import { jest } from '@jest/globals';
import crypto from 'crypto';

const sentryMocks = { captureException: jest.fn(), captureMessage: jest.fn(), init: jest.fn(), setTag: jest.fn() };
jest.unstable_mockModule('@sentry/node', () => sentryMocks);
const loggerMock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.unstable_mockModule('../../src/utils/logger.js', () => ({ logger: loggerMock }));
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
  models.Prospect = { findAll: jest.fn(), findByPk: jest.fn() };
  const sequelize = { transaction: jest.fn(), query: jest.fn() };
  return { ...models, sequelize, default: { ...models, sequelize } };
});
const consentMocks = { getSuppressedPhoneSet: jest.fn(), getMarketableGrantMap: jest.fn(), canMarketTo: jest.fn() };
jest.unstable_mockModule('../../src/services/consentService.js', () => consentMocks);

let svc;
let recon;
beforeAll(async () => {
  svc = await import('../../src/services/googleOfflineConversionsService.js');
  recon = await import('../../src/services/googleOutcomesReconciler.js');
});

const ENV_KEYS = [
  'GOOGLE_ADS_UPLOADS_ENABLED', 'GOOGLE_DM_OAUTH_CLIENT_ID', 'GOOGLE_DM_OAUTH_CLIENT_SECRET',
  'GOOGLE_DM_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_CONV_ACTION_QUALIFIED',
  'GOOGLE_CONV_ACTION_WON', 'GOOGLE_VALUE_QUALIFIED', 'GOOGLE_VALUE_WON',
  'GOOGLE_CONV_MAX_AGE_DAYS', 'GOOGLE_PENDING_MAX_DAYS', 'GOOGLE_SEND_MAX_RETRIES',
  'LYFE_SUPABASE_URL', 'LYFE_SUPABASE_SERVICE_ROLE_KEY',
];
const saved = {};
const T0 = 1_700_000_000_000;
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.GOOGLE_ADS_UPLOADS_ENABLED = 'true';
  process.env.GOOGLE_DM_OAUTH_CLIENT_ID = 'cid';
  process.env.GOOGLE_DM_OAUTH_CLIENT_SECRET = 'sec';
  process.env.GOOGLE_DM_REFRESH_TOKEN = 'rt';
  process.env.GOOGLE_ADS_CUSTOMER_ID = '1829163947';
  process.env.GOOGLE_CONV_ACTION_QUALIFIED = 'act-cr';
  process.env.GOOGLE_CONV_ACTION_WON = 'act-cw';
  process.env.GOOGLE_VALUE_QUALIFIED = '40';
  process.env.GOOGLE_VALUE_WON = '500';
  process.env.LYFE_SUPABASE_URL = 'https://lyfe.example';
  process.env.LYFE_SUPABASE_SERVICE_ROLE_KEY = 'srk';
  consentMocks.canMarketTo.mockReset().mockResolvedValue(true);
  sentryMocks.captureException.mockClear();
  sentryMocks.captureMessage.mockClear();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const nowAt = (ms) => () => ms;

function prospectFx(overrides = {}) {
  return {
    id: 'p-1',
    email: 'jane@mktr.sg',
    phone: '+6591234567',
    consumerId: 'c-1',
    campaignId: 'camp-1',
    leadSource: 'website',
    createdAt: new Date(T0 - 10 * 24 * 60 * 60 * 1000).toISOString(),
    sourceMetadata: { gcl: { gclid: 'g1', capturedAt: new Date(T0 - 10 * 24 * 60 * 60 * 1000).toISOString() } },
    ...overrides,
  };
}

