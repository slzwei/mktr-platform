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

describe('factScreen', () => {
  it('terminally screens call_bot and expired click windows; erased is non-terminal (guards block writes)', () => {
    expect(svc.factScreen(prospectFx({ leadSource: 'call_bot' }), { now: nowAt(T0) })).toEqual({ ok: false, reason: 'call_bot', terminal: true });
    expect(svc.factScreen(prospectFx({ sourceMetadata: { erased: true } }), { now: nowAt(T0) })).toEqual({ ok: false, reason: 'erased', terminal: false });
    expect(svc.factScreen(prospectFx(), { now: nowAt(T0) })).toEqual({ ok: true });
  });

  it('age-guards from the CLICK capture (or signup for click-less rows) and a FUTURE anchor cannot extend the window', () => {
    const oldClick = prospectFx({ sourceMetadata: { gcl: { gclid: 'g', capturedAt: new Date(T0 - 61 * 24 * 60 * 60 * 1000).toISOString() } } });
    expect(svc.factScreen(oldClick, { now: nowAt(T0) })).toEqual({ ok: false, reason: 'age_window_expired', terminal: true });
    const futureForged = prospectFx({
      createdAt: new Date(T0 - 61 * 24 * 60 * 60 * 1000).toISOString(),
      sourceMetadata: { gcl: { gclid: 'g', capturedAt: new Date(T0 + 90 * 24 * 60 * 60 * 1000).toISOString() } },
    });
    // clamped to now → within window is TRUE only because the click anchor is
    // clamped, not extended — a future stamp cannot push eligibility out
    expect(svc.factScreen(futureForged, { now: nowAt(T0) })).toEqual({ ok: true });
    const piiOnlyOld = prospectFx({ sourceMetadata: {}, createdAt: new Date(T0 - 61 * 24 * 60 * 60 * 1000).toISOString() });
    expect(svc.factScreen(piiOnlyOld, { now: nowAt(T0) })).toEqual({ ok: false, reason: 'age_window_expired', terminal: true });
  });

  it('Meta-Lead-Ads-origin rows are NOT skipped (upload-all guidance)', () => {
    const metaLead = prospectFx({ sourceMetadata: { metaLeadgenId: 'ml-1', gcl: { gclid: 'g', capturedAt: new Date(T0 - 1000).toISOString() } } });
    expect(svc.factScreen(metaLead, { now: nowAt(T0) })).toEqual({ ok: true });
  });
});

