/**
 * P3-1: the two stages extracted out of createProspect, exercised directly.
 *
 * This coverage could not exist before the refactor. Both stages were closures
 * inside a ~1,200-line function, reaching ~20 enclosing variables each, so the
 * only way to reach either one was to drive a full HTTP capture against a real
 * Postgres. Now they are DI factories with a named ctx, and the decisions that
 * matter — gate precedence, hold bookkeeping, dispatch suppression — can be
 * asserted with stubs and no database.
 *
 * The behaviour asserted here is the behaviour that already existed; these are
 * characterization tests pinning it in place, which is what makes the next
 * decomposition step safe.
 */
import { jest } from '@jest/globals';
import '../setup.js';
import { makeCreateTxRunner } from '../../src/services/prospectCreateTx.js';
import { makeDispatchRunner } from '../../src/services/prospectDispatch.js';

const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };

/** A transaction stub that just runs the callback — no savepoints, no database. */
const fakeTransaction = (a, b) => (typeof a === 'function' ? a('t') : b('sp'));

function txDeps(overrides = {}) {
  const created = [];
  const activities = [];
  const d = {
    sequelize: { transaction: fakeTransaction, literal: (s) => ({ literal: s }) },
    decideAssignment: jest.fn().mockResolvedValue({ action: 'assign', assignedAgentId: 'agent-1', charged: false }),
    chargeLeadCredit: jest.fn(),
    resolveConsumerForCaptureTx: jest.fn().mockResolvedValue('consumer-1'),
    recordCaptureConsentEventsTx: jest.fn().mockResolvedValue(undefined),
    buildFactSnapshot: jest.fn().mockReturnValue({ facts: [] }),
    enqueueMapJobsTx: jest.fn().mockResolvedValue(undefined),
    deductLeadCredit: jest.fn().mockResolvedValue(undefined),
    deductExternalLeadBalance: jest.fn().mockResolvedValue(true),
    AppError: class extends Error {},
    logger,
    ...overrides,
  };
  const m = {
    User: { findByPk: jest.fn().mockResolvedValue(null) },
    Prospect: {
      create: jest.fn(async (attrs) => {
        const row = { id: 'p-1', ...attrs };
        created.push(row);
        return row;
      }),
    },
    ProspectActivity: { create: jest.fn(async (a) => { activities.push(a); return a; }) },
  };
  return { d, m, created, activities };
}

const baseCtx = {
  incoming: { campaignId: 'c-1', phone: '6591234567', leadSource: 'website' },
  user: { id: 'u-1' },
  sourceCampaign: { name: 'Camp' },
  sourceQrTag: null,
  assignedAgentId: 'agent-1',
  externalAgentId: null,
  externalHold: false,
  externalHoldReason: null,
  routeVia: 'direct',
  dncBlockApplies: false,
  dncWillCheck: false,
  screeningWanted: false,
  otpMarkerLive: true,
  eventSourceUrl: null,
  consentContact: true,
  consentTerms: true,
  consentCopyVersion: '2026-07-21',
  externalConsent: null,
  dncConsent: null,
  acceptedProfileFacts: [],
};