describe('factEligibility', () => {
  it('skips call_bot and no-identifier permanently; passes a normal row', () => {
    expect(svc.factEligibility(prospectFx({ leadSource: 'call_bot' }), { now: nowAt(T0) })).toEqual({ ok: false, reason: 'call_bot' });
    expect(svc.factEligibility(prospectFx({ email: null, phone: null, sourceMetadata: {} }), { now: nowAt(T0) })).toEqual({ ok: false, reason: 'no_identifier' });
    expect(svc.factEligibility(prospectFx(), { now: nowAt(T0) })).toEqual({ ok: true });
  });

  it('age-guards from the CLICK capture (or signup for PII-only), never the outcome', () => {
    const oldClick = prospectFx({ sourceMetadata: { gcl: { gclid: 'g', capturedAt: new Date(T0 - 61 * 24 * 60 * 60 * 1000).toISOString() } } });
    expect(svc.factEligibility(oldClick, { now: nowAt(T0) })).toEqual({ ok: false, reason: 'age_window_expired' });
    const piiOnlyOld = prospectFx({ sourceMetadata: {}, createdAt: new Date(T0 - 61 * 24 * 60 * 60 * 1000).toISOString() });
    expect(svc.factEligibility(piiOnlyOld, { now: nowAt(T0) })).toEqual({ ok: false, reason: 'age_window_expired' });
    const piiOnlyFresh = prospectFx({ sourceMetadata: {}, createdAt: new Date(T0 - 5 * 24 * 60 * 60 * 1000).toISOString() });
    expect(svc.factEligibility(piiOnlyFresh, { now: nowAt(T0) })).toEqual({ ok: true });
  });

  it('Meta-Lead-Ads-origin rows are NOT skipped (upload-all guidance)', () => {
    const metaLead = prospectFx({ sourceMetadata: { metaLeadgenId: 'ml-1', gcl: { gclid: 'g', capturedAt: new Date(T0 - 1000).toISOString() } } });
    expect(svc.factEligibility(metaLead, { now: nowAt(T0) })).toEqual({ ok: true });
  });
});

