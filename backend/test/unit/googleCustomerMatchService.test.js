import { jest } from '@jest/globals';
import crypto from 'crypto';

// Mocks BEFORE importing the SUT (Jest ESM pattern).
const sentryMocks = { captureException: jest.fn(), captureMessage: jest.fn(), init: jest.fn(), setTag: jest.fn() };
jest.unstable_mockModule('@sentry/node', () => sentryMocks);
const loggerMock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.unstable_mockModule('../../src/utils/logger.js', () => ({ logger: loggerMock }));
// consumerService (imported for phoneVerificationIsCurrent) drags a wide
// transitive graph, so the models mock must satisfy EVERY named export of
// models/index.js — generated, not hand-picked, so a new model never breaks
// this suite with a missing-export link error.
const MODEL_NAMES = `Activation ActivationIssuanceSkip AgentGroup AgentGroupMember AiSettings Attribution
Campaign CampaignAgentAssignment CampaignPreview Cohort ConsentEvent Consumer ConsumerObservation
ConsumerProfile ConsumerSuppression DiscoveryCandidate DiscoveryDailyUsage DiscoveryPlaceMemory
DiscoveryRun Draw DrawAttempt DrawBoostReview DrawEntry DrawTermsVersion EmailBroadcast
EmailBroadcastRecipient EnrichmentJob EnrichmentScoringConfig EnrichmentSweepRun ExternalAgent
ExternalCampaignAgent IdempotencyKey LeadPackage LeadPackageAssignment MetaAgentConnection
MetaFormMapping MetaLeadgenEvent MetaPage OutreachAccount OutreachActivity OutreachCadence
OutreachCadenceEnrollment OutreachCadenceStep OutreachCadenceTransition OutreachEmail
OutreachPersona OutreachSuppression OutreachTask PartnerAssignmentEvent PartnerContact
PartnerLocation PartnerOnboardingItem PartnerOrganisation PartnerStageEvent Payment
PhoneVerificationMarker Prospect ProspectActivity ProspectingPool ProspectingPoolMember QrScan
QrTag RedeemOpsAuditEvent RedeemOpsCategory Redemption RedemptionEvent RewardEntitlement
RewardInventoryEvent RewardOffer RewardOfferLocation RewardTermsVersion RoundRobinCursor
SessionVisit ShortLink ShortLinkClick SuppressionPropagation TimelineHiddenEntry User Verification
WaitlistSignup WalletLedger WaMessageSend WaMessageStatus WebhookDelivery WebhookSubscriber`
  .split(/\s+/)
  .filter(Boolean);
jest.unstable_mockModule('../../src/models/index.js', () => {
  const models = Object.fromEntries(MODEL_NAMES.map((n) => [n, {}]));
  models.Prospect = { findAll: jest.fn() };
  const sequelize = { transaction: jest.fn(), query: jest.fn() };
  return { ...models, sequelize, default: { ...models, sequelize } };
});
jest.unstable_mockModule('../../src/services/mailer.js', () => ({
  sendEmail: jest.fn().mockResolvedValue({}),
}));
const consentMocks = {
  getSuppressedPhoneSet: jest.fn(),
  getMarketableGrantMap: jest.fn(),
};
jest.unstable_mockModule('../../src/services/consentService.js', () => consentMocks);

let svc;
let piiHashing;
let phoneHashOf;
let Op;
beforeAll(async () => {
  svc = await import('../../src/services/googleCustomerMatchService.js');
  piiHashing = await import('../../src/utils/piiHashing.js');
  ({ phoneHashOf } = await import('../../src/services/consumerService.js'));
  ({ Op } = await import('sequelize'));
});