describe('createProspect PERSIST stage (unit)', () => {
  it('assigns and reports the committed agent when nothing gates the lead', async () => {
    const { d, m } = txDeps();
    const out = await makeCreateTxRunner({ d, m })(baseCtx);

    expect(out.quarantined).toBe(false);
    expect(out.heldReason).toBeNull();
    expect(out.finalAgentId).toBe('agent-1');
    expect(out.prospect.assignedAgentId).toBe('agent-1');
    expect(out.prospect.consumerId).toBe('consumer-1');
    expect(d.deductLeadCredit).toHaveBeenCalled();
  });

  it('holds for DNC and stashes the intended agent on the row', async () => {
    const { d, m } = txDeps();
    // bakeHoldTargetAgentId reads User.findByPk to decide whether to keep the id.
    m.User.findByPk = jest.fn().mockResolvedValue({ id: 'agent-1', isActive: true, role: 'agent' });

    const out = await makeCreateTxRunner({ d, m })({ ...baseCtx, dncBlockApplies: true, dncWillCheck: true });

    expect(out.quarantined).toBe(true);
    expect(out.heldReason).toBe('dnc_pending');
    expect(out.finalAgentId).toBeNull();
    expect(out.dncHeld).toBe(true);
    expect(out.prospect.dncStatus).toBe('pending');
    expect(out.prospect.dncMetadata).toMatchObject({ alreadyCharged: false });
    // A held lead is not delivered, so it is not charged here either.
    expect(d.deductLeadCredit).not.toHaveBeenCalled();
  });

  it('lets the DNC hold win over the screening hold when both apply', async () => {
    // The order is load-bearing: never dial a number that has not been scrubbed
    // (plan §6). dncGate hands off to screening once the number comes back clear.
    const { d, m } = txDeps();
    m.User.findByPk = jest.fn().mockResolvedValue({ id: 'agent-1', isActive: true, role: 'agent' });

    const out = await makeCreateTxRunner({ d, m })({
      ...baseCtx, dncBlockApplies: true, dncWillCheck: true, screeningWanted: true,
    });

    expect(out.heldReason).toBe('dnc_pending');
    expect(out.dncHeld).toBe(true);
    expect(out.screeningHeld).toBe(false);
  });

  it('holds an external-eligible lead with no funded buyer, and never charges it', async () => {
    const { d, m } = txDeps();

    const out = await makeCreateTxRunner({ d, m })({
      ...baseCtx, externalHold: true, externalHoldReason: 'no_funded_external_buyer',
    });

    expect(out.heldReason).toBe('no_funded_external_buyer');
    expect(out.finalAgentId).toBeNull();
    // The internal quota gate must not even be consulted for the external path.
    expect(d.decideAssignment).not.toHaveBeenCalled();
    expect(d.deductExternalLeadBalance).not.toHaveBeenCalled();
  });

  it('aborts the whole create when an external buyer cannot be charged', async () => {
    // The one place capture is allowed to fail: handing a paid lead to a buyer
    // we could not bill would give away inventory.
    const { d, m } = txDeps({ deductExternalLeadBalance: jest.fn().mockResolvedValue(false) });

    await expect(
      makeCreateTxRunner({ d, m })({ ...baseCtx, externalAgentId: 'buyer-1' })
    ).rejects.toThrow(/external buyer balance/i);
  });

  it('never fails capture when the enrichment outbox throws', async () => {
    const { d, m } = txDeps({ enqueueMapJobsTx: jest.fn().mockRejectedValue(new Error('outbox down')) });

    const out = await makeCreateTxRunner({ d, m })(baseCtx);

    expect(out.prospect.id).toBe('p-1');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[enrichment]'), expect.anything());
  });
});

function dispatchDeps(overrides = {}) {
  const d = {
    gateHeldDncLead: jest.fn().mockResolvedValue(undefined),
    dncCheckAndRecord: jest.fn().mockResolvedValue(undefined),
    dispatchEvent: jest.fn().mockResolvedValue(undefined),
    canMarketTo: jest.fn().mockResolvedValue(true),
    sendLeadEvent: jest.fn().mockResolvedValue(undefined),
    sendCompleteRegistrationEvent: jest.fn().mockResolvedValue(undefined),
    sendTikTokLeadEvent: jest.fn().mockResolvedValue(undefined),
    sendTikTokCompleteRegistrationEvent: jest.fn().mockResolvedValue(undefined),
    onLeadCaptured: jest.fn().mockResolvedValue({ ok: true }),
    drainMapJobs: jest.fn().mockResolvedValue(undefined),
    getOrCreateProspectShareLink: jest.fn().mockResolvedValue({ url: '/share/abc' }),
    scheduleScreeningAttempt: jest.fn().mockResolvedValue(undefined),
    logger,
    ...overrides,
  };
  const m = {
    User: { findByPk: jest.fn().mockResolvedValue(null) },
    Prospect: { findByPk: jest.fn().mockResolvedValue(null) },
  };
  return { d, m };
}

const prospect = { id: 'p-1', campaignId: 'c-1', phone: '6591234567', consumerId: 'consumer-1' };

