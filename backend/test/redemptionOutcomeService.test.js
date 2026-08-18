/**
 * Unit tests for redemptionOutcomeService — completed voucher redemption →
 * Meta CAPI `VoucherRedeemed` (activation-campaign scoped, physical_store).
 *
 * Uses the makeRedemptionOutcomeService dependency-injection seam: models,
 * sendConversionEvent, canMarketTo and sleep are stubbed — no Postgres, no
 * Meta calls.
 */
import { jest } from '@jest/globals';
import { makeRedemptionOutcomeService, redemptionEventName } from '../src/services/redemptionOutcomeService.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeProspect(overrides = {}) {
  return {
    id: 'prospect-uuid-1',
    consumerId: 'consumer-uuid-1',
    phone: '+6581234567',
    campaignId: 'signup-campaign-uuid',
    sourceMetadata: { fbp: 'fb.1.1.x' },
    changed: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeEntitlement(overrides = {}) {
  return {
    id: 'ent-uuid-1',
    prospectId: 'prospect-uuid-1',
    activationId: 'act-uuid-1',
    activation: { id: 'act-uuid-1', campaignId: 'activation-campaign-uuid' },
    ...overrides,
  };
}

function buildDeps(overrides = {}) {
  const prospect = overrides.prospect ?? makeProspect();
  const Prospect = { findByPk: jest.fn().mockResolvedValue(prospect) };
  const Campaign = {
    findByPk: jest.fn().mockResolvedValue({ id: 'activation-campaign-uuid', metaPixelId: 'pixel-override-1' }),
  };
  const Activation = {
    findByPk: jest.fn().mockResolvedValue({ id: 'act-uuid-1', campaignId: 'reloaded-campaign-uuid' }),
  };
  const RewardEntitlement = { findAll: jest.fn().mockResolvedValue([]) };
  const sendConversionEvent = overrides.sendConversionEvent ?? jest.fn().mockResolvedValue({ sent: true });
  const canMarketTo = overrides.canMarketTo ?? jest.fn().mockResolvedValue(true);
  const sleep = jest.fn().mockResolvedValue(undefined);
  // Marker writes go through the atomic prospectJsonPatch seam (plan
  // google-ads-signal-levers §4.3) — the spy EMULATES the first-wins deep
  // merge on the fixture so existing assertions keep reading the result.
  const mergeSourceMetadataFirstWins =
    overrides.mergeSourceMetadataFirstWins ??
    jest.fn(async (id, path, patch) => {
      if (!prospect.sourceMetadata) prospect.sourceMetadata = {};
      let target = prospect.sourceMetadata;
      for (const k of path) {
        if (!target[k]) target[k] = {};
        target = target[k];
      }
      for (const [k, v] of Object.entries(patch)) {
        if (!(k in target)) target[k] = v;
      }
      return 1;
    });
  return {
    deps: {
      models: { Prospect, Campaign, Activation, RewardEntitlement },
      sendConversionEvent, canMarketTo, mergeSourceMetadataFirstWins, logger: silentLogger, sleep,
      ...overrides.deps,
    },
    prospect, Prospect, Campaign, Activation, RewardEntitlement, sendConversionEvent, canMarketTo, mergeSourceMetadataFirstWins, sleep,
  };
}

afterEach(() => {
  delete process.env.META_EVENT_REDEEMED;
});

describe('processRedemption — guards', () => {
  test('no entitlement → skipped, nothing sent', async () => {
    const { deps, sendConversionEvent, mergeSourceMetadataFirstWins } = buildDeps();
    const svc = makeRedemptionOutcomeService(deps);
    expect(await svc.processRedemption({})).toEqual({ skipped: 'no_entitlement' });
    expect(await svc.processRedemption()).toEqual({ skipped: 'no_entitlement' });
    expect(sendConversionEvent).not.toHaveBeenCalled();
  });

  test('prospect-less entitlement → skipped (nullable prospectId is real)', async () => {
    const { deps, sendConversionEvent, mergeSourceMetadataFirstWins } = buildDeps();
    const svc = makeRedemptionOutcomeService(deps);
    const r = await svc.processRedemption({ entitlement: makeEntitlement({ prospectId: null }) });
    expect(r).toEqual({ skipped: 'no_prospect' });
    expect(sendConversionEvent).not.toHaveBeenCalled();
  });

  test('prospect row gone → skipped', async () => {
    const { deps, Prospect, sendConversionEvent, mergeSourceMetadataFirstWins } = buildDeps();
    Prospect.findByPk.mockResolvedValue(null);
    const svc = makeRedemptionOutcomeService(deps);
    const r = await svc.processRedemption({ entitlement: makeEntitlement() });
    expect(r).toEqual({ skipped: 'prospect_missing' });
    expect(sendConversionEvent).not.toHaveBeenCalled();
  });

  test('marker already present for THIS entitlement → duplicate, nothing sent', async () => {
    const prospect = makeProspect({
      sourceMetadata: { capi: { voucherRedeemed: { 'ent-uuid-1': '2026-07-01T00:00:00Z' } } },
    });
    const { deps, sendConversionEvent, mergeSourceMetadataFirstWins } = buildDeps({ prospect });
    const svc = makeRedemptionOutcomeService(deps);
    expect(await svc.processRedemption({ entitlement: makeEntitlement() })).toEqual({ duplicate: true });
    expect(sendConversionEvent).not.toHaveBeenCalled();
  });

  test('marker for a DIFFERENT entitlement does not block (multi-campaign redeemers)', async () => {
    const prospect = makeProspect({
      sourceMetadata: { capi: { voucherRedeemed: { 'other-ent': '2026-07-01T00:00:00Z' } } },
    });
    const { deps, sendConversionEvent, mergeSourceMetadataFirstWins } = buildDeps({ prospect });
    const svc = makeRedemptionOutcomeService(deps);
    const r = await svc.processRedemption({ entitlement: makeEntitlement() });
    expect(r).toEqual({ dispatched: 'VoucherRedeemed' });
    expect(sendConversionEvent).toHaveBeenCalledTimes(1);
  });
});

describe('processRedemption — dispatch shape', () => {
  test('happy path: deterministic event_id, physical_store, activation-campaign scope, pixel override, marker on success', async () => {
    const { deps, prospect, sendConversionEvent, canMarketTo, Campaign, mergeSourceMetadataFirstWins } = buildDeps();
    const svc = makeRedemptionOutcomeService(deps);
    const r = await svc.processRedemption({ entitlement: makeEntitlement() });

    expect(r).toEqual({ dispatched: 'VoucherRedeemed' });
    const [sentProspect, ctx, options] = sendConversionEvent.mock.calls[0];
    expect(sentProspect).toBe(prospect);
    expect(ctx.eventId).toBe('voucher_redeemed:ent-uuid-1');
    expect(ctx.actionSource).toBe('physical_store');
    expect(ctx.campaignIdOverride).toBe('activation-campaign-uuid'); // NOT the signup campaign
    expect(ctx.pixelIdOverride).toBe('pixel-override-1');
    expect(ctx.marketingConsent).toBe(true);
    expect(options.eventName).toBe('VoucherRedeemed');

    // Consent + pixel lookups are scoped to the ACTIVATION's campaign.
    expect(canMarketTo).toHaveBeenCalledWith({
      consumerId: 'consumer-uuid-1', phone: '+6581234567', channel: 'all',
      campaignId: 'activation-campaign-uuid',
    });
    expect(Campaign.findByPk).toHaveBeenCalledWith('activation-campaign-uuid');

    // Marker written only after the confirmed send.
    expect(prospect.sourceMetadata.capi.voucherRedeemed['ent-uuid-1']).toEqual(expect.any(String));
    expect(mergeSourceMetadataFirstWins).toHaveBeenCalledWith(
      prospect.id,
      ['capi', 'voucherRedeemed'],
      { 'ent-uuid-1': expect.any(String) }
    );
  });

  test('activation.campaignId undefined (association loaded without the column) → reloads the Activation', async () => {
    const { deps, Activation, sendConversionEvent, canMarketTo, mergeSourceMetadataFirstWins } = buildDeps();
    const svc = makeRedemptionOutcomeService(deps);
    const entitlement = makeEntitlement({ activation: { id: 'act-uuid-1' } }); // campaignId missing entirely
    await svc.processRedemption({ entitlement });
    expect(Activation.findByPk).toHaveBeenCalledWith('act-uuid-1');
    expect(sendConversionEvent.mock.calls[0][1].campaignIdOverride).toBe('reloaded-campaign-uuid');
    expect(canMarketTo.mock.calls[0][0].campaignId).toBe('reloaded-campaign-uuid');
  });

  test('explicit null campaignId (campaign deleted) → no override, consent falls to global scope (fail-closed)', async () => {
    const { deps, Activation, Campaign, sendConversionEvent, canMarketTo, mergeSourceMetadataFirstWins } = buildDeps();
    const svc = makeRedemptionOutcomeService(deps);
    const entitlement = makeEntitlement({ activation: { id: 'act-uuid-1', campaignId: null } });
    await svc.processRedemption({ entitlement });
    expect(Activation.findByPk).not.toHaveBeenCalled(); // null is an answer, not a miss
    expect(Campaign.findByPk).not.toHaveBeenCalled();
    const ctx = sendConversionEvent.mock.calls[0][1];
    expect(ctx.campaignIdOverride).toBeUndefined();
    expect(ctx.pixelIdOverride).toBeUndefined();
    expect(canMarketTo.mock.calls[0][0].campaignId).toBe(null);
  });

  test('canMarketTo throws → marketingConsent false, event still fires (fail-closed PII, not a lost event)', async () => {
    const { deps, sendConversionEvent, mergeSourceMetadataFirstWins } = buildDeps({
      canMarketTo: jest.fn().mockRejectedValue(new Error('ledger down')),
    });
    const svc = makeRedemptionOutcomeService(deps);
    const r = await svc.processRedemption({ entitlement: makeEntitlement() });
    expect(r).toEqual({ dispatched: 'VoucherRedeemed' });
    expect(sendConversionEvent.mock.calls[0][1].marketingConsent).toBe(false);
  });

  test('META_EVENT_REDEEMED renames the event', async () => {
    process.env.META_EVENT_REDEEMED = 'Purchase';
    const { deps, sendConversionEvent, mergeSourceMetadataFirstWins } = buildDeps();
    const svc = makeRedemptionOutcomeService(deps);
    const r = await svc.processRedemption({ entitlement: makeEntitlement() });
    expect(r).toEqual({ dispatched: 'Purchase' });
    expect(sendConversionEvent.mock.calls[0][2].eventName).toBe('Purchase');
    expect(redemptionEventName()).toBe('Purchase');
  });
});

describe('processRedemption — reliability', () => {
  test('guarded (CAPI off / ineligible origin) → no retry, no marker, benign failure', async () => {
    const send = jest.fn().mockResolvedValue({ sent: false, reason: 'guarded' });
    const { deps, prospect, mergeSourceMetadataFirstWins } = buildDeps({ sendConversionEvent: send });
    const svc = makeRedemptionOutcomeService(deps);
    const r = await svc.processRedemption({ entitlement: makeEntitlement() });
    expect(r).toEqual({ failed: 'VoucherRedeemed', reason: 'guarded' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(prospect.save).not.toHaveBeenCalled();
  });

  test('transient 5xx retries with backoff, then success writes the marker', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ sent: false, status: 500 })
      .mockResolvedValueOnce({ sent: true });
    const { deps, prospect, sleep, mergeSourceMetadataFirstWins } = buildDeps({ sendConversionEvent: send });
    const svc = makeRedemptionOutcomeService(deps);
    const r = await svc.processRedemption({ entitlement: makeEntitlement() });
    expect(r).toEqual({ dispatched: 'VoucherRedeemed' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(mergeSourceMetadataFirstWins).toHaveBeenCalled();
  });

  test('4xx does not retry and leaves the marker unwritten (replay/sweep can retry later)', async () => {
    const send = jest.fn().mockResolvedValue({ sent: false, status: 400 });
    const { deps, prospect, mergeSourceMetadataFirstWins } = buildDeps({ sendConversionEvent: send });
    const svc = makeRedemptionOutcomeService(deps);
    const r = await svc.processRedemption({ entitlement: makeEntitlement() });
    expect(r.failed).toBe('VoucherRedeemed');
    expect(send).toHaveBeenCalledTimes(1);
    expect(prospect.save).not.toHaveBeenCalled();
  });

  test('never throws — an exploding model resolves to a failed result', async () => {
    const { deps, Prospect, mergeSourceMetadataFirstWins } = buildDeps();
    Prospect.findByPk.mockRejectedValue(new Error('db down'));
    const svc = makeRedemptionOutcomeService(deps);
    const r = await svc.processRedemption({ entitlement: makeEntitlement() });
    expect(r.failed).toBe('VoucherRedeemed');
    expect(r.reason).toBe('exception');
  });
});

describe('sweepUnmarkedRedemptions', () => {
  test('scans redeemed entitlements, skips prospect-less + already-marked, dispatches the rest', async () => {
    const marked = makeProspect({
      id: 'p-marked',
      sourceMetadata: { capi: { voucherRedeemed: { 'ent-marked': 'ts' } } },
    });
    const fresh = makeProspect({ id: 'p-fresh' });
    const { deps, RewardEntitlement, Prospect, sendConversionEvent, mergeSourceMetadataFirstWins } = buildDeps();
    RewardEntitlement.findAll.mockResolvedValue([
      { id: 'ent-nopros', prospectId: null, activationId: 'act-1' },
      { id: 'ent-marked', prospectId: 'p-marked', activationId: 'act-1', activation: undefined },
      { id: 'ent-fresh', prospectId: 'p-fresh', activationId: 'act-1', activation: undefined },
    ]);
    Prospect.findByPk.mockImplementation(async (id) => (id === 'p-marked' ? marked : id === 'p-fresh' ? fresh : null));
    const svc = makeRedemptionOutcomeService(deps);
    const r = await svc.sweepUnmarkedRedemptions();
    expect(RewardEntitlement.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'redeemed' },
    }));
    expect(r).toEqual({ scanned: 3, attempted: 1, dispatched: 1 });
    expect(sendConversionEvent).toHaveBeenCalledTimes(1);
    expect(sendConversionEvent.mock.calls[0][1].eventId).toBe('voucher_redeemed:ent-fresh');
  });
});
