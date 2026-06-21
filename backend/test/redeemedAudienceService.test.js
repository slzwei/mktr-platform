import { jest } from '@jest/globals';

// Mock @sentry/node BEFORE the SUT is imported (Jest ESM pattern).
const captureExceptionMock = jest.fn();
jest.unstable_mockModule('@sentry/node', () => ({
  captureException: captureExceptionMock,
  init: jest.fn(),
  setTag: jest.fn(),
}));

// Mock logger to keep output clean.
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Mock models/index.js so importing the SUT does NOT open a DB connection
// (the real module has top-level await + Sequelize setup → ECONNREFUSED in CI).
jest.unstable_mockModule('../src/models/index.js', () => ({
  Prospect: { findAll: jest.fn() },
  sequelize: { close: jest.fn() },
}));

let shouldSync, chunk, selectRedeemers, buildUserRows, uploadBatch, syncRedeemedAudience;

beforeAll(async () => {
  ({ shouldSync, chunk, selectRedeemers, buildUserRows, uploadBatch, syncRedeemedAudience } =
    await import('../src/services/redeemedAudienceService.js'));
});

// ---------- env snapshot ----------
const ENV_KEYS = [
  'REDEEMED_AUDIENCE_SYNC_ENABLED',
  'META_ADS_MANAGEMENT_TOKEN',
  'META_REDEEMED_AUDIENCE_ID',
  'META_GRAPH_API_VERSION',
  'REDEEMED_AUDIENCE_REQUIRE_CONSENT',
  'REDEEMED_AUDIENCE_SYNC_MODE',
];
const envBackup = {};

beforeEach(() => {
  ENV_KEYS.forEach((k) => { envBackup[k] = process.env[k]; delete process.env[k]; });
  // Default "all systems go"
  process.env.REDEEMED_AUDIENCE_SYNC_ENABLED = 'true';
  process.env.META_ADS_MANAGEMENT_TOKEN = 'TEST_ADS_TOKEN';
  process.env.META_REDEEMED_AUDIENCE_ID = '52506028688033';
  captureExceptionMock.mockClear();
});

afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  });
});

// ---------- helpers ----------
const prospect = (overrides = {}) => ({
  email: 'shawn@mktr.sg',
  phone: '+6581234567',
  sourceMetadata: { consent_contact: true },
  ...overrides,
});

const okFetch = (body = { num_received: 1, num_invalid_entries: 0, session_id: 'sess-1' }) =>
  jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });

// ============================================================
// shouldSync
// ============================================================
describe('shouldSync', () => {
  it('returns true with full config', () => {
    expect(shouldSync()).toBe(true);
  });
  it('returns false when disabled', () => {
    process.env.REDEEMED_AUDIENCE_SYNC_ENABLED = 'false';
    expect(shouldSync()).toBe(false);
  });
  it('returns false when token missing', () => {
    delete process.env.META_ADS_MANAGEMENT_TOKEN;
    expect(shouldSync()).toBe(false);
  });
  it('returns false when audience id missing', () => {
    delete process.env.META_REDEEMED_AUDIENCE_ID;
    expect(shouldSync()).toBe(false);
  });
});

// ============================================================
// chunk
// ============================================================
describe('chunk', () => {
  it('splits into batches of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it('returns a single batch when under size', () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });
  it('returns empty for empty input', () => {
    expect(chunk([], 10)).toEqual([]);
  });
});

// ============================================================
// buildUserRows
// ============================================================
describe('buildUserRows', () => {
  it('hashes email + phone into a multi-key row', () => {
    const rows = buildUserRows([prospect()], { requireConsent: true });
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toMatch(/^[a-f0-9]{64}$/); // email hash
    expect(rows[0][1]).toMatch(/^[a-f0-9]{64}$/); // phone hash
  });

  it('drops rows without consent when requireConsent=true', () => {
    const rows = buildUserRows(
      [prospect({ sourceMetadata: { consent_contact: false } }), prospect({ sourceMetadata: {} })],
      { requireConsent: true }
    );
    expect(rows).toHaveLength(0);
  });

  it('keeps non-consenting rows when requireConsent=false', () => {
    const rows = buildUserRows([prospect({ sourceMetadata: { consent_contact: false } })], {
      requireConsent: false,
    });
    expect(rows).toHaveLength(1);
  });

  it('drops synthetic Retell emails but keeps the phone (blank email key)', () => {
    const rows = buildUserRows(
      [prospect({ email: 'retell-abc@calls.mktr.sg', phone: '+6591112222' })],
      { requireConsent: true }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe(''); // synthetic email dropped
    expect(rows[0][1]).toMatch(/^[a-f0-9]{64}$/); // phone kept
  });

  it('drops rows with neither a usable email nor phone', () => {
    const rows = buildUserRows(
      [prospect({ email: null, phone: null })],
      { requireConsent: true }
    );
    expect(rows).toHaveLength(0);
  });

  it('emits blank phone key when phone missing', () => {
    const rows = buildUserRows([prospect({ phone: null })], { requireConsent: true });
    expect(rows[0][0]).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0][1]).toBe('');
  });
});

