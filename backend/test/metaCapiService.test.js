import { jest } from '@jest/globals';
import { createHash } from 'crypto';

const sha256 = (v) => createHash('sha256').update(v).digest('hex');

// Mock @sentry/node BEFORE the SUT is imported. Jest ESM requires
// unstable_mockModule + dynamic import for mocked modules.
const captureExceptionMock = jest.fn();
jest.unstable_mockModule('@sentry/node', () => ({
  captureException: captureExceptionMock,
  // shim other exports we don't use, in case the SUT changes
  init: jest.fn(),
  setTag: jest.fn(),
}));

// Mock logger to keep test output clean (and to avoid pino-pretty side effects)
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

let shouldFireCapi, _buildPayload, sendLeadEvent, sendCompleteRegistrationEvent, sendConversionEvent;

beforeAll(async () => {
  ({ shouldFireCapi, _buildPayload, sendLeadEvent, sendCompleteRegistrationEvent, sendConversionEvent } = await import(
    '../src/services/metaCapiService.js'
  ));
});

// ---------- env snapshot ----------
const ENV_KEYS = ['META_CAPI_ENABLED', 'META_PIXEL_ID', 'META_CAPI_ACCESS_TOKEN', 'META_TEST_EVENT_CODE'];
const envBackup = {};

beforeEach(() => {
  ENV_KEYS.forEach((k) => { envBackup[k] = process.env[k]; delete process.env[k]; });
  // Default "all systems go" config; individual tests override
  process.env.META_CAPI_ENABLED = 'true';
  process.env.META_PIXEL_ID = '123456789012345';
  process.env.META_CAPI_ACCESS_TOKEN = 'TEST_TOKEN';
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
  firstName: 'Shawn',
  lastName: "O'Neil-Tan",
  campaignId: 'campaign-uuid-1',
  leadSource: 'qr_code',
  retellCallId: null,
  sourceMetadata: { consent_contact: true },
  ...overrides,
});

const okFetch = (body = { events_received: 1, fbtrace_id: 'trace-1' }) =>
  jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });

// ============================================================
// shouldFireCapi
// ============================================================
describe('shouldFireCapi', () => {
  it('returns true for clean web-form prospect with full config', () => {
    expect(shouldFireCapi(webProspect())).toBe(true);
  });

  it('returns false when META_CAPI_ENABLED is not "true"', () => {
    process.env.META_CAPI_ENABLED = 'false';
    expect(shouldFireCapi(webProspect())).toBe(false);
  });

  it('returns false when META_CAPI_ENABLED is unset', () => {
    delete process.env.META_CAPI_ENABLED;
    expect(shouldFireCapi(webProspect())).toBe(false);
  });

  it('returns false when META_CAPI_ACCESS_TOKEN is missing', () => {
    delete process.env.META_CAPI_ACCESS_TOKEN;
    expect(shouldFireCapi(webProspect())).toBe(false);
  });

  it('stays true when META_PIXEL_ID is missing — the pixel id resolves LATE in sendConversionEvent', () => {
    delete process.env.META_PIXEL_ID;
    expect(shouldFireCapi(webProspect())).toBe(true);
  });

  it('returns false for null/undefined prospect', () => {
    expect(shouldFireCapi(null)).toBe(false);
    expect(shouldFireCapi(undefined)).toBe(false);
  });

  it('returns false when leadSource is call_bot (Retell)', () => {
    expect(shouldFireCapi(webProspect({ leadSource: 'call_bot' }))).toBe(false);
  });

  it('returns false when retellCallId is present', () => {
    expect(shouldFireCapi(webProspect({ retellCallId: 'call_abc' }))).toBe(false);
  });

  it('returns false when sourceMetadata.metaLeadgenId is present (Meta Lead Ads)', () => {
    expect(
      shouldFireCapi(webProspect({ sourceMetadata: { metaLeadgenId: 'lead_xyz' } }))
    ).toBe(false);
  });
});

