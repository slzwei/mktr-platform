/**
 * Unit tests for leadOutcomeService.processLeadOutcome — the Lyfe lead-outcome
 * webhook → Meta CAPI down-funnel dispatch.
 *
 * Uses the makeLeadOutcomeService dependency-injection seam so we run without a
 * live Postgres or real Meta calls: Prospect/Campaign models, sendConversionEvent
 * and sleep are stubbed.
 */
import { jest } from '@jest/globals';
import { makeLeadOutcomeService } from '../src/services/leadOutcomeService.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeProspect(overrides = {}) {
  return {
    id: 'prospect-uuid-1',
    campaignId: 'campaign-uuid-1',
    sourceMetadata: { consent_contact: true, fbp: 'fb.1.1.x' },
    changed: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function buildDeps(overrides = {}) {
  const prospect = overrides.prospect ?? makeProspect();
  const Prospect = { findByPk: jest.fn().mockResolvedValue(prospect) };
  const Campaign = {
    findByPk: jest.fn().mockResolvedValue({ id: 'campaign-uuid-1', metaPixelId: 'pixel-override-1' }),
  };
  const sendConversionEvent = overrides.sendConversionEvent ?? jest.fn().mockResolvedValue({ sent: true });
  // Ledger gate for the em/ph ctx flag (3sites). Default true = "person has a
  // verified grant" (the fixtures' old consent_contact:true, ledger-shaped).
  const canMarketTo = overrides.canMarketTo ?? jest.fn().mockResolvedValue(true);
  const sleep = jest.fn().mockResolvedValue(undefined);
  // Marker writes go through the atomic prospectJsonPatch seam now (plan
  // google-ads-signal-levers §4.3). The spy EMULATES the write on the
  // in-memory fixture so existing assertions keep reading the result.
  const setSourceMetadataPath =
    overrides.setSourceMetadataPath ??
    jest.fn(async (id, path, value) => {
      if (!prospect.sourceMetadata) prospect.sourceMetadata = {};
      let target = prospect.sourceMetadata;
      for (const k of path.slice(0, -1)) {
        if (!target[k]) target[k] = {};
        target = target[k];
      }
      target[path[path.length - 1]] = value;
      return 1;
    });
  const mergeSourceMetadataFirstWins = overrides.mergeSourceMetadataFirstWins ?? jest.fn().mockResolvedValue(1);
  const dispatchGoogleOutcome = overrides.dispatchGoogleOutcome ?? jest.fn().mockResolvedValue({ sent: true });
  const googleUploadsEnabled = overrides.googleUploadsEnabled ?? jest.fn().mockReturnValue(false);
  const googleActionIdFor = overrides.googleActionIdFor ?? jest.fn().mockReturnValue('act-1');
  // Platform-delivery ledger seams (ads-centralisation §3.3.2/§3.3.5):
  // this suite exercises the LEGACY direct-send contract, which is exactly
  // the ledger's no-row path — so the ledger reports "not owned" and the
  // facts+planning transaction is a pass-through stub (the fixtures' ids are
  // not real rows; DB-backed coverage lives in platformDeliveries.test.js).
  const fakeTransaction = (a, b) => (typeof a === 'function' ? a('t') : b('sp'));
  const planOutcomeDeliveriesTx = overrides.planOutcomeDeliveriesTx ?? jest.fn().mockResolvedValue({ planned: false });
  const dispatchOutcomeDelivery = overrides.dispatchOutcomeDelivery ?? jest.fn().mockResolvedValue({ owned: false });
  return {
    deps: {
      models: { Prospect, Campaign }, sendConversionEvent, canMarketTo, setSourceMetadataPath,
      mergeSourceMetadataFirstWins, dispatchGoogleOutcome, googleUploadsEnabled, googleActionIdFor,
      sequelize: { transaction: fakeTransaction },
      planOutcomeDeliveriesTx, dispatchOutcomeDelivery,
      logger: silentLogger, sleep, ...overrides.deps,
    },
    mergeSourceMetadataFirstWins,
    dispatchGoogleOutcome,
    googleUploadsEnabled,
    prospect,
    Prospect,
    Campaign,
    sendConversionEvent,
    canMarketTo,
    setSourceMetadataPath,
    sleep,
  };
}

const QUALIFIED = {
  external_id: 'prospect-uuid-1',
  lead_id: 'lyfe-lead-1',
  new_status: 'qualified',
  old_status: 'contacted',
  agent_id: 'agent-1',
  occurred_at: '2026-06-09T10:00:00Z',
};

describe('leadOutcomeService.processLeadOutcome', () => {
  it('dispatches ConfirmedResident with deterministic event_id, back-dated event_time, and pixel override', async () => {
    const { deps, sendConversionEvent, setSourceMetadataPath } = buildDeps();
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome(QUALIFIED);

    expect(result).toMatchObject({ dispatched: ['ConfirmedResident'], duplicate: [], failed: [] });
    expect(sendConversionEvent).toHaveBeenCalledTimes(1);
    const [, ctx, options] = sendConversionEvent.mock.calls[0];
    expect(ctx.eventId).toBe('confirmed_resident:prospect-uuid-1');
    expect(ctx.eventTime).toBe(Math.floor(Date.parse('2026-06-09T10:00:00Z') / 1000));
    expect(ctx.pixelIdOverride).toBe('pixel-override-1');
    expect(options.eventName).toBe('ConfirmedResident');
  });

  it('won emits BOTH ConfirmedResident and ClosedWon (won implies SC/PR)', async () => {
    const { deps, prospect, sendConversionEvent, setSourceMetadataPath } = buildDeps();
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome({ ...QUALIFIED, new_status: 'won', old_status: 'proposed' });

    expect(result.dispatched).toEqual(['ConfirmedResident', 'ClosedWon']);
    expect(sendConversionEvent).toHaveBeenCalledTimes(2);
    expect(sendConversionEvent.mock.calls[0][1].eventId).toBe('confirmed_resident:prospect-uuid-1');
    expect(sendConversionEvent.mock.calls[0][2].eventName).toBe('ConfirmedResident');
    expect(sendConversionEvent.mock.calls[1][1].eventId).toBe('closed_won:prospect-uuid-1');
    expect(sendConversionEvent.mock.calls[1][2].eventName).toBe('ClosedWon');
    expect(prospect.sourceMetadata.capi.confirmedResidentAt).toEqual(expect.any(String));
    expect(prospect.sourceMetadata.capi.closedWonAt).toEqual(expect.any(String));
    expect(setSourceMetadataPath).toHaveBeenCalledTimes(2);
    expect(setSourceMetadataPath.mock.calls.map((c) => c[1])).toEqual([
      ['capi', 'confirmedResidentAt'],
      ['capi', 'closedWonAt'],
    ]);
  });

  it('won skips ConfirmedResident if already sent, still emits ClosedWon', async () => {
    const prospect = makeProspect({
      sourceMetadata: { consent_contact: true, capi: { confirmedResidentAt: '2026-06-08T00:00:00Z' } },
    });
    const { deps, sendConversionEvent, setSourceMetadataPath } = buildDeps({ prospect });
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome({ ...QUALIFIED, new_status: 'won' });

    expect(result).toMatchObject({ dispatched: ['ClosedWon'], duplicate: ['ConfirmedResident'], failed: [] });
    expect(sendConversionEvent).toHaveBeenCalledTimes(1);
    expect(sendConversionEvent.mock.calls[0][2].eventName).toBe('ClosedWon');
  });

  it('writes the dedup marker ONLY after a successful send', async () => {
    const { deps, prospect, setSourceMetadataPath } = buildDeps();
    const svc = makeLeadOutcomeService(deps);

    await svc.processLeadOutcome(QUALIFIED);

    expect(prospect.sourceMetadata.capi.confirmedResidentAt).toEqual(expect.any(String));
    expect(setSourceMetadataPath).toHaveBeenCalledTimes(1);
    expect(setSourceMetadataPath.mock.calls[0][1]).toEqual(['capi', 'confirmedResidentAt']);
    // existing sourceMetadata preserved, not clobbered
    expect(prospect.sourceMetadata.consent_contact).toBe(true);
    expect(prospect.sourceMetadata.fbp).toBe('fb.1.1.x');
  });

  it('does NOT mark (leaves re-tryable) when the send fails', async () => {
    const sendConversionEvent = jest.fn().mockResolvedValue({ sent: false, status: 500 });
    const { deps, prospect, setSourceMetadataPath } = buildDeps({ sendConversionEvent });
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome(QUALIFIED);

    expect(result).toMatchObject({ dispatched: [], duplicate: [], failed: ['ConfirmedResident'] });
    expect(prospect.sourceMetadata.capi).toBeUndefined();
    expect(setSourceMetadataPath).not.toHaveBeenCalled();
  });

  it('retries a transient failure then succeeds', async () => {
    const sendConversionEvent = jest
      .fn()
      .mockResolvedValueOnce({ sent: false, status: 503 })
      .mockResolvedValueOnce({ sent: true });
    const { deps, prospect, sleep, setSourceMetadataPath } = buildDeps({ sendConversionEvent });
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome(QUALIFIED);

    expect(result.dispatched).toEqual(['ConfirmedResident']);
    expect(sendConversionEvent).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(setSourceMetadataPath).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a guarded (CAPI disabled / ineligible) result', async () => {
    const sendConversionEvent = jest.fn().mockResolvedValue({ sent: false, reason: 'guarded' });
    const { deps, sleep, setSourceMetadataPath } = buildDeps({ sendConversionEvent });
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome(QUALIFIED);

    expect(result.failed).toEqual(['ConfirmedResident']);
    expect(sendConversionEvent).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does NOT retry a 4xx (non-transient) result', async () => {
    const sendConversionEvent = jest.fn().mockResolvedValue({ sent: false, status: 400 });
    const { deps, sleep, setSourceMetadataPath } = buildDeps({ sendConversionEvent });
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome(QUALIFIED);

    expect(result.failed).toEqual(['ConfirmedResident']);
    expect(sendConversionEvent).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('is a no-op (no refire) when the ConfirmedResident marker already exists', async () => {
    const prospect = makeProspect({
      sourceMetadata: { consent_contact: true, capi: { confirmedResidentAt: '2026-06-08T00:00:00Z' } },
    });
    const { deps, sendConversionEvent, setSourceMetadataPath } = buildDeps({ prospect });
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome(QUALIFIED);

    expect(result).toMatchObject({ dispatched: [], duplicate: ['ConfirmedResident'], failed: [] });
    expect(sendConversionEvent).not.toHaveBeenCalled();
    expect(setSourceMetadataPath).not.toHaveBeenCalled();
  });

  it('skips cleanly when the prospect is not found', async () => {
    const { deps, Prospect, sendConversionEvent, setSourceMetadataPath } = buildDeps();
    Prospect.findByPk.mockResolvedValueOnce(null);
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome(QUALIFIED);

    expect(result).toEqual({ skipped: 'no_prospect' });
    expect(sendConversionEvent).not.toHaveBeenCalled();
  });

  it('skips unmapped statuses without touching the DB', async () => {
    const { deps, Prospect, setSourceMetadataPath } = buildDeps();
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome({ ...QUALIFIED, new_status: 'contacted' });

    expect(result).toEqual({ skipped: 'unmapped_status' });
    expect(Prospect.findByPk).not.toHaveBeenCalled();
  });

  it('omits eventTime when occurred_at is missing/invalid (falls back to now in payload)', async () => {
    const { deps, sendConversionEvent, setSourceMetadataPath } = buildDeps();
    const svc = makeLeadOutcomeService(deps);

    await svc.processLeadOutcome({ ...QUALIFIED, occurred_at: 'not-a-date' });

    expect(sendConversionEvent.mock.calls[0][1].eventTime).toBeUndefined();
  });

  it('honors META_EVENT_QUALIFIED / META_EVENT_WON overrides', async () => {
    const prev = { q: process.env.META_EVENT_QUALIFIED, w: process.env.META_EVENT_WON };
    process.env.META_EVENT_QUALIFIED = 'Lead';
    process.env.META_EVENT_WON = 'Purchase';
    try {
      const { deps, sendConversionEvent, setSourceMetadataPath } = buildDeps();
      const svc = makeLeadOutcomeService(deps);
      await svc.processLeadOutcome(QUALIFIED);
      expect(sendConversionEvent.mock.calls[0][2].eventName).toBe('Lead');
    } finally {
      if (prev.q === undefined) delete process.env.META_EVENT_QUALIFIED;
      else process.env.META_EVENT_QUALIFIED = prev.q;
      if (prev.w === undefined) delete process.env.META_EVENT_WON;
      else process.env.META_EVENT_WON = prev.w;
    }
  });
});

describe('leadOutcomeService — ledger-derived em/ph gate (3sites)', () => {
  it('computes canMarketTo from the prospect identity + campaign scope and threads it into ctx', async () => {
    const prospect = makeProspect({ consumerId: 'consumer-uuid-1', phone: '+6581234567' });
    const { deps, canMarketTo, sendConversionEvent, setSourceMetadataPath } = buildDeps({ prospect });
    const svc = makeLeadOutcomeService(deps);

    await svc.processLeadOutcome(QUALIFIED);

    expect(canMarketTo).toHaveBeenCalledTimes(1);
    expect(canMarketTo).toHaveBeenCalledWith({
      consumerId: 'consumer-uuid-1',
      phone: '+6581234567',
      channel: 'all',
      campaignId: 'campaign-uuid-1',
    });
    expect(sendConversionEvent.mock.calls[0][1].marketingConsent).toBe(true);
  });

  it('threads marketingConsent:false when the ledger denies (withdrawal/unverified)', async () => {
    const { deps, sendConversionEvent, setSourceMetadataPath } = buildDeps({ canMarketTo: jest.fn().mockResolvedValue(false) });
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome(QUALIFIED);

    expect(result.dispatched).toEqual(['ConfirmedResident']); // event still fires
    expect(sendConversionEvent.mock.calls[0][1].marketingConsent).toBe(false);
  });

  it('fails CLOSED when the ledger lookup rejects — event fires without em/ph consent', async () => {
    const { deps, sendConversionEvent, setSourceMetadataPath } = buildDeps({ canMarketTo: jest.fn().mockRejectedValue(new Error('ledger down')) });
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome(QUALIFIED);

    expect(result.dispatched).toEqual(['ConfirmedResident']);
    expect(sendConversionEvent.mock.calls[0][1].marketingConsent).toBe(false);
  });

  it('dispatches the ORIGINAL prospect instance — the PR B clone hack is gone', async () => {
    const { deps, prospect, sendConversionEvent, setSourceMetadataPath } = buildDeps({ canMarketTo: jest.fn().mockResolvedValue(false) });
    const svc = makeLeadOutcomeService(deps);

    await svc.processLeadOutcome(QUALIFIED);

    expect(sendConversionEvent.mock.calls[0][0]).toBe(prospect);
    // stored evidence untouched (no consent_contact:false overwrite)
    expect(prospect.sourceMetadata.consent_contact).toBe(true);
  });
});


describe('leadOutcomeService — durable outcome facts + Google dispatch (plan §4.3)', () => {
  it('writes ALL facts for the status FIRST (one first-wins merge), before any dispatch', async () => {
    const calls = [];
    const mergeSourceMetadataFirstWins = jest.fn(async () => { calls.push('facts'); return 1; });
    const sendConversionEvent = jest.fn(async () => { calls.push('meta'); return { sent: true }; });
    const { deps } = buildDeps({ mergeSourceMetadataFirstWins, sendConversionEvent });
    const svc = makeLeadOutcomeService(deps);
    await svc.processLeadOutcome({ ...QUALIFIED, new_status: 'won' });
    expect(calls[0]).toBe('facts');
    expect(mergeSourceMetadataFirstWins).toHaveBeenCalledTimes(1);
    const [, path, patch] = mergeSourceMetadataFirstWins.mock.calls[0];
    expect(path).toEqual(['outcomes']);
    expect(patch).toEqual({
      confirmed_resident: '2026-06-09T10:00:00.000Z',
      closed_won: '2026-06-09T10:00:00.000Z',
    });
  });

  it('canonical timestamp chain: invalid body occurred_at → signedWebhookAt → receipt time', async () => {
    const { deps, mergeSourceMetadataFirstWins } = buildDeps();
    const svc = makeLeadOutcomeService(deps);
    await svc.processLeadOutcome(
      { ...QUALIFIED, occurred_at: 'not-a-date' },
      { signedWebhookAt: '2026-06-09T09:00:00.000Z' }
    );
    expect(mergeSourceMetadataFirstWins.mock.calls[0][2]).toEqual({
      confirmed_resident: '2026-06-09T09:00:00.000Z',
    });

    const { deps: d2, mergeSourceMetadataFirstWins: m2 } = buildDeps();
    const svc2 = makeLeadOutcomeService(d2);
    const before = Date.now();
    await svc2.processLeadOutcome({ ...QUALIFIED, occurred_at: undefined });
    const written = Date.parse(m2.mock.calls[0][2].confirmed_resident);
    expect(written).toBeGreaterThanOrEqual(before - 1000);
  });

  it('a fact-write failure is loud but never blocks the Meta dispatch', async () => {
    const mergeSourceMetadataFirstWins = jest.fn().mockRejectedValue(new Error('db down'));
    const { deps, sendConversionEvent } = buildDeps({ mergeSourceMetadataFirstWins });
    const svc = makeLeadOutcomeService(deps);
    const result = await svc.processLeadOutcome(QUALIFIED);
    expect(result.dispatched).toEqual(['ConfirmedResident']);
    expect(sendConversionEvent).toHaveBeenCalledTimes(1);
  });

  it('Google dispatch runs per key when enabled (fresh markers only) and its failure never touches the Meta result', async () => {
    const dispatchGoogleOutcome = jest.fn().mockRejectedValue(new Error('google down'));
    const googleUploadsEnabled = jest.fn().mockReturnValue(true);
    const { deps, sendConversionEvent } = buildDeps({ dispatchGoogleOutcome, googleUploadsEnabled });
    const svc = makeLeadOutcomeService(deps);
    const result = await svc.processLeadOutcome({ ...QUALIFIED, new_status: 'won' });
    expect(result.dispatched).toEqual(['ConfirmedResident', 'ClosedWon']);
    expect(sendConversionEvent).toHaveBeenCalledTimes(2);
    expect(dispatchGoogleOutcome).toHaveBeenCalledTimes(2);
    expect(dispatchGoogleOutcome.mock.calls.map((c) => c[1])).toEqual(['confirmed_resident', 'closed_won']);
  });

  it('delegates marker dedup to the claim flow — dispatch is CALLED and owns the race (id-based)', async () => {
    const prospect = makeProspect({
      sourceMetadata: { consent_contact: true, gads: { confirmed_resident: { state: 'pending', requestId: 'r' } } },
    });
    const dispatchGoogleOutcome = jest.fn().mockResolvedValue({ sent: false, reason: 'marker_present' });
    const googleUploadsEnabled = jest.fn().mockReturnValue(true);
    const { deps } = buildDeps({ prospect, dispatchGoogleOutcome, googleUploadsEnabled });
    const svc = makeLeadOutcomeService(deps);
    await svc.processLeadOutcome(QUALIFIED);
    // claim-flow contract: the service delegates with the PROSPECT ID (the
    // dispatcher reloads fresh state and CAS-claims — suppression of existing
    // markers is proven in googleOfflineConversionsService.test.js).
    expect(dispatchGoogleOutcome).toHaveBeenCalledWith(prospect.id, 'confirmed_resident');
  });});
