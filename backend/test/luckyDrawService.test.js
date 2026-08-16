/**
 * Lucky-draw lifecycle (luckyDrawService, DI seam — no DB):
 * pool filters at freeze, boost math + review gating at seal, commit/reveal
 * determinism of the pick, redraw exclusions, outcome transitions, and
 * verifyDraw's tamper detection. docs/plans/lucky-draw-10x.md §4.2–§4.3.
 */
import crypto from 'crypto';
import { jest } from '@jest/globals';
import {
  makeLuckyDrawService, pickWinner, computePoolHash, computeEligibleHash,
} from '../src/services/luckyDrawService.js';
import { sgtDayEndExclusiveMs } from '../src/utils/sgtTime.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const CAMPAIGN_ID = 'camp-1';
const DRAW_ID = 'draw-1';
const ADMIN = { id: 'admin-1', role: 'admin' };

// Fixed clock: after both cutoffs below.
const NOW = new Date('2026-09-15T04:00:00Z');
const CLOSES_AT = new Date(sgtDayEndExclusiveMs('2026-08-31'));
const BOOST_CLOSES_AT = new Date(sgtDayEndExclusiveMs('2026-09-10'));

function verifiedProspect(id, first, last, phone, createdAt = '2026-08-01T00:00:00Z') {
  return {
    id, firstName: first, lastName: last, phone,
    createdAt: new Date(createdAt),
    sourceMetadata: { phoneVerifiedAt: '2026-08-01T00:00:00Z', phoneVerifiedFor: sha(phone) },
    // PR-2 (CX18): pool membership also requires pinned draw-terms acceptance.
    consentMetadata: { drawTerms: { termsVersionId: 'tv-1', acceptedAt: '2026-08-01T00:00:00Z' } },
  };
}

function entryRow(id, prospectId, phone, chances = 1, boostVia = null) {
  return { id, drawId: DRAW_ID, prospectId, phoneHash: sha(phone), phoneLast4: phone.slice(-4), displayName: 'X', chances, boostVia };
}

function buildDeps({ draw = null, prospects = [], entries = [], attempts = [], reviews = [], entitlements = [], events = [] } = {}) {
  const state = {
    draw: draw && { ...draw },
    entries: entries.map((e) => ({ ...e })),
    attempts: attempts.map((a) => ({ ...a })),
    reviews: reviews.map((r) => ({ ...r })),
  };

  const Draw = {
    findByPk: jest.fn().mockImplementation(async () => (state.draw ? { ...state.draw } : null)),
    create: jest.fn().mockImplementation(async (fields) => {
      state.draw = { id: DRAW_ID, ...fields };
      return { ...state.draw };
    }),
    update: jest.fn().mockImplementation(async (values, { where }) => {
      if (!state.draw || state.draw.id !== where.id) return [0];
      if (where.status !== undefined) {
        const allowed = Array.isArray(where.status?.__in) ? where.status.__in : null;
        // Sequelize Op.in arrives as a symbol-keyed object — emulate both forms.
        if (typeof where.status === 'string') {
          if (state.draw.status !== where.status) return [0];
        } else if (allowed) {
          if (!allowed.includes(state.draw.status)) return [0];
        } else {
          const symbolVals = Object.getOwnPropertySymbols(where.status || {}).map((s) => where.status[s]);
          if (symbolVals.length && !symbolVals[0].includes(state.draw.status)) return [0];
        }
      }
      Object.assign(state.draw, values);
      return [1];
    }),
  };

  const DrawEntry = {
    findAll: jest.fn().mockImplementation(async () => state.entries.map((e) => ({ ...e }))),
    bulkCreate: jest.fn().mockImplementation(async (rows) => {
      rows.forEach((r, i) => state.entries.push({ id: `entry-${state.entries.length + i + 1}`, ...r }));
      return rows;
    }),
    update: jest.fn().mockImplementation(async (values, { where }) => {
      const row = state.entries.find((e) => e.id === where.id);
      if (!row) return [0];
      Object.assign(row, values);
      return [1];
    }),
  };

  const DrawAttempt = {
    // Honours the scalar `where` keys the service actually uses (drawId,
    // outcome). A findAll mock that ignored `where` would hand the terminal-state
    // logic every attempt regardless of outcome and quietly pass a broken engine.
    findAll: jest.fn().mockImplementation(async ({ where = {} } = {}) => state.attempts
      .filter((a) => Object.entries(where).every(([k, v]) => (
        typeof v === 'string' || typeof v === 'number' ? a[k] === v : true
      )))
      .map((a) => ({ ...a }))),
    findByPk: jest.fn().mockImplementation(async (id) => {
      const row = state.attempts.find((a) => a.id === id);
      return row ? { ...row } : null;
    }),
    create: jest.fn().mockImplementation(async (fields) => {
      const row = { id: `attempt-${state.attempts.length + 1}`, ...fields };
      state.attempts.push(row);
      return { ...row };
    }),
    update: jest.fn().mockImplementation(async (values, { where }) => {
      const row = state.attempts.find((a) => a.id === where.id);
      if (!row || (where.outcome !== undefined && row.outcome !== where.outcome)) return [0];
      Object.assign(row, values);
      return [1];
    }),
  };

  const DrawBoostReview = {
    findAll: jest.fn().mockImplementation(async () => state.reviews.map((r) => ({ ...r }))),
    create: jest.fn().mockImplementation(async (fields) => {
      if (state.reviews.some((r) => r.entitlementId === fields.entitlementId)) {
        const err = new Error('dup'); err.name = 'SequelizeUniqueConstraintError'; throw err;
      }
      const row = { id: `review-${state.reviews.length + 1}`, ...fields };
      state.reviews.push(row);
      return { ...row };
    }),
  };

  return {
    state,
    deps: {
      Draw, DrawEntry, DrawAttempt, DrawBoostReview,
      Campaign: { findByPk: jest.fn().mockResolvedValue(null) },
      Prospect: { findAll: jest.fn().mockResolvedValue(prospects) },
      Activation: { findByPk: jest.fn().mockResolvedValue(null), findOne: jest.fn().mockResolvedValue(null) },
      // PR-2 (CX18): freeze validates each entrant's pinned terms version
      // against this campaign's version set.
      DrawTermsVersion: { findAll: jest.fn().mockResolvedValue([{ id: 'tv-1' }]) },
      RewardEntitlement: { findAll: jest.fn().mockResolvedValue(entitlements), findByPk: jest.fn().mockResolvedValue({ id: 'ent-x', prospectId: 'pros-x' }) },
      RedemptionEvent: { findAll: jest.fn().mockResolvedValue(events) },
      sequelize: { transaction: jest.fn().mockImplementation(async (cb) => cb({})) },
      logger: silentLogger,
      now: () => NOW,
      mintSeed: () => 'a'.repeat(64),
    },
  };
}

const openDraw = {
  id: DRAW_ID, campaignId: CAMPAIGN_ID, status: 'open',
  closesAt: CLOSES_AT, boostClosesAt: BOOST_CLOSES_AT,
  multiplier: 10, activationId: 'act-1', poolHash: null, notes: null,
};