// ============================================================
// _buildPayload
// ============================================================
describe('_buildPayload', () => {
  const ctx = {
    eventId: 'evt-1',
    fbp: 'fb.1.123.fbp_value',
    fbc: 'fb.1.456.fbc_value',
    clientIp: '203.0.113.1',
    clientUserAgent: 'Mozilla/5.0 (test)',
    eventSourceUrl: 'https://mktr.sg/LeadCapture',
  };

  it('hashes email and phone when ctx.marketingConsent is true (ledger-derived by the caller)', () => {
    const payload = _buildPayload(webProspect(), { ...ctx, marketingConsent: true }, {});
    const ud = payload.data[0].user_data;
    expect(ud.em).toMatch(/^[a-f0-9]{64}$/);
    expect(ud.ph).toMatch(/^[a-f0-9]{64}$/);
  });

  it('omits email and phone when ctx.marketingConsent is false', () => {
    const payload = _buildPayload(webProspect(), { ...ctx, marketingConsent: false }, {});
    const ud = payload.data[0].user_data;
    expect(ud.em).toBeUndefined();
    expect(ud.ph).toBeUndefined();
  });

  it('omits email and phone when ctx.marketingConsent is absent — FAIL CLOSED', () => {
    const payload = _buildPayload(webProspect(), ctx, {});
    const ud = payload.data[0].user_data;
    expect(ud.em).toBeUndefined();
    expect(ud.ph).toBeUndefined();
  });

  it('3sites: the stored consent_contact boolean is IGNORED — only the ctx flag gates', () => {
    // webProspect() carries sourceMetadata.consent_contact:true; without the
    // ledger-derived ctx flag the identifiers must not ride.
    const stored = _buildPayload(webProspect({ sourceMetadata: { consent_contact: true } }), ctx, {});
    expect(stored.data[0].user_data.em).toBeUndefined();
    // And the ctx flag licenses em/ph even when the stored boolean says false.
    const ctxWins = _buildPayload(
      webProspect({ sourceMetadata: { consent_contact: false } }),
      { ...ctx, marketingConsent: true },
      {}
    );
    expect(ctxWins.data[0].user_data.em).toMatch(/^[a-f0-9]{64}$/);
  });

  it('EMQ: hashes fn/ln/country with consent, using Meta-normalized inputs (lowercase, strip whitespace+punctuation, keep digits/UTF-8)', () => {
    const payload = _buildPayload(
      webProspect({ firstName: '  Shawn 3 ', lastName: "O'Neil-Tan" }),
      { ...ctx, marketingConsent: true },
      {}
    );
    const ud = payload.data[0].user_data;
    expect(ud.fn).toBe(sha256('shawn3')); // digits kept, whitespace stripped
    expect(ud.ln).toBe(sha256('oneiltan')); // apostrophe + hyphen stripped
    expect(ud.country).toBe(sha256('sg'));
  });

  it('EMQ: keeps UTF-8 letters in name hashes', () => {
    const payload = _buildPayload(
      webProspect({ firstName: 'José', lastName: 'Müller' }),
      { ...ctx, marketingConsent: true },
      {}
    );
    const ud = payload.data[0].user_data;
    expect(ud.fn).toBe(sha256('josé'));
    expect(ud.ln).toBe(sha256('müller'));
  });

  it('EMQ: omits fn/ln/country without consent — same FAIL-CLOSED gate as em/ph', () => {
    for (const ctxVariant of [ctx, { ...ctx, marketingConsent: false }]) {
      const ud = _buildPayload(webProspect(), ctxVariant, {}).data[0].user_data;
      expect(ud.fn).toBeUndefined();
      expect(ud.ln).toBeUndefined();
      expect(ud.country).toBeUndefined();
    }
  });

  it('EMQ: name-less prospects with consent omit fn/ln (no placeholder hashes)', () => {
    const ud = _buildPayload(
      webProspect({ firstName: null, lastName: '' }),
      { ...ctx, marketingConsent: true },
      {}
    ).data[0].user_data;
    expect(ud.fn).toBeUndefined();
    expect(ud.ln).toBeUndefined();
    expect(ud.country).toBe(sha256('sg')); // country rides with consent regardless of names
  });

  it('always includes fbp/fbc/ip/ua/external_id regardless of consent', () => {
    const payload = _buildPayload(webProspect(), { ...ctx, marketingConsent: false }, {});
    const ud = payload.data[0].user_data;
    expect(ud.fbp).toBe('fb.1.123.fbp_value');
    expect(ud.fbc).toBe('fb.1.456.fbc_value');
    expect(ud.client_ip_address).toBe('203.0.113.1');
    expect(ud.client_user_agent).toBe('Mozilla/5.0 (test)');
    expect(ud.external_id).toMatch(/^[a-f0-9]{64}$/);
  });

  it('strips undefined/null/empty user_data fields', () => {
    const payload = _buildPayload(
      webProspect({ phone: null, email: null }),
      { eventId: 'evt-2', clientIp: '1.2.3.4' },
      {}
    );
    const ud = payload.data[0].user_data;
    expect(Object.keys(ud)).toEqual(expect.arrayContaining(['client_ip_address', 'external_id']));
    expect(ud).not.toHaveProperty('fbp');
    expect(ud).not.toHaveProperty('fbc');
    expect(ud).not.toHaveProperty('client_user_agent');
  });

  it('includes test_event_code when option provided', () => {
    const payload = _buildPayload(webProspect(), ctx, { testEventCode: 'TEST123' });
    expect(payload.test_event_code).toBe('TEST123');
  });

  it('omits test_event_code when option missing', () => {
    const payload = _buildPayload(webProspect(), ctx, {});
    expect(payload).not.toHaveProperty('test_event_code');
  });

  it('uses ctx.eventId as event_id', () => {
    const payload = _buildPayload(webProspect(), { eventId: 'evt-xyz' }, {});
    expect(payload.data[0].event_id).toBe('evt-xyz');
  });

  it('falls back to sourceMetadata.fbp/fbc/clientIp when ctx fields missing', () => {
    const prospect = webProspect({
      sourceMetadata: {
        consent_contact: true,
        fbp: 'fb.fallback.fbp',
        fbc: 'fb.fallback.fbc',
        clientIp: '10.0.0.1',
        clientUserAgent: 'fallback-ua',
        eventSourceUrl: 'https://fallback.example.com',
      },
    });
    const payload = _buildPayload(prospect, { eventId: 'evt-3' }, {});
    const ud = payload.data[0].user_data;
    expect(ud.fbp).toBe('fb.fallback.fbp');
    expect(ud.fbc).toBe('fb.fallback.fbc');
    expect(ud.client_ip_address).toBe('10.0.0.1');
    expect(ud.client_user_agent).toBe('fallback-ua');
    expect(payload.data[0].event_source_url).toBe('https://fallback.example.com');
  });

  it('sets action_source=website and event_name=Lead', () => {
    const event = _buildPayload(webProspect(), ctx, {}).data[0];
    expect(event.action_source).toBe('website');
    expect(event.event_name).toBe('Lead');
  });

  it('ctx.actionSource overrides action_source AND suppresses event_source_url for non-website events', () => {
    const event = _buildPayload(
      webProspect(),
      { ...ctx, actionSource: 'physical_store' },
      { eventName: 'VoucherRedeemed' }
    ).data[0];
    expect(event.action_source).toBe('physical_store');
    // A counter redemption must not carry the months-old landing URL.
    expect(event).not.toHaveProperty('event_source_url');
    expect(event.event_name).toBe('VoucherRedeemed');
  });

  it('ctx.campaignIdOverride replaces prospect.campaignId in custom_data (activation-scoped redemption)', () => {
    const event = _buildPayload(
      webProspect(),
      { ...ctx, campaignIdOverride: 'activation-campaign-uuid' },
      {}
    ).data[0];
    expect(event.custom_data.campaign_id).toBe('activation-campaign-uuid');
  });

  it('defaults event_name to Lead when options.eventName is absent', () => {
    const event = _buildPayload(webProspect(), ctx, { testEventCode: 'X' }).data[0];
    expect(event.event_name).toBe('Lead');
  });

  it('overrides event_name when options.eventName is provided (CompleteRegistration)', () => {
    const event = _buildPayload(webProspect(), ctx, { eventName: 'CompleteRegistration' }).data[0];
    expect(event.event_name).toBe('CompleteRegistration');
    // The dedup id still flows from ctx.eventId so Pixel↔CAPI dedup is preserved.
    expect(event.event_id).toBe('evt-1');
  });

  it('includes campaign_id and lead_source in custom_data', () => {
    const event = _buildPayload(webProspect(), ctx, {}).data[0];
    expect(event.custom_data).toEqual({
      campaign_id: 'campaign-uuid-1',
      lead_source: 'qr_code',
    });
  });

  it('defaults event_time to now when ctx.eventTime is absent', () => {
    const before = Math.floor(Date.now() / 1000);
    const event = _buildPayload(webProspect(), ctx, {}).data[0];
    expect(event.event_time).toBeGreaterThanOrEqual(before);
    expect(event.event_time).toBeLessThanOrEqual(before + 2);
  });

  it('back-dates event_time to ctx.eventTime for delayed down-funnel events', () => {
    // e.g. QualifiedLead fired days after submit, dated to the status change.
    const qualifiedAt = 1_700_000_000; // fixed unix seconds
    const event = _buildPayload(
      webProspect(),
      { eventId: 'qualified:prospect-uuid-1', eventTime: qualifiedAt },
      { eventName: 'QualifiedLead' }
    ).data[0];
    expect(event.event_time).toBe(qualifiedAt);
    expect(event.event_name).toBe('QualifiedLead');
    expect(event.event_id).toBe('qualified:prospect-uuid-1');
  });
});

