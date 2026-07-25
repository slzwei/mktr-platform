/**
 * leadProfileService (DI seam — no DB) + the ?include=profile boundary on
 * prospectService.getProspect. Covers: the read-time reward diagnostic's
 * issueForProspect-parity order, receipt DISTINCT-ON mapping, the allowlisted
 * session projection over duplicate visit rows, Lyfe-delivery reason mapping,
 * journey enrichment (scoped consent, drawLinked, _rawSignups hygiene), and
 * that non-admins / non-opted callers get the classic payload untouched.
 * docs/plans/admin-lead-profile-page.md §4-§5.
 */
import { jest } from '@jest/globals';
import { makeLeadProfileService } from '../src/services/leadProfileService.js';
import { makeProspectService } from '../src/services/prospectService.js';
import { presentState } from '../src/utils/entitlementPresentState.js';
import { SCREENING_REASONS } from '../src/services/screeningConstants.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const NOW = new Date('2026-07-25T04:00:00Z');
const FUTURE = new Date('2026-08-25T04:00:00Z');
const PAST = new Date('2026-07-01T04:00:00Z');

// ── presentState (the shared status → UI-state mapper) ──────────────────────

describe('presentState', () => {
  it('maps the lifecycle with expiry override', () => {
    expect(presentState({ status: 'eligible', expiresAt: FUTURE }, NOW)).toBe('reserved');
    expect(presentState({ status: 'eligible', expiresAt: PAST }, NOW)).toBe('expired');
    expect(presentState({ status: 'issued', expiresAt: FUTURE }, NOW)).toBe('unlocked');
    expect(presentState({ status: 'issued', expiresAt: NOW }, NOW)).toBe('expired'); // <= not <
    expect(presentState({ status: 'redeemed', expiresAt: PAST }, NOW)).toBe('redeemed');
    expect(presentState({ status: 'cancelled', expiresAt: null }, NOW)).toBe('cancelled');
  });
});

// ── deriveRewardDiagnostic ──────────────────────────────────────────────────

function diagDeps(overrides = {}) {
  return makeLeadProfileService({
    logger: silentLogger,
    now: () => NOW,
    getProspectDrawStatus: jest.fn().mockResolvedValue(new Map()),
    getConsentState: jest.fn().mockResolvedValue(null),
    Draw: { findAll: jest.fn().mockResolvedValue([]) },
    Activation: { findOne: jest.fn().mockResolvedValue(null) },
    RewardOffer: {},
    RewardEntitlement: { findOne: jest.fn().mockResolvedValue(null), findAll: jest.fn().mockResolvedValue([]) },
    ConsumerSuppression: { findAll: jest.fn().mockResolvedValue([]) },
    EmailBroadcastRecipient: { findAll: jest.fn().mockResolvedValue([]) },
    SessionVisit: { findAll: jest.fn().mockResolvedValue([]) },
    sequelize: { query: jest.fn().mockResolvedValue([[]]), fn: jest.fn(), col: jest.fn() },
    ...overrides,
  });
}

const verifiedProspect = {
  id: 'p1', campaignId: 'camp-1', phone: '+6591234567',
  sourceMetadata: { phoneVerifiedAt: '2026-07-01T00:00:00Z' }, // legacy unbounded stamp is valid here
  quarantinedAt: null, quarantineReason: null,
};

const liveActivation = (over = {}) => ({
  id: 'act-1', campaignId: 'camp-1', status: 'active',
  issuedCount: 3, allocatedQuantity: 10, endDate: null,
  rewardOffer: { id: 'ro-1', status: 'active' },
  ...over,
});

