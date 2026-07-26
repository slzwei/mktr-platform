/**
 * PR-4 scan-door unit battery (draw-launch-integrity §5.2/§5.3; Codex R1
 * CX7/CX22/CX23). Pure DI — covers the draw-rail unlock branch (no voucher
 * mint, no expiry overwrite, boost-receipt delivery, truthful window-closed
 * refusal), undoSessionUnlock (append-only reversal + causal linkage), the
 * resend guard, and the redemption verify/complete refusals.
 */
import { jest } from '@jest/globals';
import { makeEntitlementService, flushDeliveries } from '../../src/services/redeemOps/entitlementService.js';
import { makeRedemptionService } from '../../src/services/redeemOps/redemptionService.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const AGENT = { id: 'agent1', role: 'agent' };
const FUTURE_CUTOFF = Date.now() + 30 * 24 * 3600 * 1000;

function drawCtxOf(over = {}) {
  return {
    campaignId: 'c1', drawName: 'iPhone 17 Pro Lucky Draw', multiplier: 10,
    boostClosesAt: '2026-09-30', boostCutoffMs: FUTURE_CUTOFF, ...over,
  };
}

function mkWorld({ draw = true, status = 'eligible', drawOver = {} } = {}) {
  const row = {
    id: 'ent1', status, prospectId: 'p1', activationId: 'act1', rewardOfferId: 'off1',
    presentationTokenHash: 'HASH', tokenHash: null, tokenHint: null, unlockedVia: null,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  };
  const entitlement = {
    ...row,
    reload: jest.fn(async function reload() { Object.assign(this, row); return this; }),
  };
  const updates = [];
  const events = [];
  const deps = {
    RewardEntitlement: {
      findOne: jest.fn(async () => entitlement),
      findByPk: jest.fn(async () => entitlement),
      update: jest.fn(async (fields, opts) => {
        updates.push({ fields, where: opts.where });
        Object.assign(row, fields);
        return [1];
      }),
    },
    RedemptionEvent: {
      create: jest.fn(async (e) => { const ev = { id: `ev${events.length + 1}`, ...e }; events.push(ev); return ev; }),
      findOne: jest.fn(async () => [...events].reverse().find((e) => e.type === 'unlocked') || null),
      findAll: jest.fn(async () => []),
    },
    Prospect: { findByPk: jest.fn(async () => ({ id: 'p1', assignedAgentId: 'agent1', email: 'jo@test.local', firstName: 'Jo' })) },
    Activation: { findByPk: jest.fn(async () => ({ id: 'act1', status: 'active', campaignId: 'c1' })) },
    RewardOffer: { findByPk: jest.fn(async () => ({ id: 'off1', status: 'active', redemptionExpiryDays: 30, publicTitle: 'iPhone 17 Pro Lucky Draw Entry Pass' })) },
    sequelize: { transaction: jest.fn(async (cb) => cb({})), query: jest.fn(async () => [[{ id: 'act1' }]]), literal: (s) => s },
    inventory: { recordIssued: jest.fn(), reverseIssued: jest.fn() },
    audit: { recordAuditEvent: jest.fn(async () => ({})) },
    isSendBlocked: jest.fn(async () => false),
    drawLink: {
      drawContextForEntitlement: jest.fn(async () => (draw ? drawCtxOf(drawOver) : null)),
      drawContextForActivation: jest.fn(async () => (draw ? drawCtxOf(drawOver) : null)),
    },
    notifyBoostReceipt: jest.fn(async () => ({ sent: true, to: 'j•@test.local' })),
    notifyUnlock: jest.fn(async () => ({ sent: true, to: 'j•@test.local' })),
    notifyReservation: jest.fn(async () => ({ sent: true })),
    notifyUnlockWa: null,
    notifyReservationWa: null,
    notifyBoostReceiptWa: jest.fn(async () => ({ sent: true, to: '••••9089' })),
    logger: silentLogger,
  };
  return { deps, row, entitlement, updates, events, svc: makeEntitlementService(deps) };
}

