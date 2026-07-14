/**
 * Marketplace list cache state — deliberately model-free so WRITE-side
 * services (campaignService, redeem-ops activation/reward services) can bust
 * the cache without transitively importing the marketplace read model (and
 * its Redeem Ops model imports) into their own module graphs / test mocks.
 */

let cache = { data: null, ts: 0 };

export function getMarketplaceCacheState() {
  return cache;
}

export function setMarketplaceCacheState(data, ts) {
  cache = { data, ts };
}

/** Write-side invalidation — admin actions show within one request. */
export function invalidateMarketplaceCache() {
  cache = { data: null, ts: 0 };
}
