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
// ShortLink/ShortLinkClick satisfy mailer → shortLinkService's static imports
// (the edge PR #205 added via mailer → consentService/shortLinkService);
// Consumer/RewardEntitlement/DrawEntry satisfy the eligibility engine's
// consumerService edge (ads-centralisation §5.2 — the engine seams below keep
// the DB paths out of these tests entirely).
jest.unstable_mockModule('../src/models/index.js', () => ({
  Prospect: { findAll: jest.fn() },
  Consumer: {},
  RewardEntitlement: {},
  DrawEntry: {},
  ShortLink: {},
  ShortLinkClick: {},
  sequelize: { close: jest.fn() },
}));

// Mock consumerService: the eligibility engine's verified-binding edge pulls
// consumerService's whole model subtree — a pure stub severs it (Meta's
// policy never calls the predicate anyway: requireVerifiedBinding=false).
jest.unstable_mockModule('../src/services/consumerService.js', () => ({
  phoneVerificationIsCurrent: (p) => Boolean(p?.sourceMetadata?.phoneVerifiedAt),
  phoneHashOf: (v) => `hash:${String(v)}`,
}));

// Mock consentService: satisfies mailer's static `ensureUnsubToken` import AND
// makes the SUT's dynamic import of the two bulk ledger lookups deterministic.
const suppressedMock = jest.fn();
const grantMapMock = jest.fn();
jest.unstable_mockModule('../src/services/consentService.js', () => ({
  ensureUnsubToken: jest.fn(),
  getSuppressedPhoneSet: suppressedMock,
  getMarketableGrantMap: grantMapMock,
}));

let shouldSync, chunk, shapeMetaAudienceRows, uploadBatch, syncRedeemedAudience;
let filterEligible;

beforeAll(async () => {
  ({ shouldSync, chunk, shapeMetaAudienceRows, uploadBatch, syncRedeemedAudience } =
    await import('../src/services/redeemedAudienceService.js'));
  ({ filterEligible } = await import('../src/services/audienceEligibilityService.js'));
});

// ---------- env snapshot ----------
const ENV_KEYS = [
  'REDEEMED_AUDIENCE_SYNC_ENABLED',
  'META_ADS_MANAGEMENT_TOKEN',
  'META_REDEEMED_AUDIENCE_ID',
  'META_GRAPH_API_VERSION',
  'REDEEMED_AUDIENCE_REQUIRE_CONSENT',
  'REDEEMED_AUDIENCE_SYNC_MODE',
  'REDEEMED_AUDIENCE_ALERT_EMAIL',
];
const envBackup = {};

beforeEach(() => {
  ENV_KEYS.forEach((k) => { envBackup[k] = process.env[k]; delete process.env[k]; });
  // Default "all systems go"
  process.env.REDEEMED_AUDIENCE_SYNC_ENABLED = 'true';
  process.env.META_ADS_MANAGEMENT_TOKEN = 'TEST_ADS_TOKEN';
  process.env.META_REDEEMED_AUDIENCE_ID = '52506028688033';
  captureExceptionMock.mockClear();
  // Ledger defaults: nobody suppressed, nobody granted (fail-closed baseline).
  suppressedMock.mockReset().mockResolvedValue(new Set());
  grantMapMock.mockReset().mockResolvedValue(new Map());
});

afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  });
});

// ---------- helpers ----------
const CID = '11111111-1111-4111-8111-111111111111';
const OTHER_CID = '22222222-2222-4222-8222-222222222222';

const prospect = (overrides = {}) => ({
  email: 'shawn@mktr.sg',
  phone: '+6581234567',
  campaignId: CID,
  ...overrides,
});

/** grantMap entry: Map<phone, Map<scopeKey('*'|campaignId), boolean>> */
const grantFor = (phone, cid = CID, ok = true) => new Map([[phone, new Map([[cid, ok]])]]);

const okFetch = (body = { num_received: 1, num_invalid_entries: 0, session_id: 'sess-1' }) =>
  jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });

// ============================================================
// shouldSync
// ============================================================

// §5.1 machinery seams (see googleCustomerMatchService.test.js) — keep this
// suite hermetic from audience_destination_state + the advisory lock; the
// DB-backed audienceRemovals suite exercises the real ones.
const engineSeams = {
  withDestinationLock: async (key, fn) => ({ acquired: true, value: await fn() }),
  markIngestAccepted: async () => {},
  markIngestsSettled: async () => {},
  loadEligibilityContext: async ({ requireConsent }) => {
    const { getSuppressedPhoneSet, getMarketableGrantMap } = await import('../src/services/consentService.js');
    return {
      suppressedPhones: await getSuppressedPhoneSet(),
      grantMap: requireConsent ? await getMarketableGrantMap() : null,
      editSuppressedProspectIds: new Set(),
    };
  },
};

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