describe('deriveRewardDiagnostic (issueForProspect parity)', () => {
  it('walks the gates in order', async () => {
    const svc = diagDeps();
    expect(await svc.deriveRewardDiagnostic({ ...verifiedProspect, campaignId: null })).toBeNull();
    expect(await svc.deriveRewardDiagnostic({
      ...verifiedProspect, quarantinedAt: NOW, quarantineReason: 'quota_hold',
    })).toBe('quarantined');
    expect(await svc.deriveRewardDiagnostic({
      ...verifiedProspect, sourceMetadata: {},
    })).toBe('phone_not_verified');
    expect(await svc.deriveRewardDiagnostic(verifiedProspect)).toBe('no_active_activation');
  });

  it('screening holds are reward-eligible (the AI gate withholds delivery, not the reward)', async () => {
    const svc = diagDeps({
      Activation: { findOne: jest.fn().mockResolvedValue(liveActivation()) },
    });
    expect(await svc.deriveRewardDiagnostic({
      ...verifiedProspect, quarantinedAt: NOW, quarantineReason: SCREENING_REASONS[0],
    })).toBe('not_issued_yet');
  });

  it('duplicate phone, paused offer, ended activation, exhausted allocation', async () => {
    const dup = diagDeps({
      Activation: { findOne: jest.fn().mockResolvedValue(liveActivation()) },
      RewardEntitlement: { findOne: jest.fn().mockResolvedValue({ id: 'ent-x' }), findAll: jest.fn() },
    });
    expect(await dup.deriveRewardDiagnostic(verifiedProspect)).toBe('duplicate_phone');

    const paused = diagDeps({
      Activation: { findOne: jest.fn().mockResolvedValue(liveActivation({ rewardOffer: { status: 'paused' } })) },
    });
    expect(await paused.deriveRewardDiagnostic(verifiedProspect)).toBe('offer_not_active');

    const ended = diagDeps({
      Activation: { findOne: jest.fn().mockResolvedValue(liveActivation({ endDate: PAST })) },
    });
    expect(await ended.deriveRewardDiagnostic(verifiedProspect)).toBe('activation_ended');

    const exhausted = diagDeps({
      Activation: { findOne: jest.fn().mockResolvedValue(liveActivation({ issuedCount: 10 })) },
    });
    expect(await exhausted.deriveRewardDiagnostic(verifiedProspect)).toBe('allocation_exhausted');
  });
});

// ── session context (allowlist + duplicate rows) ────────────────────────────

describe('getSessionContext', () => {
  it('aggregates duplicate visit rows and allowlists steps', async () => {
    const events = Array.from({ length: 30 }, (_, i) => ({
      type: `step_${i}`, ts: '2026-07-20T00:00:00Z',
      meta: { path: '/lead-capture', fbc: 'SECRET', nested: { junk: true } },
    }));
    const svc = diagDeps({
      SessionVisit: {
        findAll: jest.fn().mockResolvedValue([
          {
            startedAt: PAST, landingPath: '/c/tokyo', utmSource: 'fb', utmMedium: 'cpc',
            utmCampaign: 'aug', utmTerm: 't', utmContent: 'c',
            eventsJson: [...events, { notype: true }, { type: 42 }],
          },
          { startedAt: NOW, landingPath: '/other', eventsJson: events }, // race-duplicate row
        ]),
      },
    });
    const ctx = await svc.getSessionContext('sess-1');
    expect(ctx.landingPath).toBe('/c/tokyo'); // earliest row wins
    expect(ctx.utm).toEqual({ source: 'fb', medium: 'cpc', campaign: 'aug', term: 't', content: 'c' });
    expect(ctx.visitCount).toBe(2);
    expect(ctx.steps.length).toBe(50); // 60 valid events capped
    expect(ctx.stepsTruncated).toBe(true);
    // Allowlist: type/at/path only — beacon meta never reflected into admin UI.
    expect(Object.keys(ctx.steps[0]).sort()).toEqual(['at', 'path', 'type']);
    expect(JSON.stringify(ctx)).not.toContain('SECRET');
  });

  it('returns null for missing session or no rows', async () => {
    const svc = diagDeps();
    expect(await svc.getSessionContext(null)).toBeNull();
    expect(await svc.getSessionContext('sess-x')).toBeNull();
  });
});

// ── Lyfe delivery ───────────────────────────────────────────────────────────

