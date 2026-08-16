/**
 * Selection fairness (Phase 3, blocker #1).
 *
 * The v1 plan proposed reusing one sealed seed for all N picks, arguing that a
 * strictly decreasing modulus made successive picks independent. It does not:
 * `H mod 4` and `H mod 2` are perfectly correlated (CRT). A 120,000-seed
 * simulation over four equal entries drawing three winners produced a 2× bias
 * on the third prize, which is what got the plan rejected.
 *
 * These tests pin BOTH halves of the fix so it cannot regress:
 *   1. the bias is real and v1 still exhibits it (so the test is meaningful);
 *   2. v2 is uniform on the exact case that failed.
 *
 * The statistical tests use a fixed seed sequence, not randomness, so they are
 * deterministic — a flaky fairness test would get muted, which is the last
 * thing this file should be.
 */
import crypto from 'crypto';
import {
  pickWinnerV1, pickWinnerV2, deriveSelectionDigest, uniformBelow,
  CURRENT_ALGORITHM_VERSION,
} from '../../src/utils/drawSelection.js';

const EQUAL_FOUR = ['A', 'B', 'C', 'D'].map((id) => ({ id, chances: 1 }));

/** Deterministic seed stream — reproducible across runs and machines. */
function seedAt(i) {
  return crypto.createHash('sha256').update(`fairness-fixture|${i}`).digest('hex');
}

/** Distribution of the winner of prize unit `unit` over `n` seeds. */
function distribution(pick, unit, n) {
  const tally = { A: 0, B: 0, C: 0, D: 0 };
  for (let i = 0; i < n; i += 1) {
    const seed = seedAt(i);
    const taken = new Set();
    let winner = null;
    for (let u = 0; u <= unit; u += 1) {
      const eligible = EQUAL_FOUR.filter((e) => !taken.has(e.id));
      winner = pick(seed, eligible, u);
      taken.add(winner.id);
    }
    tally[winner.id] += 1;
  }
  return tally;
}

const share = (tally, n) => Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, v / n]));

describe('v1 — the biased design this module replaced', () => {
  const N = 12000;

  it('is uniform on the FIRST pick (which is why the flaw was missed)', () => {
    const s = share(distribution((seed, eligible) => pickWinnerV1(seed, eligible), 0, N), N);
    for (const p of Object.values(s)) expect(Math.abs(p - 0.25)).toBeLessThan(0.02);
  });

  it('is provably NOT uniform on the third pick — two entries are ~2× as likely', () => {
    const s = share(distribution((seed, eligible) => pickWinnerV1(seed, eligible), 2, N), N);
    const sorted = Object.values(s).sort((a, b) => a - b);
    // Two entries near 1/6, two near 1/3 — the signature of the CRT correlation.
    expect(sorted[0]).toBeLessThan(0.22);
    expect(sorted[3]).toBeGreaterThan(0.28);
    expect(sorted[3] / sorted[0]).toBeGreaterThan(1.6);
  });
});

describe('v2 — domain-separated derivation', () => {
  const N = 12000;
  const pickV2 = (seed, eligible, unit) =>
    pickWinnerV2(seed, eligible, { drawId: 'draw-fixture', unitIndex: unit, attemptNo: unit + 1 });

  it.each([0, 1, 2])('is uniform on pick %i — including the one v1 skewed', (unit) => {
    const s = share(distribution(pickV2, unit, N), N);
    for (const p of Object.values(s)) expect(Math.abs(p - 0.25)).toBeLessThan(0.02);
  });

  it('respects weighting — a 3× entry wins ~3× as often', () => {
    const weighted = [{ id: 'A', chances: 3 }, { id: 'B', chances: 1 }];
    let a = 0;
    for (let i = 0; i < 8000; i += 1) {
      if (pickWinnerV2(seedAt(i), weighted, { drawId: 'd', unitIndex: 0, attemptNo: 1 }).id === 'A') a += 1;
    }
    expect(Math.abs(a / 8000 - 0.75)).toBeLessThan(0.02);
  });

  it('is deterministic — the same inputs always produce the same winner', () => {
    const ctx = { drawId: 'draw-1', unitIndex: 2, attemptNo: 3 };
    const seed = seedAt(42);
    const first = pickWinnerV2(seed, EQUAL_FOUR, ctx);
    for (let i = 0; i < 5; i += 1) {
      expect(pickWinnerV2(seed, EQUAL_FOUR, ctx).id).toBe(first.id);
    }
  });

  it('separates domains — unit, attempt and draw each change the stream', () => {
    const seed = seedAt(7);
    const base = deriveSelectionDigest(seed, { drawId: 'd1', unitIndex: 0, attemptNo: 1, algorithmVersion: 2 });
    const byUnit = deriveSelectionDigest(seed, { drawId: 'd1', unitIndex: 1, attemptNo: 1, algorithmVersion: 2 });
    const byAttempt = deriveSelectionDigest(seed, { drawId: 'd1', unitIndex: 0, attemptNo: 2, algorithmVersion: 2 });
    const byDraw = deriveSelectionDigest(seed, { drawId: 'd2', unitIndex: 0, attemptNo: 1, algorithmVersion: 2 });
    expect(new Set([base, byUnit, byAttempt, byDraw]).size).toBe(4);
  });

  it('returns null rather than throwing when nothing is eligible', () => {
    expect(pickWinnerV2(seedAt(1), [], { drawId: 'd', unitIndex: 0, attemptNo: 1 })).toBeNull();
  });

  it('is the current algorithm version', () => {
    expect(CURRENT_ALGORITHM_VERSION).toBe(2);
  });
});

describe('uniformBelow — rejection sampling', () => {
  it('never returns a value at or above the bound', () => {
    for (let i = 0; i < 200; i += 1) {
      const v = uniformBelow(7n, (c) => deriveSelectionDigest(seedAt(i), {
        drawId: 'd', unitIndex: 0, attemptNo: 1, algorithmVersion: 2, counter: c,
      }));
      expect(v).toBeGreaterThanOrEqual(0n);
      expect(v).toBeLessThan(7n);
    }
  });

  it('rejects digests in the biased tail instead of folding them in', () => {
    // A stream whose first digest is all-ones (2^256-1, above every limit for
    // a non-power-of-two bound) must advance the counter rather than return.
    const seen = [];
    const v = uniformBelow(3n, (counter) => {
      seen.push(counter);
      return counter === 0 ? 'f'.repeat(64) : '00'.repeat(31) + '02';
    });
    expect(seen).toEqual([0, 1]);
    expect(v).toBe(2n);
  });

  it('throws on a non-positive bound rather than looping', () => {
    expect(() => uniformBelow(0n, () => '00'.repeat(32))).toThrow(/positive/);
  });
});
