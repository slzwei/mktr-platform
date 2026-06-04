import { jest } from '@jest/globals';

// Mock @sentry/node BEFORE the SUT is imported (Jest ESM requires
// unstable_mockModule + dynamic import for mocked modules).
const captureExceptionMock = jest.fn();
jest.unstable_mockModule('@sentry/node', () => ({
  captureException: captureExceptionMock,
  init: jest.fn(),
  setTag: jest.fn(),
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

let shouldFireTikTok, _buildPayload, sendTikTokLeadEvent, sendTikTokCompleteRegistrationEvent, sendConversionEvent;

beforeAll(async () => {
  ({ shouldFireTikTok, _buildPayload, sendTikTokLeadEvent, sendTikTokCompleteRegistrationEvent, sendConversionEvent } =
    await import('../src/services/tiktokEventsService.js'));
});

// ---------- env snapshot ----------
const ENV_KEYS = ['TIKTOK_EVENTS_API_ENABLED', 'TIKTOK_PIXEL_ID', 'TIKTOK_ACCESS_TOKEN', 'TIKTOK_TEST_EVENT_CODE'];
const envBackup = {};

beforeEach(() => {
  ENV_KEYS.forEach((k) => { envBackup[k] = process.env[k]; delete process.env[k]; });
  process.env.TIKTOK_EVENTS_API_ENABLED = 'true';
  process.env.TIKTOK_PIXEL_ID = 'CPIXEL123';
  process.env.TIKTOK_ACCESS_TOKEN = 'TT_TOKEN';
  captureExceptionMock.mockClear();
});

afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  });
});

// ---------- helpers ----------
const webProspect = (overrides = {}) => ({
  id: 'prospect-uuid-1',
  email: 'shawn@mktr.sg',
  phone: '+6581234567',
  campaignId: 'campaign-uuid-1',
  leadSource: 'website',
  retellCallId: null,
  sourceMetadata: { consent_contact: true },
  ...overrides,
});

const okFetch = (body = { code: 0, message: 'OK', request_id: 'req-1' }) =>
  jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });

// ============================================================
// shouldFireTikTok
// ============================================================
describe('shouldFireTikTok', () => {
  it('returns true for clean web-form prospect with full config', () => {
    expect(shouldFireTikTok(webProspect())).toBe(true);
  });

  it('returns false when TIKTOK_EVENTS_API_ENABLED is not "true"', () => {
    process.env.TIKTOK_EVENTS_API_ENABLED = 'false';
    expect(shouldFireTikTok(webProspect())).toBe(false);
  });

  it('returns false when TIKTOK_ACCESS_TOKEN is missing', () => {
    delete process.env.TIKTOK_ACCESS_TOKEN;
    expect(shouldFireTikTok(webProspect())).toBe(false);
  });

  it('stays eligible without env TIKTOK_PIXEL_ID (a per-campaign override may supply it; the sender resolves the id and bails if neither is present)', () => {
    delete process.env.TIKTOK_PIXEL_ID;
    expect(shouldFireTikTok(webProspect())).toBe(true);
  });

  it('returns false for null/undefined prospect', () => {
    expect(shouldFireTikTok(null)).toBe(false);
    expect(shouldFireTikTok(undefined)).toBe(false);
  });

  it('returns false for Retell-origin prospects (call_bot / retellCallId)', () => {
    expect(shouldFireTikTok(webProspect({ leadSource: 'call_bot' }))).toBe(false);
    expect(shouldFireTikTok(webProspect({ retellCallId: 'call_abc' }))).toBe(false);
  });

  it('returns false for Meta Lead Ads-origin prospects (metaLeadgenId)', () => {
    expect(shouldFireTikTok(webProspect({ sourceMetadata: { metaLeadgenId: 'lead_xyz' } }))).toBe(false);
  });
});