const ENV_KEYS = [
  'GOOGLE_CM_SYNC_ENABLED',
  'GOOGLE_DM_OAUTH_CLIENT_ID',
  'GOOGLE_DM_OAUTH_CLIENT_SECRET',
  'GOOGLE_DM_REFRESH_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
  'GOOGLE_CM_USER_LIST_ID',
  'GOOGLE_CM_CAMPAIGN_ID',
  'GOOGLE_CM_ALERT_EMAIL',
  'REDEEMED_AUDIENCE_ALERT_EMAIL',
  'GOOGLE_CM_FIRST_POLL_MINUTES',
  'GOOGLE_CM_SETTLE_INTERVAL_MINUTES',
];
const saved = {};
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.GOOGLE_CM_SYNC_ENABLED = 'true';
  process.env.GOOGLE_DM_OAUTH_CLIENT_ID = 'cid';
  process.env.GOOGLE_DM_OAUTH_CLIENT_SECRET = 'sec';
  process.env.GOOGLE_DM_REFRESH_TOKEN = 'rt';
  process.env.GOOGLE_ADS_CUSTOMER_ID = '1829163947';
  process.env.GOOGLE_CM_USER_LIST_ID = '999888777';
  process.env.GOOGLE_CM_CAMPAIGN_ID = 'camp-airpods';
  process.env.GOOGLE_CM_FIRST_POLL_MINUTES = '30';
  svc.__resetPendingSettlesForTests();
  delete process.env.GOOGLE_CM_ALERT_EMAIL;
  delete process.env.REDEEMED_AUDIENCE_ALERT_EMAIL;
  consentMocks.getSuppressedPhoneSet.mockReset().mockResolvedValue(new Set());
  consentMocks.getMarketableGrantMap.mockReset().mockResolvedValue(new Map());
  sentryMocks.captureException.mockClear();
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
  loggerMock.error.mockClear();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const fastSleep = () => Promise.resolve();
const okStatus = { requestStatusPerDestination: [{ requestStatus: 'SUCCESS' }] };

/** A fully-eligible prospect row + the grantMap entry that admits it. */
function eligibleRow(overrides = {}) {
  return {
    email: 'jane.doe+promo@gmail.com',
    phone: '+6591234567',
    campaignId: 'camp-airpods',
    sourceMetadata: { phoneVerifiedAt: '2026-08-01T00:00:00Z' },
    ...overrides,
  };
}
function grantAll(rows) {
  return new Map(rows.map((r) => [r.phone, new Map([['*', true]])]));
}

// §5.1 machinery seams — the real implementations need audience_destination_state
// + the advisory-lock connection, which this NO-DB unit suite doesn't have.
// The DB-backed audienceRemovals suite exercises the real ones.
const engineSeams = () => ({
  withDestinationLock: async (key, fn) => ({ acquired: true, value: await fn() }),
  markIngestAccepted: jest.fn(async () => {}),
  markIngestsSettled: jest.fn(async () => {}),
  readDestinationState: async () => null,
  loadEligibilityContext: async ({ requireConsent }) => ({
    suppressedPhones: await consentMocks.getSuppressedPhoneSet(),
    grantMap: requireConsent ? await consentMocks.getMarketableGrantMap() : null,
    editSuppressedProspectIds: new Set(),
  }),
});

function happyDeps(rows, dmOverrides = {}) {
  consentMocks.getMarketableGrantMap.mockResolvedValue(grantAll(rows));
  return {
    Prospect: { findAll: jest.fn().mockResolvedValue(rows) },
    dmRequest: jest.fn().mockResolvedValue({ requestId: 'req-1' }),
    dmRequestGet: jest.fn().mockResolvedValue(okStatus),
    sendEmail: jest.fn().mockResolvedValue({}),
    sleep: fastSleep,
    ...engineSeams(),
    ...dmOverrides,
  };
}

describe('shouldSync / removalConfigured', () => {
  it('shouldSync is true only with the full config set', () => {
    expect(svc.shouldSync()).toBe(true);
  });

  it.each(ENV_KEYS.slice(0, 7))('shouldSync is false when %s is missing', (key) => {
    delete process.env[key];
    expect(svc.shouldSync()).toBe(false);
  });

  it('shouldSync is false when the flag is any non-"true" value', () => {
    process.env.GOOGLE_CM_SYNC_ENABLED = '1';
    expect(svc.shouldSync()).toBe(false);
  });

  it('removalConfigured ignores the sync flag (erasure honor survives a sync switch-off)', () => {
    process.env.GOOGLE_CM_SYNC_ENABLED = 'false';
    expect(svc.removalConfigured()).toBe(true);
    delete process.env.GOOGLE_CM_USER_LIST_ID;
    expect(svc.removalConfigured()).toBe(false);
  });
});

