import crypto from 'crypto';

/**
 * Winner selection — the cryptographic core of the draw (Phase 3, blocker #1).
 *
 * ## Why this module exists
 *
 * The single-winner engine picked with `sha256(seed) mod totalChances`. That is
 * fine for ONE pick. Reusing the same digest for N picks is NOT: the Phase 3 v1
 * plan claimed successive picks were "effectively independent" because the
 * modulus strictly decreases, and that claim is false. `H mod 4` and `H mod 2`
 * are perfectly correlated (CRT), so the second pick is a deterministic function
 * of the first. A 120,000-seed simulation over four equal entries drawing three
 * winners produced 16.5% / 33.1% / 33.4% / 16.9% on the third prize — a 2× bias.
 *
 * ## The fix
 *
 * Two independent changes, either of which alone would be insufficient:
 *
 * 1. **Domain-separated derivation.** Every selection derives its OWN digest
 *    stream via `HMAC-SHA256(baseSeed, "v<algo>|<drawId>|<unit>|<attempt>|<ctr>")`.
 *    Distinct selections use distinct HMAC messages, so their outputs are
 *    independent under the standard PRF assumption — no shared-factor argument
 *    required. The base seed is unchanged and still hashes to `seedCommitment`,
 *    so commit-reveal verification is untouched and historical rows keep
 *    verifying byte-for-byte.
 *
 * 2. **Rejection sampling instead of modulo.** `mod` over a 256-bit value has a
 *    bias of ~total/2^256 per pick — immeasurable, but it is free to remove and
 *    removing it means the uniformity claim needs no caveat. We discard digests
 *    at or above the largest multiple of `total` that fits in 2^256 and draw
 *    again with an incremented counter. Expected iterations < 1 + 2^-200.
 *
 * ## Versioning
 *
 * `algorithmVersion` is stored on the draw row and passed in explicitly.
 *   v1 — legacy `sha256(seed) mod total`, single winner. Frozen forever so
 *        every historical draw replays exactly as it ran.
 *   v2 — this module's derivation. All new draws.
 *
 * Never change the bytes a version produces; add a version instead.
 */

export const ALGORITHM_V1_LEGACY_MOD = 1;
export const ALGORITHM_V2_DERIVED = 2;
export const CURRENT_ALGORITHM_VERSION = ALGORITHM_V2_DERIVED;

const TWO_256 = 1n << 256n;

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * The per-selection digest stream. `counter` only advances on a rejection, so
 * for essentially every real draw the answer comes from counter 0.
 *
 * The message binds the pick to its draw, prize unit and attempt number, so no
 * two selections anywhere — same draw or not — ever share a digest stream.
 */
export function deriveSelectionDigest(baseSeedHex, { drawId, unitIndex, attemptNo, algorithmVersion, counter = 0 }) {
  const message = `v${algorithmVersion}|${drawId}|${unitIndex}|${attemptNo}|${counter}`;
  return crypto.createHmac('sha256', Buffer.from(String(baseSeedHex), 'utf8')).update(message).digest('hex');
}

/**
 * Uniform integer in [0, total) with no modulo bias, from the derived stream.
 * `total` is a positive BigInt.
 */
export function uniformBelow(total, deriveAt) {
  if (total <= 0n) throw new Error('uniformBelow: total must be positive');
  // Largest multiple of `total` representable in 256 bits; values at or above
  // it would over-represent the low residues, so they are rejected.
  const limit = TWO_256 - (TWO_256 % total);
  for (let counter = 0; counter < 1000; counter += 1) {
    const value = BigInt(`0x${deriveAt(counter)}`);
    if (value < limit) return value % total;
  }
  // Unreachable for any real `total`: each iteration rejects with probability
  // < 2^-200. Throwing beats looping forever if that assumption ever breaks.
  throw new Error('uniformBelow: rejection sampling failed to converge');
}

/**
 * Walk the chances-ordered list to the entry holding `index`.
 * Entries must already be in the canonical order (id ASC).
 */
function entryAtChanceIndex(eligibleEntries, index) {
  let cumulative = 0n;
  for (const entry of eligibleEntries) {
    cumulative += BigInt(entry.chances);
    if (index < cumulative) return entry;
  }
  return null;
}

/**
 * Legacy v1 pick — `sha256(seed) mod totalChances`, exactly as the
 * single-winner engine did it. Preserved verbatim so historical draws and
 * their verification reports never change.
 */
export function pickWinnerV1(seedHex, eligibleEntries) {
  const total = eligibleEntries.reduce((n, e) => n + e.chances, 0);
  if (total <= 0) return null;
  const index = BigInt(`0x${sha256Hex(seedHex)}`) % BigInt(total);
  return entryAtChanceIndex(eligibleEntries, index);
}

/**
 * v2 pick for one prize unit. Pure: same inputs always give the same winner,
 * which is what lets verifyDraw re-derive every pick years later.
 *
 * `eligibleEntries` must be the canonical-ordered, already-filtered set (no
 * erased entrants, no previously picked entrants) — the caller owns exclusion
 * because the exclusion set is global across units.
 */
export function pickWinnerV2(baseSeedHex, eligibleEntries, { drawId, unitIndex, attemptNo }) {
  const total = eligibleEntries.reduce((n, e) => n + e.chances, 0);
  if (total <= 0) return null;
  const index = uniformBelow(BigInt(total), (counter) =>
    deriveSelectionDigest(baseSeedHex, {
      drawId, unitIndex, attemptNo, algorithmVersion: ALGORITHM_V2_DERIVED, counter,
    })
  );
  return entryAtChanceIndex(eligibleEntries, index);
}

/**
 * Version-dispatching pick — the ONE entry point the engine and the verifier
 * both call, so a replay can never drift from the ceremony that ran.
 */
export function pickWinnerFor(algorithmVersion, baseSeedHex, eligibleEntries, context) {
  return Number(algorithmVersion) === ALGORITHM_V2_DERIVED
    ? pickWinnerV2(baseSeedHex, eligibleEntries, context)
    : pickWinnerV1(baseSeedHex, eligibleEntries);
}
