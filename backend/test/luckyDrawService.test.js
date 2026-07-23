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
    findAll: jest.fn().mockImplementation(async () => state.attempts.map((a) => ({ ...a }))),
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

  it('422s (DRAW_MULTI_PRIZE_UNSUPPORTED) when structured prizes total more than one unit', async () => {
    const { deps } = buildDeps();
    deps.Campaign.findByPk.mockResolvedValue({
      id: CAMPAIGN_ID,
      design_config: {
        luckyDraw: {
          enabled: true,
          closesAt: '2026-08-31',
          prizes: [{ qty: 1, name: 'iPhone 17 Pro' }, { qty: 3, name: '$100 FairPrice Voucher' }],
        },
      },
    });
    const svc = makeLuckyDrawService(deps);
    await expect(svc.createDraw({ campaignId: CAMPAIGN_ID }, ADMIN)).rejects.toMatchObject({
      statusCode: 422,
      data: { code: 'DRAW_MULTI_PRIZE_UNSUPPORTED' },
    });
  });

  it('a single structured prize (one row, qty 1) still creates the draw', async () => {
    const { deps } = buildDeps();
    deps.Campaign.findByPk.mockResolvedValue({
      id: CAMPAIGN_ID,
      design_config: {
        luckyDraw: { enabled: true, closesAt: '2026-08-31', prizes: [{ qty: 1, name: 'iPhone 17 Pro' }] },
      },
    });
    const svc = makeLuckyDrawService(deps);
    const draw = await svc.createDraw({ campaignId: CAMPAIGN_ID }, ADMIN);
    expect(draw.status).toBe('open');
  });

  it('derives fixed SGT-exclusive instants and persists config', async () => {
    const { deps } = buildDeps();
    deps.Campaign.findByPk.mockResolvedValue({
      id: CAMPAIGN_ID,
      design_config: { luckyDraw: { enabled: true, closesAt: '2026-08-31', boostClosesAt: '2026-09-10', multiplier: 10 } },
    });
    const svc = makeLuckyDrawService(deps);
    const draw = await svc.createDraw({ campaignId: CAMPAIGN_ID }, ADMIN);
    expect(new Date(draw.closesAt).getTime()).toBe(sgtDayEndExclusiveMs('2026-08-31'));
    expect(new Date(draw.boostClosesAt).getTime()).toBe(sgtDayEndExclusiveMs('2026-09-10'));
    expect(draw.status).toBe('open');
    expect(draw.createdBy).toBe(ADMIN.id);
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
    { id: 'ev-1', entitlementId: 'ent-1', metadata: { via: 'agent_scan' }, createdAt: new Date('2026-09-01T00:00:00Z') },
    { id: 'ev-2', entitlementId: 'ent-2', metadata: { via: 'agent_button' }, createdAt: new Date('2026-09-02T00:00:00Z') },
    // p3's voucher was auto-unlocked at capture — NEVER session evidence.
    { id: 'ev-3', entitlementId: 'ent-3', metadata: { via: 'auto_on_capture' }, createdAt: new Date('2026-09-02T00:00:00Z') },
  ];
  return buildDeps({ draw: { ...openDraw, status: 'frozen' }, entries, entitlements, events, reviews });
}

describe('sealDraw', () => {
  it('refuses to seal before boostClosesAt', async () => {
    const { deps } = buildDeps({ draw: { ...openDraw, status: 'frozen', boostClosesAt: new Date('2027-01-01T00:00:00Z') }, entries: [entryRow('e1', 'p1', '+6591111111')] });
    const svc = makeLuckyDrawService(deps);
    await expect(svc.sealDraw(DRAW_ID, ADMIN)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('blocks sealing while a button unlock is undecided, listing it', async () => {
    const { deps } = boostScenario();
    const svc = makeLuckyDrawService(deps);
    const err = await svc.sealDraw(DRAW_ID, ADMIN).catch((e) => e);
    expect(err.statusCode).toBe(409);
    expect(err.data.undecided).toEqual([
      expect.objectContaining({ entitlementId: 'ent-2', prospectId: 'p2' }),
    ]);
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

  it('never boosts auto_on_capture unlocks, and manual unlocks need a review like buttons', async () => {
    // auto_on_capture (ev-3/p3) is present in every boostScenario — the
    // approved run above already proved e3 stays 1×. Now: an admin/manual
    // unlock must be review-gated, not treated as a scan.
    const scenario = boostScenario({
      reviews: [{ id: 'r1', drawId: DRAW_ID, entitlementId: 'ent-2', decision: 'rejected' }],
    });
    scenario.deps.RedemptionEvent.findAll = jest.fn().mockResolvedValue([
      { id: 'ev-m', entitlementId: 'ent-1', metadata: { via: 'manual' }, createdAt: new Date('2026-09-01T00:00:00Z') },
    ]);
    const svc = makeLuckyDrawService(scenario.deps);
    const err = await svc.sealDraw(DRAW_ID, ADMIN).catch((e) => e);
    expect(err.statusCode).toBe(409);
    expect(err.data.undecided).toEqual([
      expect.objectContaining({ entitlementId: 'ent-1', via: 'manual' }),
    ]);
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

describe('session boost — the activation link that was never written', () => {
  it('createDraw auto-resolves the campaign live activation when the config names none', async () => {
    const { deps } = buildDeps();
    deps.Campaign.findByPk.mockResolvedValue({
      id: CAMPAIGN_ID,
      design_config: { luckyDraw: { enabled: true, closesAt: '2026-09-02', multiplier: 10 } },
    });
    deps.Activation.findOne.mockResolvedValue({ id: 'act-auto', campaignId: CAMPAIGN_ID });
    const svc = makeLuckyDrawService(deps);
    const draw = await svc.createDraw({ campaignId: CAMPAIGN_ID }, ADMIN);
    expect(deps.Activation.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: CAMPAIGN_ID, status: 'active' } })
    );
    expect(draw.activationId).toBe('act-auto');
  });

  it('no active activation still creates the draw (activationId stays null)', async () => {
    const { deps } = buildDeps();
    deps.Campaign.findByPk.mockResolvedValue({
      id: CAMPAIGN_ID,
      design_config: { luckyDraw: { enabled: true, closesAt: '2026-09-02', multiplier: 10 } },
    });
    deps.Activation.findOne.mockResolvedValue(null);
    const svc = makeLuckyDrawService(deps);
    const draw = await svc.createDraw({ campaignId: CAMPAIGN_ID }, ADMIN);
    expect(draw.activationId).toBe(null);
  });

  it('an EXPLICIT activationId still wins and is still ownership-checked', async () => {
    const { deps } = buildDeps();
    deps.Campaign.findByPk.mockResolvedValue({
      id: CAMPAIGN_ID,
      design_config: { luckyDraw: { enabled: true, closesAt: '2026-09-02', activationId: 'act-9' } },
    });
    deps.Activation.findByPk.mockResolvedValue({ id: 'act-9', campaignId: 'SOMEONE-ELSE' });
    const svc = makeLuckyDrawService(deps);
    await expect(svc.createDraw({ campaignId: CAMPAIGN_ID }, ADMIN)).rejects.toMatchObject({ statusCode: 422 });
    expect(deps.Activation.findOne).not.toHaveBeenCalled();
  });
});