describe('unlockEntitlement — draw rail (CX22/CX7)', () => {
  it('records the session WITHOUT minting a voucher or touching the pass expiry; boost-receipt email, not voucher email', async () => {
    const w = mkWorld();
    const res = await w.svc.unlockEntitlement({ presentationToken: 'RAW' }, AGENT, 'agent_scan');

    expect(res.drawBoost).toEqual({ multiplier: 10, boostClosesAt: '2026-09-30' });
    expect(res.voucherToken).toBeNull();
    expect(w.row.status).toBe('issued');
    const fields = w.updates[0].fields;
    expect(fields).not.toHaveProperty('tokenHash');
    expect(fields).not.toHaveProperty('tokenHint');
    expect(fields).not.toHaveProperty('expiresAt'); // reservation expiry untouched → undo is restoration-free
    expect(fields.unlockedVia).toBe('agent_scan');
    const unlockEvent = w.events.find((e) => e.type === 'unlocked');
    expect(unlockEvent.metadata).toMatchObject({ via: 'agent_scan', draw: true, multiplier: 10 });

    await flushDeliveries();
    expect(w.deps.notifyBoostReceipt).toHaveBeenCalledTimes(1);
    expect(w.deps.notifyUnlock).not.toHaveBeenCalled();
    // WhatsApp twin (draw_boost_receipt template) rides the same unlock.
    expect(w.deps.notifyBoostReceiptWa).toHaveBeenCalledTimes(1);
    expect(w.deps.notifyBoostReceiptWa.mock.calls[0][0].drawCtx).toMatchObject({ multiplier: 10 });
  });

  it('trial rails are byte-unchanged: voucher minted, redemption window set, voucher email', async () => {
    const w = mkWorld({ draw: false });
    const res = await w.svc.unlockEntitlement({ presentationToken: 'RAW' }, AGENT, 'agent_scan');
    expect(res.drawBoost).toBeNull();
    expect(typeof res.voucherToken).toBe('string');
    const fields = w.updates[0].fields;
    expect(fields.tokenHash).toBeTruthy();
    expect(fields.expiresAt).toBeInstanceOf(Date);
    await flushDeliveries();
    expect(w.deps.notifyUnlock).toHaveBeenCalledTimes(1);
    expect(w.deps.notifyBoostReceipt).not.toHaveBeenCalled();
    expect(w.deps.notifyBoostReceiptWa).not.toHaveBeenCalled();
  });

  it('REFUSES truthfully after the boost window closes — no unearned ×N confirmation (CX7)', async () => {
    const w = mkWorld({ drawOver: { boostCutoffMs: Date.now() - 1000 } });
    await expect(w.svc.unlockEntitlement({ presentationToken: 'RAW' }, AGENT, 'agent_scan'))
      .rejects.toMatchObject({ statusCode: 409, data: { code: 'DRAW_BOOST_WINDOW_CLOSED' } });
    expect(w.deps.RewardEntitlement.update).not.toHaveBeenCalled();
  });
});

