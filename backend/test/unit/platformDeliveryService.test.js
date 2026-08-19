/**
 * Pure-function unit matrix for the platform-delivery outbox
 * (ads-centralisation §3.7): settle taxonomy, deadline math (per key, incl.
 * the CReg anchor-present/absent split and the wire anchor), backoff ladders,
 * Retry-After parsing, origin-vs-flag planning, and the §3.3.5 outcome
 * return-contract mapping. No database.
 */
import '../setup.js';
import {
  classifySendResult,
  computeBackoffMs,
  computeDeadlineMs,
  keyHorizonHours,
  parseRetryAfterMs,
  originEligible,
  submitPlanningApplies,
  planningEnabled,
  deliveryPaused,
  mapDeliveryOutcomeToLegacy,
  makeDeliveryFetch,
} from '../../src/services/platformDeliveryService.js';
import { OUTCOME_EVENTS, eventNameFor, eventKeysForStatus } from '../../src/services/outcomeEvents.js';

const H = 3600 * 1000;

afterEach(() => {
  delete process.env.PLATFORM_DELIVERY_PLANNING_ENABLED;
  delete process.env.PLATFORM_DELIVERY_PAUSED;
  delete process.env.PLATFORM_DELIVERY_OUTCOME_HORIZON_HOURS;
  delete process.env.PLATFORM_DELIVERY_LEAD_HORIZON_HOURS;
  delete process.env.PLATFORM_DELIVERY_HTTP_TIMEOUT_MS;
  delete process.env.META_EVENT_QUALIFIED;
});

describe('classifySendResult — the settle taxonomy (§3.3.4.7)', () => {
  it('maps a sent Meta result with its fbtrace id', () => {
    const r = classifySendResult('meta', { sent: true, status: 200, body: { fbtrace_id: 'fb-1' } });
    expect(r).toEqual({ kind: 'sent', status: 200, providerRequestId: 'fb-1' });
  });

  it('maps a sent TikTok result with its request id', () => {
    const r = classifySendResult('tiktok', { sent: true, status: 200, body: { code: 0, request_id: 'tt-1' } });
    expect(r).toEqual({ kind: 'sent', status: 200, providerRequestId: 'tt-1' });
  });

  it('maps sender-internal guarded/no_pixel_id to config_blocked (defensive)', () => {
    expect(classifySendResult('meta', { sent: false, reason: 'guarded' }).kind).toBe('config_blocked');
    expect(classifySendResult('tiktok', { sent: false, reason: 'no_pixel_id' }).kind).toBe('config_blocked');
  });

  it('maps network/timeout errors to retry_wait', () => {
    const r = classifySendResult('meta', { sent: false, error: 'This operation was aborted' });
    expect(r.kind).toBe('retry_wait');
    expect(r.errorCode).toBe('network');
  });

  it('maps 5xx/408/429 to retry_wait and carries Retry-After', () => {
    expect(classifySendResult('meta', { sent: false, status: 503 }).kind).toBe('retry_wait');
    expect(classifySendResult('meta', { sent: false, status: 408 }).kind).toBe('retry_wait');
    const r = classifySendResult('tiktok', { sent: false, status: 429 }, { retryAfterMs: 90_000 });
    expect(r.kind).toBe('retry_wait');
    expect(r.retryAfterMs).toBe(90_000);
  });

  it('maps Meta auth-class body codes (190/102/104) to the auth retry ladder', () => {
    for (const code of [190, 102, 104]) {
      const r = classifySendResult('meta', { sent: false, status: 400, body: { error: { code } } });
      expect(r).toMatchObject({ kind: 'retry_wait', errorCode: 'auth', authClass: true });
    }
  });

  it('maps TikTok auth via HTTP 401/403 AND via body code on HTTP 200', () => {
    expect(classifySendResult('tiktok', { sent: false, status: 401, body: {} })).toMatchObject({ errorCode: 'auth' });
    // TikTok can return auth failures as HTTP 200 with a 401xx body code.
    const r = classifySendResult('tiktok', { sent: false, status: 200, body: { code: 40105 } });
    expect(r).toMatchObject({ kind: 'retry_wait', errorCode: 'auth', authClass: true });
  });

  it('maps other 4xx to failed_permanent', () => {
    const r = classifySendResult('meta', { sent: false, status: 400, body: { error: { code: 100 } } });
    expect(r).toMatchObject({ kind: 'failed_permanent', errorCode: 'http_4xx' });
  });

  it('maps a TikTok 200-with-nonzero-code logical failure to failed_permanent', () => {
    const r = classifySendResult('tiktok', { sent: false, status: 200, body: { code: 40001 } });
    expect(r).toMatchObject({ kind: 'failed_permanent', errorCode: 'logical_reject' });
  });

  it('auth-class classifications carry Retry-After so the backoff floor applies (Codex #8)', () => {
    const meta = classifySendResult('meta', { sent: false, status: 400, body: { error: { code: 190 } } }, { retryAfterMs: 90_000 });
    expect(meta.retryAfterMs).toBe(90_000);
    const tt = classifySendResult('tiktok', { sent: false, status: 200, body: { code: 40105 } }, { retryAfterMs: 45_000 });
    expect(tt.retryAfterMs).toBe(45_000);
  });
});

