/**
 * Unit tests for leadOutcomeService.processLeadOutcome — the Lyfe lead-outcome
 * webhook → Meta CAPI down-funnel dispatch.
 *
 * Uses the makeLeadOutcomeService dependency-injection seam so we run without a
 * live Postgres or real Meta calls: Prospect/Campaign models and
 * sendConversionEvent are stubbed.
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
  const Prospect = {
    findByPk: jest.fn().mockResolvedValue(prospect),
  };
  const Campaign = {
    findByPk: jest.fn().mockResolvedValue({ id: 'campaign-uuid-1', metaPixelId: 'pixel-override-1' }),
  };
  const sendConversionEvent = jest.fn().mockResolvedValue({ sent: true });
  return {
    deps: {
      models: { Prospect, Campaign },
      sendConversionEvent,
      logger: silentLogger,
      ...overrides.deps,
    },
    prospect,
    Prospect,
    Campaign,
    sendConversionEvent,
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
  it('dispatches QualifiedLead with deterministic event_id, back-dated event_time, and pixel override', async () => {
    const { deps, sendConversionEvent } = buildDeps();
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome(QUALIFIED);

    expect(result).toEqual({ action: 'dispatched', eventName: 'QualifiedLead' });
    expect(sendConversionEvent).toHaveBeenCalledTimes(1);
    const [, ctx, options] = sendConversionEvent.mock.calls[0];
    expect(ctx.eventId).toBe('qualified:prospect-uuid-1');
    expect(ctx.eventTime).toBe(Math.floor(Date.parse('2026-06-09T10:00:00Z') / 1000));
    expect(ctx.pixelIdOverride).toBe('pixel-override-1');
    expect(options.eventName).toBe('QualifiedLead');
  });

  it('maps won → ClosedWon and writes the wonAt marker', async () => {
    const { deps, prospect, sendConversionEvent } = buildDeps();
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome({ ...QUALIFIED, new_status: 'won', old_status: 'proposed' });

    expect(result.eventName).toBe('ClosedWon');
    expect(sendConversionEvent.mock.calls[0][2].eventName).toBe('ClosedWon');
    expect(prospect.sourceMetadata.capi.wonAt).toEqual(expect.any(String));
    expect(prospect.save).toHaveBeenCalledTimes(1);
  });

  it('persists the idempotency marker before dispatch', async () => {
    const { deps, prospect } = buildDeps();
    const svc = makeLeadOutcomeService(deps);

    await svc.processLeadOutcome(QUALIFIED);

    expect(prospect.sourceMetadata.capi.qualifiedAt).toEqual(expect.any(String));
    expect(prospect.changed).toHaveBeenCalledWith('sourceMetadata', true);
    expect(prospect.save).toHaveBeenCalledTimes(1);
    // existing sourceMetadata is preserved, not clobbered
    expect(prospect.sourceMetadata.consent_contact).toBe(true);
    expect(prospect.sourceMetadata.fbp).toBe('fb.1.1.x');
  });

  it('is a no-op (no refire) when the marker already exists', async () => {
    const prospect = makeProspect({
      sourceMetadata: { consent_contact: true, capi: { qualifiedAt: '2026-06-08T00:00:00Z' } },
    });
    const { deps, sendConversionEvent } = buildDeps({ prospect });
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome(QUALIFIED);

    expect(result).toEqual({ skipped: 'duplicate', eventName: 'QualifiedLead' });
    expect(sendConversionEvent).not.toHaveBeenCalled();
    expect(prospect.save).not.toHaveBeenCalled();
  });

  it('skips cleanly when the prospect is not found', async () => {
    const { deps, Prospect, sendConversionEvent } = buildDeps();
    Prospect.findByPk.mockResolvedValueOnce(null);
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome(QUALIFIED);

    expect(result).toEqual({ skipped: 'no_prospect' });
    expect(sendConversionEvent).not.toHaveBeenCalled();
  });

  it('skips unmapped statuses without touching the DB', async () => {
    const { deps, Prospect } = buildDeps();
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome({ ...QUALIFIED, new_status: 'contacted' });

    expect(result).toEqual({ skipped: 'unmapped_status' });
    expect(Prospect.findByPk).not.toHaveBeenCalled();
  });

  it('omits eventTime when occurred_at is missing/invalid (falls back to now in payload)', async () => {
    const { deps, sendConversionEvent } = buildDeps();
    const svc = makeLeadOutcomeService(deps);

    await svc.processLeadOutcome({ ...QUALIFIED, occurred_at: 'not-a-date' });

    expect(sendConversionEvent.mock.calls[0][1].eventTime).toBeUndefined();
  });

  it('honors META_EVENT_QUALIFIED / META_EVENT_WON overrides', async () => {
    const prev = { q: process.env.META_EVENT_QUALIFIED, w: process.env.META_EVENT_WON };
    process.env.META_EVENT_QUALIFIED = 'Lead';
    process.env.META_EVENT_WON = 'Purchase';
    try {
      const { deps, sendConversionEvent } = buildDeps();
      const svc = makeLeadOutcomeService(deps);
      await svc.processLeadOutcome(QUALIFIED);
      expect(sendConversionEvent.mock.calls[0][2].eventName).toBe('Lead');
    } finally {
      if (prev.q === undefined) delete process.env.META_EVENT_QUALIFIED; else process.env.META_EVENT_QUALIFIED = prev.q;
      if (prev.w === undefined) delete process.env.META_EVENT_WON; else process.env.META_EVENT_WON = prev.w;
    }
  });
});