// ── Pure pick math ──────────────────────────────────────────────────────────

describe('pickWinner / hashes (pure)', () => {
  const entries = [
    { id: 'e1', prospectId: 'p1', phoneHash: 'h1', chances: 1, boostVia: null },
    { id: 'e2', prospectId: 'p2', phoneHash: 'h2', chances: 10, boostVia: 'agent_scan' },
    { id: 'e3', prospectId: 'p3', phoneHash: 'h3', chances: 1, boostVia: null },
  ];

  it('is deterministic for a fixed seed and respects the eligible set', () => {
    const first = pickWinner('seed-1', entries);
    for (let i = 0; i < 5; i += 1) expect(pickWinner('seed-1', entries).id).toBe(first.id);
    expect(entries.map((e) => e.id)).toContain(first.id);
  });

  it('weights by chances (boosted entry wins overwhelmingly over many seeds)', () => {
    let boostedWins = 0;
    for (let i = 0; i < 200; i += 1) {
      if (pickWinner(`seed-${i}`, entries).id === 'e2') boostedWins += 1;
    }
    // e2 holds 10 of 12 chances (~83%); allow wide tolerance.
    expect(boostedWins).toBeGreaterThan(120);
  });

  it('poolHash is order-independent of input array and pins the weights', () => {
    const a = computePoolHash(entries);
    const b = computePoolHash([...entries].reverse());
    expect(a).toBe(b);
    const tampered = computePoolHash(entries.map((e) => (e.id === 'e1' ? { ...e, chances: 5 } : e)));
    expect(tampered).not.toBe(a);
  });
});

// ── createDraw ──────────────────────────────────────────────────────────────