describe('__legacySelectCampaignProspects', () => {
  it('pins the exact selector: target campaign, non-bot, minimal attributes', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    await svc.__legacySelectCampaignProspects({ Prospect: { findAll } });
    expect(findAll).toHaveBeenCalledWith({
      attributes: ['email', 'phone', 'campaignId', 'sourceMetadata'],
      where: {
        campaignId: 'camp-airpods',
        leadSource: { [Op.ne]: 'call_bot' },
      },
      raw: true,
    });
  });
});

describe('__legacyBuildMemberRows', () => {
  it('emits HEX-hashed google-normalized email + E.164 phone identifiers', () => {
    const rows = [eligibleRow()];
    const out = svc.__legacyBuildMemberRows(rows, { grantMap: grantAll(rows) });
    expect(out).toEqual([
      {
        userIdentifiers: [
          { emailAddress: sha('janedoe@gmail.com') },
          { phoneNumber: sha('+6591234567') },
        ],
      },
    ]);
  });

  it('skips erased skeleton rows', () => {
    const rows = [eligibleRow({ sourceMetadata: { erased: true } })];
    expect(svc.__legacyBuildMemberRows(rows, { grantMap: grantAll(rows) })).toEqual([]);
  });

  it('skips rows without a verification stamp', () => {
    const rows = [eligibleRow({ sourceMetadata: {} })];
    expect(svc.__legacyBuildMemberRows(rows, { grantMap: grantAll(rows) })).toEqual([]);
  });

  it('enforces the phoneVerifiedFor binding: stale hash out, matching hash in, legacy stamp in', () => {
    const stale = eligibleRow({
      sourceMetadata: { phoneVerifiedAt: 'x', phoneVerifiedFor: 'not-the-hash' },
    });
    const bound = eligibleRow({
      sourceMetadata: { phoneVerifiedAt: 'x', phoneVerifiedFor: phoneHashOf('+6591234567') },
    });
    const legacy = eligibleRow();
    const rows = [stale, bound, legacy];
    expect(svc.__legacyBuildMemberRows(rows, { grantMap: grantAll(rows) })).toHaveLength(2);
  });

  it('fails closed on consent: no map, no entry, and refused entry are all excluded', () => {
    const row = eligibleRow();
    expect(svc.__legacyBuildMemberRows([row], {})).toEqual([]);
    expect(svc.__legacyBuildMemberRows([row], { grantMap: new Map() })).toEqual([]);
    const refused = new Map([[row.phone, new Map([['*', false]])]]);
    expect(svc.__legacyBuildMemberRows([row], { grantMap: refused })).toEqual([]);
  });

  it('admits a campaign-scoped grant for the row campaign', () => {
    const row = eligibleRow();
    const scoped = new Map([[row.phone, new Map([['camp-airpods', true]])]]);
    expect(svc.__legacyBuildMemberRows([row], { grantMap: scoped })).toHaveLength(1);
  });

  it('drops suppressed phones', () => {
    const rows = [eligibleRow()];
    const out = svc.__legacyBuildMemberRows(rows, {
      grantMap: grantAll(rows),
      suppressedPhones: new Set(['+6591234567']),
    });
    expect(out).toEqual([]);
  });

  it('drops the synthetic Retell email but keeps the phone identifier', () => {
    const rows = [eligibleRow({ email: 'retell-abc@calls.mktr.sg' })];
    const out = svc.__legacyBuildMemberRows(rows, { grantMap: grantAll(rows) });
    expect(out).toEqual([{ userIdentifiers: [{ phoneNumber: sha('+6591234567') }] }]);
  });

  it('drops rows with neither usable identifier', () => {
    const weird = eligibleRow({ email: 'not-an-email', phone: null });
    expect(svc.__legacyBuildMemberRows([weird], { grantMap: grantAll([weird]) })).toEqual([]);
  });
});

