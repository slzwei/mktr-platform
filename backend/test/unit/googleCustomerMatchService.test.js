import { jest } from '@jest/globals';
import crypto from 'crypto';

// Mocks BEFORE importing the SUT (Jest ESM pattern).
jest.unstable_mockModule('@sentry/node', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  init: jest.fn(),
  setTag: jest.fn(),
}));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
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
beforeAll(async () => {
  svc = await import('../../src/services/googleCustomerMatchService.js');
  piiHashing = await import('../../src/utils/piiHashing.js');
  ({ phoneHashOf } = await import('../../src/services/consumerService.js'));
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
  delete process.env.GOOGLE_CM_ALERT_EMAIL;
  delete process.env.REDEEMED_AUDIENCE_ALERT_EMAIL;
  consentMocks.getSuppressedPhoneSet.mockReset().mockResolvedValue(new Set());
  consentMocks.getMarketableGrantMap.mockReset().mockResolvedValue(new Map());
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

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

describe('shouldSync', () => {
  it('is true only with the full config set', () => {
    expect(svc.shouldSync()).toBe(true);
  });

  it.each(ENV_KEYS.slice(0, 7))('is false when %s is missing', (key) => {
    delete process.env[key];
    expect(svc.shouldSync()).toBe(false);
  });

  it('is false when the flag is any non-"true" value', () => {
    process.env.GOOGLE_CM_SYNC_ENABLED = '1';
    expect(svc.shouldSync()).toBe(false);
  });
});

describe('buildMemberRows', () => {
  it('emits HEX-hashed google-normalized email + E.164 phone identifiers', () => {
    const rows = [eligibleRow()];
    const out = svc.buildMemberRows(rows, { grantMap: grantAll(rows) });
    expect(out).toEqual([
      {
        userIdentifiers: [
          // gmail canonicalization: dots stripped, +suffix dropped
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
    const rows = [eligibleRow({ email: null, phone: '' })];
    // phone '' → no verification either, but assert the neither-identifier path
    // with a verified-but-unhashable row too:
    const weird = eligibleRow({ email: 'not-an-email', phone: null });
    expect(svc.buildMemberRows([...rows, weird], { grantMap: grantAll([...rows, weird]) })).toEqual(
      []
    );
  });
});

describe('buildIngestBody', () => {
  it('pins the golden envelope: destination, consent enums, HEX, CM terms', () => {
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
});

describe('chunk', () => {
  it('splits at the batch cap', () => {
    expect(svc.chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('syncGoogleCustomerMatch', () => {
  it('returns guarded without touching the ledger when config is missing', async () => {
    delete process.env.GOOGLE_CM_USER_LIST_ID;
    const res = await svc.syncGoogleCustomerMatch({ dmRequest: jest.fn() });
    expect(res).toEqual({ synced: false, reason: 'guarded' });
    expect(consentMocks.getMarketableGrantMap).not.toHaveBeenCalled();
  });

  it('uploads eligible members in batches and reports requestIds', async () => {
    const rows = [eligibleRow(), eligibleRow({ phone: '+6598765432' })];
    consentMocks.getMarketableGrantMap.mockResolvedValue(grantAll(rows));
    const Prospect = { findAll: jest.fn().mockResolvedValue(rows) };
    const dmRequest = jest.fn().mockResolvedValue({ requestId: 'req-1' });
    const res = await svc.syncGoogleCustomerMatch({ Prospect, dmRequest });
    expect(res).toEqual({ synced: true, eligible: 2, batches: 1, requestIds: ['req-1'] });
    expect(dmRequest).toHaveBeenCalledTimes(1);
    const [method, body] = dmRequest.mock.calls[0];
    expect(method).toBe('audienceMembers:ingest');
    expect(body.audienceMembers).toHaveLength(2);
    expect(body.encoding).toBe('HEX');
  });

  it('aborts fail-closed (no upload, alert sent) when a ledger lookup throws', async () => {
    consentMocks.getSuppressedPhoneSet.mockRejectedValue(new Error('ledger down'));
    process.env.GOOGLE_CM_ALERT_EMAIL = 'ops@mktr.sg';
    const sendEmail = jest.fn().mockResolvedValue({});
    const dmRequest = jest.fn();
    const res = await svc.syncGoogleCustomerMatch({ dmRequest, sendEmail });
    expect(res.synced).toBe(false);
    expect(res.error).toMatch(/ledger down/);
    expect(dmRequest).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe('ops@mktr.sg');
  });

  it('reports a failed upload with an alert and keeps PII out of the summary', async () => {
    const rows = [eligibleRow()];
    consentMocks.getMarketableGrantMap.mockResolvedValue(grantAll(rows));
    const Prospect = { findAll: jest.fn().mockResolvedValue(rows) };
    const dmRequest = jest.fn().mockRejectedValue(
      Object.assign(new Error('google dm audienceMembers:ingest failed: HTTP 403 denied'), {
        status: 403,
      })
    );
    process.env.REDEEMED_AUDIENCE_ALERT_EMAIL = 'fallback@mktr.sg';
    const sendEmail = jest.fn().mockResolvedValue({});
    const res = await svc.syncGoogleCustomerMatch({ Prospect, dmRequest, sendEmail });
    expect(res.synced).toBe(false);
    expect(res.error).not.toMatch(/@gmail/);
    expect(sendEmail.mock.calls[0][0].to).toBe('fallback@mktr.sg');
  });

  it('single-flights overlapping runs', async () => {
    const rows = [eligibleRow()];
    consentMocks.getMarketableGrantMap.mockResolvedValue(grantAll(rows));
    const Prospect = { findAll: jest.fn().mockResolvedValue(rows) };
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const dmRequest = jest.fn(async () => {
      await gate;
      return { requestId: 'slow' };
    });
    const first = svc.syncGoogleCustomerMatch({ Prospect, dmRequest });
    // Let the first run reach the in-flight section before starting the second.
    await new Promise((r) => setTimeout(r, 10));
    const second = await svc.syncGoogleCustomerMatch({ Prospect, dmRequest });
    expect(second).toEqual({ synced: false, reason: 'overlap' });
    release();
    const firstRes = await first;
    expect(firstRes.synced).toBe(true);
  });

  it('treats an empty eligible set as a successful no-op', async () => {
    const Prospect = { findAll: jest.fn().mockResolvedValue([]) };
    const dmRequest = jest.fn();
    const res = await svc.syncGoogleCustomerMatch({ Prospect, dmRequest });
    expect(res).toEqual({ synced: true, eligible: 0, batches: 0, requestIds: [] });
    expect(dmRequest).not.toHaveBeenCalled();
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