describe('computeBackoffMs', () => {
  it('grows 60s·2^(n−1) capped at 1h, with jitter ≤30s', () => {
    expect(computeBackoffMs(1, { jitterRatio: 0 })).toBe(60_000);
    expect(computeBackoffMs(3, { jitterRatio: 0 })).toBe(240_000);
    expect(computeBackoffMs(12, { jitterRatio: 0 })).toBe(3600_000); // cap
    const withJitter = computeBackoffMs(1, { jitterRatio: 0.999 });
    expect(withJitter).toBeGreaterThan(60_000);
    expect(withJitter).toBeLessThanOrEqual(60_000 + 30_000);
  });

  it('uses the long auth ladder 30min·2^(n−1) capped at 4h', () => {
    expect(computeBackoffMs(1, { authClass: true })).toBe(30 * 60_000);
    expect(computeBackoffMs(2, { authClass: true })).toBe(60 * 60_000);
    expect(computeBackoffMs(9, { authClass: true })).toBe(4 * 3600_000); // cap
  });

  it('honours Retry-After as a floor, never a shortening', () => {
    expect(computeBackoffMs(1, { jitterRatio: 0, retryAfterMs: 300_000 })).toBe(300_000);
    expect(computeBackoffMs(6, { jitterRatio: 0, retryAfterMs: 1000 })).toBe(1920_000);
  });
});

describe('computeDeadlineMs — per-key horizons + the wire anchor (§1.3)', () => {
  const anchor = Date.parse('2026-08-01T00:00:00Z');

  it('lead: anchor + 47h', () => {
    expect(computeDeadlineMs({ eventKey: 'lead', dedupeAnchorAt: new Date(anchor), firstWireAt: null }))
      .toBe(anchor + 47 * H);
  });

  it('complete_registration WITH a reveal anchor: 47h from it', () => {
    expect(computeDeadlineMs({
      eventKey: 'complete_registration', dedupeAnchorAt: new Date(anchor), firstWireAt: null, hasRegistrationAnchor: true,
    })).toBe(anchor + 47 * H);
  });

  it('complete_registration WITHOUT a reveal anchor: the conservative 24h', () => {
    expect(computeDeadlineMs({
      eventKey: 'complete_registration', dedupeAnchorAt: new Date(anchor), firstWireAt: null, hasRegistrationAnchor: false,
    })).toBe(anchor + 24 * H);
  });

  it('outcomes: 156h from the fact time', () => {
    expect(computeDeadlineMs({ eventKey: 'confirmed_resident', dedupeAnchorAt: new Date(anchor), firstWireAt: null }))
      .toBe(anchor + 156 * H);
  });

  it('the wire anchor wins when firstWireAt + 47h is earlier than the anchor horizon', () => {
    const firstWire = anchor + 1 * H;
    expect(computeDeadlineMs({
      eventKey: 'confirmed_resident', dedupeAnchorAt: new Date(anchor), firstWireAt: new Date(firstWire),
    })).toBe(firstWire + 47 * H); // < anchor + 156h
  });

  it('clamps env horizons into their §8 bounds', () => {
    process.env.PLATFORM_DELIVERY_OUTCOME_HORIZON_HOURS = '500';
    expect(keyHorizonHours('confirmed_resident')).toBe(160);
    process.env.PLATFORM_DELIVERY_LEAD_HORIZON_HOURS = '99';
    expect(keyHorizonHours('lead')).toBe(47);
  });

  it('treats a BLANK env value as absent — the default, never a min-clamped zero (Codex #6)', () => {
    process.env.PLATFORM_DELIVERY_OUTCOME_HORIZON_HOURS = '';
    expect(keyHorizonHours('confirmed_resident')).toBe(156);
    process.env.PLATFORM_DELIVERY_OUTCOME_HORIZON_HOURS = '  ';
    expect(keyHorizonHours('confirmed_resident')).toBe(156);
    process.env.PLATFORM_DELIVERY_OUTCOME_HORIZON_HOURS = 'abc';
    expect(keyHorizonHours('confirmed_resident')).toBe(156);
  });
});

