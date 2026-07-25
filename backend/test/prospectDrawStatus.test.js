/**
 * getProspectDrawStatus (luckyDrawService, DI seam — no DB): the Lead Profile
 * page's per-prospect draw standing. Three lifecycle branches (open derives,
 * frozen reads the persisted pool, sealed+ reads stored chances + the redraw
 * ledger), deterministic draw selection over terminal history, the full boost
 * predicate (manual-issuance exclusion, supersede, review gating), erasure
 * honesty, bounded query counts, and the status-flip consistency retry.
 * docs/plans/admin-lead-profile-page.md §4.
 */
import crypto from 'crypto';
import { jest } from '@jest/globals';
import { makeLuckyDrawService, entryEligibility } from '../src/services/luckyDrawService.js';
import { sgtDayEndExclusiveMs } from '../src/utils/sgtTime.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const NOW = new Date('2026-09-15T04:00:00Z');
const CLOSES_AT = new Date(sgtDayEndExclusiveMs('2026-08-31'));
const BOOST_CLOSES_AT = new Date(sgtDayEndExclusiveMs('2026-09-10'));

// Sequelize Op conditions arrive as symbol-keyed objects — unwrap the first
// symbol value ({ [Op.in]: [...] } → [...], { [Op.ne]: 'x' } → 'x').
const symVal = (cond) => {
  const syms = Object.getOwnPropertySymbols(cond || {});
  return syms.length ? cond[syms[0]] : undefined;
};
const asList = (cond) => (Array.isArray(cond) ? cond : symVal(cond) ?? [cond]);

function prospect(id, campaignId, phone, {
  verified = true, terms = 'tv-1', createdAt = '2026-08-01T00:00:00Z', erased = false,
} = {}) {
  return {
    id,
    campaignId,
    phone,
    createdAt: new Date(createdAt),
    sourceMetadata: {
      ...(verified && phone
        ? { phoneVerifiedAt: '2026-08-01T00:00:00Z', phoneVerifiedFor: sha(phone) }
        : {}),
      ...(erased ? { erased: true } : {}),
    },
    consentMetadata: terms ? { drawTerms: { termsVersionId: terms } } : {},
  };
}

function drawRow(id, campaignId, status, extra = {}) {
  return {
    id, campaignId, status,
    closesAt: CLOSES_AT, boostClosesAt: BOOST_CLOSES_AT,
    multiplier: 10, activationId: 'act-1',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...extra,
  };
}

/**
 * Where-clause-honest mocks: each findAll filters its fixtures the way the
 * real query would, so the manual-issuance exclusion, the supersede logic and
 * the cutoff all get exercised for real rather than pre-filtered by the test.
 */
