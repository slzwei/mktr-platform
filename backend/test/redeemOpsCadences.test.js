/**
 * P1 cadence engine (docs/plans/redeem-ops-cadences.md §5): enroll → disposition
 * completion → edge advance → exits (terminal, hooks, sweep) → reconcile,
 * plus the generic-PATCH guard, scheduling clamp, suppressions, and queue dedup.
 */
process.env.REDEEM_OPS_ENABLED = 'true';
process.env.REDEEM_OPS_CADENCES_ENABLED = 'true';

import request from 'supertest';
import { getApp, closeDb, createTestUser } from './helpers.js';
import {
  PartnerOrganisation, OutreachTask, OutreachActivity,
  OutreachCadence, OutreachCadenceEnrollment, OutreachSuppression, User, sequelize,
} from '../src/models/index.js';
import { makeCadenceService, sgtWindowClamp } from '../src/services/redeemOps/cadenceService.js';
import { ensureCadences } from '../src/services/redeemOps/cadenceSeeds.js';
import { registerCadenceHooks, clearCadenceHooks } from '../src/services/redeemOps/cadenceHooks.js';
import { makePartnerService } from '../src/services/redeemOps/partnerService.js';
import { makeClaimService } from '../src/services/redeemOps/claimService.js';
import { makeTaskService } from '../src/services/redeemOps/taskService.js';
import { runRedeemOpsStaleSweep } from '../src/services/redeemOps/staleSweep.js';

let app;
let admin, execA, execB;
const svc = makeCadenceService();
const partnerSvc = makePartnerService();
const claimSvc = makeClaimService();
const taskSvc = makeTaskService();

let phoneSeq = 81000000;
const nextPhone = () => `+65${phoneSeq++}`;

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  execA = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
  execB = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
  // the app boot may have created the system agent already — don't collide
  await User.findOrCreate({
    where: { email: 'system@mktr.local' },
    defaults: {
      firstName: 'System', lastName: 'Agent', role: 'admin',
      isActive: true, emailVerified: true, password: 'TestPassword123!',
    },
  });
  await ensureCadences();
  registerCadenceHooks(svc.hookHandlers());
});