describe('buildOutcomeEnvelope', () => {
  it('pins the consented envelope: OTHER, RFC3339, transactionId, ALL identifiers, HEX + consent WITH userData', () => {
    const env = svc.buildOutcomeEnvelope(
      prospectFx({ sourceMetadata: { gcl: { gclid: 'g1', gbraid: 'b1', wbraid: 'w1' } } }),
      'confirmed_resident',
      '2026-08-18T01:02:03.000Z',
      { marketingConsent: true }
    );
    expect(env).toEqual({
      destinations: [{ operatingAccount: { product: 'GOOGLE_ADS', accountId: '1829163947' }, productDestinationId: 'act-cr' }],
      events: [{
        eventSource: 'OTHER',
        eventTimestamp: '2026-08-18T01:02:03.000Z',
        transactionId: 'confirmed_resident:p-1',
        conversionValue: 40,
        currency: 'SGD',
        adIdentifiers: { gclid: 'g1', gbraid: 'b1', wbraid: 'w1' },
        userData: { userIdentifiers: [{ emailAddress: sha('jane@mktr.sg') }, { phoneNumber: sha('+6591234567') }] },
      }],
      encoding: 'HEX',
      consent: { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' },
    });
  });

  it('click-only (no consent) omits userData, encoding, AND the consent block — never a false CONSENT_GRANTED', () => {
    const env = svc.buildOutcomeEnvelope(prospectFx(), 'closed_won', '2026-08-18T01:02:03.000Z', { marketingConsent: false });
    expect(env.events[0].userData).toBeUndefined();
    expect(env.encoding).toBeUndefined();
    expect(env.consent).toBeUndefined();
    expect(env.events[0].adIdentifiers).toEqual({ gclid: 'g1' });
    expect(env.events[0].conversionValue).toBe(500);
    expect(env.destinations[0].productDestinationId).toBe('act-cw');
  });
});

describe('dispatchOutcome', () => {
  it('accept → pending marker carrying retryCount, ~30min first poll', async () => {
    const setPath = jest.fn().mockResolvedValue(1);
    const dmRequest = jest.fn().mockResolvedValue({ requestId: 'req-1' });
    const res = await svc.dispatchOutcome(prospectFx(), 'confirmed_resident', new Date(T0).toISOString(), 2, {
      setPath, dmRequest, canMarketTo: consentMocks.canMarketTo, now: nowAt(T0),
    });
    expect(res).toEqual({ sent: true, requestId: 'req-1' });
    const [, path, marker] = setPath.mock.calls[0];
    expect(path).toEqual(['gads', 'confirmed_resident']);
    expect(marker).toMatchObject({ state: 'pending', requestId: 'req-1', retryCount: 2 });
    expect(Date.parse(marker.nextPollAt) - T0).toBe(30 * 60_000);
  });

  it('permanently ineligible facts get skippedPermanent (no send)', async () => {
    const setPath = jest.fn().mockResolvedValue(1);
    const dmRequest = jest.fn();
    const res = await svc.dispatchOutcome(prospectFx({ leadSource: 'call_bot' }), 'confirmed_resident', new Date(T0).toISOString(), 0, {
      setPath, dmRequest, now: nowAt(T0),
    });
    expect(res.reason).toBe('call_bot');
    expect(dmRequest).not.toHaveBeenCalled();
    expect(setPath.mock.calls[0][2]).toMatchObject({ state: 'skippedPermanent', reason: 'call_bot' });
  });

  it('retry cap is checked BEFORE dispatch → failedPermanent', async () => {
    const setPath = jest.fn().mockResolvedValue(1);
    const dmRequest = jest.fn();
    const res = await svc.dispatchOutcome(prospectFx(), 'confirmed_resident', new Date(T0).toISOString(), 5, {
      setPath, dmRequest, canMarketTo: consentMocks.canMarketTo, now: nowAt(T0),
    });
    expect(res.reason).toBe('retry_cap');
    expect(dmRequest).not.toHaveBeenCalled();
    expect(setPath.mock.calls[0][2]).toMatchObject({ state: 'failedPermanent', reason: 'retry_cap' });
  });

  it('ledger failure fails CLOSED for PII but the click-only event still sends', async () => {
    consentMocks.canMarketTo.mockRejectedValue(new Error('ledger down'));
    const setPath = jest.fn().mockResolvedValue(1);
    const dmRequest = jest.fn().mockResolvedValue({ requestId: 'req-1' });
    const res = await svc.dispatchOutcome(prospectFx(), 'confirmed_resident', new Date(T0).toISOString(), 0, {
      setPath, dmRequest, canMarketTo: consentMocks.canMarketTo, now: nowAt(T0),
    });
    expect(res.sent).toBe(true);
    const envelope = dmRequest.mock.calls[0][1];
    expect(envelope.events[0].userData).toBeUndefined();
    expect(envelope.consent).toBeUndefined();
    expect(envelope.events[0].adIdentifiers.gclid).toBe('g1');
  });

  it('missing requestId and transient errors → retryWait with retryCount+1; 4xx → failedPermanent', async () => {
    const setPath = jest.fn().mockResolvedValue(1);
    const noId = await svc.dispatchOutcome(prospectFx(), 'confirmed_resident', new Date(T0).toISOString(), 1, {
      setPath, dmRequest: jest.fn().mockResolvedValue({}), canMarketTo: consentMocks.canMarketTo, now: nowAt(T0),
    });
    expect(noId.reason).toBe('missing_request_id');
    expect(setPath.mock.calls[0][2]).toMatchObject({ state: 'retryWait', retryCount: 2, lastReason: 'missing_request_id' });

    setPath.mockClear();
    const transient = await svc.dispatchOutcome(prospectFx(), 'confirmed_resident', new Date(T0).toISOString(), 0, {
      setPath, dmRequest: jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { status: 503 })),
      canMarketTo: consentMocks.canMarketTo, now: nowAt(T0),
    });
    expect(transient.reason).toBe('transient');
    expect(setPath.mock.calls[0][2]).toMatchObject({ state: 'retryWait', retryCount: 1 });

    setPath.mockClear();
    const permanent = await svc.dispatchOutcome(prospectFx(), 'confirmed_resident', new Date(T0).toISOString(), 0, {
      setPath, dmRequest: jest.fn().mockRejectedValue(Object.assign(new Error('bad'), { status: 400 })),
      canMarketTo: consentMocks.canMarketTo, now: nowAt(T0),
    });
    expect(permanent.reason).toBe('permanent');
    expect(setPath.mock.calls[0][2]).toMatchObject({ state: 'failedPermanent', reason: 'http_400' });
  });
});