// ============================================================
// _buildPayload
// ============================================================
describe('_buildPayload', () => {
  const ctx = {
    eventId: 'evt-1',
    ttclid: 'ttclid-abc',
    ttp: 'ttp-xyz',
    clientIp: '203.0.113.1',
    clientUserAgent: 'Mozilla/5.0 (test)',
    eventSourceUrl: 'https://redeem.sg/LeadCapture',
  };

  it('sets event_source=web and event_source_id to the pixel id', () => {
    const payload = _buildPayload(webProspect(), ctx, {});
    expect(payload.event_source).toBe('web');
    expect(payload.event_source_id).toBe('CPIXEL123');
  });

  it('defaults event to Lead and overrides via options.eventName', () => {
    expect(_buildPayload(webProspect(), ctx, {}).data[0].event).toBe('Lead');
    expect(_buildPayload(webProspect(), ctx, { eventName: 'CompleteRegistration' }).data[0].event).toBe(
      'CompleteRegistration'
    );
  });

  it('uses ctx.eventId as the dedup event_id', () => {
    expect(_buildPayload(webProspect(), { eventId: 'evt-xyz' }, {}).data[0].event_id).toBe('evt-xyz');
  });

  it('hashes email and phone when marketing consent is true', () => {
    const user = _buildPayload(webProspect(), ctx, {}).data[0].user;
    expect(user.email).toMatch(/^[a-f0-9]{64}$/);
    expect(user.phone).toMatch(/^[a-f0-9]{64}$/);
  });

  it('omits email and phone when marketing consent is false/missing', () => {
    const u1 = _buildPayload(webProspect({ sourceMetadata: { consent_contact: false } }), ctx, {}).data[0].user;
    expect(u1.email).toBeUndefined();
    expect(u1.phone).toBeUndefined();
    const u2 = _buildPayload(webProspect({ sourceMetadata: {} }), ctx, {}).data[0].user;
    expect(u2.email).toBeUndefined();
    expect(u2.phone).toBeUndefined();
  });

  it('always includes ttclid/ttp/ip/user_agent/external_id regardless of consent', () => {
    const user = _buildPayload(webProspect({ sourceMetadata: { consent_contact: false } }), ctx, {}).data[0].user;
    expect(user.ttclid).toBe('ttclid-abc');
    expect(user.ttp).toBe('ttp-xyz');
    expect(user.ip).toBe('203.0.113.1');
    expect(user.user_agent).toBe('Mozilla/5.0 (test)');
    expect(user.external_id).toMatch(/^[a-f0-9]{64}$/);
  });

  it('falls back to sourceMetadata ttclid/ttp/ip when ctx fields missing', () => {
    const prospect = webProspect({
      sourceMetadata: { consent_contact: true, ttclid: 'tt-fallback', ttp: 'ttp-fallback', clientIp: '10.0.0.1', eventSourceUrl: 'https://fallback.example.com' },
    });
    const event = _buildPayload(prospect, { eventId: 'evt-3' }, {}).data[0];
    expect(event.user.ttclid).toBe('tt-fallback');
    expect(event.user.ttp).toBe('ttp-fallback');
    expect(event.user.ip).toBe('10.0.0.1');
    expect(event.page.url).toBe('https://fallback.example.com');
  });

  it('strips empty user fields and omits page when no url', () => {
    const event = _buildPayload(webProspect({ phone: null, email: null, sourceMetadata: {} }), { eventId: 'e' }, {}).data[0];
    expect(event.user).not.toHaveProperty('ttclid');
    expect(event.user).not.toHaveProperty('ip');
    expect(event.user).toHaveProperty('external_id');
    expect(event).not.toHaveProperty('page');
  });

  it('includes content_type/campaign_id/lead_source in properties', () => {
    const props = _buildPayload(webProspect(), ctx, {}).data[0].properties;
    expect(props).toEqual({ content_type: 'lead', campaign_id: 'campaign-uuid-1', lead_source: 'website' });
  });

  it('includes test_event_code when option provided, omits otherwise', () => {
    expect(_buildPayload(webProspect(), ctx, { testEventCode: 'TT_TEST' }).test_event_code).toBe('TT_TEST');
    expect(_buildPayload(webProspect(), ctx, {})).not.toHaveProperty('test_event_code');
  });

  it('uses ctx.pixelIdOverride for event_source_id when provided', () => {
    expect(_buildPayload(webProspect(), { ...ctx, pixelIdOverride: 'CAMPAIGN_PIXEL' }, {}).event_source_id).toBe(
      'CAMPAIGN_PIXEL'
    );
  });
});