describe('makeDeliveryFetch — the timeout covers the BODY read (Codex #1)', () => {
  it('a stalled body aborts at the timeout instead of outliving the claim lease', async () => {
    process.env.PLATFORM_DELIVERY_HTTP_TIMEOUT_MS = '1000';
    const capture = {};
    const base = async (url, opts) => ({
      status: 200,
      headers: { get: () => null },
      // Headers arrived; the body never does. A real undici read rejects on
      // abort — the fake wires the same contract to the wrapper's signal.
      json: () => new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(new Error('body aborted')));
      }),
    });
    const wrapped = makeDeliveryFetch(capture, base);
    const res = await wrapped('https://provider.test/events', {});
    await expect(res.json()).rejects.toThrow('body aborted');
  }, 10000);

  it('a settling body clears the timer, and Retry-After is captured out-of-band', async () => {
    process.env.PLATFORM_DELIVERY_HTTP_TIMEOUT_MS = '1000';
    const capture = {};
    const base = async () => ({
      status: 429,
      headers: { get: (h) => (h === 'retry-after' ? '120' : null) },
      json: async () => ({ code: 0 }),
    });
    const wrapped = makeDeliveryFetch(capture, base);
    const res = await wrapped('https://provider.test/events', {});
    await expect(res.json()).resolves.toEqual({ code: 0 });
    expect(capture.retryAfterMs).toBe(120_000);
  });
});

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfterMs('120')).toBe(120_000);
  });
  it('parses an HTTP-date relative to now', () => {
    const now = Date.parse('2026-08-01T00:00:00Z');
    expect(parseRetryAfterMs('Sat, 01 Aug 2026 00:05:00 GMT', now)).toBe(300_000);
  });
  it('returns null on garbage/absent', () => {
    expect(parseRetryAfterMs('soon')).toBeNull();
    expect(parseRetryAfterMs(null)).toBeNull();
  });
});

describe('origin-vs-flag planning (§3.2)', () => {
  const web = { leadSource: 'website', retellCallId: null, sourceMetadata: {} };

  it('originEligible excludes call_bot, retell, and Meta Lead Ads prospects', () => {
    expect(originEligible(web)).toBe(true);
    expect(originEligible({ ...web, leadSource: 'call_bot' })).toBe(false);
    expect(originEligible({ ...web, retellCallId: 'call-1' })).toBe(false);
    expect(originEligible({ ...web, sourceMetadata: { metaLeadgenId: 'lg-1' } })).toBe(false);
  });

  it('submitPlanningApplies = planning flag ∧ origin eligibility', () => {
    expect(submitPlanningApplies({ prospect: web })).toBe(false); // flag unset
    process.env.PLATFORM_DELIVERY_PLANNING_ENABLED = 'true';
    expect(submitPlanningApplies({ prospect: web })).toBe(true);
    expect(submitPlanningApplies({ prospect: { ...web, retellCallId: 'c' } })).toBe(false);
  });

  it('flag readers require the literal "true"', () => {
    process.env.PLATFORM_DELIVERY_PLANNING_ENABLED = '1';
    expect(planningEnabled()).toBe(false);
    process.env.PLATFORM_DELIVERY_PAUSED = 'true';
    expect(deliveryPaused()).toBe(true);
  });
});

describe('mapDeliveryOutcomeToLegacy — §3.3.5 contract, complete', () => {
  it('covers every outcome', () => {
    expect(mapDeliveryOutcomeToLegacy({ outcome: 'sent' })).toBe('dispatched');
    expect(mapDeliveryOutcomeToLegacy({ outcome: 'config_blocked' })).toBe('guarded');
    expect(mapDeliveryOutcomeToLegacy({ outcome: 'retry_wait' })).toBe('transientFailed');
    expect(mapDeliveryOutcomeToLegacy({ outcome: 'paused' })).toBe('transientFailed');
    expect(mapDeliveryOutcomeToLegacy({ outcome: 'claim_miss' })).toBe('transientFailed');
    expect(mapDeliveryOutcomeToLegacy({ outcome: 'failed_permanent' })).toBe('permanentFailed');
    expect(mapDeliveryOutcomeToLegacy({ outcome: 'expired' })).toBe('permanentFailed');
    expect(mapDeliveryOutcomeToLegacy({ outcome: 'skipped' })).toBe('permanentFailed');
  });
});

describe('outcomeEvents — the shared per-key vocabulary (§3.3.2)', () => {
  it('pins the marker keys the ledger and the legacy path both write', () => {
    expect(OUTCOME_EVENTS.confirmed_resident.markerKey).toBe('confirmedResidentAt');
    expect(OUTCOME_EVENTS.closed_won.markerKey).toBe('closedWonAt');
  });

  it('resolves env-overridable event names', () => {
    expect(eventNameFor('confirmed_resident')).toBe('ConfirmedResident');
    process.env.META_EVENT_QUALIFIED = 'CustomCR';
    expect(eventNameFor('confirmed_resident')).toBe('CustomCR');
    expect(eventNameFor('closed_won')).toBe('ClosedWon');
    expect(eventNameFor('nope')).toBeNull();
  });

  it('maps statuses to ordered key lists', () => {
    expect(eventKeysForStatus('qualified')).toEqual(['confirmed_resident']);
    expect(eventKeysForStatus('won')).toEqual(['confirmed_resident', 'closed_won']);
    expect(eventKeysForStatus('contacted')).toEqual([]);
  });
});