const dispatchCtx = {
  prospect,
  quarantined: false,
  heldReason: null,
  assignedAgentId: 'agent-1',
  dncHeld: false,
  dncFlagApplies: false,
  screeningHeld: false,
  externalAgentId: null,
  sourceCampaign: { name: 'Camp' },
  sourceQrTag: null,
  resolvedAgent: null,
  agentGroup: null,
  routingMode: 'direct',
  eventId: 'ev-1',
  registrationEventId: null,
  eventSourceUrl: null,
  fbp: null, fbc: null, ttclid: null, ttp: null,
  clientIp: null, clientUserAgent: null,
};

const eventsOf = (d) => d.dispatchEvent.mock.calls.map((c) => c[0]);

describe('createProspect DISPATCH stage (unit)', () => {
  it('fires lead.created and the CAPI pair for a delivered lead', async () => {
    const { d, m } = dispatchDeps();
    const out = await makeDispatchRunner({ d, m })(dispatchCtx);

    expect(eventsOf(d)).toContain('lead.created');
    expect(d.sendLeadEvent).toHaveBeenCalled();
    expect(d.sendTikTokLeadEvent).toHaveBeenCalled();
    // The host comes from the campaign's customerHost, which is env-derived here.
    expect(out.shareUrl).toMatch(/\/share\/abc$/);
    expect(out.leadCapturedOutcome).not.toBeNull();
  });

  it('suppresses lead.created for a quarantined lead — it fires on release instead', async () => {
    const { d, m } = dispatchDeps();
    await makeDispatchRunner({ d, m })({ ...dispatchCtx, quarantined: true, heldReason: 'no_funded_agent', assignedAgentId: null });

    expect(eventsOf(d)).not.toContain('lead.created');
  });

  it('suppresses lead.created for an external buyer lead — the subscriber is the Lyfe app', async () => {
    const { d, m } = dispatchDeps();
    await makeDispatchRunner({ d, m })({ ...dispatchCtx, externalAgentId: 'buyer-1' });

    expect(eventsOf(d)).not.toContain('lead.created');
  });

  it('still awards the reward on a screening hold, but not on a quota hold', async () => {
    // Screening gates AGENT delivery, not consumer rewards (plan D8).
    const screening = dispatchDeps();
    await makeDispatchRunner(screening)({
      ...dispatchCtx, quarantined: true, heldReason: 'screening_pending', screeningHeld: true, assignedAgentId: null,
    });
    expect(screening.d.onLeadCaptured).toHaveBeenCalled();
    expect(screening.d.scheduleScreeningAttempt).toHaveBeenCalled();

    const quota = dispatchDeps();
    await makeDispatchRunner(quota)({
      ...dispatchCtx, quarantined: true, heldReason: 'no_funded_agent', assignedAgentId: null,
    });
    expect(quota.d.onLeadCaptured).not.toHaveBeenCalled();
  });

  it('scrubs a DNC-held lead through the gate, not the flag-mode recorder', async () => {
    const { d, m } = dispatchDeps();
    await makeDispatchRunner({ d, m })({ ...dispatchCtx, dncHeld: true, quarantined: true, heldReason: 'dnc_pending', assignedAgentId: null });

    expect(d.gateHeldDncLead).toHaveBeenCalledWith(prospect);
    expect(d.dncCheckAndRecord).not.toHaveBeenCalled();
    // The dial is dncGate's to make once the number comes back clear.
    expect(d.scheduleScreeningAttempt).not.toHaveBeenCalled();
  });

  it('fails closed on the consent lookup — events still fire, without em/ph', async () => {
    const { d, m } = dispatchDeps({ canMarketTo: jest.fn().mockRejectedValue(new Error('ledger down')) });
    await makeDispatchRunner({ d, m })(dispatchCtx);

    expect(d.sendLeadEvent).toHaveBeenCalledWith(prospect, expect.objectContaining({ marketingConsent: false }));
  });

  it('never breaks capture when the share-link mint fails', async () => {
    const { d, m } = dispatchDeps({ getOrCreateProspectShareLink: jest.fn().mockRejectedValue(new Error('shortlink down')) });
    const out = await makeDispatchRunner({ d, m })(dispatchCtx);

    expect(out.shareUrl).toBeNull();
    expect(out.prospectWithCampaign).toBe(prospect);
  });
});
