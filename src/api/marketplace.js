import { apiClient } from '@/api/client';

/**
 * Marketplace read API (redeem.sg consumer surfaces).
 * Backend: GET /api/marketplace/campaigns[/:slug] — composed two-layer DTOs
 * (design_config + ops), publication-gated server-side, 60s service cache.
 * A short module-level cache avoids refetching the list on every route change
 * within one session (the browse surfaces share it).
 */

const LIST_TTL_MS = 60_000;
let listCache = { data: null, ts: 0 };
let listInflight = null;

export async function listMarketplaceCampaigns() {
  const now = Date.now();
  if (listCache.data && now - listCache.ts < LIST_TTL_MS) return listCache.data;
  if (listInflight) return listInflight;
  listInflight = apiClient
    .get('/marketplace/campaigns', { skipAuth: true })
    .then((resp) => {
      const campaigns = resp?.data?.campaigns || [];
      listCache = { data: campaigns, ts: Date.now() };
      return campaigns;
    })
    .finally(() => {
      listInflight = null;
    });
  return listInflight;
}

/** Detail is always fetched live (sold-out/paused must be immediate). */
export async function getMarketplaceCampaign(slug) {
  try {
    const resp = await apiClient.get(`/marketplace/campaigns/${encodeURIComponent(slug)}`, { skipAuth: true });
    return resp?.data?.campaign || null;
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/** Test hook. */
export function __resetMarketplaceListCache() {
  listCache = { data: null, ts: 0 };
  listInflight = null;
}