function buildDeps({
  draws = [], campaigns = [], termsVersions = [{ id: 'tv-1', campaignId: 'camp-1' }],
  entries = [], attempts = [], entitlements = [], events = [], reviews = [],
} = {}) {
  const deps = {
    Draw: {
      findAll: jest.fn().mockImplementation(async ({ where }) => {
        let rows = draws;
        if (where?.campaignId) {
          const ids = asList(where.campaignId).map(String);
          rows = rows.filter((r) => ids.includes(String(r.campaignId)));
        }
        if (where?.id) {
          const ids = asList(where.id).map(String);
          rows = rows.filter((r) => ids.includes(String(r.id)));
        }
        return [...rows]
          .sort((a, b) => (b.createdAt - a.createdAt) || String(b.id).localeCompare(String(a.id)))
          .map((r) => ({ ...r }));
      }),
      findByPk: jest.fn(),
      update: jest.fn(),
    },
    Campaign: {
      findAll: jest.fn().mockImplementation(async ({ where }) => {
        const ids = asList(where.id).map(String);
        return campaigns.filter((c) => ids.includes(String(c.id))).map((c) => ({ ...c }));
      }),
      findByPk: jest.fn(),
    },
    DrawTermsVersion: {
      findAll: jest.fn().mockImplementation(async ({ where }) => {
        const ids = asList(where.campaignId).map(String);
        return termsVersions.filter((v) => ids.includes(String(v.campaignId)));
      }),
    },
    DrawEntry: {
      findAll: jest.fn().mockImplementation(async ({ where }) => {
        const drawIds = asList(where.drawId).map(String);
        const prospectIds = asList(where.prospectId).map(String);
        return entries
          .filter((e) => drawIds.includes(String(e.drawId)) && prospectIds.includes(String(e.prospectId)))
          .map((e) => ({ ...e }));
      }),
    },
    DrawAttempt: {
      findAll: jest.fn().mockImplementation(async ({ where }) => {
        const drawIds = asList(where.drawId).map(String);
        return attempts
          .filter((a) => drawIds.includes(String(a.drawId)))
          .sort((a, b) => a.attemptNo - b.attemptNo)
          .map((a) => ({ ...a }));
      }),
    },
    RewardEntitlement: {
      findAll: jest.fn().mockImplementation(async ({ where }) => {
        const prospectIds = asList(where.prospectId).map(String);
        const excluded = symVal(where.issuedVia); // Op.ne 'manual'
        return entitlements
          .filter((e) => String(e.activationId) === String(where.activationId)
            && prospectIds.includes(String(e.prospectId))
            && (excluded === undefined || e.issuedVia !== excluded))
          .map((e) => ({ ...e }));
      }),
    },
    RedemptionEvent: {
      findAll: jest.fn().mockImplementation(async ({ where }) => {
        const entIds = asList(where.entitlementId).map(String);
        const types = asList(where.type);
        const cutoff = symVal(where.createdAt); // Op.lt
        return events
          .filter((e) => entIds.includes(String(e.entitlementId))
            && types.includes(e.type)
            && (!cutoff || e.createdAt < cutoff))
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((e) => ({ ...e }));
      }),
    },
    DrawBoostReview: {
      findAll: jest.fn().mockImplementation(async ({ where }) => reviews
        .filter((r) => String(r.drawId) === String(where.drawId))
        .map((r) => ({ ...r }))),
    },
    Prospect: { findAll: jest.fn() },
    Activation: { findByPk: jest.fn(), findOne: jest.fn() },
    sequelize: { transaction: jest.fn().mockImplementation(async (cb) => cb({})) },
    logger: silentLogger,
    now: () => NOW,
    mintSeed: () => 'a'.repeat(64),
  };
  return { deps, svc: makeLuckyDrawService(deps) };
}

const unlockEvent = (id, entitlementId, via, at = '2026-09-01T00:00:00Z') => ({
  id, entitlementId, type: 'unlocked', metadata: { via }, createdAt: new Date(at),
});

// ── entryEligibility (pure, shared with freeze) ─────────────────────────────

describe('entryEligibility', () => {
  const versions = new Set(['tv-1']);
  it('accepts a bound stamp + pinned terms', () => {
    expect(entryEligibility(prospect('p1', 'c', '+6591234567'), versions))
      .toEqual({ verified: true, hasTerms: true, eligible: true });
  });
  it('rejects a stamp bound to a DIFFERENT phone (staff edit)', () => {
    const p = prospect('p1', 'c', '+6591234567');
    p.phone = '+6598765432';
    expect(entryEligibility(p, versions).verified).toBe(false);
  });
  it('rejects missing terms pinning and unknown versions', () => {
    expect(entryEligibility(prospect('p1', 'c', '+6591234567', { terms: null }), versions).hasTerms).toBe(false);
    expect(entryEligibility(prospect('p1', 'c', '+6591234567', { terms: 'tv-9' }), versions).hasTerms).toBe(false);
  });
});

// ── open: provisional derivation ────────────────────────────────────────────