describe('getLyfeDelivery', () => {
  it('maps receiver codes to operator-safe reasons', async () => {
    const svc = diagDeps({
      sequelize: {
        query: jest.fn().mockResolvedValue([[
          { eventType: 'lead.created', status: 'failed', attempts: 3, lastAttemptAt: NOW, responseCode: 422, createdAt: PAST },
          { eventType: 'lead.assigned', status: 'success', attempts: 1, lastAttemptAt: NOW, responseCode: 200, createdAt: NOW },
        ]]),
        fn: jest.fn(), col: jest.fn(),
      },
    });
    const rows = await svc.getLyfeDelivery('p1');
    expect(rows[0]).toMatchObject({ eventType: 'lead.created', status: 'failed', reason: 'agent_not_found' });
    expect(rows[1]).toMatchObject({ status: 'success', reason: null });
  });

  it('returns null when nothing was ever queued (System-Agent default-deny)', async () => {
    const svc = diagDeps();
    expect(await svc.getLyfeDelivery('p1')).toBeNull();
  });
});

// ── journey enrichment ──────────────────────────────────────────────────────

describe('enrichJourneyProfile', () => {
  function journeyFixture() {
    return {
      consumer: { id: 'con-1', erasedAt: null },
      signups: [
        { prospectId: 'p1', campaign: { id: 'camp-1', name: 'Tokyo Draw' } },
        { prospectId: 'p2', campaign: { id: 'camp-2', name: 'NTUC Trial' } },
      ],
      entitlements: [{
        id: 'ent-1', status: 'issued', campaignId: 'camp-1',
        expiresAt: FUTURE, createdAt: PAST, unlockedAt: PAST,
      }],
      drawEntries: 1,
      _rawSignups: [
        { id: 'p1', campaignId: 'camp-1', phone: '+6591234567', sourceMetadata: {}, consentMetadata: {} },
        // Verified (legacy unbounded stamp) so the diagnostic walks PAST the
        // phone gate and reaches the activation lookup.
        { id: 'p2', campaignId: 'camp-2', phone: '+6591234567', sourceMetadata: { phoneVerifiedAt: '2026-07-01T00:00:00Z' }, consentMetadata: {} },
      ],
    };
  }

  function enrichDeps() {
    const drawBlock = { state: 'provisional_in', chances: 10, drawId: 'd1' };
    return {
      drawBlock,
      svc: makeLeadProfileService({
        logger: silentLogger,
        now: () => NOW,
        getProspectDrawStatus: jest.fn().mockResolvedValue(new Map([['p1', drawBlock], ['p2', null]])),
        getConsentState: jest.fn().mockImplementation(async (_cid, { campaignId }) => ({
          contact: { granted: campaignId === 'camp-1', scope: 'campaign' },
          suppressions: [{ channel: 'email', reason: 'unsubscribed' }],
        })),
        Draw: { findAll: jest.fn().mockResolvedValue([{ activationId: 'act-9' }]) },
        Activation: { findOne: jest.fn().mockResolvedValue(null) },
        RewardOffer: {},
        RewardEntitlement: {
          findOne: jest.fn().mockResolvedValue(null),
          findAll: jest.fn().mockResolvedValue([
            { id: 'ent-1', status: 'issued', expiresAt: FUTURE, unlockedVia: 'agent_scan', tokenHint: '1234', activationId: 'act-9' },
          ]),
        },
        ConsumerSuppression: {
          findAll: jest.fn().mockResolvedValue([{ channel: 'email', reason: 'unsubscribed' }]),
        },
        EmailBroadcastRecipient: {
          findAll: jest.fn()
            .mockResolvedValueOnce([{
              broadcastId: 'b1', broadcast: { subject: 'Aug promo' },
              status: 'skipped', reason: 'suppressed', sentAt: null, createdAt: NOW,
            }])
            .mockResolvedValueOnce([{ status: 'skipped', n: '1' }]),
        },
        SessionVisit: { findAll: jest.fn().mockResolvedValue([]) },
        sequelize: {
          query: jest.fn().mockResolvedValue([[
            { entitlementId: 'ent-1', type: 'notified', channel: 'whatsapp', kind: 'voucher', createdAt: NOW },
          ]]),
          fn: jest.fn(), col: jest.fn(),
        },
      }),
    };
  }

  it('attaches draw, scoped consent, diagnostics, receipts — and strips _rawSignups', async () => {
    const { svc, drawBlock } = enrichDeps();
    const journey = await svc.enrichJourneyProfile(journeyFixture());

    expect(journey._rawSignups).toBeUndefined();
    expect(journey.signups[0].draw).toBe(drawBlock);
    expect(journey.signups[1].draw).toBeNull();

    // Consent is campaign-scoped and stripped of the suppressions key.
    expect(journey.signups[0].consent.contact.granted).toBe(true);
    expect(journey.signups[1].consent.contact.granted).toBe(false);
    expect(journey.signups[0].consent.suppressions).toBeUndefined();

    // Diagnostic ONLY where the campaign has no entitlement.
    expect(journey.signups[0].rewardDiagnostic).toBeNull();
    expect(journey.signups[1].rewardDiagnostic).toBe('no_active_activation');

    // Entitlement extras: presentation state, draw voice, receipts.
    expect(journey.entitlements[0]).toMatchObject({
      state: 'unlocked', unlockedVia: 'agent_scan', tokenHint: '1234', drawLinked: true,
    });
    expect(journey.entitlements[0].delivery.whatsapp).toMatchObject({ ok: true, kind: 'voucher' });
    expect(journey.entitlements[0].delivery.email).toBeNull();

    expect(journey.suppressions).toEqual([{ channel: 'email', reason: 'unsubscribed' }]);
    expect(journey.broadcasts.recent[0]).toMatchObject({ subject: 'Aug promo', status: 'skipped', reason: 'suppressed' });
    expect(journey.broadcasts.counts).toEqual({ skipped: 1 });
  });

  it('erased people get no reward diagnostics (their state is the erasure)', async () => {
    const { svc } = enrichDeps();
    const journey = journeyFixture();
    journey.consumer.erasedAt = NOW;
    const out = await svc.enrichJourneyProfile(journey);
    expect(out.signups[1].rewardDiagnostic).toBeNull();
  });
});

