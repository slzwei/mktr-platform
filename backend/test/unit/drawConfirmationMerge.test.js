/**
 * One draw signup, ONE email (2026-07-25 merge): the entry pass rides inside
 * the Onyx confirmation instead of shipping as a second, same-subject email
 * that Gmail threads into an apparent duplicate. Two seams make that true:
 *
 *  - fulfilmentNotify.sendReservationEmail with drawCtx DELEGATES to
 *    sendLeadConfirmationEmail — campaign hydrated, card + /r/ link riding as
 *    drawPass — while keeping the normalized `{ sent, to?, error? }` receipt
 *    contract the delivery sweep depends on. Trial rails keep the standalone
 *    reservation email byte-unchanged.
 *
 *  - issueForProspect surfaces `drawEmailQueued` so the capture controller
 *    can skip its own confirmation on an OBSERVED outcome, never a
 *    prediction — a skipped issuance still gets the plain confirmation.
 */
import { jest } from '@jest/globals';
import { makeFulfilmentNotify } from '../../src/services/redeemOps/fulfilmentNotify.js';
import { makeEntitlementService, flushDeliveries } from '../../src/services/redeemOps/entitlementService.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const DRAW_CTX = {
  campaignId: 'c1', drawName: 'iPhone 17 Pro Lucky Draw', multiplier: 10,
  prize: 'iPhone 17 Pro 256GB', drawOn: '2026-10-22', passTheme: 'titanium',
  boostClosesAt: '2026-09-30', boostCutoffMs: Date.now() + 30 * 864e5,
};

describe('fulfilmentNotify.sendReservationEmail — the merged draw send', () => {
  const entitlement = { id: 'ent1', rewardOfferId: 'off1', activationId: 'act1', expiresAt: new Date(Date.now() + 7 * 864e5) };
  const prospect = { id: 'p1', email: 'lai@example.com', firstName: 'lai', consumerId: 'con1', campaignId: 'c1' };

  function world(over = {}) {
    const deps = {
      RewardOffer: { findByPk: jest.fn(async () => ({ id: 'off1', publicTitle: 'Lucky Draw Entry', partner: { tradingName: 'MKTR' } })) },
      Activation: { findByPk: jest.fn(async () => ({ id: 'act1', campaignId: 'c1' })) },
      Campaign: {
        findByPk: jest.fn(async () => ({
          id: 'c1', name: 'iPhone 17 Pro Lucky Draw',
          design_config: { customerHost: 'redeem', luckyDraw: { enabled: true, passTheme: 'titanium', prize: 'iPhone 17 Pro 256GB', multiplier: 10 } },
        })),
      },
      renderQrCard: jest.fn(async () => Buffer.from('vault-card-png')),
      sendEmail: jest.fn(async () => ({ success: true })),
      sendLeadConfirmationEmail: jest.fn(async () => ({ success: true })),
      logger: silentLogger,
      ...over,
    };
    return { deps, notify: makeFulfilmentNotify(deps) };
  }

  it('draw: ONE merged Onyx send — campaign hydrated, pass card + /r/ link attached, no standalone email', async () => {
    const w = world();
    const res = await w.notify.sendReservationEmail({ entitlement, prospect, presentationToken: 'tok123', drawCtx: DRAW_CTX });

    expect(res.sent).toBe(true);
    expect(w.deps.sendLeadConfirmationEmail).toHaveBeenCalledTimes(1);
    const [mailedProspect, opts] = w.deps.sendLeadConfirmationEmail.mock.calls[0];
    expect(mailedProspect.email).toBe('lai@example.com');
    expect(mailedProspect.campaign).toMatchObject({ id: 'c1', name: 'iPhone 17 Pro Lucky Draw' });
    expect(opts.drawPass.link).toContain('/r/tok123');
    expect(Buffer.isBuffer(opts.drawPass.png)).toBe(true);
    expect(opts.drawPass.deadlineLong).toContain('September');
    // The old standalone "You're in the draw 🎉" email must NOT also fire.
    expect(w.deps.sendEmail).not.toHaveBeenCalled();
  });

  it('draw: a mailer failure resolves sent:false with the reason — receipts stay truthful, the sweep can re-send', async () => {
    const w = world({ sendLeadConfirmationEmail: jest.fn(async () => ({ success: false, message: 'SMTP down' })) });
    const res = await w.notify.sendReservationEmail({ entitlement, prospect, presentationToken: 'tok123', drawCtx: DRAW_CTX });
    expect(res).toMatchObject({ sent: false, error: 'SMTP down' });
  });

  it('trial rails keep the standalone reservation email, byte-unchanged by the merge', async () => {
    const w = world();
    const res = await w.notify.sendReservationEmail({ entitlement, prospect, presentationToken: 'tok123', drawCtx: null });
    expect(res.sent).toBe(true);
    expect(w.deps.sendLeadConfirmationEmail).not.toHaveBeenCalled();
    expect(w.deps.sendEmail).toHaveBeenCalledTimes(1);
    expect(w.deps.sendEmail.mock.calls[0][0].subject).toContain('Reserved for you');
  });

  it('synthetic Retell address: skipped before anything loads', async () => {
    const w = world();
    const res = await w.notify.sendReservationEmail({
      entitlement, prospect: { ...prospect, email: 'retell-abc@calls.mktr.sg' }, presentationToken: 't', drawCtx: DRAW_CTX,
    });
    expect(res).toEqual({ sent: false, skipped: 'no_email' });
    expect(w.deps.sendLeadConfirmationEmail).not.toHaveBeenCalled();
    expect(w.deps.sendEmail).not.toHaveBeenCalled();
  });
});