// ============================================================
// uploadBatch (request shape)
// ============================================================
describe('uploadBatch', () => {
  const session = { session_id: 123, batch_seq: 1, last_batch_flag: true, estimated_num_total: 1 };

  it('POSTs to /users with Bearer auth and form-encoded payload+session', async () => {
    const fetchSpy = okFetch();
    await uploadBatch(
      { audienceId: 'AUD1', token: 'TOK', version: 'v21.0', mode: 'add', schema: ['EMAIL', 'PHONE'], data: [['a', 'b']], session },
      { fetch: fetchSpy }
    );
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/AUD1/users');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer TOK');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    // token must never appear in the URL
    expect(url).not.toContain('TOK');

    const parsed = new URLSearchParams(init.body);
    expect(JSON.parse(parsed.get('payload'))).toEqual({ schema: ['EMAIL', 'PHONE'], data: [['a', 'b']] });
    expect(JSON.parse(parsed.get('session'))).toEqual(session);
  });

  it('targets the usersreplace edge in replace mode', async () => {
    const fetchSpy = okFetch();
    await uploadBatch(
      { audienceId: 'AUD1', token: 'TOK', version: 'v21.0', mode: 'replace', schema: ['EMAIL'], data: [['a']], session },
      { fetch: fetchSpy }
    );
    expect(fetchSpy.mock.calls[0][0]).toBe('https://graph.facebook.com/v21.0/AUD1/usersreplace');
  });

  it('throws a sanitized error on non-2xx (no response body attached)', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Invalid parameter' }, invalid_entry_samples: ['deadbeef'] }),
    });
    await expect(
      uploadBatch(
        { audienceId: 'AUD1', token: 'TOK', version: 'v21.0', mode: 'add', schema: ['EMAIL'], data: [['a']], session },
        { fetch: fetchSpy }
      )
    ).rejects.toThrow(/HTTP 400 Invalid parameter/);
  });
});

// ============================================================
// syncRedeemedAudience (orchestration)
// ============================================================
describe('syncRedeemedAudience', () => {
  it('no-ops (guarded) and does not fetch when disabled', async () => {
    process.env.REDEEMED_AUDIENCE_SYNC_ENABLED = 'false';
    const fetchSpy = okFetch();
    const Prospect = { findAll: jest.fn() };
    const result = await syncRedeemedAudience({ fetch: fetchSpy, Prospect });
    expect(result).toEqual({ synced: false, reason: 'guarded' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Prospect.findAll).not.toHaveBeenCalled();
  });

  it('selects, hashes, and uploads in one batch with correct session flags', async () => {
    const fetchSpy = okFetch({ num_received: 2, num_invalid_entries: 0 });
    const Prospect = {
      findAll: jest.fn().mockResolvedValue([
        prospect({ email: 'a@x.com', phone: '+6590000001' }),
        prospect({ email: 'b@x.com', phone: '+6590000002' }),
      ]),
    };
    const result = await syncRedeemedAudience({ fetch: fetchSpy, Prospect });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const parsed = new URLSearchParams(fetchSpy.mock.calls[0][1].body);
    const session = JSON.parse(parsed.get('session'));
    expect(session.batch_seq).toBe(1);
    expect(session.last_batch_flag).toBe(true);
    expect(session.estimated_num_total).toBe(2);
    expect(result).toEqual({ synced: true, eligible: 2, totalReceived: 2, totalInvalid: 0 });
  });

  it('uploads nothing and reports zero when no eligible redeemers', async () => {
    const fetchSpy = okFetch();
    const Prospect = {
      findAll: jest.fn().mockResolvedValue([prospect({ sourceMetadata: { consent_contact: false } })]),
    };
    const result = await syncRedeemedAudience({ fetch: fetchSpy, Prospect });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: true, eligible: 0, totalReceived: 0, totalInvalid: 0 });
  });

  it('captures Sentry and returns { synced:false } on upload failure', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const Prospect = { findAll: jest.fn().mockResolvedValue([prospect()]) };
    const result = await syncRedeemedAudience({ fetch: fetchSpy, Prospect });
    expect(result.synced).toBe(false);
    expect(result.error).toMatch(/HTTP 500/);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('honors REDEEMED_AUDIENCE_REQUIRE_CONSENT=false (uploads non-consenting)', async () => {
    process.env.REDEEMED_AUDIENCE_REQUIRE_CONSENT = 'false';
    const fetchSpy = okFetch({ num_received: 1, num_invalid_entries: 0 });
    const Prospect = {
      findAll: jest.fn().mockResolvedValue([prospect({ sourceMetadata: { consent_contact: false } })]),
    };
    const result = await syncRedeemedAudience({ fetch: fetchSpy, Prospect });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.eligible).toBe(1);
  });
});
