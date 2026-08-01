/**
 * Shared micro-helpers (P4-1). isPlainObject existed in FIVE utils with TWO
 * different semantics — toString-based (strict: rejects Date/RegExp/Map) vs
 * typeof-based (accepts them) — a latent divergence. The strict form is
 * canonical. campaignBrief.js keeps a local copy by twin discipline
 * (byte-parity with src/lib/campaignBrief.js, dependency-free) but its
 * semantic is aligned to this one.
 */
export function isPlainObject(v) {
  return Object.prototype.toString.call(v) === '[object Object]';
}

/** trim + cap; undefined for non-strings/empties — the config-clamp idiom. */
export function cleanString(v, max) {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}
