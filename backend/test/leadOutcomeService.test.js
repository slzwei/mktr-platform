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
  const sleep = jest.fn().mockResolvedValue(undefined);
  return {
    deps: { models: { Prospect, Campaign }, sendConversionEvent, logger: silentLogger, sleep, ...overrides.deps },
    prospect,
    Prospect,
    Campaign,
    sendConversionEvent,
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
    const { deps, sendConversionEvent } = buildDeps();
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome(QUALIFIED);

    expect(result).toEqual({ dispatched: ['ConfirmedResident'], duplicate: [], failed: [] });
    expect(sendConversionEvent).toHaveBeenCalledTimes(1);
    const [, ctx, options] = sendConversionEvent.mock.calls[0];
    expect(ctx.eventId).toBe('confirmed_resident:prospect-uuid-1');
    expect(ctx.eventTime).toBe(Math.floor(Date.parse('2026-06-09T10:00:00Z') / 1000));
    expect(ctx.pixelIdOverride).toBe('pixel-override-1');
    expect(options.eventName).toBe('ConfirmedResident');
  });

  it('won emits BOTH ConfirmedResident and ClosedWon (won implies SC/PR)', async () => {
    const { deps, prospect, sendConversionEvent } = buildDeps();
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
    expect(prospect.save).toHaveBeenCalledTimes(2);
  });

  it('won skips ConfirmedResident if already sent, still emits ClosedWon', async () => {
    const prospect = makeProspect({
      sourceMetadata: { consent_contact: true, capi: { confirmedResidentAt: '2026-06-08T00:00:00Z' } },
    });
    const { deps, sendConversionEvent } = buildDeps({ prospect });
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome({ ...QUALIFIED, new_status: 'won' });

    expect(result).toEqual({ dispatched: ['ClosedWon'], duplicate: ['ConfirmedResident'], failed: [] });
    expect(sendConversionEvent).toHaveBeenCalledTimes(1);
    expect(sendConversionEvent.mock.calls[0][2].eventName).toBe('ClosedWon');
  });

  it('writes the dedup marker ONLY after a successful send', async () => {
    const { deps, prospect } = buildDeps();
    const svc = makeLeadOutcomeService(deps);

    await svc.processLeadOutcome(QUALIFIED);

    expect(prospect.sourceMetadata.capi.confirmedResidentAt).toEqual(expect.any(String));
    expect(prospect.changed).toHaveBeenCalledWith('sourceMetadata', true);
    expect(prospect.save).toHaveBeenCalledTimes(1);
    // existing sourceMetadata preserved, not clobbered
    expect(prospect.sourceMetadata.consent_contact).toBe(true);
    expect(prospect.sourceMetadata.fbp).toBe('fb.1.1.x');
  });

  it('does NOT mark (leaves re-tryable) when the send fails', async () => {
    const sendConversionEvent = jest.fn().mockResolvedValue({ sent: false, status: 500 });
    const { deps, prospect } = buildDeps({ sendConversionEvent });
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome(QUALIFIED);

    expect(result).toEqual({ dispatched: [], duplicate: [], failed: ['ConfirmedResident'] });
    expect(prospect.sourceMetadata.capi).toBeUndefined();
    expect(prospect.save).not.toHaveBeenCalled();
  });

  it('retries a transient failure then succeeds', async () => {
    const sendConversionEvent = jest
      .fn()
      .mockResolvedValueOnce({ sent: false, status: 503 })
      .mockResolvedValueOnce({ sent: true });
    const { deps, prospect, sleep } = buildDeps({ sendConversionEvent });
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome(QUALIFIED);

    expect(result.dispatched).toEqual(['ConfirmedResident']);
    expect(sendConversionEvent).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(prospect.save).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a guarded (CAPI disabled / ineligible) result', async () => {
    const sendConversionEvent = jest.fn().mockResolvedValue({ sent: false, reason: 'guarded' });
    const { deps, sleep } = buildDeps({ sendConversionEvent });
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome(QUALIFIED);

    expect(result.failed).toEqual(['ConfirmedResident']);
    expect(sendConversionEvent).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does NOT retry a 4xx (non-transient) result', async () => {
    const sendConversionEvent = jest.fn().mockResolvedValue({ sent: false, status: 400 });
    const { deps, sleep } = buildDeps({ sendConversionEvent });
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
    const { deps, sendConversionEvent } = buildDeps({ prospect });
    const svc = makeLeadOutcomeService(deps);

    const result = await svc.processLeadOutcome(QUALIFIED);

    expect(result).toEqual({ dispatched: [], duplicate: ['ConfirmedResident'], failed: [] });
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
      if (prev.q === undefined) delete process.env.META_EVENT_QUALIFIED;
      else process.env.META_EVENT_QUALIFIED = prev.q;
      if (prev.w === undefined) delete process.env.META_EVENT_WON;
      else process.env.META_EVENT_WON = prev.w;
    }
  });
});