// Engine-path equivalent of the deleted legacy filter+shape (ads-centralisation
// §5.2): the differential harness pinned parity in the previous commit; these
// tests now guard the PRODUCTION composition — filterEligible under the Meta
// policy shape, then Meta wire shaping.
const engineUserRows = (prospects, { requireConsent = true, suppressedPhones = null, grantMap = null } = {}) =>
  shapeMetaAudienceRows(
    filterEligible(
      prospects,
      { suppressedPhones, grantMap, editSuppressedProspectIds: new Set() },
      { scope: 'global', requireConsent, requireVerifiedBinding: false, checkErased: true }
    )
  );

// ============================================================
// engineUserRows — consent arm is LEDGER-based (3sites): a row passes only when
// its phone's latest contact event in scope {row's campaign, global} is
// granted && verified (encoded as `true` in the grantMap by consentService).
// ============================================================
describe('engine user rows (filterEligible → shapeMetaAudienceRows)', () => {
  it('hashes email + phone into a multi-key row (ledger grant present)', () => {
    const rows = engineUserRows([prospect()], {
      requireConsent: true,
      grantMap: grantFor('+6581234567'),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toMatch(/^[a-f0-9]{64}$/); // email hash
    expect(rows[0][1]).toMatch(/^[a-f0-9]{64}$/); // phone hash
  });

  it('drops rows whose latest in-scope event is not granted+verified (false entry)', () => {
    const rows = engineUserRows([prospect()], {
      requireConsent: true,
      grantMap: grantFor('+6581234567', CID, false), // untick / unverified / withdrawn
    });
    expect(rows).toHaveLength(0);
  });

  it('drops rows with no ledger entry at all (unknown person — fail closed)', () => {
    const rows = engineUserRows([prospect()], {
      requireConsent: true,
      grantMap: new Map(),
    });
    expect(rows).toHaveLength(0);
  });

  it('drops everything when requireConsent=true and no grantMap was supplied (fail closed)', () => {
    const rows = engineUserRows([prospect()], { requireConsent: true, grantMap: null });
    expect(rows).toHaveLength(0);
  });

  it('a grant in a DIFFERENT campaign does not license this row', () => {
    const rows = engineUserRows([prospect({ campaignId: OTHER_CID })], {
      requireConsent: true,
      grantMap: grantFor('+6581234567', CID, true),
    });
    expect(rows).toHaveLength(0);
  });

  it('a global grant licenses a row with no scoped entry', () => {
    const rows = engineUserRows([prospect()], {
      requireConsent: true,
      grantMap: grantFor('+6581234567', '*', true),
    });
    expect(rows).toHaveLength(1);
  });

  it('a scoped false (recency-folded) beats a global true — scope precedence', () => {
    const scopes = new Map([['*', true], [CID, false]]);
    const rows = engineUserRows([prospect()], {
      requireConsent: true,
      grantMap: new Map([['+6581234567', scopes]]),
    });
    expect(rows).toHaveLength(0);
  });

  it('keeps ungranted rows when requireConsent=false', () => {
    const rows = engineUserRows([prospect()], { requireConsent: false });
    expect(rows).toHaveLength(1);
  });

  it('drops synthetic Retell emails but keeps the phone (blank email key)', () => {
    const rows = engineUserRows(
      [prospect({ email: 'retell-abc@calls.mktr.sg', phone: '+6591112222' })],
      { requireConsent: true, grantMap: grantFor('+6591112222') }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe(''); // synthetic email dropped
    expect(rows[0][1]).toMatch(/^[a-f0-9]{64}$/); // phone kept
  });

  it('drops rows with neither a usable email nor phone', () => {
    const rows = engineUserRows(
      [prospect({ email: null, phone: null })],
      { requireConsent: false }
    );
    expect(rows).toHaveLength(0);
  });

  it('phone-less rows are consent-excluded when required (grant is phone-keyed)…', () => {
    const rows = engineUserRows([prospect({ phone: null })], {
      requireConsent: true,
      grantMap: grantFor('+6581234567'),
    });
    expect(rows).toHaveLength(0);
  });

  it('…but emit a blank phone key when consent is not required', () => {
    const rows = engineUserRows([prospect({ phone: null })], { requireConsent: false });
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
    const result = await syncRedeemedAudience({ ...engineSeams, fetch: fetchSpy, Prospect });
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
    grantMapMock.mockResolvedValue(new Map([
      ['+6590000001', new Map([[CID, true]])],
      ['+6590000002', new Map([[CID, true]])],
    ]));
    const result = await syncRedeemedAudience({ ...engineSeams, fetch: fetchSpy, Prospect });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const parsed = new URLSearchParams(fetchSpy.mock.calls[0][1].body);
    const session = JSON.parse(parsed.get('session'));
    expect(session.batch_seq).toBe(1);
    expect(session.last_batch_flag).toBe(true);
    expect(session.estimated_num_total).toBe(2);
    expect(result).toEqual({ synced: true, eligible: 2, totalReceived: 2, totalInvalid: 0 });
  });

  it('uploads nothing and reports zero when nobody has a ledger grant', async () => {
    const fetchSpy = okFetch();
    const Prospect = { findAll: jest.fn().mockResolvedValue([prospect()]) };
    const result = await syncRedeemedAudience({ ...engineSeams, fetch: fetchSpy, Prospect }); // default: empty grant map
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: true, eligible: 0, totalReceived: 0, totalInvalid: 0 });
  });

  it('drops SUPPRESSED phones even when the grant map licenses them', async () => {
    const fetchSpy = okFetch();
    const Prospect = { findAll: jest.fn().mockResolvedValue([prospect()]) };
    grantMapMock.mockResolvedValue(grantFor('+6581234567'));
    suppressedMock.mockResolvedValue(new Set(['+6581234567']));
    const result = await syncRedeemedAudience({ ...engineSeams, fetch: fetchSpy, Prospect });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.eligible).toBe(0);
  });

  it('captures Sentry and returns { synced:false } on upload failure', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const Prospect = { findAll: jest.fn().mockResolvedValue([prospect()]) };
    grantMapMock.mockResolvedValue(grantFor('+6581234567'));
    const result = await syncRedeemedAudience({ ...engineSeams, fetch: fetchSpy, Prospect });
    expect(result.synced).toBe(false);
    expect(result.error).toMatch(/HTTP 500/);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('aborts the run observably (Sentry + alert + no upload) when the grant lookup throws', async () => {
    process.env.REDEEMED_AUDIENCE_ALERT_EMAIL = 'ops@example.com';
    const fetchSpy = okFetch();
    const Prospect = { findAll: jest.fn().mockResolvedValue([prospect()]) };
    const sendEmail = jest.fn().mockResolvedValue({ success: true });
    grantMapMock.mockRejectedValue(new Error('ledger unreachable'));
    const result = await syncRedeemedAudience({ ...engineSeams, fetch: fetchSpy, Prospect, sendEmail });
    expect(result).toEqual({ synced: false, error: 'ledger unreachable' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].subject).toMatch(/FAILED/);
  });

  it('aborts the run observably when the suppression lookup throws (fail closed)', async () => {
    const fetchSpy = okFetch();
    const Prospect = { findAll: jest.fn().mockResolvedValue([prospect()]) };
    suppressedMock.mockRejectedValue(new Error('suppressions unreachable'));
    const result = await syncRedeemedAudience({ ...engineSeams, fetch: fetchSpy, Prospect });
    expect(result).toEqual({ synced: false, error: 'suppressions unreachable' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('honors REDEEMED_AUDIENCE_REQUIRE_CONSENT=false (uploads ungranted, skips the grant lookup)', async () => {
    process.env.REDEEMED_AUDIENCE_REQUIRE_CONSENT = 'false';
    const fetchSpy = okFetch({ num_received: 1, num_invalid_entries: 0 });
    const Prospect = { findAll: jest.fn().mockResolvedValue([prospect()]) };
    const result = await syncRedeemedAudience({ ...engineSeams, fetch: fetchSpy, Prospect });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.eligible).toBe(1);
    expect(grantMapMock).not.toHaveBeenCalled();
    expect(suppressedMock).toHaveBeenCalledTimes(1); // suppression drop stays unconditional
  });

  it('emails a failure alert when REDEEMED_AUDIENCE_ALERT_EMAIL is set', async () => {
    process.env.REDEEMED_AUDIENCE_ALERT_EMAIL = 'ops@example.com';
    const fetchSpy = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const Prospect = { findAll: jest.fn().mockResolvedValue([prospect()]) };
    const sendEmail = jest.fn().mockResolvedValue({ success: true });
    grantMapMock.mockResolvedValue(grantFor('+6581234567'));
    const result = await syncRedeemedAudience({ ...engineSeams, fetch: fetchSpy, Prospect, sendEmail });
    expect(result.synced).toBe(false);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = sendEmail.mock.calls[0][0];
    expect(arg.to).toBe('ops@example.com');
    expect(arg.subject).toMatch(/FAILED/);
    expect(arg.text).toMatch(/HTTP 500/);
  });

  it('does NOT email when REDEEMED_AUDIENCE_ALERT_EMAIL is unset', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const Prospect = { findAll: jest.fn().mockResolvedValue([prospect()]) };
    const sendEmail = jest.fn();
    grantMapMock.mockResolvedValue(grantFor('+6581234567'));
    await syncRedeemedAudience({ ...engineSeams, fetch: fetchSpy, Prospect, sendEmail });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('emails an alert when Meta rejects records (num_invalid_entries > 0)', async () => {
    process.env.REDEEMED_AUDIENCE_ALERT_EMAIL = 'ops@example.com';
    const fetchSpy = okFetch({ num_received: 1, num_invalid_entries: 1 });
    const Prospect = { findAll: jest.fn().mockResolvedValue([prospect()]) };
    const sendEmail = jest.fn().mockResolvedValue({ success: true });
    grantMapMock.mockResolvedValue(grantFor('+6581234567'));
    const result = await syncRedeemedAudience({ ...engineSeams, fetch: fetchSpy, Prospect, sendEmail });
    expect(result.synced).toBe(true);
    expect(result.totalInvalid).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].subject).toMatch(/rejected/);
  });
});