describe('buildRemovalIdentifiersFromRaw', () => {
  it('builds identifiers with NO consent/verification gate (removal is always permitted)', () => {
    const out = svc.buildRemovalIdentifiersFromRaw([
      { email: 'jane.doe@gmail.com', phone: '+6591234567' },
      { email: 'retell-x@calls.mktr.sg', phone: '+6598765432' },
      { email: null, phone: null },
    ]);
    expect(out).toEqual([
      {
        userIdentifiers: [
          { emailAddress: sha('janedoe@gmail.com') },
          { phoneNumber: sha('+6591234567') },
        ],
      },
      { userIdentifiers: [{ phoneNumber: sha('+6598765432') }] },
    ]);
  });
});

describe('buildIngestBody / buildRemoveBody', () => {
  it('pins the golden ingest envelope: destination, consent enums, HEX, CM terms', () => {
    const members = [{ userIdentifiers: [{ phoneNumber: 'ph' }] }];
    expect(svc.buildIngestBody(members)).toEqual({
      destinations: [
        {
          operatingAccount: { product: 'GOOGLE_ADS', accountId: '1829163947' },
          productDestinationId: '999888777',
        },
      ],
      audienceMembers: [{ userData: { userIdentifiers: [{ phoneNumber: 'ph' }] } }],
      consent: { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' },
      encoding: 'HEX',
      termsOfService: { customerMatchTermsOfServiceStatus: 'ACCEPTED' },
    });
  });

  it('adds validateOnly only when asked', () => {
    expect(svc.buildIngestBody([], { validateOnly: true }).validateOnly).toBe(true);
    expect(svc.buildIngestBody([]).validateOnly).toBeUndefined();
  });

  it('pins the removal envelope: HEX, destination, NO consent/terms blocks', () => {
    const body = svc.buildRemoveBody([{ userIdentifiers: [{ phoneNumber: 'ph' }] }]);
    expect(body).toEqual({
      destinations: [
        {
          operatingAccount: { product: 'GOOGLE_ADS', accountId: '1829163947' },
          productDestinationId: '999888777',
        },
      ],
      audienceMembers: [{ userData: { userIdentifiers: [{ phoneNumber: 'ph' }] } }],
      encoding: 'HEX',
    });
  });
});

describe('settlePendingStatuses (deferred, Google-recommended timing)', () => {
  const T0 = 1_700_000_000_000;

  async function seedIngestRequest(requestId, atMs) {
    const rows = [eligibleRow()];
    const d = happyDeps(rows);
    d.dmRequest = jest.fn().mockResolvedValue({ requestId });
    d.now = () => atMs;
    const res = await svc.syncGoogleCustomerMatch(d);
    expect(res.settlement).toBe('queued');
    return d;
  }

  it('does NOT poll before the 30-minute first-poll delay, then settles when due', async () => {
    await seedIngestRequest('req-a', T0);
    const dmRequestGet = jest.fn().mockResolvedValue(okStatus);

    const early = await svc.settlePendingStatuses({ ...engineSeams(), dmRequestGet, now: () => T0 + 29 * 60_000 });
    expect(dmRequestGet).not.toHaveBeenCalled();
    expect(early.pending).toBe(1);

    const due = await svc.settlePendingStatuses({ ...engineSeams(), dmRequestGet, now: () => T0 + 31 * 60_000 });
    expect(dmRequestGet).toHaveBeenCalledTimes(1);
    expect(dmRequestGet.mock.calls[0][0]).toBe('requestStatus:retrieve?requestId=req-a');
    expect(due.succeeded).toBe(1);
    expect(due.pending).toBe(0);
  });

  it('reschedules non-terminal entries with backoff and marks them stuck past the 24h horizon (alerting)', async () => {
    await seedIngestRequest('req-b', T0);
    const processing = jest.fn().mockResolvedValue({ requestStatus: 'PROCESSING' });
    const sendEmail = jest.fn().mockResolvedValue({});
    process.env.GOOGLE_CM_ALERT_EMAIL = 'ops@mktr.sg';

    const first = await svc.settlePendingStatuses({ ...engineSeams(), dmRequestGet: processing, sendEmail, now: () => T0 + 31 * 60_000 });
    expect(first.pending).toBe(1); // rescheduled, not stuck
    expect(sendEmail).not.toHaveBeenCalled();

    const past = await svc.settlePendingStatuses({ ...engineSeams(), dmRequestGet: processing, sendEmail, now: () => T0 + 25 * 60 * 60_000 });
    expect(past.stuck).toBe(1);
    expect(past.pending).toBe(0);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].subject).toMatch(/settlement failures/);
  });

  it('terminal FAILED alerts + Sentry; a retrieve error only reschedules until the horizon', async () => {
    await seedIngestRequest('req-c', T0);
    const failed = jest.fn().mockResolvedValue({ requestStatus: 'FAILED' });
    const sendEmail = jest.fn().mockResolvedValue({});
    process.env.GOOGLE_CM_ALERT_EMAIL = 'ops@mktr.sg';
    const res = await svc.settlePendingStatuses({ ...engineSeams(), dmRequestGet: failed, sendEmail, now: () => T0 + 31 * 60_000 });
    expect(res.failed).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sentryMocks.captureMessage).toHaveBeenCalled();

    svc.__resetPendingSettlesForTests();
    await seedIngestRequest('req-d', T0);
    const broken = jest.fn().mockRejectedValue(new Error('boom'));
    const mid = await svc.settlePendingStatuses({ ...engineSeams(), dmRequestGet: broken, sendEmail: jest.fn(), now: () => T0 + 31 * 60_000 });
    expect(mid.pending).toBe(1); // rescheduled — a flaky retrieve is not yet stuck
  });

  it('a blocked pass cannot hide a later-due request from a subsequent pass', async () => {
    await seedIngestRequest('req-slow', T0);
    // second request accepted five minutes later — NOT yet due at pass 1
    const rows = [eligibleRow()];
    const d2 = happyDeps(rows);
    d2.dmRequest = jest.fn().mockResolvedValue({ requestId: 'req-later' });
    d2.now = () => T0 + 5 * 60_000;
    const second = await svc.syncGoogleCustomerMatch(d2);
    expect(second).toMatchObject({ submitted: true, accepted: 1, settlement: 'queued' });

    let releaseSlow;
    const slowGate = new Promise((r) => { releaseSlow = r; });
    const slowGet = jest.fn(async (path) => {
      if (path.includes('req-slow')) {
        await slowGate; // Google outage: this poll hangs
        return okStatus;
      }
      return okStatus;
    });
    // Pass 1 at T0+31min: only req-slow is due; it hangs mid-poll.
    const pass1 = svc.settlePendingStatuses({ ...engineSeams(), dmRequestGet: slowGet, now: () => T0 + 31 * 60_000 });
    await new Promise((r) => setTimeout(r, 10));
    // Pass 2 at T0+36min: req-later is due now — it must be visible and settle
    // even though pass 1 still holds req-slow.
    const pass2 = await svc.settlePendingStatuses({ ...engineSeams(), dmRequestGet: slowGet, now: () => T0 + 36 * 60_000 });
    expect(pass2.succeeded).toBe(1);
    expect(pass2.polled).toBe(1);
    releaseSlow();
    const pass1Res = await pass1;
    expect(pass1Res.succeeded).toBe(1);
    expect(slowGet.mock.calls.filter((c) => c[0].includes('req-slow'))).toHaveLength(1); // no double-poll
  });

  it('a PARTIAL_SUCCESS *removal* alerts (people stayed on the list); a partial ingest does not', async () => {
    const dmRequest = jest.fn().mockResolvedValue({ requestId: 'rm-partial' });
    const acceptance = await svc.removeAudienceMembers(
      [{ userIdentifiers: [{ phoneNumber: 'x' }] }],
      { dmRequest, now: () => T0 }
    );
    expect(acceptance).toEqual({ accepted: 1, members: 1, failedBatches: 0, settlement: 'queued' });
    const partial = jest.fn().mockResolvedValue({ requestStatus: 'PARTIAL_SUCCESS' });
    const sendEmail = jest.fn().mockResolvedValue({});
    process.env.GOOGLE_CM_ALERT_EMAIL = 'ops@mktr.sg';
    const res = await svc.settlePendingStatuses({ ...engineSeams(), dmRequestGet: partial, sendEmail, now: () => T0 + 31 * 60_000 });
    expect(res.removePartial).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);

    svc.__resetPendingSettlesForTests();
    await seedIngestRequest('req-e', T0);
    const sendEmail2 = jest.fn().mockResolvedValue({});
    const res2 = await svc.settlePendingStatuses({ ...engineSeams(), dmRequestGet: partial, sendEmail: sendEmail2, now: () => T0 + 31 * 60_000 });
    expect(res2.partialSuccess).toBe(1);
    expect(res2.removePartial).toBe(0);
    expect(sendEmail2).not.toHaveBeenCalled();
  });
});

