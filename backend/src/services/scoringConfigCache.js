/**
 * The resolved-scoring-config cache (per-campaign-lead-scoring.md §9).
 *
 * A LEAF MODULE ON PURPOSE. Both resolution-input writers have to bust this —
 * the config writer (an approval at any scope) and `campaignService.updateCampaign`
 * (a brief edit that changes `targetAudience.product` re-routes a campaign to a
 * different product chain without any config row changing). Putting the Map in
 * `consumerScoringService` would make campaignService import the whole
 * enrichment chain — models, the erasure fence, the fact resolver — and the
 * suites that mock `models/index.js` with a partial export set fail to link on
 * the transitive `Consumer` import. Nothing here imports anything.
 *
 * Keys are resolution ENTRY POINTS: `campaign:<uuid>` | `product:<key>` |
 * `global`. Each entry may hold an INHERITED row — a `campaign:C` entry can be
 * carrying the product or global config — which is exactly why invalidation is
 * whole-map rather than per-key: per-key would need reverse-dependency
 * bookkeeping to know which campaigns inherited from the row that just moved.
 *
 * IN-PROCESS ONLY. Other instances, and the standalone scripts that run with a
 * fresh cache of their own, converge within one TTL — the same cross-process
 * bound the single-slot cache this replaces already accepted.
 */

/** Config changes a few times a year; 60s keeps a sweep of thousands of rows
 *  from re-reading it per row while still picking up a calibration the same
 *  night. Unchanged from the single-slot cache. */
export const CONFIG_TTL_MS = 60_000;

const cache = new Map();

export function cacheKeyFor({ campaignId = null, productKey = null } = {}) {
  if (campaignId) return `campaign:${campaignId}`;
  if (productKey) return `product:${productKey}`;
  return 'global';
}

/** The cached value, or undefined when absent or past its TTL. */
export function readScoringConfigCache(key, now) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (now - hit.loadedAt >= CONFIG_TTL_MS) return undefined;
  return hit.value;
}

export function writeScoringConfigCache(key, value, now) {
  cache.set(key, { value, loadedAt: now });
}

/**
 * Whole-map invalidation. Called by BOTH resolution-input writers; see the
 * header for why it cannot be per-key. A full bust costs one refetch per live
 * key, and the map holds at most (campaigns + products + 1) entries.
 */
export function bustScoringConfigCache() {
  cache.clear();
}

/** Test seam — the same door bustScoringConfigCache uses, named for intent. */
export function _resetScoringConfigCache() {
  cache.clear();
}

/** Introspection for tests: how many entries are live right now. */
export function _scoringConfigCacheSize() {
  return cache.size;
}
