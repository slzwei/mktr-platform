/**
 * P0 cadence tx-primitives + hook registry (docs/plans/redeem-ops-cadences.md §3).
 * Proves: hooks fire inside the owning transaction at every CRM choke point,
 * a throwing hook rolls the whole operation back, nothing registered = no-op
 * (dark-ship), and the *Tx primitives compose into one caller transaction.
 */
process.env.REDEEM_OPS_ENABLED = 'true';

import { jest } from '@jest/globals';
import { getApp, closeDb, createTestUser } from './helpers.js';
import {
  PartnerOrganisation, PartnerStageEvent, OutreachActivity, OutreachTask, sequelize,
} from '../src/models/index.js';
import { makePartnerService } from '../src/services/redeemOps/partnerService.js';
import { makeClaimService } from '../src/services/redeemOps/claimService.js';
import { makeTaskService } from '../src/services/redeemOps/taskService.js';
import {
  registerCadenceHooks, clearCadenceHooks, fireCadenceHook,
} from '../src/services/redeemOps/cadenceHooks.js';
import { runRedeemOpsStaleSweep } from '../src/services/redeemOps/staleSweep.js';

let admin, exec;
const partnerSvc = makePartnerService();
const claimSvc = makeClaimService();
const taskSvc = makeTaskService();

beforeAll(async () => {
  await getApp();
  admin = await createTestUser({ role: 'admin' });
  exec = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
});

afterEach(() => clearCadenceHooks());
afterAll(async () => {
  await closeDb();
});

async function makePartner(name, patch = {}) {
  const { partner } = await partnerSvc.createPartner({ tradingName: name }, admin.user);
  if (Object.keys(patch).length) await partner.update(patch);
  return partner;
}

const future = (days = 1) => new Date(Date.now() + days * 24 * 3600 * 1000);

describe('registry', () => {
  test('unknown hook names are rejected at register and fire time', async () => {
    expect(() => registerCadenceHooks({ onSomethingElse: () => {} })).toThrow(/Unknown cadence hook/);
    await expect(fireCadenceHook('onSomethingElse', {})).rejects.toThrow(/Unknown cadence hook/);
  });

  test('nothing registered → fire is a no-op (dark-ship default)', async () => {
    await expect(fireCadenceHook('onStageChange', {})).resolves.toBeUndefined();
  });
});

describe('onStageChange', () => {
  test('fires inside the transaction with from/to stages', async () => {
    const partner = await makePartner('Hook Stage Cafe', { pipelineStage: 'NEW' });
    const spy = jest.fn();
    registerCadenceHooks({ onStageChange: spy });

    await partnerSvc.changeStage(partner.id, 'CONTACTED', admin.user);
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0][0];
    expect(payload.fromStage).toBe('NEW');
    expect(payload.toStage).toBe('CONTACTED');
    expect(payload.partner.id).toBe(partner.id);
    expect(payload.transaction).toBeTruthy();
  });

  test('same-stage move does not fire', async () => {
    const partner = await makePartner('Hook Stage Same', { pipelineStage: 'NEW' });
    const spy = jest.fn();
    registerCadenceHooks({ onStageChange: spy });
    await partnerSvc.changeStage(partner.id, 'NEW', admin.user);
    expect(spy).not.toHaveBeenCalled();
  });

  test('a throwing hook rolls back the stage change atomically', async () => {
    const partner = await makePartner('Hook Rollback Cafe', { pipelineStage: 'NEW' });
    registerCadenceHooks({ onStageChange: () => { throw new Error('cadence says no'); } });

    await expect(partnerSvc.changeStage(partner.id, 'CONTACTED', admin.user))
      .rejects.toThrow('cadence says no');

    const reloaded = await PartnerOrganisation.findByPk(partner.id);
    expect(reloaded.pipelineStage).toBe('NEW');
    const events = await PartnerStageEvent.count({ where: { partnerOrganisationId: partner.id } });
    expect(events).toBe(0);
  });
});