describe('getProspectDrawStatus — open draws (provisional preview)', () => {
  it('eligible signup previews 1 provisional chance', async () => {
    const { svc } = buildDeps({ draws: [drawRow('d1', 'camp-1', 'open')] });
    const map = await svc.getProspectDrawStatus([prospect('p1', 'camp-1', '+6591110001')]);
    expect(map.get('p1')).toMatchObject({
      state: 'provisional_in', chances: 1, provisional: true,
      boosted: false, drawStatus: 'open', multiplier: 10,
    });
  });

  it('names the blocking reason, in predicate order', async () => {
    const { svc } = buildDeps({ draws: [drawRow('d1', 'camp-1', 'open')] });
    const cases = [
      [prospect('p1', 'camp-1', null), 'no_phone'],
      [prospect('p2', 'camp-1', '+6591110002', { verified: false }), 'phone_unverified'],
      [prospect('p3', 'camp-1', '+6591110003', { terms: null }), 'terms_not_pinned'],
      [prospect('p4', 'camp-1', '+6591110004', { createdAt: '2026-09-05T00:00:00Z' }), 'signed_up_after_close'],
    ];
    const map = await svc.getProspectDrawStatus(cases.map(([p]) => p));
    for (const [p, reason] of cases) {
      expect(map.get(p.id)).toMatchObject({ state: 'provisional_out', chances: 0, notEligibleReason: reason });
    }
  });

  it('agent_scan unlock previews the multiplier', async () => {
    const { svc } = buildDeps({
      draws: [drawRow('d1', 'camp-1', 'open')],
      entitlements: [{ id: 'ent-1', activationId: 'act-1', prospectId: 'p1', issuedVia: 'hook' }],
      events: [unlockEvent('ev-1', 'ent-1', 'agent_scan')],
    });
    const map = await svc.getProspectDrawStatus([prospect('p1', 'camp-1', '+6591110001')]);
    expect(map.get('p1')).toMatchObject({
      state: 'provisional_in', chances: 10, boosted: true, boostVia: 'agent_scan',
    });
    expect(map.get('p1').boostedAt).toEqual(new Date('2026-09-01T00:00:00Z'));
  });

  it('a superseded unlock earns nothing; a fresh re-scan boosts again', async () => {
    const base = {
      draws: [drawRow('d1', 'camp-1', 'open')],
      entitlements: [{ id: 'ent-1', activationId: 'act-1', prospectId: 'p1', issuedVia: 'hook' }],
    };
    const reversed = {
      id: 'ev-2', entitlementId: 'ent-1', type: 'unlock_reversed',
      metadata: { supersedesEventId: 'ev-1' }, createdAt: new Date('2026-09-02T00:00:00Z'),
    };
    const p = prospect('p1', 'camp-1', '+6591110001');

    const undone = buildDeps({ ...base, events: [unlockEvent('ev-1', 'ent-1', 'agent_scan'), reversed] });
    expect((await undone.svc.getProspectDrawStatus([p])).get('p1'))
      .toMatchObject({ chances: 1, boosted: false });

    const rescanned = buildDeps({
      ...base,
      events: [
        unlockEvent('ev-1', 'ent-1', 'agent_scan'), reversed,
        unlockEvent('ev-3', 'ent-1', 'agent_scan', '2026-09-03T00:00:00Z'),
      ],
    });
    expect((await rescanned.svc.getProspectDrawStatus([p])).get('p1'))
      .toMatchObject({ chances: 10, boosted: true });
  });

  it('agent_button (veto model): counts by default and when approved; only a rejection strikes it', async () => {
    const base = {
      draws: [drawRow('d1', 'camp-1', 'open')],
      entitlements: [{ id: 'ent-1', activationId: 'act-1', prospectId: 'p1', issuedVia: 'hook' }],
      events: [unlockEvent('ev-1', 'ent-1', 'agent_button')],
    };
    const p = prospect('p1', 'camp-1', '+6591110001');

    const unreviewed = buildDeps(base);
    expect((await unreviewed.svc.getProspectDrawStatus([p])).get('p1'))
      .toMatchObject({ chances: 10, boosted: true, boostVia: 'agent_button' });

    const approved = buildDeps({ ...base, reviews: [{ drawId: 'd1', entitlementId: 'ent-1', decision: 'approved' }] });
    expect((await approved.svc.getProspectDrawStatus([p])).get('p1'))
      .toMatchObject({ chances: 10, boosted: true, boostVia: 'agent_button' });

    const rejected = buildDeps({ ...base, reviews: [{ drawId: 'd1', entitlementId: 'ent-1', decision: 'rejected' }] });
    expect((await rejected.svc.getProspectDrawStatus([p])).get('p1'))
      .toMatchObject({ chances: 1, boosted: false });
  });

  it('a manually-ISSUED entitlement never boosts, even under the veto model', async () => {
    const { svc } = buildDeps({
      draws: [drawRow('d1', 'camp-1', 'open')],
      entitlements: [{ id: 'ent-1', activationId: 'act-1', prospectId: 'p1', issuedVia: 'manual' }],
      events: [unlockEvent('ev-1', 'ent-1', 'manual')],
    });
    const map = await svc.getProspectDrawStatus([prospect('p1', 'camp-1', '+6591110001')]);
    expect(map.get('p1')).toMatchObject({ chances: 1, boosted: false });
  });

  it('an unlock at/after the boost cutoff is out of window', async () => {
    const { svc } = buildDeps({
      draws: [drawRow('d1', 'camp-1', 'open')],
      entitlements: [{ id: 'ent-1', activationId: 'act-1', prospectId: 'p1', issuedVia: 'hook' }],
      events: [unlockEvent('ev-1', 'ent-1', 'agent_scan', BOOST_CLOSES_AT.toISOString())],
    });
    const map = await svc.getProspectDrawStatus([prospect('p1', 'camp-1', '+6591110001')]);
    expect(map.get('p1')).toMatchObject({ chances: 1, boosted: false });
  });
});