// ============================================================
// sendTikTokLeadEvent
// ============================================================
describe('sendTikTokLeadEvent', () => {
  it('returns { sent: false, reason: "guarded" } when shouldFireTikTok is false; does NOT call fetch', async () => {
    process.env.TIKTOK_EVENTS_API_ENABLED = 'false';
    const fetchSpy = okFetch();
    const result = await sendTikTokLeadEvent(webProspect(), { eventId: 'evt-1' }, { fetch: fetchSpy });
    expect(result).toEqual({ sent: false, reason: 'guarded' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts to the TikTok Events API with the Access-Token header and event=Lead', async () => {
    const fetchSpy = okFetch();
    await sendTikTokLeadEvent(webProspect(), { eventId: 'evt-1' }, { fetch: fetchSpy });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://business-api.tiktok.com/open_api/v1.3/event/track/');
    expect(init.method).toBe('POST');
    expect(init.headers['Access-Token']).toBe('TT_TOKEN');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.data[0].event).toBe('Lead');
    expect(body.data[0].event_id).toBe('evt-1');
  });

  it('returns { sent: true } on HTTP 200 with code 0', async () => {
    const result = await sendTikTokLeadEvent(webProspect(), { eventId: 'evt-1' }, { fetch: okFetch() });
    expect(result.sent).toBe(true);
    expect(result.status).toBe(200);
  });

  it('treats a non-zero TikTok `code` on HTTP 200 as a failure (+ Sentry)', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 40001, message: 'param error' }),
    });
    const result = await sendTikTokLeadEvent(webProspect(), { eventId: 'evt-1' }, { fetch: fetchSpy });
    expect(result.sent).toBe(false);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('treats a 200 with a missing/unparseable code as a failure (strict code===0)', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const result = await sendTikTokLeadEvent(webProspect(), { eventId: 'evt-1' }, { fetch: fetchSpy });
    expect(result.sent).toBe(false);
  });

  it('does NOT send when no pixel id is resolvable (env unset + no override)', async () => {
    delete process.env.TIKTOK_PIXEL_ID;
    const fetchSpy = okFetch();
    const result = await sendTikTokLeadEvent(webProspect(), { eventId: 'evt-1' }, { fetch: fetchSpy });
    expect(result).toEqual({ sent: false, reason: 'no_pixel_id' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends with ctx.pixelIdOverride even when env TIKTOK_PIXEL_ID is unset (per-campaign pixel)', async () => {
    delete process.env.TIKTOK_PIXEL_ID;
    const fetchSpy = okFetch();
    await sendTikTokLeadEvent(webProspect(), { eventId: 'evt-1', pixelIdOverride: 'CAMP_PIXEL' }, { fetch: fetchSpy });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.event_source_id).toBe('CAMP_PIXEL');
  });

  it('returns { sent: false } and captures Sentry on non-2xx', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ code: 40105 }) });
    const result = await sendTikTokLeadEvent(webProspect(), { eventId: 'evt-1' }, { fetch: fetchSpy });
    expect(result.sent).toBe(false);
    expect(result.status).toBe(401);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('catches network errors without throwing', async () => {
    const fetchSpy = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await sendTikTokLeadEvent(webProspect(), { eventId: 'evt-1' }, { fetch: fetchSpy });
    expect(result.sent).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('includes test_event_code in body when TIKTOK_TEST_EVENT_CODE is set', async () => {
    process.env.TIKTOK_TEST_EVENT_CODE = 'TT_TEST_ABC';
    const fetchSpy = okFetch();
    await sendTikTokLeadEvent(webProspect(), { eventId: 'evt-1' }, { fetch: fetchSpy });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.test_event_code).toBe('TT_TEST_ABC');
  });
});

// ============================================================
// sendTikTokCompleteRegistrationEvent
// ============================================================
describe('sendTikTokCompleteRegistrationEvent', () => {
  it('posts event=CompleteRegistration with the registration event_id (dedup contract)', async () => {
    const fetchSpy = okFetch();
    await sendTikTokCompleteRegistrationEvent(webProspect(), { eventId: 'reg-evt-9' }, { fetch: fetchSpy });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.data[0].event).toBe('CompleteRegistration');
    expect(body.data[0].event_id).toBe('reg-evt-9');
  });

  it('is guarded by shouldFireTikTok like Lead', async () => {
    process.env.TIKTOK_EVENTS_API_ENABLED = 'false';
    const fetchSpy = okFetch();
    const result = await sendTikTokCompleteRegistrationEvent(webProspect(), { eventId: 'reg-1' }, { fetch: fetchSpy });
    expect(result).toEqual({ sent: false, reason: 'guarded' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ============================================================
// sendConversionEvent (generic core)
// ============================================================
describe('sendConversionEvent', () => {
  it('defaults to event=Lead and passes through an arbitrary eventName', async () => {
    const f1 = okFetch();
    await sendConversionEvent(webProspect(), { eventId: 'e' }, {}, { fetch: f1 });
    expect(JSON.parse(f1.mock.calls[0][1].body).data[0].event).toBe('Lead');

    const f2 = okFetch();
    await sendConversionEvent(webProspect(), { eventId: 'e' }, { eventName: 'CompleteRegistration' }, { fetch: f2 });
    expect(JSON.parse(f2.mock.calls[0][1].body).data[0].event).toBe('CompleteRegistration');
  });
});