describe('buildOutcomeEnvelope', () => {
  it('pins the consented envelope: OTHER, RFC3339, transactionId, ALL identifiers, HEX + consent WITH userData', () => {
    const env = svc.buildOutcomeEnvelope(
      prospectFx(),
      'confirmed_resident',
      '2026-08-18T01:02:03.000Z',
      {
        adIdentifiers: { gclid: 'g1', gbraid: 'b1', wbraid: 'w1' },
        userIdentifiers: [{ emailAddress: sha('jane@mktr.sg') }, { phoneNumber: sha('+6591234567') }],
      }
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
    const env = svc.buildOutcomeEnvelope(prospectFx(), 'closed_won', '2026-08-18T01:02:03.000Z', {
      adIdentifiers: { gclid: 'g1' },
      userIdentifiers: [],
    });
    expect(env.events[0].userData).toBeUndefined();
    expect(env.encoding).toBeUndefined();
    expect(env.consent).toBeUndefined();
    expect(env.events[0].adIdentifiers).toEqual({ gclid: 'g1' });
    expect(env.events[0].conversionValue).toBe(500);
    expect(env.destinations[0].productDestinationId).toBe('act-cw');
  });
});

describe('dispatchOutcome (claim-flow)', () => {
  function freshDeps(row, over = {}) {
    return {
      Prospect: { findByPk: jest.fn().mockResolvedValue(row) },
      setPath: jest.fn().mockResolvedValue(1),
      dmRequest: jest.fn().mockResolvedValue({ requestId: 'req-1' }),
      canMarketTo: consentMocks.canMarketTo,
      now: nowAt(T0),
      randomUUID: () => 'claim-1',
      ...over,
    };
  }
  function rowWithFact(overrides = {}) {
    const base = prospectFx(overrides);
    base.sourceMetadata = { ...base.sourceMetadata, outcomes: { confirmed_resident: '2026-08-18T01:00:00.000Z' }, ...(overrides.sourceMetadata || {}) };
    return base;
  }

  it('claims (CAS absent), sends, and CASes pending against the claim token', async () => {
    const d = freshDeps(rowWithFact());
    const res = await svc.dispatchOutcome('p-1', 'confirmed_resident', d);
    expect(res).toEqual({ sent: true, requestId: 'req-1' });
    const claim = d.setPath.mock.calls[0];
    expect(claim[2]).toMatchObject({ state: 'sending', claimToken: 'claim-1', retryCount: 0 });
    expect(claim[3].cas).toEqual({ path: ['gads', 'confirmed_resident'], absent: true });
    const pending = d.setPath.mock.calls[1];
    expect(pending[2]).toMatchObject({ state: 'pending', requestId: 'req-1', retryCount: 0 });
    expect(Date.parse(pending[2].nextPollAt) - T0).toBe(30 * 60_000);
    expect(pending[3].cas).toEqual({ path: ['gads', 'confirmed_resident'], contains: { state: 'sending', claimToken: 'claim-1' } });
  });

  it('a lost claim walks away without sending (worker/inline race)', async () => {
    const d = freshDeps(rowWithFact(), { setPath: jest.fn().mockResolvedValue(0) });
    const res = await svc.dispatchOutcome('p-1', 'confirmed_resident', d);
    expect(res).toEqual({ sent: false, reason: 'claim_lost' });
    expect(d.dmRequest).not.toHaveBeenCalled();
  });

  it('claims a DUE retryWait with its retryCount and refuses one that is not due', async () => {
    const due = rowWithFact({ sourceMetadata: { gads: { confirmed_resident: { state: 'retryWait', retryCount: 2, nextSendAt: new Date(T0 - 1000).toISOString() } } } });
    const d = freshDeps(due);
    const res = await svc.dispatchOutcome('p-1', 'confirmed_resident', d);
    expect(res.sent).toBe(true);
    expect(d.setPath.mock.calls[0][3].cas).toEqual({
      path: ['gads', 'confirmed_resident'],
      contains: { state: 'retryWait', retryCount: 2 },
    });
    expect(d.setPath.mock.calls[1][2].retryCount).toBe(2); // rides through pending

    const notDue = rowWithFact({ sourceMetadata: { gads: { confirmed_resident: { state: 'retryWait', retryCount: 1, nextSendAt: new Date(T0 + 60_000).toISOString() } } } });
    const d2 = freshDeps(notDue);
    expect(await svc.dispatchOutcome('p-1', 'confirmed_resident', d2)).toEqual({ sent: false, reason: 'not_due' });
  });

  it('existing pending/delivered markers are never re-dispatched; missing fact/row abort', async () => {
    const pendingRow = rowWithFact({ sourceMetadata: { gads: { confirmed_resident: { state: 'pending', requestId: 'r' } } } });
    expect(await svc.dispatchOutcome('p-1', 'confirmed_resident', freshDeps(pendingRow))).toEqual({ sent: false, reason: 'marker_present' });
    expect(await svc.dispatchOutcome('p-1', 'confirmed_resident', freshDeps(prospectFx()))).toEqual({ sent: false, reason: 'no_fact' });
    expect(await svc.dispatchOutcome('p-1', 'confirmed_resident', freshDeps(null))).toEqual({ sent: false, reason: 'missing_row' });
  });

  it('erased rows never send and never get a marker written', async () => {
    const erased = rowWithFact({ sourceMetadata: { erased: true } });
    const d = freshDeps(erased);
    const res = await svc.dispatchOutcome('p-1', 'confirmed_resident', d);
    expect(res).toEqual({ sent: false, reason: 'erased' });
    expect(d.dmRequest).not.toHaveBeenCalled();
    expect(d.setPath).not.toHaveBeenCalled();
  });

  it('terminal screens write skippedPermanent THROUGH the claim CAS', async () => {
    const bot = rowWithFact({ leadSource: 'call_bot' });
    const d = freshDeps(bot);
    const res = await svc.dispatchOutcome('p-1', 'confirmed_resident', d);
    expect(res.reason).toBe('call_bot');
    expect(d.dmRequest).not.toHaveBeenCalled();
    expect(d.setPath.mock.calls[0][2]).toMatchObject({ state: 'skippedPermanent', reason: 'call_bot' });
    expect(d.setPath.mock.calls[0][3].cas).toEqual({ path: ['gads', 'confirmed_resident'], absent: true });
  });

  it('retry cap is enforced BEFORE dispatch', async () => {
    const capped = rowWithFact({ sourceMetadata: { gads: { confirmed_resident: { state: 'retryWait', retryCount: 5, nextSendAt: new Date(T0 - 1000).toISOString() } } } });
    const d = freshDeps(capped);
    const res = await svc.dispatchOutcome('p-1', 'confirmed_resident', d);
    expect(res.reason).toBe('retry_cap');
    expect(d.dmRequest).not.toHaveBeenCalled();
    expect(d.setPath.mock.calls[0][2]).toMatchObject({ state: 'failedPermanent', reason: 'retry_cap' });
  });

  it('identifier decision is POST-ledger: PII-only + ledger outage → retryWait; PII-only + denial → skippedPermanent; click-only sends without consent block', async () => {
    const piiOnly = rowWithFact({ sourceMetadata: { outcomes: { confirmed_resident: 'X' } } });
    piiOnly.sourceMetadata.gcl = undefined;
    consentMocks.canMarketTo.mockRejectedValueOnce(new Error('ledger down'));
    const d = freshDeps(piiOnly);
    const outage = await svc.dispatchOutcome('p-1', 'confirmed_resident', d);
    expect(outage.reason).toBe('ledger_outage');
    expect(d.setPath.mock.calls[1][2]).toMatchObject({ state: 'retryWait', retryCount: 1, lastReason: 'ledger_outage' });
    expect(d.dmRequest).not.toHaveBeenCalled();

    consentMocks.canMarketTo.mockResolvedValueOnce(false);
    const d2 = freshDeps(structuredClone(piiOnly));
    const denied = await svc.dispatchOutcome('p-1', 'confirmed_resident', d2);
    expect(denied.reason).toBe('no_identifier');
    expect(d2.setPath.mock.calls[1][2]).toMatchObject({ state: 'skippedPermanent', reason: 'no_identifier' });
    expect(d2.dmRequest).not.toHaveBeenCalled();

    consentMocks.canMarketTo.mockRejectedValueOnce(new Error('ledger down'));
    const clickOnly = freshDeps(rowWithFact());
    const sent = await svc.dispatchOutcome('p-1', 'confirmed_resident', clickOnly);
    expect(sent.sent).toBe(true);
    const envelope = clickOnly.dmRequest.mock.calls[0][1];
    expect(envelope.events[0].userData).toBeUndefined();
    expect(envelope.consent).toBeUndefined();
    expect(envelope.events[0].adIdentifiers.gclid).toBe('g1');
  });

  it('missing requestId / transient / 4xx transitions all CAS against the claim', async () => {
    const d = freshDeps(rowWithFact(), { dmRequest: jest.fn().mockResolvedValue({}) });
    const noId = await svc.dispatchOutcome('p-1', 'confirmed_resident', d);
    expect(noId.reason).toBe('missing_request_id');
    expect(d.setPath.mock.calls[1][2]).toMatchObject({ state: 'retryWait', retryCount: 1 });
    expect(d.setPath.mock.calls[1][3].cas.contains).toEqual({ state: 'sending', claimToken: 'claim-1' });

    const d2 = freshDeps(rowWithFact(), { dmRequest: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { status: 400 })) });
    const perm = await svc.dispatchOutcome('p-1', 'confirmed_resident', d2);
    expect(perm.reason).toBe('permanent');
    expect(d2.setPath.mock.calls[1][2]).toMatchObject({ state: 'failedPermanent', reason: 'http_400' });

    const d3 = freshDeps(rowWithFact(), { dmRequest: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { status: 503 })) });
    const trans = await svc.dispatchOutcome('p-1', 'confirmed_resident', d3);
    expect(trans.reason).toBe('transient');
    expect(d3.setPath.mock.calls[1][2]).toMatchObject({ state: 'retryWait', retryCount: 1 });
  });

  it('default values survive missing env (plan-contracted S$40/S$500)', async () => {
    delete process.env.GOOGLE_VALUE_QUALIFIED;
    delete process.env.GOOGLE_VALUE_WON;
    expect(svc.valueFor('confirmed_resident')).toBe(40);
    expect(svc.valueFor('closed_won')).toBe(500);
    process.env.GOOGLE_VALUE_QUALIFIED = 'garbage';
    expect(svc.valueFor('confirmed_resident')).toBe(40);
  });
});