// ── frozen: the pool is written ─────────────────────────────────────────────

describe('getProspectDrawStatus — frozen draws (persisted membership)', () => {
  const frozen = drawRow('d1', 'camp-1', 'frozen');
  const entry = { id: 'e1', drawId: 'd1', prospectId: 'p1', chances: 1, boostVia: null };

  it('an entry row means frozen_in even if the prospect was edited AFTER freeze', async () => {
    // Verification stripped post-freeze — the live prospect would fail the
    // predicate, but membership is the snapshot, and the page must agree
    // with the pool, not with today's row.
    const { svc } = buildDeps({ draws: [frozen], entries: [entry] });
    const editedAfterFreeze = prospect('p1', 'camp-1', '+6591110001', { verified: false, terms: null });
    const map = await svc.getProspectDrawStatus([editedAfterFreeze]);
    expect(map.get('p1')).toMatchObject({ state: 'frozen_in', chances: 1, provisional: true });
  });

  it('no entry row means excluded_at_freeze, never a re-derived verdict', async () => {
    const { svc } = buildDeps({ draws: [frozen], entries: [] });
    const map = await svc.getProspectDrawStatus([prospect('p1', 'camp-1', '+6591110001')]);
    expect(map.get('p1')).toMatchObject({ state: 'excluded_at_freeze', chances: 0 });
  });

  it('boost evidence over the frozen pool stays provisional until seal', async () => {
    const { svc } = buildDeps({
      draws: [frozen],
      entries: [entry],
      entitlements: [{ id: 'ent-1', activationId: 'act-1', prospectId: 'p1', issuedVia: 'hook' }],
      events: [unlockEvent('ev-1', 'ent-1', 'agent_scan')],
    });
    const map = await svc.getProspectDrawStatus([prospect('p1', 'camp-1', '+6591110001')]);
    expect(map.get('p1')).toMatchObject({
      state: 'frozen_in', chances: 1, boosted: true, boostVia: 'agent_scan', provisional: true,
    });
  });
});

// ── sealed+: stored truth + the redraw ledger ───────────────────────────────