// ── getProspectOutcomes (the list's STATUS column raw material) ─────────────

describe('getProspectOutcomes', () => {
  const listRows = [
    { id: 'p1', campaignId: 'camp-1' },
    { id: 'p2', campaignId: 'camp-2' },
    { id: 'p3', campaignId: 'camp-2' },
  ];

  function outcomeDeps() {
    return makeLeadProfileService({
      logger: silentLogger,
      now: () => NOW,
      getProspectDrawStatus: jest.fn().mockResolvedValue(new Map([
        ['p1', { state: 'provisional_in', chances: 10, boosted: true, multiplier: 10, drawHistory: [{ drawId: 'old' }] }],
      ])),
      getConsentState: jest.fn(),
      Draw: { findAll: jest.fn().mockResolvedValue([{ activationId: 'rail-1' }]) },
      Activation: { findOne: jest.fn() },
      RewardOffer: {},
      RewardEntitlement: {
        findOne: jest.fn(),
        findAll: jest.fn().mockResolvedValue([
          // Newest first (DESC): p2's newest is a DRAW PASS (rail-1) — skipped;
          // its older voucher wins. p3 has only a voucher.
          { id: 'e3', prospectId: 'p2', status: 'issued', expiresAt: FUTURE, activationId: 'rail-1', createdAt: NOW, rewardOffer: null },
          { id: 'e2', prospectId: 'p2', status: 'redeemed', expiresAt: null, activationId: 'act-v', createdAt: PAST, rewardOffer: { title: 'Latte', publicTitle: '1-for-1 latte' } },
          { id: 'e1', prospectId: 'p3', status: 'eligible', expiresAt: FUTURE, activationId: 'act-v', createdAt: PAST, rewardOffer: { title: 'Latte', publicTitle: null } },
        ]),
      },
      ConsumerSuppression: { findAll: jest.fn() },
      EmailBroadcastRecipient: { findAll: jest.fn() },
      SessionVisit: { findAll: jest.fn() },
      sequelize: { query: jest.fn(), fn: jest.fn(), col: jest.fn() },
    });
  }

  it('attaches draw standing (history-trimmed) and the newest non-draw-linked reward', async () => {
    const svc = outcomeDeps();
    const map = await svc.getProspectOutcomes(listRows);

    // Draw lead: block passed through minus drawHistory.
    expect(map.get('p1').draw).toMatchObject({ state: 'provisional_in', chances: 10, boosted: true });
    expect(map.get('p1').draw.drawHistory).toBeUndefined();
    expect(map.get('p1').reward).toBeNull();

    // p2: the newer entitlement is a draw pass (rail activation) — the older
    // VOUCHER speaks: redeemed, public title preferred.
    expect(map.get('p2').reward).toEqual({ state: 'redeemed', rewardTitle: '1-for-1 latte' });
    expect(map.get('p2').draw).toBeNull();

    // p3: eligible + future expiry → presentState 'reserved'; title falls back.
    expect(map.get('p3').reward).toEqual({ state: 'reserved', rewardTitle: 'Latte' });
  });

  it('returns an empty map for an empty page', async () => {
    const svc = outcomeDeps();
    expect((await svc.getProspectOutcomes([])).size).toBe(0);
  });
});