describe('syncGoogleCustomerMatch', () => {
  it('returns guarded without touching the ledger when config is missing', async () => {
    delete process.env.GOOGLE_CM_USER_LIST_ID;
    const res = await svc.syncGoogleCustomerMatch({ ...engineSeams(), dmRequest: jest.fn() });
    expect(res).toEqual({ submitted: false, reason: 'guarded' });
    expect(consentMocks.getMarketableGrantMap).not.toHaveBeenCalled();
  });

  it('uploads, settles statuses, and reports the full summary', async () => {
    const rows = [eligibleRow(), eligibleRow({ phone: '+6598765432' })];
    const d = happyDeps(rows);
    const res = await svc.syncGoogleCustomerMatch(d);
    expect(res).toEqual({
      submitted: true,
      eligible: 2,
      batches: 1,
      accepted: 1,
      failedBatches: 0,
      settlement: 'queued',
    });
    expect(d.dmRequest.mock.calls[0][0]).toBe('audienceMembers:ingest');
    // Settlement is DEFERRED — no in-run status polling.
    expect(d.dmRequestGet).not.toHaveBeenCalled();
    expect(d.sendEmail).not.toHaveBeenCalled();
  });

  it('splits 10001 members into envelopes of 10000 and 1 (the production cap)', async () => {
    const rows = Array.from({ length: 10001 }, (_, i) =>
      eligibleRow({ phone: `+659${String(1000000 + i).slice(-7)}` })
    );
    const d = happyDeps(rows);
    d.dmRequest
      .mockResolvedValueOnce({ requestId: 'req-1' })
      .mockResolvedValueOnce({ requestId: 'req-2' });
    d.dmRequestGet.mockResolvedValue(okStatus);
    const res = await svc.syncGoogleCustomerMatch(d);
    expect(res.batches).toBe(2);
    expect(res.accepted).toBe(2);
    expect(d.dmRequest.mock.calls[0][1].audienceMembers).toHaveLength(10000);
    expect(d.dmRequest.mock.calls[1][1].audienceMembers).toHaveLength(1);
  });

  it('partial batch failure: accepted batches stand, alert says partial (not wholesale)', async () => {
    const rows = Array.from({ length: 10001 }, (_, i) =>
      eligibleRow({ phone: `+659${String(1000000 + i).slice(-7)}` })
    );
    const d = happyDeps(rows);
    d.dmRequest
      .mockResolvedValueOnce({ requestId: 'req-1' })
      .mockRejectedValueOnce(new Error('google dm audienceMembers:ingest failed: HTTP 500'));
    process.env.GOOGLE_CM_ALERT_EMAIL = 'ops@mktr.sg';
    const res = await svc.syncGoogleCustomerMatch(d);
    expect(res.submitted).toBe(true);
    expect(res.accepted).toBe(1);
    expect(res.failedBatches).toBe(1);
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
    expect(d.sendEmail.mock.calls[0][0].subject).toMatch(/partial failure/);
    expect(d.sendEmail.mock.calls[0][0].text).toMatch(/settle asynchronously/i);
  });

  it('a missing requestId on accept counts as a failed batch, never silent success', async () => {
    const rows = [eligibleRow()];
    const d = happyDeps(rows);
    d.dmRequest.mockResolvedValue({});
    process.env.GOOGLE_CM_ALERT_EMAIL = 'ops@mktr.sg';
    const res = await svc.syncGoogleCustomerMatch(d);
    expect(res.submitted).toBe(false);
    expect(res.failedBatches).toBe(1);
    expect(res.accepted).toBe(0);
    expect(res.settlement).toBeNull();
    expect(d.sendEmail.mock.calls[0][0].subject).toMatch(/nothing uploaded/);
  });

  it('aborts fail-closed (no upload, wholesale alert) when a ledger lookup throws', async () => {
    consentMocks.getSuppressedPhoneSet.mockRejectedValue(new Error('ledger down'));
    process.env.GOOGLE_CM_ALERT_EMAIL = 'ops@mktr.sg';
    const sendEmail = jest.fn().mockResolvedValue({});
    const dmRequest = jest.fn();
    const res = await svc.syncGoogleCustomerMatch({ ...engineSeams(), dmRequest, sendEmail, sleep: fastSleep });
    expect(res.submitted).toBe(false);
    expect(res.error).toMatch(/ledger down/);
    expect(dmRequest).not.toHaveBeenCalled();
    expect(sendEmail.mock.calls[0][0].subject).toMatch(/nothing uploaded/);
  });

  it('never leaks raw or hashed PII into errors, logs, Sentry, or alert email — through the REAL client (provider echoes the hash)', async () => {
    const rawEmail = 'pii.sentinel@gmail.com';
    const rawPhone = '+6590000001';
    const emailHash = sha('piisentinel@gmail.com');
    const phoneHash = sha(rawPhone);
    const rows = [eligibleRow({ email: rawEmail, phone: rawPhone })];
    const d = happyDeps(rows);
    // Route through the real dmRequest with a mocked fetch whose error body
    // ECHOES both sentinels — the client's redaction is the surface under test.
    const client = await import('../../src/utils/googleDataManagerClient.js');
    client.__resetTokenCacheForTests();
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'at', expires_in: 3600 }) })
      .mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            code: 400,
            status: 'INVALID_ARGUMENT',
            message: `rejected identifiers ${emailHash} ${phoneHash} for ${rawEmail} / ${rawPhone}`,
          },
        }),
      });
    d.dmRequest = (method, payload) => client.dmRequest(method, payload, { fetch, sleep: fastSleep });
    process.env.GOOGLE_CM_ALERT_EMAIL = 'ops@mktr.sg';
    await svc.syncGoogleCustomerMatch(d);
    const surfaces = [
      JSON.stringify(d.sendEmail.mock.calls),
      JSON.stringify(loggerMock.error.mock.calls),
      JSON.stringify(loggerMock.warn.mock.calls),
      JSON.stringify(loggerMock.info.mock.calls),
      JSON.stringify(sentryMocks.captureException.mock.calls.map((c) => c[0]?.message)),
    ].join(' ');
    expect(surfaces).not.toContain(rawEmail);
    expect(surfaces).not.toContain(rawPhone);
    expect(surfaces).not.toContain(emailHash);
    expect(surfaces).not.toContain(phoneHash);
  });

  it('single-flights overlapping runs (held through settling)', async () => {
    const rows = [eligibleRow()];
    const d = happyDeps(rows);
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    d.dmRequest = jest.fn(async () => {
      await gate;
      return { requestId: 'slow' };
    });
    const first = svc.syncGoogleCustomerMatch(d);
    await new Promise((r) => setTimeout(r, 10));
    const second = await svc.syncGoogleCustomerMatch(d);
    expect(second).toEqual({ submitted: false, reason: 'overlap' });
    release();
    const firstRes = await first;
    expect(firstRes.submitted).toBe(true);
  });

  it('treats an empty eligible set as a successful no-op', async () => {
    const Prospect = { findAll: jest.fn().mockResolvedValue([]) };
    const dmRequest = jest.fn();
    const res = await svc.syncGoogleCustomerMatch({ ...engineSeams(), Prospect, dmRequest, sleep: fastSleep });
    expect(res).toEqual({ submitted: false, ok: true, reason: 'empty', eligible: 0, batches: 0, accepted: 0, failedBatches: 0, settlement: null });
    expect(dmRequest).not.toHaveBeenCalled();
  });
});

