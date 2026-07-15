/**
 * Switchboard admin v2 data layer — thin fetchers over the authed apiClient,
 * one per Phase B contract (docs/plans/mktr-admin-rebuild-implementation.md).
 * Adapters unwrap each endpoint's REAL envelope and normalize list results to
 * { rows, total } so table components never learn per-endpoint shapes.
 */
import { apiClient } from '@/api/client';

export async function fetchOverview(period) {
  const resp = await apiClient.get(`/dashboard/overview?period=${encodeURIComponent(period)}`);
  return resp?.data?.stats ?? null;
}

export async function fetchAttention() {
  const resp = await apiClient.get('/dashboard/attention');
  return resp?.data ?? null;
}

export async function fetchSeries(period) {
  const resp = await apiClient.get(`/dashboard/series?period=${encodeURIComponent(period)}`);
  return resp?.data ?? null;
}

export async function fetchFunnel(period) {
  const resp = await apiClient.get(`/dashboard/funnel?period=${encodeURIComponent(period)}`);
  return resp?.data ?? null;
}

/**
 * Prospects list. params: { page, limit, leadStatus (csv), leadSource (csv),
 * assignment ('held'|'unassigned'|'assigned'), search, sort, campaignId }.
 * Returns { rows, total, page, totalPages }.
 */
export async function fetchProspects(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  }
  const resp = await apiClient.get(`/prospects?${qs.toString()}`);
  const data = resp?.data ?? {};
  return {
    rows: data.prospects || [],
    total: data.pagination?.totalItems ?? 0,
    page: data.pagination?.currentPage ?? 1,
    totalPages: data.pagination?.totalPages ?? 0,
  };
}

/** Campaign leaderboard source — extended admin list (B6). */
export async function fetchCampaignsList(period) {
  const resp = await apiClient.get(`/campaigns?period=${encodeURIComponent(period)}&limit=100`);
  const data = resp?.data ?? {};
  return { rows: data.campaigns || [], total: data.pagination?.totalItems ?? (data.campaigns || []).length };
}

/** Agent picker for the bulk assign action (staff-facing lightweight list). */
export async function fetchAgentOptions() {
  const resp = await apiClient.get('/agents?limit=200&status=active');
  const data = resp?.data ?? {};
  return (data.agents || []).map((a) => ({
    id: a.id,
    name: a.fullName || `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.email,
  }));
}

// ── Bulk actions (existing endpoints — wired LIVE, not stubbed) ──────────────

export function bulkAssign(prospectIds, agentId) {
  return apiClient.patch('/prospects/bulk/assign', { prospectIds, agentId });
}

export function bulkReturnToHeld(prospectIds) {
  return apiClient.patch('/prospects/bulk/return-to-held', { prospectIds });
}

export function bulkDelete(prospectIds) {
  return apiClient.post('/prospects/bulk/delete', { prospectIds });
}