// ── the ?include=outcome boundary on listProspects ──────────────────────────

describe('prospectService.listProspects include gating', () => {
  function listService() {
    const getProspectOutcomes = jest.fn().mockResolvedValue(new Map([
      ['p1', { draw: { state: 'provisional_in' }, reward: null }],
    ]));
    const row = () => {
      const data = {};
      return { id: 'p1', phone: '+6591234567', email: null, setDataValue: jest.fn((k, v) => { data[k] = v; }), _set: data };
    };
    const findAndCountAll = jest.fn();
    const svc = makeProspectService({
      getProspectOutcomes,
      buildProspectWhere: jest.fn().mockResolvedValue({}),
      sequelize: { query: jest.fn().mockResolvedValue([[]]) },
      models: { Prospect: { findAndCountAll } },
    });
    return { svc, getProspectOutcomes, findAndCountAll, row };
  }

  it('non-admins never reach the enrichment, whatever they send', async () => {
    const { svc, getProspectOutcomes, findAndCountAll, row } = listService();
    findAndCountAll.mockResolvedValue({ count: 1, rows: [row()] });
    await svc.listProspects({ id: 'agent-1', role: 'agent' }, { include: 'outcome' });
    expect(getProspectOutcomes).not.toHaveBeenCalled();
  });

  it('admin WITHOUT include gets the classic payload', async () => {
    const { svc, getProspectOutcomes, findAndCountAll, row } = listService();
    findAndCountAll.mockResolvedValue({ count: 1, rows: [row()] });
    await svc.listProspects({ id: 'admin-1', role: 'admin' }, {});
    expect(getProspectOutcomes).not.toHaveBeenCalled();
  });

  it('admin + include=outcome attaches draw/reward per row', async () => {
    const { svc, getProspectOutcomes, findAndCountAll, row } = listService();
    const r = row();
    findAndCountAll.mockResolvedValue({ count: 1, rows: [r] });
    await svc.listProspects({ id: 'admin-1', role: 'admin' }, { include: 'outcome' });
    expect(getProspectOutcomes).toHaveBeenCalled();
    expect(r._set.draw).toEqual({ state: 'provisional_in' });
    expect(r._set.reward).toBeNull();
  });
});

// ── the ?include=profile boundary on getProspect ────────────────────────────

