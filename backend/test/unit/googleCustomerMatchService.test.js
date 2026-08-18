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
  'GOOGLE_CM_STATUS_MAX_POLLS',
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
  process.env.GOOGLE_CM_STATUS_MAX_POLLS = '3';
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
function happyDeps(rows, dmOverrides = {}) {
  consentMocks.getMarketableGrantMap.mockResolvedValue(grantAll(rows));
  return {
    Prospect: { findAll: jest.fn().mockResolvedValue(rows) },
    dmRequest: jest.fn().mockResolvedValue({ requestId: 'req-1' }),
    dmRequestGet: jest.fn().mockResolvedValue(okStatus),
    sendEmail: jest.fn().mockResolvedValue({}),
    sleep: fastSleep,
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

describe('selectCampaignProspects', () => {
  it('pins the exact selector: target campaign, non-bot, minimal attributes', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    await svc.selectCampaignProspects({ Prospect: { findAll } });
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

describe('buildMemberRows', () => {
  it('emits HEX-hashed google-normalized email + E.164 phone identifiers', () => {
    const rows = [eligibleRow()];
    const out = svc.buildMemberRows(rows, { grantMap: grantAll(rows) });
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
    expect(svc.buildMemberRows(rows, { grantMap: grantAll(rows) })).toEqual([]);
  });

  it('skips rows without a verification stamp', () => {
    const rows = [eligibleRow({ sourceMetadata: {} })];
    expect(svc.buildMemberRows(rows, { grantMap: grantAll(rows) })).toEqual([]);
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
    expect(svc.buildMemberRows(rows, { grantMap: grantAll(rows) })).toHaveLength(2);
  });

  it('fails closed on consent: no map, no entry, and refused entry are all excluded', () => {
    const row = eligibleRow();
    expect(svc.buildMemberRows([row], {})).toEqual([]);
    expect(svc.buildMemberRows([row], { grantMap: new Map() })).toEqual([]);
    const refused = new Map([[row.phone, new Map([['*', false]])]]);
    expect(svc.buildMemberRows([row], { grantMap: refused })).toEqual([]);
  });

  it('admits a campaign-scoped grant for the row campaign', () => {
    const row = eligibleRow();
    const scoped = new Map([[row.phone, new Map([['camp-airpods', true]])]]);
    expect(svc.buildMemberRows([row], { grantMap: scoped })).toHaveLength(1);
  });

  it('drops suppressed phones', () => {
    const rows = [eligibleRow()];
    const out = svc.buildMemberRows(rows, {
      grantMap: grantAll(rows),
      suppressedPhones: new Set(['+6591234567']),
    });
    expect(out).toEqual([]);
  });

  it('drops the synthetic Retell email but keeps the phone identifier', () => {
    const rows = [eligibleRow({ email: 'retell-abc@calls.mktr.sg' })];
    const out = svc.buildMemberRows(rows, { grantMap: grantAll(rows) });
    expect(out).toEqual([{ userIdentifiers: [{ phoneNumber: sha('+6591234567') }] }]);
  });

  it('drops rows with neither usable identifier', () => {
    const weird = eligibleRow({ email: 'not-an-email', phone: null });
    expect(svc.buildMemberRows([weird], { grantMap: grantAll([weird]) })).toEqual([]);
  });
});

describe('buildRemovalIdentifiers', () => {
  it('builds identifiers with NO consent/verification gate (removal is always permitted)', () => {
    const out = svc.buildRemovalIdentifiers([
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

describe('settleRequestStatuses', () => {
  it('classifies terminal states and dedupes request ids', async () => {
    const dmRequestGet = jest
      .fn()
      .mockResolvedValueOnce({ requestStatusPerDestination: [{ requestStatus: 'SUCCESS' }] })
      .mockResolvedValueOnce({ requestStatus: 'PARTIAL_SUCCESS' })
      .mockResolvedValueOnce({ status: 'FAILED' });
    const res = await svc.settleRequestStatuses(['a', 'a', 'b', 'c', null], {
      dmRequestGet,
      sleep: fastSleep,
    });
    expect(res).toEqual({ succeeded: 1, partialSuccess: 1, failed: 1, stuck: 0 });
    expect(dmRequestGet).toHaveBeenCalledTimes(3);
    expect(dmRequestGet.mock.calls[0][0]).toBe('requestStatus:retrieve?requestId=a');
  });

  it('polls PROCESSING through to a terminal state', async () => {
    const dmRequestGet = jest
      .fn()
      .mockResolvedValueOnce({ requestStatus: 'PROCESSING' })
      .mockResolvedValueOnce({ requestStatus: 'PROCESSING' })
      .mockResolvedValueOnce({ requestStatus: 'SUCCESS' });
    const res = await svc.settleRequestStatuses(['a'], { dmRequestGet, sleep: fastSleep });
    expect(res).toEqual({ succeeded: 1, partialSuccess: 0, failed: 0, stuck: 0 });
  });

  it('marks an id stuck after the poll budget, and on a retrieve error', async () => {
    const neverDone = jest.fn().mockResolvedValue({ requestStatus: 'PROCESSING' });
    expect(await svc.settleRequestStatuses(['a'], { dmRequestGet: neverDone, sleep: fastSleep }))
      .toEqual({ succeeded: 0, partialSuccess: 0, failed: 0, stuck: 1 });
    const broken = jest.fn().mockRejectedValue(new Error('boom'));
    expect(await svc.settleRequestStatuses(['b'], { dmRequestGet: broken, sleep: fastSleep }))
      .toEqual({ succeeded: 0, partialSuccess: 0, failed: 0, stuck: 1 });
  });
});

describe('syncGoogleCustomerMatch', () => {
  it('returns guarded without touching the ledger when config is missing', async () => {
    delete process.env.GOOGLE_CM_USER_LIST_ID;
    const res = await svc.syncGoogleCustomerMatch({ dmRequest: jest.fn() });
    expect(res).toEqual({ synced: false, reason: 'guarded' });
    expect(consentMocks.getMarketableGrantMap).not.toHaveBeenCalled();
  });

  it('uploads, settles statuses, and reports the full summary', async () => {
    const rows = [eligibleRow(), eligibleRow({ phone: '+6598765432' })];
    const d = happyDeps(rows);
    const res = await svc.syncGoogleCustomerMatch(d);
    expect(res).toEqual({
      synced: true,
      eligible: 2,
      batches: 1,
      accepted: 1,
      failedBatches: 0,
      status: { succeeded: 1, partialSuccess: 0, failed: 0, stuck: 0 },
    });
    expect(d.dmRequest.mock.calls[0][0]).toBe('audienceMembers:ingest');
    expect(d.sendEmail).not.toHaveBeenCalled();
  });

  it('splits 5001 members into envelopes of 5000 and 1 (the production cap)', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) =>
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
    expect(d.dmRequest.mock.calls[0][1].audienceMembers).toHaveLength(5000);
    expect(d.dmRequest.mock.calls[1][1].audienceMembers).toHaveLength(1);
  });

  it('partial batch failure: accepted batches stand, alert says partial (not wholesale)', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) =>
      eligibleRow({ phone: `+659${String(1000000 + i).slice(-7)}` })
    );
    const d = happyDeps(rows);
    d.dmRequest
      .mockResolvedValueOnce({ requestId: 'req-1' })
      .mockRejectedValueOnce(new Error('google dm audienceMembers:ingest failed: HTTP 500'));
    process.env.GOOGLE_CM_ALERT_EMAIL = 'ops@mktr.sg';
    const res = await svc.syncGoogleCustomerMatch(d);
    expect(res.synced).toBe(true);
    expect(res.accepted).toBe(1);
    expect(res.failedBatches).toBe(1);
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
    expect(d.sendEmail.mock.calls[0][0].subject).toMatch(/partial failure/);
    expect(d.sendEmail.mock.calls[0][0].text).toMatch(/confirmed batches stand/i);
  });

  it('a missing requestId on accept counts as a failed batch, never silent success', async () => {
    const rows = [eligibleRow()];
    const d = happyDeps(rows);
    d.dmRequest.mockResolvedValue({});
    process.env.GOOGLE_CM_ALERT_EMAIL = 'ops@mktr.sg';
    const res = await svc.syncGoogleCustomerMatch(d);
    expect(res.synced).toBe(false);
    expect(res.failedBatches).toBe(1);
    expect(res.accepted).toBe(0);
    expect(d.sendEmail.mock.calls[0][0].subject).toMatch(/nothing uploaded/);
  });

  it('every accepted job terminally FAILED = wholesale, never "synced" (outcome-derived)', async () => {
    const rows = [eligibleRow()];
    const d = happyDeps(rows);
    d.dmRequestGet.mockResolvedValue({ requestStatus: 'FAILED' });
    process.env.GOOGLE_CM_ALERT_EMAIL = 'ops@mktr.sg';
    const res = await svc.syncGoogleCustomerMatch(d);
    expect(res.synced).toBe(false);
    expect(res.status.failed).toBe(1);
    expect(d.sendEmail.mock.calls[0][0].subject).toMatch(/nothing uploaded/);
  });

  it('accepted-but-stuck statuses = unconfirmed, never "synced"', async () => {
    const rows = [eligibleRow()];
    const d = happyDeps(rows);
    d.dmRequestGet.mockResolvedValue({ requestStatus: 'PROCESSING' });
    process.env.GOOGLE_CM_ALERT_EMAIL = 'ops@mktr.sg';
    const res = await svc.syncGoogleCustomerMatch(d);
    expect(res.synced).toBe(false);
    expect(res.reason).toBe('unconfirmed');
    expect(res.status.stuck).toBe(1);
    expect(d.sendEmail.mock.calls[0][0].subject).toMatch(/unconfirmed/);
  });

  it('aborts fail-closed (no upload, wholesale alert) when a ledger lookup throws', async () => {
    consentMocks.getSuppressedPhoneSet.mockRejectedValue(new Error('ledger down'));
    process.env.GOOGLE_CM_ALERT_EMAIL = 'ops@mktr.sg';
    const sendEmail = jest.fn().mockResolvedValue({});
    const dmRequest = jest.fn();
    const res = await svc.syncGoogleCustomerMatch({ dmRequest, sendEmail, sleep: fastSleep });
    expect(res.synced).toBe(false);
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
    d.dmRequestGet = jest.fn(async () => {
      await gate;
      return okStatus;
    });
    const first = svc.syncGoogleCustomerMatch(d);
    await new Promise((r) => setTimeout(r, 10));
    const second = await svc.syncGoogleCustomerMatch(d);
    expect(second).toEqual({ synced: false, reason: 'overlap' });
    release();
    const firstRes = await first;
    expect(firstRes.synced).toBe(true);
  });

  it('treats an empty eligible set as a successful no-op', async () => {
    const Prospect = { findAll: jest.fn().mockResolvedValue([]) };
    const dmRequest = jest.fn();
    const res = await svc.syncGoogleCustomerMatch({ Prospect, dmRequest, sleep: fastSleep });
    expect(res).toEqual({ synced: true, eligible: 0, batches: 0, accepted: 0, failedBatches: 0, status: null });
    expect(dmRequest).not.toHaveBeenCalled();
  });
});

describe('removeAudienceMembers / removeByConsumerId', () => {
  it('no-ops unconfigured, and works with the sync flag OFF', async () => {
    delete process.env.GOOGLE_CM_USER_LIST_ID;
    expect(await svc.removeAudienceMembers([{ userIdentifiers: [{ phoneNumber: 'x' }] }])).toEqual({
      removed: false,
      reason: 'unconfigured',
    });
    process.env.GOOGLE_CM_USER_LIST_ID = '999888777';
    process.env.GOOGLE_CM_SYNC_ENABLED = 'false';
    const dmRequest = jest.fn().mockResolvedValue({ requestId: 'rm-1' });
    const dmRequestGet = jest.fn().mockResolvedValue(okStatus);
    const res = await svc.removeAudienceMembers(
      [{ userIdentifiers: [{ phoneNumber: 'x' }] }],
      { dmRequest, dmRequestGet, sleep: fastSleep }
    );
    expect(res.removed).toBe(true);
    expect(dmRequest.mock.calls[0][0]).toBe('audienceMembers:remove');
    expect(dmRequest.mock.calls[0][1].encoding).toBe('HEX');
    expect(dmRequestGet).toHaveBeenCalled(); // removal is settled, not assumed
  });

  it('removal PARTIAL_SUCCESS is NOT removed:true — people stayed on the list', async () => {
    const dmRequest = jest.fn().mockResolvedValue({ requestId: 'rm-1' });
    const partialGet = jest.fn().mockResolvedValue({ requestStatus: 'PARTIAL_SUCCESS' });
    const res = await svc.removeAudienceMembers(
      [{ userIdentifiers: [{ phoneNumber: 'x' }] }],
      { dmRequest, dmRequestGet: partialGet, sleep: fastSleep }
    );
    expect(res.removed).toBe(false);
    expect(res.status.partialSuccess).toBe(1);
  });

  it('removal is UNCONFIRMED (removed:false) when the status never settles or FAILs', async () => {
    const dmRequest = jest.fn().mockResolvedValue({ requestId: 'rm-1' });
    const stuckGet = jest.fn().mockResolvedValue({ requestStatus: 'PROCESSING' });
    const stuck = await svc.removeAudienceMembers(
      [{ userIdentifiers: [{ phoneNumber: 'x' }] }],
      { dmRequest, dmRequestGet: stuckGet, sleep: fastSleep }
    );
    expect(stuck.removed).toBe(false);
    expect(stuck.status.stuck).toBe(1);
    const noId = await svc.removeAudienceMembers(
      [{ userIdentifiers: [{ phoneNumber: 'x' }] }],
      { dmRequest: jest.fn().mockResolvedValue({}), dmRequestGet: stuckGet, sleep: fastSleep }
    );
    expect(noId.removed).toBe(false);
    expect(noId.failedBatches).toBe(1);
  });

  it('never throws on a provider failure (erasure must not depend on Google)', async () => {
    const dmRequest = jest.fn().mockRejectedValue(new Error('boom'));
    const res = await svc.removeAudienceMembers(
      [{ userIdentifiers: [{ phoneNumber: 'x' }] }],
      { dmRequest, sleep: fastSleep }
    );
    expect(res.removed).toBe(false);
    expect(res.failedBatches).toBe(1);
    expect(res.accepted).toBe(0);
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
    expect(res.removed).toBe(true);
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