describe('issueForProspect — the drawEmailQueued signal', () => {
  function issueWorld({ draw = true, unlockPolicy = 'agent_unlock', email = 'lai@example.com' } = {}) {
    const offer = { id: 'off1', status: 'active', claimExpiryDays: 7, redemptionExpiryDays: 30 };
    const activation = { id: 'act1', campaignId: 'c1', status: 'active', unlockPolicy, endDate: null, rewardOffer: offer };
    const prospect = {
      id: 'p1', campaignId: 'c1', phone: '+6591234567', email, firstName: 'lai', consumerId: 'con1',
      sourceMetadata: { phoneVerifiedAt: '2026-07-25T00:00:00Z' },
    };
    const deps = {
      Activation: { findOne: jest.fn(async () => activation), findByPk: jest.fn(async () => activation) },
      RewardOffer: {}, // model ref for the include clause only
      RewardEntitlement: {
        findOne: jest.fn(async () => null),
        create: jest.fn(async (row) => ({ id: 'ent1', ...row })),
      },
      ActivationIssuanceSkip: { create: jest.fn(async () => ({})) },
      Consumer: { findOne: jest.fn(async () => null) },
      Prospect: { findByPk: jest.fn(async () => prospect) },
      RedemptionEvent: { create: jest.fn(async (e) => e) },
      sequelize: { transaction: jest.fn(async (cb) => cb({})), query: jest.fn(async () => [[{ id: 'act1' }]]) },
      inventory: { recordIssued: jest.fn() },
      isSendBlocked: jest.fn(async () => false),
      drawLink: { drawContextForActivation: jest.fn(async () => (draw ? DRAW_CTX : null)) },
      notifyReservation: jest.fn(async () => ({ sent: true })),
      notifyUnlock: jest.fn(async () => ({ sent: true })),
      notifyReservationWa: null,
      notifyUnlockWa: null,
      logger: silentLogger,
    };
    return { deps, prospect, svc: makeEntitlementService(deps) };
  }

  it('draw + agent_unlock + emailable → drawEmailQueued: the merged email owns the confirmation', async () => {
    const w = issueWorld();
    const res = await w.svc.issueForProspect(w.prospect, { via: 'hook' });
    expect(res.reason).toBeNull();
    expect(res.emailQueued).toBe(true);
    expect(res.drawEmailQueued).toBe(true);
    await flushDeliveries();
    expect(w.deps.notifyReservation).toHaveBeenCalledTimes(1);
  });

  it('non-draw issuance never claims the confirmation', async () => {
    const w = issueWorld({ draw: false });
    const res = await w.svc.issueForProspect(w.prospect, { via: 'hook' });
    expect(res.reason).toBeNull();
    expect(res.drawEmailQueued).toBe(false);
    await flushDeliveries();
  });

  it('a no-email lead cannot mark the confirmation covered (its WhatsApp leg may still fire)', async () => {
    const w = issueWorld({ email: 'retell-abc@calls.mktr.sg' });
    const res = await w.svc.issueForProspect(w.prospect, { via: 'hook' });
    expect(res.emailQueued).toBe(false);
    expect(res.drawEmailQueued).toBe(false);
    await flushDeliveries();
  });

  it('an on_capture voucher rail never claims it either — it confirms a reward, not a draw entry', async () => {
    const w = issueWorld({ unlockPolicy: 'on_capture' });
    const res = await w.svc.issueForProspect(w.prospect, { via: 'hook' });
    expect(res.drawEmailQueued).toBe(false);
    await flushDeliveries();
  });
});