// ============================================================
// sendLeadEvent
// ============================================================
describe('sendLeadEvent', () => {
  it('returns { sent: false, reason: "guarded" } when shouldFireCapi is false; does NOT call fetch', async () => {
    process.env.META_CAPI_ENABLED = 'false';
    const fetchSpy = okFetch();
    const result = await sendLeadEvent(webProspect(), { eventId: 'evt-1' }, { fetch: fetchSpy });
    expect(result).toEqual({ sent: false, reason: 'guarded' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns { sent: false, reason: "no_pixel_id" } when neither override nor env pixel id exists; does NOT call fetch', async () => {
    delete process.env.META_PIXEL_ID;
    const fetchSpy = okFetch();
    const result = await sendLeadEvent(webProspect(), { eventId: 'evt-1' }, { fetch: fetchSpy });
    expect(result).toEqual({ sent: false, reason: 'no_pixel_id' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a per-campaign pixelIdOverride fires even when META_PIXEL_ID is unset (late resolution, mirrors TikTok)', async () => {
    delete process.env.META_PIXEL_ID;
    const fetchSpy = okFetch();
    const result = await sendLeadEvent(
      webProspect(),
      { eventId: 'evt-1', pixelIdOverride: '999888777666555' },
      { fetch: fetchSpy }
    );
    expect(result.sent).toBe(true);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://graph.facebook.com/v21.0/999888777666555/events?access_token=TEST_TOKEN'
    );
  });

  it('calls fetch with the correct URL, method, headers, and body on a happy path', async () => {
    const fetchSpy = okFetch();
    await sendLeadEvent(webProspect(), { eventId: 'evt-1' }, { fetch: fetchSpy });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/123456789012345/events?access_token=TEST_TOKEN');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.data[0].event_id).toBe('evt-1');
    expect(body.data[0].event_name).toBe('Lead');
  });

  it('returns { sent: true } on 200 response', async () => {
    const fetchSpy = okFetch();
    const result = await sendLeadEvent(webProspect(), { eventId: 'evt-1' }, { fetch: fetchSpy });
    expect(result.sent).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body.events_received).toBe(1);
  });

  it('threads ctx.marketingConsent through to the wire payload (em rides only with the flag)', async () => {
    const withFlag = okFetch();
    await sendLeadEvent(webProspect(), { eventId: 'evt-1', marketingConsent: true }, { fetch: withFlag });
    expect(JSON.parse(withFlag.mock.calls[0][1].body).data[0].user_data.em).toMatch(/^[a-f0-9]{64}$/);

    const withoutFlag = okFetch();
    await sendLeadEvent(webProspect(), { eventId: 'evt-1' }, { fetch: withoutFlag });
    expect(JSON.parse(withoutFlag.mock.calls[0][1].body).data[0].user_data.em).toBeUndefined();
  });

  it('returns { sent: false } and captures Sentry on non-2xx', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'invalid token' } }),
    });
    const result = await sendLeadEvent(webProspect(), { eventId: 'evt-1' }, { fetch: fetchSpy });
    expect(result.sent).toBe(false);
    expect(result.status).toBe(400);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('catches network errors without throwing and returns { sent: false, error }', async () => {
    const fetchSpy = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await sendLeadEvent(webProspect(), { eventId: 'evt-1' }, { fetch: fetchSpy });
    expect(result.sent).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('uses ctx.pixelIdOverride when provided (Phase 5 forward-compat)', async () => {
    const fetchSpy = okFetch();
    await sendLeadEvent(
      webProspect(),
      { eventId: 'evt-1', pixelIdOverride: 'override-pixel-999' },
      { fetch: fetchSpy }
    );
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('/override-pixel-999/events?');
  });

  it('includes test_event_code in body when META_TEST_EVENT_CODE is set', async () => {
    process.env.META_TEST_EVENT_CODE = 'TEST_ABC';
    const fetchSpy = okFetch();
    await sendLeadEvent(webProspect(), { eventId: 'evt-1' }, { fetch: fetchSpy });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.test_event_code).toBe('TEST_ABC');
  });
});