describe('workers', () => {
  it('resend: missing action id aborts the key pass with NO row mutation or query', async () => {
    delete process.env.GOOGLE_CONV_ACTION_QUALIFIED;
    delete process.env.GOOGLE_CONV_ACTION_WON;
    const sequelize = { query: jest.fn() };
    const res = await svc.resendDueOutcomes({ sequelize, now: nowAt(T0) });
    expect(res.ran).toBe(true);
    expect(sequelize.query).not.toHaveBeenCalled();
  });

  it('settle: SUCCESS delivers with a requestId CAS; FAILED re-queues with Sentry; PROCESSING advances nextPollAt', async () => {
    const marker = { state: 'pending', requestId: 'req-1', retryCount: 0, sentAt: new Date(T0 - 40 * 60_000).toISOString(), nextPollAt: new Date(T0 - 60_000).toISOString() };
    const sequelize = { query: jest.fn().mockResolvedValueOnce([{ id: 'p-1', marker }]).mockResolvedValue([]) };
    const setPath = jest.fn().mockResolvedValue(1);
    const dmRequestGet = jest.fn().mockResolvedValue({ requestStatus: 'SUCCESS' });
    const res = await svc.settleDueOutcomes({ sequelize, setPath, dmRequestGet, now: nowAt(T0) });
    expect(res.delivered).toBe(1);
    const [, path, value, opts] = setPath.mock.calls[0];
    expect(path).toEqual(['gads', 'confirmed_resident']);
    expect(value).toMatchObject({ state: 'delivered', requestId: 'req-1' });
    expect(opts.cas).toEqual({ path: ['gads', 'confirmed_resident'], contains: { state: 'pending', requestId: 'req-1' } });

    const seq2 = { query: jest.fn().mockResolvedValueOnce([{ id: 'p-1', marker }]).mockResolvedValue([]) };
    const set2 = jest.fn().mockResolvedValue(1);
    const failed = await svc.settleDueOutcomes({ sequelize: seq2, setPath: set2, dmRequestGet: jest.fn().mockResolvedValue({ requestStatus: 'FAILED' }), now: nowAt(T0) });
    expect(failed.retried).toBe(1);
    expect(set2.mock.calls[0][2]).toMatchObject({ state: 'retryWait', retryCount: 1, lastReason: 'ingest_failed' });
    expect(sentryMocks.captureMessage).toHaveBeenCalled();

    const seq3 = { query: jest.fn().mockResolvedValueOnce([{ id: 'p-1', marker }]).mockResolvedValue([]) };
    const set3 = jest.fn().mockResolvedValue(1);
    const processing = await svc.settleDueOutcomes({ sequelize: seq3, setPath: set3, dmRequestGet: jest.fn().mockResolvedValue({ requestStatus: 'PROCESSING' }), now: nowAt(T0) });
    expect(processing.stillPending).toBe(1);
    expect(Date.parse(set3.mock.calls[0][2].nextPollAt)).toBeGreaterThan(T0);
  });

  it('settle: duplicate-transaction evidence counts as delivered; pending past the horizon fails permanently', async () => {
    const marker = { state: 'pending', requestId: 'req-1', retryCount: 0, sentAt: new Date(T0 - 8 * 24 * 60 * 60_000).toISOString(), nextPollAt: new Date(T0 - 60_000).toISOString() };
    const seq = { query: jest.fn().mockResolvedValueOnce([{ id: 'p-1', marker }]).mockResolvedValue([]) };
    const set = jest.fn().mockResolvedValue(1);
    const dup = await svc.settleDueOutcomes({ sequelize: seq, setPath: set, dmRequestGet: jest.fn().mockRejectedValue(new Error('HTTP 409 duplicate transaction id')), now: nowAt(T0) });
    expect(dup.delivered).toBe(1);
    expect(set.mock.calls[0][2]).toMatchObject({ state: 'delivered' });

    const seq2 = { query: jest.fn().mockResolvedValueOnce([{ id: 'p-1', marker }]).mockResolvedValue([]) };
    const set2 = jest.fn().mockResolvedValue(1);
    const timedOut = await svc.settleDueOutcomes({ sequelize: seq2, setPath: set2, dmRequestGet: jest.fn().mockResolvedValue({ requestStatus: 'PROCESSING' }), now: nowAt(T0) });
    expect(timedOut.failedPermanent).toBe(1);
    expect(set2.mock.calls[0][2]).toMatchObject({ state: 'failedPermanent', reason: 'pending_timeout' });
  });
});