afterAll(async () => {
  clearCadenceHooks();
  await closeDb();
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function ownedPartner(name, owner = execA, patch = {}) {
  const { partner } = await partnerSvc.createPartner(
    { tradingName: name, primaryPhone: nextPhone() }, admin.user
  );
  await claimSvc.claimPartner(partner.id, owner.user);
  if (Object.keys(patch).length) await partner.update(patch);
  return PartnerOrganisation.findByPk(partner.id);
}

async function openCadenceTask(enrollmentId) {
  return OutreachTask.findOne({
    where: { cadenceEnrollmentId: enrollmentId, status: ['open', 'in_progress'] },
  });
}

describe('seeds', () => {
  test('two cadences seeded, idempotently', async () => {
    const again = await ensureCadences();
    expect(again.seeded).toBe(0);
    const fnb = await OutreachCadence.findOne({ where: { key: 'fnb_call_first', version: 1 } });
    expect(fnb).toBeTruthy();
    const cadences = await svc.listCadences();
    const keys = cadences.map((c) => c.key).sort();
    expect(keys).toEqual(['fnb_call_first', 'revival_60d']);
    expect(cadences.find((c) => c.key === 'fnb_call_first').steps).toHaveLength(7);
  });
});

describe('sgtWindowClamp', () => {
  const at = (iso) => new Date(iso);
  test('delay-0 with the window already past is due NOW, not tomorrow', () => {
    const now = at('2026-07-12T12:00:00Z'); // 20:00 SGT — past every window
    expect(sgtWindowClamp(now, 0, 'any', now).getTime()).toBe(now.getTime());
  });
  test('delay-0 before the window lands on today’s window start', () => {
    const now = at('2026-07-11T21:00:00Z'); // 05:00 SGT 12 Jul
    expect(sgtWindowClamp(now, 0, 'off_peak', now).toISOString()).toBe('2026-07-12T07:00:00.000Z'); // 15:00 SGT
  });
  test('delayed steps land on the window start N days out', () => {
    const now = at('2026-07-12T04:00:00Z'); // 12:00 SGT
    expect(sgtWindowClamp(now, 2, 'off_peak', now).toISOString()).toBe('2026-07-14T07:00:00.000Z');
  });
  test('stale anchors roll forward until the due date is in the future', () => {
    const now = at('2026-07-12T04:00:00Z');
    const oldAnchor = at('2026-07-01T04:00:00Z');
    expect(sgtWindowClamp(oldAnchor, 1, 'morning', now).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('enroll', () => {
  test('enrolls an owned partner: first task materialized with provenance + recipient snapshot', async () => {
    const p = await ownedPartner('Cadence Enroll Cafe');
    const { enrollment, firstTask } = await svc.enrollPartner(p.id, { cadenceKey: 'fnb_call_first' }, execA.user);
    expect(enrollment.state).toBe('active');
    expect(firstTask.title).toBe('Intro call');
    expect(firstTask.assigneeUserId).toBe(execA.user.id);
    expect(firstTask.cadenceEnrollmentId).toBe(enrollment.id);
    expect(firstTask.snapshotRecipient).toBe(p.primaryPhone);
  });

  test('unowned partners and double-enrollment are refused', async () => {
    const { partner } = await partnerSvc.createPartner({ tradingName: 'Unowned Cafe', primaryPhone: nextPhone() }, admin.user);
    await expect(svc.enrollPartner(partner.id, { cadenceKey: 'fnb_call_first' }, admin.user))
      .rejects.toMatchObject({ statusCode: 409 });

    const p = await ownedPartner('Double Enroll Cafe');
    await svc.enrollPartner(p.id, { cadenceKey: 'fnb_call_first' }, execA.user);
    await expect(svc.enrollPartner(p.id, { cadenceKey: 'revival_60d' }, execA.user))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  test('per-owner capacity cap: refused at cap, manager may override', async () => {
    const capped = makeCadenceService({ enrollmentCap: 1 });
    const owner = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
    const p1 = await ownedPartner('Cap Cafe 1', owner);
    const p2 = await ownedPartner('Cap Cafe 2', owner);
    await capped.enrollPartner(p1.id, { cadenceKey: 'fnb_call_first' }, owner.user);
    await expect(capped.enrollPartner(p2.id, { cadenceKey: 'fnb_call_first' }, owner.user))
      .rejects.toMatchObject({ statusCode: 409 });
    const ok = await capped.enrollPartner(p2.id, { cadenceKey: 'fnb_call_first', overrideCapacity: true }, admin.user);
    expect(ok.enrollment.state).toBe('active');
  });

  test('route: enroll via POST returns 201', async () => {
    const p = await ownedPartner('Route Enroll Cafe');
    const res = await request(app)
      .post(`/api/redeem-ops/partners/${p.id}/cadence/enroll`)
      .set(auth(execA.token))
      .send({ cadenceKey: 'fnb_call_first' });
    expect(res.status).toBe(201);
    expect(res.body.data.firstTask.title).toBe('Intro call');
  });
});

describe('completion & advance', () => {
  test('no_answer branches to the same-day WhatsApp; honest activity + firstOutreachAt', async () => {
    const p = await ownedPartner('Advance Cafe');
    const { enrollment, firstTask } = await svc.enrollPartner(p.id, { cadenceKey: 'fnb_call_first' }, execA.user);

    const result = await svc.completeCadenceTask(firstTask.id, { disposition: 'no_answer' }, execA.user);
    expect(result.nextTask.title).toContain('WhatsApp intro');

    const acts = await OutreachActivity.findAll({ where: { partnerOrganisationId: p.id } });
    expect(acts.some((a) => a.type === 'call_attempt' && a.direction === 'outbound')).toBe(true);
    const reloaded = await PartnerOrganisation.findByPk(p.id);
    expect(reloaded.firstOutreachAt).toBeTruthy();

    // WhatsApp 'sent' → call #2, two days out in the off-peak window (15:00 SGT)
    const r2 = await svc.completeCadenceTask(result.nextTask.id, { disposition: 'sent' }, execA.user);
    expect(r2.nextTask.title).toContain('Call #2');
    expect(new Date(r2.nextTask.dueAt).getTime()).toBeGreaterThan(Date.now() + 24 * 3600 * 1000);
    expect(new Date(r2.nextTask.dueAt).getUTCHours()).toBe(7); // 15:00 SGT

    const e = await OutreachCadenceEnrollment.findByPk(enrollment.id);
    expect(e.state).toBe('active');
    expect(e.lastDisposition).toBe('sent');
  });

  test('double-completion and channel-invalid dispositions are refused', async () => {
    const p = await ownedPartner('Refusal Cafe');
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceKey: 'fnb_call_first' }, execA.user);
    await expect(svc.completeCadenceTask(firstTask.id, { disposition: 'sent' }, execA.user))
      .rejects.toMatchObject({ statusCode: 400 }); // call step has no 'sent'
    await svc.completeCadenceTask(firstTask.id, { disposition: 'no_answer' }, execA.user);
    await expect(svc.completeCadenceTask(firstTask.id, { disposition: 'no_answer' }, execA.user))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  test("'replied' exits the enrollment and leaves no open cadence task", async () => {
    const p = await ownedPartner('Replied Cafe');
    const { enrollment, firstTask } = await svc.enrollPartner(p.id, { cadenceKey: 'fnb_call_first' }, execA.user);
    await svc.completeCadenceTask(firstTask.id, { disposition: 'replied' }, execA.user);
    const e = await OutreachCadenceEnrollment.findByPk(enrollment.id);
    expect(e.state).toBe('exited');
    expect(e.exitReason).toBe('replied');
    expect(await openCadenceTask(enrollment.id)).toBeNull();
  });

  test('not_interested + alsoMarkLost exits AND moves the stage in one transaction', async () => {
    const p = await ownedPartner('NotInterested Cafe');
    const { enrollment, firstTask } = await svc.enrollPartner(p.id, { cadenceKey: 'fnb_call_first' }, execA.user);
    const res = await request(app)
      .post(`/api/redeem-ops/cadence-tasks/${firstTask.id}/complete`)
      .set(auth(execA.token))
      .send({ disposition: 'not_interested', alsoMarkLost: true, lostReason: 'not_interested' });
    expect(res.status).toBe(200);
    const e = await OutreachCadenceEnrollment.findByPk(enrollment.id);
    expect(e.exitReason).toBe('not_interested');
    const reloaded = await PartnerOrganisation.findByPk(p.id);
    expect(reloaded.pipelineStage).toBe('LOST');
    expect(reloaded.lostReason).toBe('not_interested');
  });

  test('generic PATCH refuses cadence-task status changes but allows description edits', async () => {
    const p = await ownedPartner('Guard Cafe');
    const { firstTask } = await svc.enrollPartner(p.id, { cadenceKey: 'fnb_call_first' }, execA.user);
    await expect(taskSvc.updateTask(firstTask.id, { status: 'completed' }, execA.user))
      .rejects.toMatchObject({ statusCode: 409 });
    const edited = await taskSvc.updateTask(firstTask.id, { description: 'prep note' }, execA.user);
    expect(edited.description).toBe('prep note');
  });
});

describe('hook-driven exits and pauses', () => {
  test('a real inbound reply exits the cadence and cancels its task', async () => {
    const p = await ownedPartner('Inbound Exit Cafe');
    const { enrollment } = await svc.enrollPartner(p.id, { cadenceKey: 'fnb_call_first' }, execA.user);
    await partnerSvc.logActivity(p.id, { type: 'whatsapp_reply', direction: 'inbound', summary: 'they wrote back' }, execA.user);
    const e = await OutreachCadenceEnrollment.findByPk(enrollment.id);
    expect(e.state).toBe('exited');
    expect(e.exitReason).toBe('replied');
    expect(await openCadenceTask(enrollment.id)).toBeNull();
  });

  test('stage moves: CONTACTED keeps the cadence, MEETING exits it', async () => {
    const p = await ownedPartner('Stage Exit Cafe');
    const { enrollment } = await svc.enrollPartner(p.id, { cadenceKey: 'fnb_call_first' }, execA.user);
    await partnerSvc.changeStage(p.id, 'CONTACTED', execA.user);
    expect((await OutreachCadenceEnrollment.findByPk(enrollment.id)).state).toBe('active');
    await partnerSvc.changeStage(p.id, 'MEETING', execA.user);
    const e = await OutreachCadenceEnrollment.findByPk(enrollment.id);
    expect(e.state).toBe('exited');
    expect(e.exitReason).toBe('stage_advanced');
  });

  test('snooze pauses + cancels; manual unsnooze resumes with a fresh task', async () => {
    const p = await ownedPartner('Snooze Cafe');
    const { enrollment } = await svc.enrollPartner(p.id, { cadenceKey: 'fnb_call_first' }, execA.user);
    await partnerSvc.snoozePartner(p.id, execA.user, new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString());
    let e = await OutreachCadenceEnrollment.findByPk(enrollment.id);
    expect(e.state).toBe('paused');
    expect(await openCadenceTask(enrollment.id)).toBeNull();

    await partnerSvc.unsnoozePartner(p.id, execA.user);
    e = await OutreachCadenceEnrollment.findByPk(enrollment.id);
    expect(e.state).toBe('active');
    expect(await openCadenceTask(enrollment.id)).toBeTruthy();
  });

  test('sweep wake resumes a snooze-paused cadence', async () => {
    const p = await ownedPartner('Sweep Wake Cafe');
    const { enrollment } = await svc.enrollPartner(p.id, { cadenceKey: 'fnb_call_first' }, execA.user);
    await partnerSvc.snoozePartner(p.id, execA.user, new Date(Date.now() + 24 * 3600 * 1000).toISOString());
    await sequelize.query(
      `UPDATE partner_organisations SET "snoozedUntil" = NOW() - INTERVAL '1 hour' WHERE id = :id`,
      { replacements: { id: p.id } }
    );
    await runRedeemOpsStaleSweep();
    const e = await OutreachCadenceEnrollment.findByPk(enrollment.id);
    expect(e.state).toBe('active');
    expect(await openCadenceTask(enrollment.id)).toBeTruthy();
  });

  test('release exits; reassign keeps the enrollment and moves the task', async () => {
    const p1 = await ownedPartner('Release Cafe');
    const { enrollment: e1 } = await svc.enrollPartner(p1.id, { cadenceKey: 'fnb_call_first' }, execA.user);
    await claimSvc.releasePartner(p1.id, execA.user);
    expect((await OutreachCadenceEnrollment.findByPk(e1.id)).exitReason).toBe('released');

    const p2 = await ownedPartner('Reassign Cafe');
    const { enrollment: e2 } = await svc.enrollPartner(p2.id, { cadenceKey: 'fnb_call_first' }, execA.user);
    await claimSvc.assignPartner(p2.id, execB.user.id, admin.user);
    expect((await OutreachCadenceEnrollment.findByPk(e2.id)).state).toBe('active');
    expect((await openCadenceTask(e2.id)).assigneeUserId).toBe(execB.user.id);
  });

  test('merge exits the duplicate’s enrollment (before task repointing)', async () => {
    const survivor = await ownedPartner('Merge Survivor Cadence');
    const dup = await ownedPartner('Merge Dup Cadence');
    const { enrollment } = await svc.enrollPartner(dup.id, { cadenceKey: 'fnb_call_first' }, execA.user);
    await partnerSvc.mergePartners(survivor.id, dup.id, admin.user);
    const e = await OutreachCadenceEnrollment.findByPk(enrollment.id);
    expect(e.state).toBe('exited');
    expect(e.exitReason).toBe('merged');
    expect(await openCadenceTask(enrollment.id)).toBeNull();
  });

  test('manual pause/stop endpoints', async () => {
    const p = await ownedPartner('PauseStop Cafe');
    await svc.enrollPartner(p.id, { cadenceKey: 'fnb_call_first' }, execA.user);
    const paused = await request(app).post(`/api/redeem-ops/partners/${p.id}/cadence/pause`).set(auth(execA.token));
    expect(paused.status).toBe(200);
    // pausing a cadence does NOT snooze the partner (pause ≠ snooze)
    expect((await PartnerOrganisation.findByPk(p.id)).availability).toBe('owned');
    const resumed = await request(app).post(`/api/redeem-ops/partners/${p.id}/cadence/resume`).set(auth(execA.token));
    expect(resumed.status).toBe(200);
    const stopped = await request(app).post(`/api/redeem-ops/partners/${p.id}/cadence/stop`).set(auth(execA.token));
    expect(stopped.status).toBe(200);
    expect(stopped.body.data.enrollment.exitReason).toBe('manual_stop');
  });
});

describe('suppressions', () => {
  test("an 'any'-channel suppression blocks every step → enrollment finishes immediately", async () => {
    const p = await ownedPartner('Suppressed Cafe');
    await OutreachSuppression.create({ channel: 'any', value: p.primaryPhone, reason: 'opt_out' });
    // IG / visit steps blocked too (no handle, no location), so the chain finishes
    const { enrollment, finishedImmediately } = await svc.enrollPartner(p.id, { cadenceKey: 'fnb_call_first' }, execA.user);
    expect(finishedImmediately).toBe(true);
    const e = await OutreachCadenceEnrollment.findByPk(enrollment.id);
    expect(e.state).toBe('completed');
    expect(await openCadenceTask(enrollment.id)).toBeNull();
  });
});

describe('queue accounting', () => {
  test('a scheduled cadence first touch removes the partner from awaiting-first-outreach', async () => {
    const owner = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' });
    const enrolled = await ownedPartner('Queue Dedup Enrolled', owner);
    const bare = await ownedPartner('Queue Dedup Bare', owner);
    await svc.enrollPartner(enrolled.id, { cadenceKey: 'fnb_call_first' }, owner.user);

    const res = await request(app).get('/api/redeem-ops/queue').set(auth(owner.token));
    expect(res.status).toBe(200);
    const awaitingIds = res.body.data.awaitingFirstOutreach.items.map((x) => x.id);
    expect(awaitingIds).toContain(bare.id);
    expect(awaitingIds).not.toContain(enrolled.id);
    // and the queue exposes the cadence chip data on the task
    const allTasks = [
      ...res.body.data.overdueTasks.items,
      ...res.body.data.dueTodayTasks.items,
      ...res.body.data.upcomingTasks.items,
    ];
    const chip = allTasks.find((tk) => tk.partner?.id === enrolled.id);
    expect(chip?.cadenceStep?.cadence?.key).toBe('fnb_call_first');
  });
});

describe('reconcile', () => {
  test('re-materializes the task for an orphaned active enrollment', async () => {
    const p = await ownedPartner('Reconcile Cafe');
    const { enrollment } = await svc.enrollPartner(p.id, { cadenceKey: 'fnb_call_first' }, execA.user);
    await sequelize.query(
      `UPDATE outreach_tasks SET status = 'cancelled' WHERE "cadenceEnrollmentId" = :eid`,
      { replacements: { eid: enrollment.id } }
    );
    await sequelize.query(
      `UPDATE outreach_cadence_enrollments SET "updatedAt" = NOW() - INTERVAL '20 minutes' WHERE id = :eid`,
      { replacements: { eid: enrollment.id } }
    );
    const result = await svc.reconcile();
    expect(result.repaired).toBeGreaterThanOrEqual(1);
    expect(await openCadenceTask(enrollment.id)).toBeTruthy();
  });
});