// ============================================================
// sendCompleteRegistrationEvent (quiz funnel reveal)
// ============================================================
describe('sendCompleteRegistrationEvent', () => {
  it('returns { sent: false, reason: "guarded" } when shouldFireCapi is false; does NOT call fetch', async () => {
    process.env.META_CAPI_ENABLED = 'false';
    const fetchSpy = okFetch();
    const result = await sendCompleteRegistrationEvent(
      webProspect(),
      { eventId: 'reg-1' },
      { fetch: fetchSpy }
    );
    expect(result).toEqual({ sent: false, reason: 'guarded' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts event_name=CompleteRegistration with the registration event_id (dedup contract)', async () => {
    const fetchSpy = okFetch();
    await sendCompleteRegistrationEvent(webProspect(), { eventId: 'reg-evt-123' }, { fetch: fetchSpy });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.data[0].event_name).toBe('CompleteRegistration');
    expect(body.data[0].event_id).toBe('reg-evt-123');
  });

  it('uses the same pixel/token URL as Lead and honors pixelIdOverride', async () => {
    const fetchSpy = okFetch();
    await sendCompleteRegistrationEvent(
      webProspect(),
      { eventId: 'reg-1', pixelIdOverride: 'override-pixel-777' },
      { fetch: fetchSpy }
    );
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('/override-pixel-777/events?access_token=TEST_TOKEN');
  });

  it('returns { sent: true } on 200 and captures Sentry on non-2xx', async () => {
    const okSpy = okFetch();
    const ok = await sendCompleteRegistrationEvent(webProspect(), { eventId: 'reg-1' }, { fetch: okSpy });
    expect(ok.sent).toBe(true);

    const badSpy = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    const bad = await sendCompleteRegistrationEvent(webProspect(), { eventId: 'reg-1' }, { fetch: badSpy });
    expect(bad.sent).toBe(false);
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});

// ============================================================
// sendConversionEvent (generic core)
// ============================================================
describe('sendConversionEvent', () => {
  it('defaults to event_name=Lead when no eventName option is given', async () => {
    const fetchSpy = okFetch();
    await sendConversionEvent(webProspect(), { eventId: 'evt-1' }, {}, { fetch: fetchSpy });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.data[0].event_name).toBe('Lead');
  });

  it('passes through an arbitrary eventName', async () => {
    const fetchSpy = okFetch();
    await sendConversionEvent(
      webProspect(),
      { eventId: 'evt-1' },
      { eventName: 'CompleteRegistration' },
      { fetch: fetchSpy }
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.data[0].event_name).toBe('CompleteRegistration');
  });
});