describe('getProspectDrawStatus — sealed and drawn (redraw ledger)', () => {
  const entries = [
    { id: 'e1', drawId: 'd1', prospectId: 'p1', chances: 10, boostVia: 'agent_scan' },
    { id: 'e2', drawId: 'd1', prospectId: 'p2', chances: 1, boostVia: null },
    { id: 'e3', drawId: 'd1', prospectId: 'p3', chances: 1, boostVia: null },
  ];
  const people = [
    prospect('p1', 'camp-1', '+6591110001'),
    prospect('p2', 'camp-1', '+6591110002'),
    prospect('p3', 'camp-1', '+6591110003'),
  ];

  it('sealed with no attempts reads the frozen chances', async () => {
    const { svc } = buildDeps({ draws: [drawRow('d1', 'camp-1', 'sealed')], entries });
    const map = await svc.getProspectDrawStatus(people);
    expect(map.get('p1')).toMatchObject({
      state: 'sealed', chances: 10, boosted: true, boostVia: 'agent_scan', provisional: false, outcome: null,
    });
    expect(map.get('p2')).toMatchObject({ chances: 1, outcome: null });
  });

  it('a declined pick is selected_declined; the next pick pending; the rest not_selected_yet', async () => {
    const { svc } = buildDeps({
      draws: [drawRow('d1', 'camp-1', 'drawn')],
      entries,
      attempts: [
        { id: 'a1', drawId: 'd1', attemptNo: 1, pickedEntryId: 'e1', outcome: 'declined', claimDeadline: new Date('2026-09-20T00:00:00Z') },
        { id: 'a2', drawId: 'd1', attemptNo: 2, pickedEntryId: 'e2', outcome: 'pending', claimDeadline: new Date('2026-09-29T00:00:00Z') },
      ],
    });
    const map = await svc.getProspectDrawStatus(people);
    expect(map.get('p1').outcome).toMatchObject({ status: 'selected_declined', attemptNo: 1 });
    expect(map.get('p2').outcome).toMatchObject({ status: 'selected_pending', attemptNo: 2 });
    expect(map.get('p3').outcome).toMatchObject({ status: 'not_selected_yet' });
  });

  it('a claimed attempt finalizes: winner selected_claimed, the rest not_selected_final', async () => {
    const { svc } = buildDeps({
      draws: [drawRow('d1', 'camp-1', 'claimed')],
      entries,
      attempts: [
        { id: 'a1', drawId: 'd1', attemptNo: 1, pickedEntryId: 'e1', outcome: 'declined' },
        { id: 'a2', drawId: 'd1', attemptNo: 2, pickedEntryId: 'e2', outcome: 'claimed', claimedAt: new Date('2026-09-25T00:00:00Z') },
      ],
    });
    const map = await svc.getProspectDrawStatus(people);
    expect(map.get('p2').outcome).toMatchObject({ status: 'selected_claimed' });
    expect(map.get('p2').outcome.claimedAt).toEqual(new Date('2026-09-25T00:00:00Z'));
    expect(map.get('p1').outcome).toMatchObject({ status: 'selected_declined' });
    expect(map.get('p3').outcome).toMatchObject({ status: 'not_selected_final' });
  });
});

// ── selection, drift, erasure, void ─────────────────────────────────────────

