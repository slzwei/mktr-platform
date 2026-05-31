/**
 * Pure round-robin selection — no DB, no model imports — so the rotation logic
 * is unit-testable in isolation (see test/unit/leadRing.test.js).
 *
 * `ring` is a pre-built array of tagged candidates (internal + external mixed);
 * `cursorValue` is the monotonic per-campaign counter. Modulo is applied at READ
 * time so rotation stays fair as the roster grows or shrinks.
 *
 * @param {Array} ring
 * @param {number} cursorValue
 * @returns {*|null} the selected candidate, or null for an empty/invalid ring
 */
export function pickFromRing(ring, cursorValue) {
  if (!Array.isArray(ring) || ring.length === 0) return null;
  const n = ring.length;
  const idx = (((cursorValue - 1) % n) + n) % n;
  return ring[idx];
}