describe('reconcileLyfeOutcomes', () => {
  function jsonRes(body) {
    return { ok: true, json: async () => body };
  }

  it('direct statuses write first-wins facts; proposed WITHOUT history gets nothing (no false CR)', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonRes([
        { id: 'L1', external_id: 'p-q', status: 'qualified', updated_at: '2026-08-01T00:00:00Z' },
        { id: 'L2', external_id: 'p-prop', status: 'proposed', updated_at: '2026-08-02T00:00:00Z' },
      ]))
      .mockResolvedValueOnce(jsonRes([])); // no qualifying history
    const Prospect = { findAll: jest.fn().mockResolvedValue([
      { id: 'p-q', sourceMetadata: {} },
      { id: 'p-prop', sourceMetadata: {} },
    ]) };
    const mergeFirstWins = jest.fn().mockResolvedValue(1);
    const res = await recon.reconcileLyfeOutcomes({ fetch, Prospect, mergeFirstWins });
    expect(res.factsWritten).toBe(1);
    expect(mergeFirstWins).toHaveBeenCalledTimes(1);
    expect(mergeFirstWins.mock.calls[0][0]).toBe('p-q');
    expect(mergeFirstWins.mock.calls[0][2]).toEqual({ confirmed_resident: '2026-08-01T00:00:00.000Z' });
  });

  it('a won → qualified regression recovers closed_won from the status_change history', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonRes([
        { id: 'L1', external_id: 'p-1', status: 'qualified', updated_at: '2026-08-10T00:00:00Z' },
      ]))
      .mockResolvedValueOnce(jsonRes([
        { lead_id: 'L1', created_at: '2026-08-05T00:00:00Z', metadata: { from_status: 'qualified', to_status: 'won' } },
      ]));
    const Prospect = { findAll: jest.fn().mockResolvedValue([{ id: 'p-1', sourceMetadata: {} }]) };
    const mergeFirstWins = jest.fn().mockResolvedValue(1);
    const res = await recon.reconcileLyfeOutcomes({ fetch, Prospect, mergeFirstWins });
    expect(res.factsWritten).toBe(2);
    const patch = mergeFirstWins.mock.calls[0][2];
    expect(patch.confirmed_resident).toBe('2026-08-10T00:00:00.000Z'); // direct evidence
    expect(patch.closed_won).toBe('2026-08-05T00:00:00.000Z'); // history-proven
    // the exact PostgREST shapes are pinned (column `type`, metadata to_status)
    expect(fetch.mock.calls[1][0]).toContain('lead_activities?type=eq.status_change');
    expect(fetch.mock.calls[1][0]).toContain('select=lead_id,created_at,metadata');
  });

  it('existing facts are never re-written; guarded without config', async () => {
    const fetch = jest.fn().mockResolvedValueOnce(jsonRes([
      { id: 'L1', external_id: 'p-1', status: 'won', updated_at: '2026-08-10T00:00:00Z' },
    ])).mockResolvedValueOnce(jsonRes([]));
    const Prospect = { findAll: jest.fn().mockResolvedValue([
      { id: 'p-1', sourceMetadata: { outcomes: { confirmed_resident: 'X', closed_won: 'Y' } } },
    ]) };
    const mergeFirstWins = jest.fn();
    const res = await recon.reconcileLyfeOutcomes({ fetch, Prospect, mergeFirstWins });
    expect(res.factsWritten).toBe(0);
    expect(mergeFirstWins).not.toHaveBeenCalled();

    delete process.env.LYFE_SUPABASE_URL;
    expect(await recon.reconcileLyfeOutcomes({ fetch, Prospect, mergeFirstWins })).toEqual({ ran: false, reason: 'guarded' });
  });
});