describe('getProspectDrawStatus — draw selection and honesty states', () => {
  it('a live draw wins over terminal history; history is summarized', async () => {
    const { svc } = buildDeps({
      draws: [
        drawRow('d-old', 'camp-1', 'claimed', { createdAt: new Date('2026-05-01T00:00:00Z') }),
        drawRow('d-new', 'camp-1', 'open', { createdAt: new Date('2026-07-01T00:00:00Z') }),
      ],
    });
    const map = await svc.getProspectDrawStatus([prospect('p1', 'camp-1', '+6591110001')]);
    const block = map.get('p1');
    expect(block.drawId).toBe('d-new');
    expect(block.drawHistory).toEqual([
      expect.objectContaining({ drawId: 'd-old', drawStatus: 'claimed' }),
    ]);
  });

  it('void draws say void; erased people get erased_draw_unavailable', async () => {
    const { svc } = buildDeps({
      draws: [drawRow('d1', 'camp-1', 'void'), drawRow('d2', 'camp-2', 'frozen')],
    });
    const map = await svc.getProspectDrawStatus([
      prospect('p1', 'camp-1', '+6591110001'),
      prospect('p2', 'camp-2', '+6591110002', { erased: true }),
    ]);
    expect(map.get('p1').state).toBe('void');
    expect(map.get('p2').state).toBe('erased_draw_unavailable');
  });

  it('config-enabled without a draw record is no_draw_record; disabled is null', async () => {
    const { svc } = buildDeps({
      draws: [],
      campaigns: [
        { id: 'camp-1', design_config: { luckyDraw: { enabled: true } } },
        { id: 'camp-2', design_config: {} },
      ],
    });
    const map = await svc.getProspectDrawStatus([
      prospect('p1', 'camp-1', '+6591110001'),
      prospect('p2', 'camp-2', '+6591110002'),
    ]);
    expect(map.get('p1')).toEqual({ state: 'no_draw_record' });
    expect(map.get('p2')).toBeNull();
  });

  it('stays query-bounded across campaigns (per-draw, never per-signup)', async () => {
    const { svc, deps } = buildDeps({
      draws: [drawRow('d1', 'camp-1', 'open'), drawRow('d2', 'camp-2', 'frozen', { activationId: 'act-2' })],
      entries: [{ id: 'e1', drawId: 'd2', prospectId: 'p3', chances: 1, boostVia: null }],
    });
    await svc.getProspectDrawStatus([
      prospect('p1', 'camp-1', '+6591110001'),
      prospect('p2', 'camp-1', '+6591110002'),
      prospect('p3', 'camp-2', '+6591110003'),
      prospect('p4', 'camp-2', '+6591110004'),
    ]);
    expect(deps.Draw.findAll.mock.calls.length).toBeLessThanOrEqual(2); // campaign query + consistency re-read
    expect(deps.DrawEntry.findAll.mock.calls.length).toBeLessThanOrEqual(1);
    expect(deps.DrawAttempt.findAll.mock.calls.length).toBeLessThanOrEqual(1);
    // Boost evidence: ≤3 queries per DISTINCT open/frozen draw.
    expect(deps.RewardEntitlement.findAll.mock.calls.length).toBeLessThanOrEqual(2);
    expect(deps.RedemptionEvent.findAll.mock.calls.length).toBeLessThanOrEqual(2);
    expect(deps.DrawBoostReview.findAll.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('re-collects once when a freeze lands mid-read (status flip)', async () => {
    const openFirst = drawRow('d1', 'camp-1', 'open');
    const frozenNow = drawRow('d1', 'camp-1', 'frozen');
    const entries = [{ id: 'e1', drawId: 'd1', prospectId: 'p1', chances: 1, boostVia: null }];
    const { deps } = (() => {
      const built = buildDeps({ draws: [openFirst], entries });
      let campaignCalls = 0;
      built.deps.Draw.findAll = jest.fn().mockImplementation(async ({ where }) => {
        if (where?.campaignId) {
          campaignCalls += 1;
          return campaignCalls === 1 ? [{ ...openFirst }] : [{ ...frozenNow }];
        }
        return [{ id: 'd1', status: 'frozen' }]; // the consistency re-read sees the flip
      });
      return built;
    })();
    const svc = makeLuckyDrawService(deps);
    const map = await svc.getProspectDrawStatus([prospect('p1', 'camp-1', '+6591110001')]);
    // Second collection ran and landed on the FROZEN branch (entry-backed).
    expect(map.get('p1')).toMatchObject({ state: 'frozen_in', drawStatus: 'frozen' });
    expect(deps.Draw.findAll.mock.calls.length).toBe(3); // collect + verify + re-collect
  });
});