describe('classifyStatusBody (M2 reason taxonomy)', () => {
  it('duplicate evidence in errorCounts = delivered even on FAILED/PARTIAL', () => {
    expect(svc.classifyStatusBody({ requestStatusPerDestination: [{ requestStatus: 'FAILED', errorInfo: { errorCounts: [{ reason: 'DUPLICATE_TRANSACTION_ID', count: 1 }] } }] })).toBe('delivered');
    expect(svc.classifyStatusBody({ requestStatus: 'PARTIAL_SUCCESS', errorInfo: { errorCounts: [{ errorReason: 'duplicate' }] } })).toBe('delivered');
  });

  it('permanent validation/consent/age reasons never retry; unexplained failures do', () => {
    expect(svc.classifyStatusBody({ requestStatus: 'FAILED', errorInfo: { errorCounts: [{ reason: 'INVALID_ARGUMENT' }] } })).toBe('permanent');
    expect(svc.classifyStatusBody({ requestStatus: 'FAILED', errorInfo: { errorCounts: [{ reason: 'EVENT_TOO_OLD' }] } })).toBe('permanent');
    expect(svc.classifyStatusBody({ requestStatus: 'FAILED' })).toBe('transient');
    expect(svc.classifyStatusBody({ requestStatus: 'SUCCESS' })).toBe('delivered');
    expect(svc.classifyStatusBody({ requestStatus: 'PROCESSING' })).toBe('processing');
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

  it('resend: dispatches each due row through the claim flow (fresh reload inside)', async () => {
    const sequelize = { query: jest.fn().mockResolvedValueOnce([{ id: 'p-1' }]).mockResolvedValue([]) };
    const row = prospectFx();
    row.sourceMetadata = { ...row.sourceMetadata, outcomes: { confirmed_resident: '2026-08-18T01:00:00.000Z' } };
    const Prospect = { findByPk: jest.fn().mockResolvedValue(row) };
    const setPath = jest.fn().mockResolvedValue(1);
    const dmRequest = jest.fn().mockResolvedValue({ requestId: 'req-1' });
    const res = await svc.resendDueOutcomes({ sequelize, Prospect, setPath, dmRequest, canMarketTo: consentMocks.canMarketTo, now: nowAt(T0), randomUUID: () => 'c' });
    expect(res.sent).toBe(1);
    expect(Prospect.findByPk).toHaveBeenCalledWith('p-1', { raw: true });
    expect(sequelize.query.mock.calls[0][0]).toContain("-> 'outcomes'");
  });

  it('settle: delivered/permanent/transient via the taxonomy, all CAS on the exact pending marker', async () => {
    const marker = { state: 'pending', requestId: 'req-1', retryCount: 0, sentAt: new Date(T0 - 40 * 60_000).toISOString(), nextPollAt: new Date(T0 - 60_000).toISOString() };
    const mk = () => ({ query: jest.fn().mockResolvedValueOnce([{ id: 'p-1', marker }]).mockResolvedValue([]) });

    const set1 = jest.fn().mockResolvedValue(1);
    const ok = await svc.settleDueOutcomes({ sequelize: mk(), setPath: set1, dmRequestGet: jest.fn().mockResolvedValue({ requestStatus: 'SUCCESS' }), now: nowAt(T0) });
    expect(ok.delivered).toBe(1);
    expect(set1.mock.calls[0][3].cas).toEqual({ path: ['gads', 'confirmed_resident'], contains: { state: 'pending', requestId: 'req-1' } });

    const set2 = jest.fn().mockResolvedValue(1);
    const rejected = await svc.settleDueOutcomes({ sequelize: mk(), setPath: set2, dmRequestGet: jest.fn().mockResolvedValue({ requestStatus: 'FAILED', errorInfo: { errorCounts: [{ reason: 'INVALID_ARGUMENT' }] } }), now: nowAt(T0) });
    expect(rejected.failedPermanent).toBe(1);
    expect(set2.mock.calls[0][2]).toMatchObject({ state: 'failedPermanent', reason: 'ingest_rejected' });

    const set3 = jest.fn().mockResolvedValue(1);
    const transient = await svc.settleDueOutcomes({ sequelize: mk(), setPath: set3, dmRequestGet: jest.fn().mockResolvedValue({ requestStatus: 'FAILED' }), now: nowAt(T0) });
    expect(transient.retried).toBe(1);
    expect(set3.mock.calls[0][2]).toMatchObject({ state: 'retryWait', retryCount: 1, lastReason: 'ingest_failed' });

    const set4 = jest.fn().mockResolvedValue(1);
    const processing = await svc.settleDueOutcomes({ sequelize: mk(), setPath: set4, dmRequestGet: jest.fn().mockResolvedValue({ requestStatus: 'PROCESSING' }), now: nowAt(T0) });
    expect(processing.stillPending).toBe(1);
    expect(Date.parse(set4.mock.calls[0][2].nextPollAt)).toBeGreaterThan(T0);
  });

  it('settle: duplicate evidence (body OR thrown) = delivered; pending past the horizon fails permanently', async () => {
    const marker = { state: 'pending', requestId: 'req-1', retryCount: 0, sentAt: new Date(T0 - 8 * 24 * 60 * 60_000).toISOString(), nextPollAt: new Date(T0 - 60_000).toISOString() };
    const mk = () => ({ query: jest.fn().mockResolvedValueOnce([{ id: 'p-1', marker }]).mockResolvedValue([]) });

    const set1 = jest.fn().mockResolvedValue(1);
    const viaBody = await svc.settleDueOutcomes({ sequelize: mk(), setPath: set1, dmRequestGet: jest.fn().mockResolvedValue({ requestStatus: 'FAILED', errorInfo: { errorCounts: [{ reason: 'duplicate_transaction' }] } }), now: nowAt(T0) });
    expect(viaBody.delivered).toBe(1);

    const set2 = jest.fn().mockResolvedValue(1);
    const viaThrow = await svc.settleDueOutcomes({ sequelize: mk(), setPath: set2, dmRequestGet: jest.fn().mockRejectedValue(new Error('HTTP 409 duplicate transaction id')), now: nowAt(T0) });
    expect(viaThrow.delivered).toBe(1);

    const set3 = jest.fn().mockResolvedValue(1);
    const timedOut = await svc.settleDueOutcomes({ sequelize: mk(), setPath: set3, dmRequestGet: jest.fn().mockResolvedValue({ requestStatus: 'PROCESSING' }), now: nowAt(T0) });
    expect(timedOut.failedPermanent).toBe(1);
    expect(set3.mock.calls[0][2]).toMatchObject({ state: 'failedPermanent', reason: 'pending_timeout' });
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