describe('prospectService.getProspect include gating', () => {
  function gatedService() {
    const calls = {
      getConsumerJourney: jest.fn().mockResolvedValue({ consumer: { id: 'con-1' }, signups: [], entitlements: [], drawEntries: 0 }),
      enrichJourneyProfile: jest.fn().mockImplementation(async (j) => ({ ...j, enriched: true })),
      getSessionContext: jest.fn().mockResolvedValue({ landingPath: '/x' }),
      getLyfeDelivery: jest.fn().mockResolvedValue([{ eventType: 'lead.created' }]),
      getSignupProfile: jest.fn().mockResolvedValue({ draw: null, entitlements: [], rewardDiagnostic: null }),
    };
    const prospectRow = (consumerId) => {
      const data = {};
      return {
        id: 'p1', phone: '+6591234567', email: null, consumerId, sessionId: 'sess-1', activities: [],
        setDataValue: jest.fn().mockImplementation((k, v) => { data[k] = v; }),
        _set: data,
      };
    };
    const findOne = jest.fn();
    const svc = makeProspectService({
      ...calls,
      buildProspectWhere: jest.fn().mockResolvedValue({}),
      sequelize: { query: jest.fn().mockResolvedValue([[]]) },
      models: { Prospect: { findOne } },
    });
    return { svc, calls, findOne, prospectRow };
  }

  it('non-admins never reach any profile enrichment, whatever they send', async () => {
    const { svc, calls, findOne, prospectRow } = gatedService();
    findOne.mockResolvedValue(prospectRow('con-1'));
    await svc.getProspect('p1', { id: 'agent-1', role: 'agent' }, { include: 'profile' });
    expect(calls.getConsumerJourney).not.toHaveBeenCalled();
    expect(calls.getSessionContext).not.toHaveBeenCalled();
    expect(calls.getLyfeDelivery).not.toHaveBeenCalled();
    // The externalAgent include must not appear either (classic payload).
    const include = findOne.mock.calls[0][0].include;
    expect(include.some((i) => i.association === 'externalAgent')).toBe(false);
  });

  it('admin WITHOUT include gets the classic journey — no raw rows, no extras', async () => {
    const { svc, calls, findOne, prospectRow } = gatedService();
    findOne.mockResolvedValue(prospectRow('con-1'));
    await svc.getProspect('p1', { id: 'admin-1', role: 'admin' }, {});
    expect(calls.getConsumerJourney).toHaveBeenCalledWith('con-1', undefined);
    expect(calls.enrichJourneyProfile).not.toHaveBeenCalled();
    expect(calls.getSessionContext).not.toHaveBeenCalled();
    expect(calls.getLyfeDelivery).not.toHaveBeenCalled();
    expect(calls.getSignupProfile).not.toHaveBeenCalled();
  });

  it('admin + include=profile enriches the journey and attaches the extras', async () => {
    const { svc, calls, findOne, prospectRow } = gatedService();
    const row = prospectRow('con-1');
    findOne.mockResolvedValue(row);
    await svc.getProspect('p1', { id: 'admin-1', role: 'admin' }, { include: 'profile' });
    expect(calls.getConsumerJourney).toHaveBeenCalledWith('con-1', { includeRaw: true });
    expect(calls.enrichJourneyProfile).toHaveBeenCalled();
    expect(row._set.consumer).toMatchObject({ enriched: true });
    expect(row._set.session).toEqual({ landingPath: '/x' });
    expect(row._set.lyfeDelivery).toEqual([{ eventType: 'lead.created' }]);
    expect(calls.getSignupProfile).not.toHaveBeenCalled(); // consumer exists
    const include = findOne.mock.calls[0][0].include;
    expect(include.some((i) => i.association === 'externalAgent')).toBe(true);
  });

  it('admin + include=profile on a consumer-less lead falls back to signupProfile (B4)', async () => {
    const { svc, calls, findOne, prospectRow } = gatedService();
    const row = prospectRow(null);
    findOne.mockResolvedValue(row);
    await svc.getProspect('p1', { id: 'admin-1', role: 'admin' }, { include: 'profile' });
    expect(calls.getConsumerJourney).not.toHaveBeenCalled();
    expect(calls.getSignupProfile).toHaveBeenCalled();
    expect(row._set.signupProfile).toEqual({ draw: null, entitlements: [], rewardDiagnostic: null });
  });
});
