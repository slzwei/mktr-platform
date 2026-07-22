/**
 * Marketplace list cache state — deliberately model-free so WRITE-side
 * services (campaignService, redeem-ops activation/reward services) can bust
 * the cache without transitively importing the marketplace read model (and
 * its Redeem Ops model imports) into their own module graphs / test mocks.
 */

let cache = { data: null, ts: 0, mode: null };
let generation = 0;

export function getMarketplaceCacheState() {
  return cache;
}

/** Monotonic invalidation counter — a refresh only commits if no mutation
 * landed while it was in flight (Phase A review finding 2: the old cache
 * could be repopulated with pre-save data by an already-running refresh). */
export function getMarketplaceCacheGeneration() {
  return generation;
}

/** `mode` tags the entry with the inheritance-flag value it was built under
 * (finding 1: a flag flip must never serve the other mode's copy, including
 * via stale-on-error). Returns false when the commit lost to an invalidation. */
export function setMarketplaceCacheState(data, ts, mode = null, gen = generation) {
  if (gen !== generation) return false;
  cache = { data, ts, mode };
  return true;
}

/** Write-side invalidation — admin actions show within one request. */
export function invalidateMarketplaceCache() {
  generation += 1;
  cache = { data: null, ts: 0, mode: null };
}