describe('onInboundActivity', () => {
  test('meaningful inbound fires; outbound and internal notes do not', async () => {
    const partner = await makePartner('Hook Inbound Cafe');
    const spy = jest.fn();
    registerCadenceHooks({ onInboundActivity: spy });

    await partnerSvc.logActivity(partner.id, {
      type: 'whatsapp_reply', direction: 'inbound', summary: 'They replied!',
    }, admin.user);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].activity.type).toBe('whatsapp_reply');
    expect(spy.mock.calls[0][0].transaction).toBeTruthy();

    await partnerSvc.logActivity(partner.id, {
      type: 'call_attempt', summary: 'rang, no answer',
    }, admin.user);
    await partnerSvc.logActivity(partner.id, {
      type: 'internal_note', direction: 'inbound', summary: 'note to self',
    }, admin.user);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('suppressCadenceHooks keeps the engine-logged activity out of the loop', async () => {
    const partner = await makePartner('Hook Suppress Cafe');
    const spy = jest.fn();
    registerCadenceHooks({ onInboundActivity: spy });

    await sequelize.transaction(async (t) => {
      await partnerSvc.logActivityTx(partner.id, {
        type: 'email_reply', direction: 'inbound', summary: 'reply recorded by engine',
      }, admin.user, t, { suppressCadenceHooks: true });
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('onSnooze / onUnsnooze', () => {
  test('manual snooze and wake fire with source', async () => {
    const partner = await makePartner('Hook Snooze Cafe', { pipelineStage: 'CONTACTED' });
    const snoozeSpy = jest.fn();
    const wakeSpy = jest.fn();
    registerCadenceHooks({ onSnooze: snoozeSpy, onUnsnooze: wakeSpy });

    await partnerSvc.snoozePartner(partner.id, admin.user, future(10).toISOString());
    expect(snoozeSpy).toHaveBeenCalledTimes(1);
    expect(snoozeSpy.mock.calls[0][0].transaction).toBeTruthy();

    await partnerSvc.unsnoozePartner(partner.id, admin.user);
    expect(wakeSpy).toHaveBeenCalledTimes(1);
    expect(wakeSpy.mock.calls[0][0].source).toBe('manual');
  });

  test('stale-sweep wake fires onUnsnooze per woken partner and survives hook failures', async () => {
    const partner = await makePartner('Hook Sweep Wake Cafe', {
      pipelineStage: 'CONTACTED',
      availability: 'follow_up_later',
      snoozedUntil: new Date(Date.now() - 3600 * 1000),
    });
    const calls = [];
    registerCadenceHooks({
      onUnsnooze: (p) => {
        calls.push(p);
        throw new Error('resume failed'); // must not crash the sweep
      },
    });

    await expect(runRedeemOpsStaleSweep()).resolves.toBeTruthy();
    const mine = calls.find((c) => c.partnerId === partner.id);
    expect(mine).toBeTruthy();
    expect(mine.source).toBe('sweep');

    const reloaded = await PartnerOrganisation.findByPk(partner.id);
    expect(reloaded.availability).toBe('available');
    expect(reloaded.snoozedUntil).toBeNull();
  });
});

describe('onRelease / onReassign', () => {
  test('release fires after a claim', async () => {
    const partner = await makePartner('Hook Release Cafe');
    const spy = jest.fn();
    registerCadenceHooks({ onRelease: spy });

    await claimSvc.claimPartner(partner.id, exec.user);
    await claimSvc.releasePartner(partner.id, exec.user);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].partnerId).toBe(partner.id);
    expect(spy.mock.calls[0][0].transaction).toBeTruthy();
  });

  test('reassign fires with from/to users', async () => {
    const partner = await makePartner('Hook Reassign Cafe');
    const spy = jest.fn();
    registerCadenceHooks({ onReassign: spy });

    await claimSvc.assignPartner(partner.id, exec.user.id, admin.user);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].toUserId).toBe(exec.user.id);
    expect(spy.mock.calls[0][0].transaction).toBeTruthy();
  });
});

describe('onMergeDuplicate', () => {
  test('fires BEFORE child repointing — duplicate still owns its tasks at hook time', async () => {
    const survivor = await makePartner('Merge Survivor Cafe');
    const duplicate = await makePartner('Merge Duplicate Cafe');
    const task = await taskSvc.createTask({
      title: 'Call the dup', partnerOrganisationId: duplicate.id, dueAt: future(2).toISOString(),
    }, admin.user);

    let tasksOnDuplicateAtHookTime = null;
    registerCadenceHooks({
      onMergeDuplicate: async ({ duplicate: dup, transaction }) => {
        tasksOnDuplicateAtHookTime = await OutreachTask.count({
          where: { partnerOrganisationId: dup.id }, transaction,
        });
      },
    });

    await partnerSvc.mergePartners(survivor.id, duplicate.id, admin.user);
    expect(tasksOnDuplicateAtHookTime).toBe(1);

    const moved = await OutreachTask.findByPk(task.id);
    expect(moved.partnerOrganisationId).toBe(survivor.id);
  });
});

describe('tx primitives compose (the point of P0)', () => {
  test('logActivityTx + changeStageTx commit atomically in one caller transaction', async () => {
    const partner = await makePartner('Composed Flow Cafe', { pipelineStage: 'NEW' });

    await sequelize.transaction(async (t) => {
      await partnerSvc.logActivityTx(partner.id, {
        type: 'call_connected', summary: 'spoke to owner',
      }, admin.user, t, { suppressCadenceHooks: true });
      await partnerSvc.changeStageTx(partner.id, 'CONTACTED', admin.user, t);
    });

    const reloaded = await PartnerOrganisation.findByPk(partner.id);
    expect(reloaded.pipelineStage).toBe('CONTACTED');
    expect(reloaded.firstOutreachAt).toBeTruthy();
    const acts = await OutreachActivity.count({ where: { partnerOrganisationId: partner.id } });
    expect(acts).toBe(1);
  });

  test('behavior lock: completing the only open task still clears nextTaskAt', async () => {
    const partner = await makePartner('Task Behavior Cafe');
    const task = await taskSvc.createTask({
      title: 'One task', partnerOrganisationId: partner.id, dueAt: future(3).toISOString(),
    }, admin.user);
    let row = await PartnerOrganisation.findByPk(partner.id);
    expect(row.nextTaskAt).toBeTruthy();

    await taskSvc.updateTask(task.id, { status: 'completed' }, admin.user);
    row = await PartnerOrganisation.findByPk(partner.id);
    expect(row.nextTaskAt).toBeNull();
  });
});