describe('removeAudienceMembers / removeByConsumerId', () => {
  it('no-ops unconfigured, and works with the sync flag OFF', async () => {
    delete process.env.GOOGLE_CM_USER_LIST_ID;
    expect(await svc.removeAudienceMembers([{ userIdentifiers: [{ phoneNumber: 'x' }] }])).toEqual({
      accepted: 0,
      reason: 'unconfigured',
    });
    process.env.GOOGLE_CM_USER_LIST_ID = '999888777';
    process.env.GOOGLE_CM_SYNC_ENABLED = 'false';
    const dmRequest = jest.fn().mockResolvedValue({ requestId: 'rm-1' });
    const dmRequestGet = jest.fn();
    const res = await svc.removeAudienceMembers(
      [{ userIdentifiers: [{ phoneNumber: 'x' }] }],
      { dmRequest, dmRequestGet, sleep: fastSleep, now: () => 1_700_000_000_000 }
    );
    expect(res).toEqual({ accepted: 1, members: 1, failedBatches: 0, settlement: 'queued' });
    expect(dmRequest.mock.calls[0][0]).toBe('audienceMembers:remove');
    expect(dmRequest.mock.calls[0][1].encoding).toBe('HEX');
    expect(dmRequestGet).not.toHaveBeenCalled(); // settlement is deferred, never in-run
  });

  it('a missing requestId on a removal accept is a failed batch (no silent success)', async () => {
    const res = await svc.removeAudienceMembers(
      [{ userIdentifiers: [{ phoneNumber: 'x' }] }],
      { dmRequest: jest.fn().mockResolvedValue({}), sleep: fastSleep }
    );
    expect(res.accepted).toBe(0);
    expect(res.failedBatches).toBe(1);
    expect(res.settlement).toBeNull();
  });

  it('never throws on a provider failure (erasure must not depend on Google)', async () => {
    const dmRequest = jest.fn().mockRejectedValue(new Error('boom'));
    const res = await svc.removeAudienceMembers(
      [{ userIdentifiers: [{ phoneNumber: 'x' }] }],
      { dmRequest, sleep: fastSleep }
    );
    expect(res.accepted).toBe(0);
    expect(res.failedBatches).toBe(1);
    expect(sentryMocks.captureException).toHaveBeenCalled();
  });

  it('removeByConsumerId scopes the lookup to the target campaign and removes', async () => {
    const findAll = jest
      .fn()
      .mockResolvedValue([{ email: 'jane@mktr.sg', phone: '+6591234567' }]);
    const dmRequest = jest.fn().mockResolvedValue({ requestId: 'rm-1' });
    const res = await svc.removeByConsumerId('consumer-1', {
      Prospect: { findAll },
      dmRequest,
      dmRequestGet: jest.fn().mockResolvedValue(okStatus),
      sleep: fastSleep,
    });
    expect(findAll).toHaveBeenCalledWith({
      attributes: ['email', 'phone'],
      where: { consumerId: 'consumer-1', campaignId: 'camp-airpods' },
      raw: true,
    });
    expect(res.accepted).toBe(1);
    expect(res.members).toBe(1);
  });
});

describe('hashEmailGoogle', () => {
  it('canonicalizes gmail and googlemail local parts (dots + plus-suffix)', () => {
    expect(piiHashing.hashEmailGoogle('Jane.Doe+x@Gmail.com')).toBe(sha('janedoe@gmail.com'));
    expect(piiHashing.hashEmailGoogle('a.b.c@googlemail.com')).toBe(sha('abc@googlemail.com'));
  });

  it('leaves non-google domains intact (dots/plus significant elsewhere)', () => {
    expect(piiHashing.hashEmailGoogle('jane.doe+x@mktr.sg')).toBe(sha('jane.doe+x@mktr.sg'));
  });

  it('strips all whitespace and lowercases', () => {
    expect(piiHashing.hashEmailGoogle('  Jane @ Gmail.com ')).toBe(sha('jane@gmail.com'));
  });

  it('returns undefined for garbage', () => {
    expect(piiHashing.hashEmailGoogle('')).toBeUndefined();
    expect(piiHashing.hashEmailGoogle(null)).toBeUndefined();
    expect(piiHashing.hashEmailGoogle('no-at-sign')).toBeUndefined();
    expect(piiHashing.hashEmailGoogle('+only@gmail.com')).toBeUndefined();
  });
});
