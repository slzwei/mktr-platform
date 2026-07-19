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

/**
 * Full prospect detail (drawer): the list row is a thin projection — this adds
 * the admin enrichments (repeatSignup, timeline, and the consumer-spine
 * `consumer` journey block) and lets deep-links open off-page leads.
 */
export async function fetchProspectDetail(id) {
  const resp = await apiClient.get(`/prospects/${encodeURIComponent(id)}`);
  return resp?.data?.prospect ?? null;
}

/** Campaign leaderboard source — extended admin list (B6). */
export async function fetchCampaignsList(period) {
  const resp = await apiClient.get(`/campaigns?period=${encodeURIComponent(period)}&limit=100`);
  const data = resp?.data ?? {};
  return { rows: data.campaigns || [], total: data.pagination?.totalItems ?? (data.campaigns || []).length };
}

/** Agent picker for bulk assign + group membership (lightweight roster slice). */
export async function fetchAgentOptions() {
  const resp = await apiClient.get('/agents?limit=200&status=active');
  const data = resp?.data ?? {};
  return (data.agents || []).map((a) => ({
    id: a.id,
    name: a.fullName || `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.email,
    phone: a.phone || null,
    email: a.email || null,
    firstName: a.firstName || '',
    lastName: a.lastName || '',
  }));
}

/** Full agents roster (B7 aggregates: assignedThisPeriod, wallet columns…). */
export async function fetchAgentsRoster({ period = '30d', search = '', status = '' } = {}) {
  const qs = new URLSearchParams({ limit: '200', period });
  if (search) qs.set('search', search);
  if (status) qs.set('status', status);
  const resp = await apiClient.get(`/agents?${qs.toString()}`);
  const data = resp?.data ?? {};
  return { rows: data.agents || [], total: data.pagination?.totalItems ?? (data.agents || []).length };
}

/** Campaign detail composite (B6): campaign + 30d series + commitments + recent + QR tags. */
export async function fetchCampaignSummary(id) {
  const resp = await apiClient.get(`/campaigns/${id}/summary`);
  return resp?.data ?? null;
}

// ── Wallets & Commitments (Phase A admin endpoints — live-dark in prod) ─────

export async function fetchWallets() {
  const resp = await apiClient.get('/admin/wallets');
  return resp?.data?.wallets || [];
}

export async function fetchWalletLedger(agentId, { page = 1, limit = 25 } = {}) {
  const resp = await apiClient.get(`/admin/wallets/${agentId}/ledger?page=${page}&limit=${limit}`);
  return resp?.data ?? { entries: [], total: 0, page: 1, limit };
}

/** Manual adjustment — signed cents + MANDATORY note; requestId = idempotency key. */
export function adjustWallet(agentId, { amountCents, note, requestId }) {
  return apiClient.post(`/admin/wallets/${agentId}/adjust`, { amountCents, note, requestId });
}

// ── Agent groups (named phone-keyed member collections) ─────────────────────

export async function fetchAgentGroups() {
  const resp = await apiClient.get('/admin/agent-groups');
  return resp?.data || [];
}

export function createAgentGroup({ name, description, agents }) {
  return apiClient.post('/admin/agent-groups', { name, description, agents });
}

export function updateAgentGroup(id, { name, description, agents }) {
  return apiClient.put(`/admin/agent-groups/${id}`, { name, description, agents });
}

export function deleteAgentGroup(id) {
  return apiClient.delete(`/admin/agent-groups/${id}`);
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