describe('createDraw', () => {
  it('422s without an enabled luckyDraw config', async () => {
    const { deps } = buildDeps();
    deps.Campaign.findByPk.mockResolvedValue({ id: CAMPAIGN_ID, design_config: {} });
    const svc = makeLuckyDrawService(deps);
    await expect(svc.createDraw({ campaignId: CAMPAIGN_ID }, ADMIN)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('422s when the designated activation belongs to another campaign', async () => {
    const { deps } = buildDeps();
    deps.Campaign.findByPk.mockResolvedValue({
      id: CAMPAIGN_ID,
      design_config: { luckyDraw: { enabled: true, closesAt: '2026-08-31', activationId: 'act-9' } },
    });
    deps.Activation.findByPk.mockResolvedValue({ id: 'act-9', campaignId: 'OTHER' });
    const svc = makeLuckyDrawService(deps);
    await expect(svc.createDraw({ campaignId: CAMPAIGN_ID }, ADMIN)).rejects.toMatchObject({ statusCode: 422 });
  });

  // Phase 3: the multi-prize gate is GONE. A structured multi-prize config now
  // mints a draw that snapshots what it awards — Σqty prize units, the prize
  // list verbatim, and the v2 selection algorithm.
  it('snapshots prizes + winnersCount when structured prizes total more than one unit', async () => {
    const { deps } = buildDeps();
    deps.Campaign.findByPk.mockResolvedValue({
      id: CAMPAIGN_ID,
      design_config: {
        luckyDraw: {
          enabled: true,
          closesAt: '2026-08-31',
          activationId: 'act-1',
          prizes: [{ qty: 1, name: 'iPhone 17 Pro' }, { qty: 3, name: '$100 FairPrice Voucher' }],
        },
      },
    });
    deps.Activation.findByPk.mockResolvedValue({ id: 'act-1', campaignId: CAMPAIGN_ID, unlockPolicy: 'agent_unlock' });
    const svc = makeLuckyDrawService(deps);
    await svc.createDraw({ campaignId: CAMPAIGN_ID }, ADMIN);

    expect(deps.Draw.create).toHaveBeenCalledWith(expect.objectContaining({
      winnersCount: 4,
      algorithmVersion: 2,
      prizes: [{ qty: 1, name: 'iPhone 17 Pro' }, { qty: 3, name: '$100 FairPrice Voucher' }],
    }));
  });

  // The one promise the engine still refuses: N winners with no prize rows to
  // expand, which would advertise more winners than the ceremony can award.
  it('422s (DRAW_UNSTRUCTURED_MULTI_WINNER) for a legacy winners:N config with no prizes[]', async () => {
    const { deps } = buildDeps();
    deps.Campaign.findByPk.mockResolvedValue({
      id: CAMPAIGN_ID,
      design_config: {
        luckyDraw: { enabled: true, closesAt: '2026-08-31', prize: 'A pile of things', winners: 5 },
      },
    });
    const svc = makeLuckyDrawService(deps);
    await expect(svc.createDraw({ campaignId: CAMPAIGN_ID }, ADMIN)).rejects.toMatchObject({
      statusCode: 422,
      data: { code: 'DRAW_UNSTRUCTURED_MULTI_WINNER' },
    });
  });

  it('a legacy single-prize config snapshots NULL prizes and exactly one unit', async () => {
    const { deps } = buildDeps();
    deps.Campaign.findByPk.mockResolvedValue({
      id: CAMPAIGN_ID,
      design_config: { luckyDraw: { enabled: true, closesAt: '2026-08-31', activationId: 'act-1', prize: 'One iPhone' } },
    });
    deps.Activation.findByPk.mockResolvedValue({ id: 'act-1', campaignId: CAMPAIGN_ID, unlockPolicy: 'agent_unlock' });
    const svc = makeLuckyDrawService(deps);
    await svc.createDraw({ campaignId: CAMPAIGN_ID }, ADMIN);

    expect(deps.Draw.create).toHaveBeenCalledWith(expect.objectContaining({
      prizes: null,
      winnersCount: 1,
    }));
  });

  it('a single structured prize (one row, qty 1) still creates the draw — stamp-absent resolves the active rail (F3)', async () => {
    const { deps } = buildDeps();
    deps.Campaign.findByPk.mockResolvedValue({
      id: CAMPAIGN_ID,
      design_config: {
        luckyDraw: { enabled: true, closesAt: '2026-08-31', prizes: [{ qty: 1, name: 'iPhone 17 Pro' }] },
      },
    });
    deps.Activation.findOne.mockResolvedValue({ id: 'act-1', campaignId: CAMPAIGN_ID, unlockPolicy: 'agent_unlock' });
    const svc = makeLuckyDrawService(deps);
    const draw = await svc.createDraw({ campaignId: CAMPAIGN_ID }, ADMIN);
    expect(draw.status).toBe('open');
    expect(draw.activationId).toBe('act-1');
  });

  it('derives fixed SGT-exclusive instants and persists config', async () => {
    const { deps } = buildDeps();
    deps.Campaign.findByPk.mockResolvedValue({
      id: CAMPAIGN_ID,
      design_config: { luckyDraw: { enabled: true, closesAt: '2026-08-31', boostClosesAt: '2026-09-10', multiplier: 10 } },
    });
    deps.Activation.findOne.mockResolvedValue({ id: 'act-1', campaignId: CAMPAIGN_ID, unlockPolicy: 'agent_unlock' });
    const svc = makeLuckyDrawService(deps);
    const draw = await svc.createDraw({ campaignId: CAMPAIGN_ID }, ADMIN);
    expect(new Date(draw.closesAt).getTime()).toBe(sgtDayEndExclusiveMs('2026-08-31'));
    expect(new Date(draw.boostClosesAt).getTime()).toBe(sgtDayEndExclusiveMs('2026-09-10'));
    expect(draw.status).toBe('open');
    expect(draw.createdBy).toBe(ADMIN.id);
  });

  it('PR-2 (F3): stamp absent + NO active rail → 422 DRAW_BOOST_RAIL_MISSING; --allow-no-boost mints a 1×-only draw', async () => {
    const { deps } = buildDeps();
    deps.Campaign.findByPk.mockResolvedValue({
      id: CAMPAIGN_ID,
      design_config: { luckyDraw: { enabled: true, closesAt: '2026-08-31' } },
    });
    const svc = makeLuckyDrawService(deps);
    await expect(svc.createDraw({ campaignId: CAMPAIGN_ID }, ADMIN)).rejects.toMatchObject({
      statusCode: 422, data: { code: 'DRAW_BOOST_RAIL_MISSING' },
    });
    const draw = await svc.createDraw({ campaignId: CAMPAIGN_ID, allowNoBoost: true }, ADMIN);
    expect(draw.status).toBe('open');
    expect(draw.activationId ?? null).toBeNull();
  });

  it('PR-2 (F3): an active on_capture rail is refused — its issuance never boosts', async () => {
    const { deps } = buildDeps();
    deps.Campaign.findByPk.mockResolvedValue({
      id: CAMPAIGN_ID,
      design_config: { luckyDraw: { enabled: true, closesAt: '2026-08-31' } },
    });
    deps.Activation.findOne.mockResolvedValue({ id: 'act-2', campaignId: CAMPAIGN_ID, unlockPolicy: 'on_capture' });
    const svc = makeLuckyDrawService(deps);
    await expect(svc.createDraw({ campaignId: CAMPAIGN_ID }, ADMIN)).rejects.toMatchObject({
      statusCode: 422, data: { code: 'DRAW_BOOST_RAIL_CONFLICT' },
    });
  });
});

// ── freezeDraw ──────────────────────────────────────────────────────────────

describe('freezeDraw', () => {
  it('refuses to freeze before entries close', async () => {
    const { deps } = buildDeps({ draw: { ...openDraw, closesAt: new Date('2027-01-01T00:00:00Z') } });
    const svc = makeLuckyDrawService(deps);
    await expect(svc.freezeDraw(DRAW_ID, ADMIN)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('snapshots ONLY bound-verified in-window prospects, masked', async () => {
    const good = verifiedProspect('p1', 'Jane', 'Doe', '+6591234567');
    const unstamped = { ...verifiedProspect('p2', 'No', 'Stamp', '+6591111111'), sourceMetadata: {} };
    const unbound = { ...verifiedProspect('p3', 'Moved', 'Phone', '+6592222222'), sourceMetadata: { phoneVerifiedAt: 'x', phoneVerifiedFor: sha('+6599999999') } };
    const { deps, state } = buildDeps({ draw: { ...openDraw }, prospects: [good, unstamped, unbound] });
    const svc = makeLuckyDrawService(deps);

    const result = await svc.freezeDraw(DRAW_ID, ADMIN);
    expect(result).toMatchObject({ candidates: 3, entries: 1 });
    expect(state.draw.status).toBe('frozen');
    const entry = state.entries[0];
    expect(entry).toMatchObject({
      prospectId: 'p1',
      phoneHash: sha('+6591234567'),
      phoneLast4: '4567',
      displayName: 'Jane D.',
      chances: 1,
    });
    // The where clause re-applies the stored cutoff (createdAt <= closesAt).
    const where = deps.Prospect.findAll.mock.calls[0][0].where;
    expect(where.campaignId).toBe(CAMPAIGN_ID);
  });

  it('409s when the draw is not open (double freeze)', async () => {
    const { deps } = buildDeps({ draw: { ...openDraw, status: 'frozen' } });
    const svc = makeLuckyDrawService(deps);
    await expect(svc.freezeDraw(DRAW_ID, ADMIN)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('PR-2 (CX18): a verified entrant with NO pinned draw-terms acceptance is EXCLUDED and counted; cohorts surfaced', async () => {
    const accepted = verifiedProspect('p1', 'Jane', 'Doe', '+6591234567');
    const acceptedOldVersion = {
      ...verifiedProspect('p2', 'Early', 'Bird', '+6592222222'),
      consentMetadata: { drawTerms: { termsVersionId: 'tv-0' } }, // a DIFFERENT valid version
    };
    const neverAccepted = { ...verifiedProspect('p3', 'Pre', 'Draw', '+6593333333'), consentMetadata: {} };
    const foreignVersion = {
      ...verifiedProspect('p4', 'Wrong', 'Camp', '+6594444444'),
      consentMetadata: { drawTerms: { termsVersionId: 'tv-OTHER-CAMPAIGN' } },
    };
    const { deps, state } = buildDeps({ draw: { ...openDraw }, prospects: [accepted, acceptedOldVersion, neverAccepted, foreignVersion] });
    deps.DrawTermsVersion.findAll.mockResolvedValue([{ id: 'tv-1' }, { id: 'tv-0' }]);
    const svc = makeLuckyDrawService(deps);

    const result = await svc.freezeDraw(DRAW_ID, ADMIN);
    expect(result).toMatchObject({ candidates: 4, entries: 2, excludedNoConsent: 2 });
    expect(result.termsCohorts).toEqual({ 'tv-1': 1, 'tv-0': 1 });
    expect(state.entries.map((e) => e.prospectId).sort()).toEqual(['p1', 'p2']);
  });
});

// ── boost review + seal ─────────────────────────────────────────────────────

function boostScenario({ reviews = [] } = {}) {
  const entries = [
    entryRow('e1', 'p1', '+6591111111'), // scan boost
    entryRow('e2', 'p2', '+6592222222'), // button boost (review-dependent)
    entryRow('e3', 'p3', '+6593333333'), // no boost
    entryRow('e4', 'p4', '+6594444444'), // manual issuance — must never boost
  ];
  const entitlements = [
    { id: 'ent-1', prospectId: 'p1', issuedVia: 'hook' },
    { id: 'ent-2', prospectId: 'p2', issuedVia: 'hook' },
    { id: 'ent-3', prospectId: 'p3', issuedVia: 'hook' },
    // ent for p4 excluded by the issuedVia != manual query — emulate by not returning it.
  ];
  const events = [
    { id: 'ev-1', type: 'unlocked', entitlementId: 'ent-1', metadata: { via: 'agent_scan' }, createdAt: new Date('2026-09-01T00:00:00Z') },
    { id: 'ev-2', type: 'unlocked', entitlementId: 'ent-2', metadata: { via: 'agent_button' }, createdAt: new Date('2026-09-02T00:00:00Z') },
    // p3's voucher was auto-unlocked at capture — NEVER session evidence.
    { id: 'ev-3', type: 'unlocked', entitlementId: 'ent-3', metadata: { via: 'auto_on_capture' }, createdAt: new Date('2026-09-02T00:00:00Z') },
  ];
  return buildDeps({ draw: { ...openDraw, status: 'frozen' }, entries, entitlements, events, reviews });
}

describe('sealDraw', () => {
  it('refuses to seal before boostClosesAt', async () => {
    const { deps } = buildDeps({ draw: { ...openDraw, status: 'frozen', boostClosesAt: new Date('2027-01-01T00:00:00Z') }, entries: [entryRow('e1', 'p1', '+6591111111')] });
    const svc = makeLuckyDrawService(deps);
    await expect(svc.sealDraw(DRAW_ID, ADMIN)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('PR-3 (CX17): a boost-less record cuts evidence at the ENTRY close, not seal time', async () => {
    // boostScenario's events are dated Sep 1–2 — AFTER the Aug-31 entry
    // close. With boostClosesAt null the query cutoff must fall back to
    // closesAt (what the terms told entrants); the old seal-time fallback
    // (NOW = Sep-15) silently widened the window. The harness mock filters
    // by the where-clause here so the DB-level cutoff actually applies.
    const sc = boostScenario();
    sc.state.draw.boostClosesAt = null;
    const allEvents = [
      { id: 'ev-early', type: 'unlocked', entitlementId: 'ent-1', metadata: { via: 'agent_scan' }, createdAt: new Date('2026-08-15T00:00:00Z') },
      { id: 'ev-late', type: 'unlocked', entitlementId: 'ent-2', metadata: { via: 'agent_button' }, createdAt: new Date('2026-09-02T00:00:00Z') },
    ];
    sc.deps.RedemptionEvent.findAll.mockImplementation(async ({ where }) => {
      const ltSym = where?.createdAt ? Object.getOwnPropertySymbols(where.createdAt)[0] : null;
      const lt = ltSym ? where.createdAt[ltSym] : null;
      return allEvents.filter((e) => !lt || e.createdAt < lt);
    });
    const svc = makeLuckyDrawService(sc.deps);
    const result = await svc.sealDraw(DRAW_ID, ADMIN);

    // The query cutoff was the ENTRY close instant, not "now".
    const where = sc.deps.RedemptionEvent.findAll.mock.calls[0][0].where;
    const cutoffSym = Object.getOwnPropertySymbols(where.createdAt)[0];
    expect(new Date(where.createdAt[cutoffSym]).getTime()).toBe(CLOSES_AT.getTime());

    // ev-early (pre-close scan) boosts; ev-late (post-close button) is OUT of
    // the window — no undecided-review block, no boost.
    const byId = Object.fromEntries(sc.state.entries.map((e) => [e.id, e.chances]));
    expect(byId.e1).toBe(10);
    expect(byId.e2).toBe(1);
    expect(result.totalChances).toBe(13);
  });

  it('veto model: an UNREVIEWED button unlock counts and never blocks the seal', async () => {
    // Operator decision 2026-07-25 — the approval queue was friction; button
    // unlocks weight the draw by default and ops can only STRIKE one
    // (decision 'rejected') before seal.
    const { deps, state } = boostScenario();
    const svc = makeLuckyDrawService(deps);
    const sealed = await svc.sealDraw(DRAW_ID, ADMIN);
    const byId = Object.fromEntries(state.entries.map((e) => [e.id, e.chances]));
    expect(byId.e1).toBe(10); // scan
    expect(byId.e2).toBe(10); // unreviewed button — counts by default
    expect(byId.e3).toBe(1); // auto_on_capture never boosts
    expect(byId.e4).toBe(1); // manually-issued entitlement never boosts
    expect(sealed.totalChances).toBe(22);
  });

  it('PR-4 (CX23): an unlock_reversed event kills EXACTLY its unlock; a later genuine re-scan boosts again', async () => {
    // ev-1 (scan) is reversed → e1 stays 1×; then a fresh scan ev-9 → ×10.
    const undone = boostScenario({ reviews: [{ id: 'r1', drawId: DRAW_ID, entitlementId: 'ent-2', decision: 'rejected' }] });
    undone.deps.RedemptionEvent.findAll.mockResolvedValue([
      { id: 'ev-1', type: 'unlocked', entitlementId: 'ent-1', metadata: { via: 'agent_scan' }, createdAt: new Date('2026-09-01T00:00:00Z') },
      { id: 'ev-r', type: 'unlock_reversed', entitlementId: 'ent-1', metadata: { supersedesEventId: 'ev-1' }, createdAt: new Date('2026-09-02T00:00:00Z') },
    ]);
    const sealed = await makeLuckyDrawService(undone.deps).sealDraw(DRAW_ID, ADMIN);
    expect(Object.fromEntries(undone.state.entries.map((e) => [e.id, e.chances])).e1).toBe(1);
    expect(sealed.totalChances).toBe(4);

    const rescanned = boostScenario({ reviews: [{ id: 'r1', drawId: DRAW_ID, entitlementId: 'ent-2', decision: 'rejected' }] });
    rescanned.deps.RedemptionEvent.findAll.mockResolvedValue([
      { id: 'ev-1', type: 'unlocked', entitlementId: 'ent-1', metadata: { via: 'agent_scan' }, createdAt: new Date('2026-09-01T00:00:00Z') },
      { id: 'ev-r', type: 'unlock_reversed', entitlementId: 'ent-1', metadata: { supersedesEventId: 'ev-1' }, createdAt: new Date('2026-09-02T00:00:00Z') },
      { id: 'ev-9', type: 'unlocked', entitlementId: 'ent-1', metadata: { via: 'agent_scan' }, createdAt: new Date('2026-09-03T00:00:00Z') },
    ]);
    const sealed2 = await makeLuckyDrawService(rescanned.deps).sealDraw(DRAW_ID, ADMIN);
    const byId2 = Object.fromEntries(rescanned.state.entries.map((e) => [e.id, e]));
    expect(byId2.e1).toMatchObject({ chances: 10, boostEventId: 'ev-9' });
    expect(sealed2.totalChances).toBe(13);
  });

  it('boosts scan automatically, approved button ×N, rejected button stays 1×, and commits poolHash', async () => {
    const { deps, state } = boostScenario({
      reviews: [{ id: 'r1', drawId: DRAW_ID, entitlementId: 'ent-2', decision: 'approved' }],
    });
    const svc = makeLuckyDrawService(deps);
    const result = await svc.sealDraw(DRAW_ID, ADMIN);

    const byId = Object.fromEntries(state.entries.map((e) => [e.id, e]));
    expect(byId.e1).toMatchObject({ chances: 10, boostVia: 'agent_scan', boostEventId: 'ev-1' });
    expect(byId.e2).toMatchObject({ chances: 10, boostVia: 'agent_button', boostEventId: 'ev-2' });
    expect(byId.e3.chances).toBe(1);
    expect(byId.e4.chances).toBe(1);
    expect(result.totalChances).toBe(22);
    expect(state.draw.status).toBe('sealed');
    expect(state.draw.poolHash).toBe(computePoolHash(state.entries));
    // Boost evidence query excluded manual issuance.
    const entWhere = deps.RewardEntitlement.findAll.mock.calls[0][0].where;
    expect(entWhere.activationId).toBe('act-1');

    // Rejected instead of approved → 1×.
    const rejected = boostScenario({
      reviews: [{ id: 'r1', drawId: DRAW_ID, entitlementId: 'ent-2', decision: 'rejected' }],
    });
    const svc2 = makeLuckyDrawService(rejected.deps);
    const result2 = await svc2.sealDraw(DRAW_ID, ADMIN);
    expect(Object.fromEntries(rejected.state.entries.map((e) => [e.id, e.chances])).e2).toBe(1);
    expect(result2.totalChances).toBe(13);
  });

  it('never boosts auto_on_capture unlocks; a manual-via unlock counts by default but a rejection strikes it', async () => {
    // auto_on_capture (ev-3/p3) is present in every boostScenario — the runs
    // above prove e3 stays 1×. Under the veto model an admin/manual unlock
    // counts like a button — until ops rejects it.
    const counted = boostScenario({
      reviews: [{ id: 'r1', drawId: DRAW_ID, entitlementId: 'ent-2', decision: 'rejected' }],
    });
    counted.deps.RedemptionEvent.findAll = jest.fn().mockResolvedValue([
      { id: 'ev-m', type: 'unlocked', entitlementId: 'ent-1', metadata: { via: 'manual' }, createdAt: new Date('2026-09-01T00:00:00Z') },
    ]);
    const sealed = await makeLuckyDrawService(counted.deps).sealDraw(DRAW_ID, ADMIN);
    expect(Object.fromEntries(counted.state.entries.map((e) => [e.id, e.chances])).e1).toBe(10);
    expect(sealed.totalChances).toBe(13);

    const vetoed = boostScenario({
      reviews: [
        { id: 'r1', drawId: DRAW_ID, entitlementId: 'ent-2', decision: 'rejected' },
        { id: 'r2', drawId: DRAW_ID, entitlementId: 'ent-1', decision: 'rejected' },
      ],
    });
    vetoed.deps.RedemptionEvent.findAll = jest.fn().mockResolvedValue([
      { id: 'ev-m', type: 'unlocked', entitlementId: 'ent-1', metadata: { via: 'manual' }, createdAt: new Date('2026-09-01T00:00:00Z') },
    ]);
    const sealed2 = await makeLuckyDrawService(vetoed.deps).sealDraw(DRAW_ID, ADMIN);
    expect(Object.fromEntries(vetoed.state.entries.map((e) => [e.id, e.chances])).e1).toBe(1);
    expect(sealed2.totalChances).toBe(4);
  });
});

describe('reviewBoost', () => {
  it('422s on a bad decision and 409s on double review', async () => {
    const { deps } = boostScenario();
    const svc = makeLuckyDrawService(deps);
    await expect(svc.reviewBoost({ drawId: DRAW_ID, entitlementId: 'ent-2', decision: 'maybe' }, ADMIN))
      .rejects.toMatchObject({ statusCode: 422 });
    await svc.reviewBoost({ drawId: DRAW_ID, entitlementId: 'ent-2', decision: 'approved' }, ADMIN);
    await expect(svc.reviewBoost({ drawId: DRAW_ID, entitlementId: 'ent-2', decision: 'rejected' }, ADMIN))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});

// ── runDrawAttempt / outcomes ───────────────────────────────────────────────

function sealedScenario({ entries, attempts = [] }) {
  return buildDeps({
    draw: { ...openDraw, status: attempts.length > 0 ? 'drawn' : 'sealed', poolHash: computePoolHash(entries) },
    entries, attempts,
  });
}

describe('runDrawAttempt', () => {
  const entries = [
    entryRow('e1', 'p1', '+6591111111', 1),
    entryRow('e2', 'p2', '+6592222222', 10, 'agent_scan'),
    entryRow('e3', 'p3', '+6593333333', 1),
  ];

  it('picks deterministically from the injected seed, commits the eligible set, sets the 14-day deadline', async () => {
    const { deps, state } = sealedScenario({ entries });
    const svc = makeLuckyDrawService(deps);
    const { attempt, picked } = await svc.runDrawAttempt(DRAW_ID, { witnessUserId: 'w-1' }, ADMIN);

    const orderedEligible = [...entries].sort((a, b) => a.id.localeCompare(b.id));
    const expected = pickWinner('a'.repeat(64), orderedEligible);
    expect(picked.entryId).toBe(expected.id);
    expect(attempt.totalChances).toBe(12);
    expect(attempt.eligibleHash).toBe(computeEligibleHash(orderedEligible));
    expect(new Date(attempt.claimDeadline).getTime()).toBe(NOW.getTime() + 14 * 24 * 3600 * 1000);
    expect(state.draw.status).toBe('drawn');
  });

  it('blocks a redraw while an attempt is pending, and requires a real reason after', async () => {
    const prior = { id: 'attempt-0', drawId: DRAW_ID, attemptNo: 1, pickedEntryId: 'e2', outcome: 'pending' };
    const { deps } = sealedScenario({ entries, attempts: [prior] });
    const svc = makeLuckyDrawService(deps);
    await expect(svc.runDrawAttempt(DRAW_ID, {}, ADMIN)).rejects.toMatchObject({ statusCode: 409 });

    const lapsed = { ...prior, outcome: 'unclaimed' };
    const { deps: deps2 } = sealedScenario({ entries, attempts: [lapsed] });
    const svc2 = makeLuckyDrawService(deps2);
    await expect(svc2.runDrawAttempt(DRAW_ID, { reason: 'initial' }, ADMIN)).rejects.toMatchObject({ statusCode: 422 });
    // The reason must be the prior attempt's actual outcome, not any non-initial value.
    const declined = { ...prior, outcome: 'declined' };
    const { deps: deps3 } = sealedScenario({ entries, attempts: [declined] });
    const svc3 = makeLuckyDrawService(deps3);
    await expect(svc3.runDrawAttempt(DRAW_ID, { reason: 'unclaimed' }, ADMIN)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('redraw excludes every previously picked entry AND erased entrants', async () => {
    const withErased = [
      entryRow('e1', 'p1', '+6591111111', 1),
      entryRow('e2', 'p2', '+6592222222', 10, 'agent_scan'),
      { ...entryRow('e3', 'p3', '+6593333333', 1), prospectId: null }, // erased post-freeze
    ];
    const prior = { id: 'attempt-0', drawId: DRAW_ID, attemptNo: 1, pickedEntryId: 'e2', outcome: 'unclaimed' };
    const { deps } = sealedScenario({ entries: withErased, attempts: [prior] });
    const svc = makeLuckyDrawService(deps);
    const { attempt, picked } = await svc.runDrawAttempt(DRAW_ID, { reason: 'unclaimed' }, ADMIN);
    // Only e1 is left: e2 already picked, e3 erased.
    expect(picked.entryId).toBe('e1');
    expect(attempt.attemptNo).toBe(2);
    expect(attempt.totalChances).toBe(1);
  });
});

describe('recordAttemptOutcome', () => {
  it('claims: stamps claimedAt and moves the draw to claimed; refuses a second outcome', async () => {
    const entries = [entryRow('e1', 'p1', '+6591111111', 1)];
    const attempt = { id: 'attempt-1', drawId: DRAW_ID, attemptNo: 1, pickedEntryId: 'e1', outcome: 'pending' };
    const { deps, state } = sealedScenario({ entries, attempts: [attempt] });
    state.draw.status = 'drawn';
    const svc = makeLuckyDrawService(deps);

    const updated = await svc.recordAttemptOutcome('attempt-1', { outcome: 'claimed' }, ADMIN);
    expect(updated.outcome).toBe('claimed');
    expect(updated.claimedAt).toBeTruthy();
    expect(state.draw.status).toBe('claimed');

    await expect(svc.recordAttemptOutcome('attempt-1', { outcome: 'declined' }, ADMIN))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("refuses to lapse a winner before the 14-day claim deadline ('unclaimed' too early)", async () => {
    const entries = [entryRow('e1', 'p1', '+6591111111', 1)];
    const attempt = {
      id: 'attempt-1', drawId: DRAW_ID, attemptNo: 1, pickedEntryId: 'e1',
      outcome: 'pending', claimDeadline: new Date(NOW.getTime() + 7 * 24 * 3600 * 1000),
    };
    const { deps } = sealedScenario({ entries, attempts: [attempt] });
    const svc = makeLuckyDrawService(deps);
    await expect(svc.recordAttemptOutcome('attempt-1', { outcome: 'unclaimed' }, ADMIN))
      .rejects.toMatchObject({ statusCode: 409 });
    // An explicit "no" is fine at any time.
    const updated = await svc.recordAttemptOutcome('attempt-1', { outcome: 'declined' }, ADMIN);
    expect(updated.outcome).toBe('declined');
  });
});

// ── verifyDraw ──────────────────────────────────────────────────────────────

describe('verifyDraw', () => {
  it('verifies a clean draw and detects a tampered pool', async () => {
    const entries = [
      entryRow('e1', 'p1', '+6591111111', 1),
      entryRow('e2', 'p2', '+6592222222', 10, 'agent_scan'),
    ];
    const orderedEligible = [...entries].sort((a, b) => a.id.localeCompare(b.id));
    const seed = 'a'.repeat(64);
    const picked = pickWinner(seed, orderedEligible);
    const attempt = {
      id: 'attempt-1', drawId: DRAW_ID, attemptNo: 1, seed,
      totalChances: 11, eligibleHash: computeEligibleHash(orderedEligible),
      pickedEntryId: picked.id, outcome: 'pending',
    };
    const clean = sealedScenario({ entries, attempts: [attempt] });
    const svc = makeLuckyDrawService(clean.deps);
    const report = await svc.verifyDraw(DRAW_ID);
    expect(report.ok).toBe(true);

    // Tamper: bump a weight after seal → poolHash AND eligibleHash mismatch.
    const tampered = sealedScenario({ entries, attempts: [attempt] });
    tampered.state.entries[0].chances = 5;
    const svc2 = makeLuckyDrawService(tampered.deps);
    const report2 = await svc2.verifyDraw(DRAW_ID);
    expect(report2.ok).toBe(false);
    expect(report2.checks.some((c) => c.check === 'poolHash' && !c.ok)).toBe(true);
  });

  it('treats post-attempt erasure as an eligible-set change, NOT pool tampering', async () => {
    const entries = [
      entryRow('e1', 'p1', '+6591111111', 1),
      entryRow('e2', 'p2', '+6592222222', 10, 'agent_scan'),
    ];
    const orderedEligible = [...entries].sort((a, b) => a.id.localeCompare(b.id));
    const seed = 'a'.repeat(64);
    const picked = pickWinner(seed, orderedEligible);
    const attempt = {
      id: 'attempt-1', drawId: DRAW_ID, attemptNo: 1, seed,
      totalChances: 11, eligibleHash: computeEligibleHash(orderedEligible),
      pickedEntryId: picked.id, outcome: 'pending',
    };
    const scenario = sealedScenario({ entries, attempts: [attempt] });
    // Erase the non-picked entrant after the attempt.
    const erased = scenario.state.entries.find((e) => e.id !== picked.id);
    erased.prospectId = null;
    const svc = makeLuckyDrawService(scenario.deps);
    const report = await svc.verifyDraw(DRAW_ID);
    // poolHash no longer includes prospectId — erasure must not read as tamper…
    expect(report.checks.find((c) => c.check === 'poolHash').ok).toBe(true);
    // …but the attempt's committed eligible set visibly changed.
    expect(report.ok).toBe(false);
    expect(report.checks.some((c) => c.check.includes('eligibleSet') && !c.ok)).toBe(true);
  });
});

// ── P2-8: commit-reveal on the seed ────────────────────────────────────────

/**
 * pickWinner is a pure function of (seed, entries), and the seed used to be
 * minted at DRAW time and used immediately. The pool was committed at seal, but
 * nothing committed the seed — so an operator could re-mint and re-run the pick
 * until it landed on a chosen entry and persist only that attempt. Nothing in
 * the record would show the discarded rolls.
 *
 * The seed is now minted inside the one-way frozen→sealed transition; only its
 * hash is published. The pool is committed by the same statement, so the winner
 * is fixed at the seal instant.
 */
describe('seed commit-reveal', () => {
  const entries = [
    entryRow('e1', 'p1', '+6591111111', 1),
    entryRow('e2', 'p2', '+6592222222', 10, 'agent_scan'),
    entryRow('e3', 'p3', '+6593333333', 1),
  ];

  it('commits hash(seed) at SEAL, before any pick exists', async () => {
    const { deps, state } = boostScenario();
    const sealed = await makeLuckyDrawService(deps).sealDraw(DRAW_ID, ADMIN);

    expect(sealed.seedCommitment).toMatch(/^[0-9a-f]{64}$/);
    expect(state.draw.sealedSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(state.draw.seedCommitment).toBe(sha(state.draw.sealedSeed));
    // No attempt has been made yet — the commitment precedes the pick.
    expect(state.attempts).toHaveLength(0);
  });

  it('draws with the REVEALED sealed seed rather than a fresh one', async () => {
    const sealedSeed = 'a'.repeat(64);
    const { deps, state } = buildDeps({
      draw: {
        ...openDraw, status: 'sealed', poolHash: computePoolHash(entries),
        sealedSeed, seedCommitment: sha(sealedSeed),
      },
      entries,
    });
    // A mint that would betray itself if it were used.
    deps.mintSeed = () => 'f'.repeat(64);

    const { attempt } = await makeLuckyDrawService(deps).runDrawAttempt(DRAW_ID, {}, ADMIN);

    expect(attempt.seed).toBe(sealedSeed);
    expect(state.attempts[0].seed).toBe(sealedSeed);
  });

  it('REFUSES to draw when the sealed seed does not match its commitment', async () => {
    const { deps } = buildDeps({
      draw: {
        ...openDraw, status: 'sealed', poolHash: computePoolHash(entries),
        sealedSeed: 'b'.repeat(64), seedCommitment: sha('a'.repeat(64)), // substituted
      },
      entries,
    });

    await expect(makeLuckyDrawService(deps).runDrawAttempt(DRAW_ID, {}, ADMIN))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/does not match its commitment/i) });
  });

  it('verifyDraw passes a normal sealed→drawn round trip', async () => {
    const sealedSeed = 'c'.repeat(64);
    const { deps } = buildDeps({
      draw: {
        ...openDraw, status: 'sealed', poolHash: computePoolHash(entries),
        sealedSeed, seedCommitment: sha(sealedSeed),
      },
      entries,
    });
    const svc = makeLuckyDrawService(deps);
    await svc.runDrawAttempt(DRAW_ID, {}, ADMIN);

    const report = await svc.verifyDraw(DRAW_ID);

    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.check === 'seedCommitment')).toMatchObject({ ok: true });
  });

  it('verifyDraw REJECTS a revealed seed that does not hash to the commitment', async () => {
    const sealedSeed = 'd'.repeat(64);
    const { deps, state } = buildDeps({
      draw: {
        ...openDraw, status: 'sealed', poolHash: computePoolHash(entries),
        sealedSeed, seedCommitment: sha(sealedSeed),
      },
      entries,
    });
    const svc = makeLuckyDrawService(deps);
    await svc.runDrawAttempt(DRAW_ID, {}, ADMIN);

    // The operator swaps in the seed that produced the winner they wanted.
    state.draw.sealedSeed = 'e'.repeat(64);
    state.attempts[0].seed = 'e'.repeat(64);

    const report = await svc.verifyDraw(DRAW_ID);

    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.check === 'seedCommitment')).toMatchObject({ ok: false });
    expect(report.checks.some((c) => c.check === 'attempt#1.seedRevealed' && c.ok === false)).toBe(true);
  });

  it('a draw sealed BEFORE commit-reveal still draws, and verifyDraw says the commitment is absent', async () => {
    const { deps } = buildDeps({
      draw: { ...openDraw, status: 'sealed', poolHash: computePoolHash(entries) }, // no commitment
      entries,
    });
    const svc = makeLuckyDrawService(deps);
    await svc.runDrawAttempt(DRAW_ID, {}, ADMIN);

    const report = await svc.verifyDraw(DRAW_ID);

    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.check === 'seedCommitment').note)
      .toMatch(/sealed before commit-reveal/i);
  });
});

// ── The ceremony: N winners in one witnessed transaction (Phase 3) ──────────

/** A sealed multi-winner draw: `winnersCount` units, v2 selection. */
function sealedMultiScenario({ entries, winnersCount, prizes = null, attempts = [] }) {
  return buildDeps({
    draw: {
      ...openDraw,
      status: attempts.length > 0 ? 'drawn' : 'sealed',
      poolHash: computePoolHash(entries),
      sealedSeed: 'a'.repeat(64),
      seedCommitment: sha('a'.repeat(64)),
      winnersCount,
      algorithmVersion: 2,
      prizes: prizes || [{ qty: winnersCount, name: 'AirPods Pro 3' }],
    },
    entries,
    attempts,
  });
}

describe('runInitialDraw — the multi-winner ceremony', () => {
  const fiveEntries = [
    entryRow('e1', 'p1', '+6591111111', 1),
    entryRow('e2', 'p2', '+6592222222', 10, 'agent_scan'),
    entryRow('e3', 'p3', '+6593333333', 1),
    entryRow('e4', 'p4', '+6594444444', 1),
    entryRow('e5', 'p5', '+6595555555', 1),
  ];

  it('awards every prize unit to a DISTINCT entrant in one transaction', async () => {
    const { deps, state } = sealedMultiScenario({ entries: fiveEntries, winnersCount: 5 });
    const svc = makeLuckyDrawService(deps);
    const result = await svc.runInitialDraw(DRAW_ID, { witnessUserId: 'w-1' }, ADMIN);

    expect(result.awarded).toBe(5);
    expect(state.attempts).toHaveLength(5);
    // One prize per person — the T&C promise, enforced by a GLOBAL exclusion set.
    expect(new Set(state.attempts.map((a) => a.pickedEntryId)).size).toBe(5);
    // One attempt per unit, units 0..4, attemptNo 1..5.
    expect(state.attempts.map((a) => a.prizeUnitIndex).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(state.attempts.map((a) => a.attemptNo).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(state.draw.status).toBe('drawn');
    expect(state.attempts.every((a) => a.outcome === 'pending')).toBe(true);
  });

  it('carries the prize name for each unit from the draw SNAPSHOT', async () => {
    const prizes = [{ qty: 1, name: 'iPhone 17 Pro' }, { qty: 2, name: '$100 Voucher' }];
    const { deps } = sealedMultiScenario({ entries: fiveEntries, winnersCount: 3, prizes });
    const svc = makeLuckyDrawService(deps);
    const { picks } = await svc.runInitialDraw(DRAW_ID, {}, ADMIN);
    expect(picks.map((p) => p.prize)).toEqual(['iPhone 17 Pro', '$100 Voucher', '$100 Voucher']);
  });

  it('REFUSES to award fewer winners than promised (blocker #7)', async () => {
    const { deps, state } = sealedMultiScenario({ entries: fiveEntries.slice(0, 3), winnersCount: 5 });
    const svc = makeLuckyDrawService(deps);
    await expect(svc.runInitialDraw(DRAW_ID, {}, ADMIN)).rejects.toMatchObject({
      statusCode: 409,
      data: { code: 'DRAW_INSUFFICIENT_ENTRIES', winnersCount: 5, eligible: 3 },
    });
    // Nothing partially written, draw untouched.
    expect(state.attempts).toHaveLength(0);
    expect(state.draw.status).toBe('sealed');
  });

  it('awards short ONLY on an explicit, recorded decision', async () => {
    const { deps } = sealedMultiScenario({ entries: fiveEntries.slice(0, 3), winnersCount: 5 });
    const svc = makeLuckyDrawService(deps);
    const result = await svc.runInitialDraw(DRAW_ID, { allowPartialAward: true }, ADMIN);
    expect(result.awarded).toBe(3);
    expect(result.winnersCount).toBe(5);
  });

  it('excludes erased entrants (prospectId NULL) from the pool', async () => {
    const withErased = [...fiveEntries.slice(0, 4), { ...fiveEntries[4], prospectId: null }];
    const { deps, state } = sealedMultiScenario({ entries: withErased, winnersCount: 4 });
    const svc = makeLuckyDrawService(deps);
    await svc.runInitialDraw(DRAW_ID, {}, ADMIN);
    expect(state.attempts.some((a) => a.pickedEntryId === 'e5')).toBe(false);
  });

  it('refuses to run twice', async () => {
    const { deps } = sealedMultiScenario({ entries: fiveEntries, winnersCount: 2 });
    const svc = makeLuckyDrawService(deps);
    await svc.runInitialDraw(DRAW_ID, {}, ADMIN);
    await expect(svc.runInitialDraw(DRAW_ID, {}, ADMIN)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('a legacy single-winner draw still awards exactly one', async () => {
    const { deps, state } = sealedMultiScenario({ entries: fiveEntries, winnersCount: 1, prizes: null });
    const svc = makeLuckyDrawService(deps);
    const result = await svc.runInitialDraw(DRAW_ID, {}, ADMIN);
    expect(result.awarded).toBe(1);
    expect(state.attempts[0].prizeUnitIndex).toBe(0);
  });
});

describe('per-unit lifecycle', () => {
  const entries = [
    entryRow('e1', 'p1', '+6591111111', 1),
    entryRow('e2', 'p2', '+6592222222', 1),
    entryRow('e3', 'p3', '+6593333333', 1),
    entryRow('e4', 'p4', '+6594444444', 1),
  ];

  /** Run a 3-unit ceremony and return the service + state. */
  async function ceremony() {
    const { deps, state } = sealedMultiScenario({ entries, winnersCount: 3 });
    const svc = makeLuckyDrawService(deps);
    await svc.runInitialDraw(DRAW_ID, {}, ADMIN);
    return { svc, state };
  }

  it('a claim on ONE unit does not end the draw', async () => {
    const { svc, state } = await ceremony();
    await svc.recordAttemptOutcome(state.attempts[0].id, { outcome: 'claimed' }, ADMIN);
    expect(state.draw.status).toBe('drawn');
  });

  it('the draw becomes claimed only when EVERY unit is claimed', async () => {
    const { svc, state } = await ceremony();
    await svc.recordAttemptOutcome(state.attempts[0].id, { outcome: 'claimed' }, ADMIN);
    await svc.recordAttemptOutcome(state.attempts[1].id, { outcome: 'claimed' }, ADMIN);
    expect(state.draw.status).toBe('drawn');
    await svc.recordAttemptOutcome(state.attempts[2].id, { outcome: 'claimed' }, ADMIN);
    expect(state.draw.status).toBe('claimed');
  });

  it('a pending attempt on one unit does not block a redraw on another', async () => {
    const { svc, state } = await ceremony();
    // Unit 1 fails; unit 0 and 2 are still pending.
    await svc.recordAttemptOutcome(state.attempts[1].id, { outcome: 'declined' }, ADMIN);
    const { attempt } = await svc.runDrawAttempt(
      DRAW_ID, { reason: 'declined', prizeUnitIndex: 1 }, ADMIN
    );
    expect(attempt.prizeUnitIndex).toBe(1);
    // The replacement is someone who has not already won.
    const live = state.attempts.filter((a) => ['pending', 'claimed'].includes(a.outcome));
    expect(new Set(live.map((a) => a.pickedEntryId)).size).toBe(live.length);
  });

  it('refuses a redraw while THAT unit is still pending', async () => {
    const { svc } = await ceremony();
    await expect(
      svc.runDrawAttempt(DRAW_ID, { reason: 'declined', prizeUnitIndex: 0 }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses a redraw on a unit that is already claimed', async () => {
    const { svc, state } = await ceremony();
    await svc.recordAttemptOutcome(state.attempts[0].id, { outcome: 'claimed' }, ADMIN);
    await expect(
      svc.runDrawAttempt(DRAW_ID, { reason: 'declined', prizeUnitIndex: 0 }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('requires the redraw reason to match THAT unit’s last outcome', async () => {
    const { svc, state } = await ceremony();
    await svc.recordAttemptOutcome(state.attempts[1].id, { outcome: 'declined' }, ADMIN);
    await expect(
      svc.runDrawAttempt(DRAW_ID, { reason: 'unreachable', prizeUnitIndex: 1 }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rejects a unit index outside the draw', async () => {
    const { svc } = await ceremony();
    await expect(
      svc.runDrawAttempt(DRAW_ID, { reason: 'initial', prizeUnitIndex: 9 }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('verifyDraw replays every unit and reports the structural checks', async () => {
    const { svc } = await ceremony();
    const report = await svc.verifyDraw(DRAW_ID);
    expect(report.ok).toBe(true);
    expect(report.checks.filter((c) => /\.pick$/.test(c.check))).toHaveLength(3);
    expect(report.checks.find((c) => c.check === 'prizeUnitBounds')?.ok).toBe(true);
    expect(report.checks.find((c) => c.check === 'oneClaimPerUnit')?.ok).toBe(true);
    expect(report.checks.find((c) => c.check === 'onePrizePerEntry')?.ok).toBe(true);
  });

  /**
   * Blocker #15 — the pick is BOUND to its prize unit: the unit index is part of
   * the HMAC message, so re-deriving an award under a different unit lands on a
   * different entrant and the replay fails.
   *
   * Detection is strong, not absolute, and the fixture is chosen to reflect that
   * honestly: with N candidates left, a reassigned unit still has a ~1/N chance
   * of coincidentally re-deriving the SAME entrant (on this 8-candidate pool,
   * units 1, 2 and 4 all happen to yield w5). The unstorable-by-construction
   * guarantees are the partial unique indexes; the verifier is a detector on
   * top of them. Unit 0 re-derives to a different entrant here, so the check
   * is deterministic.
   */
  it('verifyDraw FLAGS an attempt reassigned to a different prize unit', async () => {
    const wide = Array.from({ length: 10 }, (_, i) => entryRow(`w${i}`, `pw${i}`, `+659${i}${i}${i}${i}${i}${i}${i}${i}`, 1));
    const { deps, state } = sealedMultiScenario({ entries: wide, winnersCount: 3 });
    const svc = makeLuckyDrawService(deps);
    await svc.runInitialDraw(DRAW_ID, {}, ADMIN);
    expect((await svc.verifyDraw(DRAW_ID)).ok).toBe(true);

    state.attempts[2].prizeUnitIndex = 0; // tamper: move a pick to another unit
    const report = await svc.verifyDraw(DRAW_ID);
    expect(report.ok).toBe(false);
    // It fails on the PICK replay (the unit is still structurally in range).
    expect(report.checks.find((c) => c.check === 'attempt#3.pick')?.ok).toBe(false);
  });

  it('getDrawState rolls up one row per prize unit', async () => {
    const { svc } = await ceremony();
    const view = await svc.getDrawState(DRAW_ID);
    expect(view.units).toHaveLength(3);
    expect(view.units.map((u) => u.unitIndex)).toEqual([0, 1, 2]);
    expect(view.units.every((u) => u.status === 'pending' && u.winner)).toBe(true);
    expect(view.draw.winnersCount).toBe(3);
  });
});