describe('undoSessionUnlock (CX23)', () => {
  it('flips issued→eligible, appends unlock_reversed with the causal supersedes link, audits', async () => {
    const w = mkWorld({ status: 'issued' });
    w.events.push({ id: 'ev-original', type: 'unlocked', entitlementId: 'ent1', metadata: { via: 'agent_scan' } });

    const res = await w.svc.undoSessionUnlock('ent1', AGENT, { reason: 'wrong customer' });
    expect(w.row.status).toBe('eligible');
    expect(w.row.unlockedVia).toBeNull();
    const reversal = w.events.find((e) => e.type === 'unlock_reversed');
    expect(reversal.metadata).toMatchObject({ supersedesEventId: 'ev-original', reason: 'wrong customer' });
    expect(res.supersededEventId).toBe('ev-original');
    expect(w.deps.audit.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'entitlement.session_undone' }));
  });

  it('refuses on non-draw rails, non-issued states, and after the window closes', async () => {
    const trial = mkWorld({ draw: false, status: 'issued' });
    await expect(trial.svc.undoSessionUnlock('ent1', AGENT, {})).rejects.toMatchObject({ statusCode: 409 });

    const eligible = mkWorld({ status: 'eligible' });
    await expect(eligible.svc.undoSessionUnlock('ent1', AGENT, {})).rejects.toMatchObject({ statusCode: 409 });

    const closed = mkWorld({ status: 'issued', drawOver: { boostCutoffMs: Date.now() - 1000 } });
    await expect(closed.svc.undoSessionUnlock('ent1', AGENT, {}))
      .rejects.toMatchObject({ statusCode: 409, data: { code: 'DRAW_BOOST_WINDOW_CLOSED' } });
  });
});

describe('resendDelivery — draw guard (CX22)', () => {
  it('a recorded session resends the boost receipt, never the partner voucher', async () => {
    // wa-delivery-truth (#277) changed this contract: the draw-session resend
    // now succeeds as the informational receipt instead of rejecting 409.
    const w = mkWorld({ status: 'issued' });
    const res = await w.svc.resendDelivery('ent1', AGENT, { channel: 'email' });
    expect(res).toMatchObject({ kind: 'boost_receipt', channel: 'email', emailQueued: true });
    expect(res.entitlement.tokenHash).toBeNull();
  });
});

describe('redemptionService — draw rails are never partner-redeemable (CX22)', () => {
  function redemptionWorld({ status = 'eligible', windowOpen = true } = {}) {
    const entitlement = {
      id: 'ent1', status, activationId: 'act1', prospectId: 'p1',
      presentationTokenHash: 'H', tokenHash: null,
      rewardOffer: { publicTitle: 'Entry Pass' },
      activation: { campaignNameSnapshot: 'iPhone Draw' },
      prospect: { id: 'p1', firstName: 'Jo', lastName: 'Tan', phone: '+6591112222' },
      expiresAt: new Date(Date.now() + 864e5),
      _matchedViaPresentation: true,
    };
    const deps = {
      RewardEntitlement: { findOne: jest.fn(async () => { entitlement._matchedViaPresentation = true; return entitlement; }) },
      RedemptionEvent: { create: jest.fn(async (e) => e) },
      sequelize: { transaction: jest.fn(async (cb) => cb({})) },
      logger: silentLogger,
      drawContextForActivation: jest.fn(async () => drawCtxOf(windowOpen ? {} : { boostCutoffMs: Date.now() - 1000 })),
    };
    return { deps, svc: makeRedemptionService(deps), entitlement };
  }

  it('verify on an eligible pass → scannable "record session" affordance, never a 422', async () => {
    const w = redemptionWorld();
    const out = await w.svc.verify('TOKEN', AGENT);
    expect(out).toMatchObject({ valid: false, drawLinked: true, state: 'draw_pass', canRecordSession: true, drawMultiplier: 10 });
  });

  it('verify after the window → affordance withdrawn; recorded session reports itself', async () => {
    const closed = redemptionWorld({ windowOpen: false });
    const out = await closed.svc.verify('TOKEN', AGENT);
    expect(out).toMatchObject({ state: 'draw_pass', canRecordSession: false, boostWindowOpen: false });

    const recorded = redemptionWorld({ status: 'issued' });
    const out2 = await recorded.svc.verify('TOKEN', AGENT);
    expect(out2).toMatchObject({ state: 'draw_session_recorded', valid: false });
  });

  it('complete() hard-refuses — boost evidence is not inventory to consume', async () => {
    const w = redemptionWorld({ status: 'issued' });
    await expect(w.svc.complete('TOKEN', {}, AGENT))
      .rejects.toMatchObject({ statusCode: 409, data: { code: 'DRAW_PASS_NOT_REDEEMABLE' } });
  });
});
