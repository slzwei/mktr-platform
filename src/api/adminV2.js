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

/**
 * Lead Profile page (/admin/leads/:id): the full admin enrichment —
 * per-signup draw standing, scoped consent + reward diagnostics, delivery
 * receipts, broadcasts, session, Lyfe delivery (?include=profile, PR #269).
 */
export async function fetchProspectProfile(id) {
  const resp = await apiClient.get(`/prospects/${encodeURIComponent(id)}?include=profile`);
  return resp?.data?.prospect ?? null;
}

/**
 * Consent-version click-through (lead profile "Raw consent versions"): the
 * exact wording that version stamped. 404 → null (era never registered).
 */
export async function fetchConsentCopy(version) {
  try {
    const resp = await apiClient.get(`/consent-copy/${encodeURIComponent(version)}`);
    return resp?.data ?? null;
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/**
 * People directory (/AdminPeople): the deduplicated person list. Rows carry
 * latestProspectId, the profile click-through anchor. params: { q, page,
 * limit, sort }.
 */
export async function fetchConsumers(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  }
  const resp = await apiClient.get(`/consumers?${qs.toString()}`);
  const data = resp?.data ?? {};
  return {
    rows: data.rows || [],
    total: data.total ?? 0,
    page: data.page ?? 1,
    limit: data.limit ?? 25,
  };
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

// ── Cohorts (tracker "cohortui" — /api/cohorts, cohortapi backend) ───────────

export async function fetchCohorts() {
  const resp = await apiClient.get('/cohorts');
  const rows = resp?.data || [];
  return { rows, total: rows.length };
}

/** refresh=1 recomputes counts server-side and persists the snapshot. */
export async function fetchCohort(id, { refresh = false } = {}) {
  const resp = await apiClient.get(`/cohorts/${id}${refresh ? '?refresh=1' : ''}`);
  return resp?.data ?? null;
}

export async function fetchCohortFacets() {
  const resp = await apiClient.get('/cohorts/facets');
  return resp?.data ?? null;
}

/** Stateless preview: definition (+channel) → counts with byReason. */
export async function previewCohortDefinition(definition, channel) {
  const resp = await apiClient.post('/cohorts/preview', {
    definition,
    ...(channel && channel !== 'all' ? { channel } : {}),
  });
  return resp?.data ?? null;
}

export async function fetchCohortMembers(id, { status = 'all', channel, limit = 50, offset = 0 } = {}) {
  const qs = new URLSearchParams({ status, limit: String(limit), offset: String(offset) });
  if (channel && channel !== 'all') qs.set('channel', channel);
  const resp = await apiClient.get(`/cohorts/${id}/members?${qs.toString()}`);
  return resp?.data ?? { total: 0, members: [] };
}

export function createCohort({ name, description, definition }) {
  return apiClient.post('/cohorts', { name, description, definition });
}

export function updateCohort(id, patch) {
  return apiClient.put(`/cohorts/${id}`, patch);
}

export function archiveCohort(id) {
  return apiClient.delete(`/cohorts/${id}`);
}

// ── Email broadcasts (tracker "emailpush" — /api/email-broadcasts) ───────────

export async function fetchEmailBroadcasts() {
  const resp = await apiClient.get('/email-broadcasts');
  const rows = resp?.data || [];
  return { rows, total: rows.length };
}

/** Detail DTO: row + cohort{definition} + campaign + ctaUrlPreview + liveCounts. */
export async function fetchEmailBroadcast(id) {
  const resp = await apiClient.get(`/email-broadcasts/${id}`);
  return resp?.data ?? null;
}

export function createEmailBroadcast({ cohortId, campaignId, subject, bodyText, ctaLabel }) {
  return apiClient.post('/email-broadcasts', {
    cohortId,
    campaignId,
    subject,
    bodyText,
    ...(ctaLabel ? { ctaLabel } : {}),
  });
}

export function updateEmailBroadcast(id, patch) {
  return apiClient.put(`/email-broadcasts/${id}`, patch);
}

export function deleteEmailBroadcast(id) {
  return apiClient.delete(`/email-broadcasts/${id}`);
}

/** Kick a draft send; { resume: true } continues an interrupted/stale one. */
export function sendEmailBroadcast(id, { resume = false } = {}) {
  return apiClient.post(`/email-broadcasts/${id}/send`, resume ? { resume: true } : {});
}

export function cancelEmailBroadcast(id) {
  return apiClient.post(`/email-broadcasts/${id}/cancel`, {});
}

/** Sends a marked test render to the requesting admin's own email. */
export function testEmailBroadcast(id) {
  return apiClient.post(`/email-broadcasts/${id}/test`, {});
}

export async function fetchEmailBroadcastRecipients(id, { status = 'all', limit = 50, offset = 0 } = {}) {
  const qs = new URLSearchParams({ status, limit: String(limit), offset: String(offset) });
  const resp = await apiClient.get(`/email-broadcasts/${id}/recipients?${qs.toString()}`);
  return resp?.data ?? { total: 0, recipients: [] };
}

// ── campaign scoring sheets (campaign-scoring-editor §3-§4) ─────────────────
// All ride /api/admin/scoring-configs, which is UNMOUNTED until the backend
// flips SCORING_CONFIG_ADMIN_ENABLED — a 404 here therefore means "scoring
// controls unavailable on this backend" (flag off OR an old deploy; the two
// are indistinguishable and the UI must not claim to know which — B10).

/** Strict resolve: the editor's read path. Never cached, never fail-open. */
export async function fetchScoringSheet(campaignId) {
  const resp = await apiClient.get(`/admin/scoring-configs/resolve?campaignId=${encodeURIComponent(campaignId)}&strict=1`);
  return resp?.data ?? null;
}

export async function fetchScoringHistory(campaignId, { limit = 50 } = {}) {
  const resp = await apiClient.get(`/admin/scoring-configs/?campaignId=${encodeURIComponent(campaignId)}&limit=${limit}`);
  return resp?.data ?? [];
}

export async function fetchScoringEdition(version) {
  const resp = await apiClient.get(`/admin/scoring-configs/${version}`);
  return resp?.data ?? null;
}

export async function fetchScoringProgress(campaignId) {
  const resp = await apiClient.get(`/admin/scoring-configs/progress?campaignId=${encodeURIComponent(campaignId)}`);
  return resp?.data ?? null;
}

/** The editor's save door: the patch composes server-side onto the winning
 *  RAW doc (§4.1) — the client never merges tiers itself. */
export async function createScoringDraft(campaignId, patch) {
  const resp = await apiClient.post('/admin/scoring-configs/', {
    campaignId, config: patch, composeOnResolved: true,
  });
  return resp?.data ?? null;
}

export async function simulateScoringDraft(version, { sampleMax = 100 } = {}) {
  const resp = await apiClient.post(`/admin/scoring-configs/${version}/simulate`, {
    compareTo: 'resolved', sampleMax,
  });
  return resp?.data ?? null;
}

/** `expectedLiveVersion` is the §4.5 concurrency guard: the version the
 *  editor SAW as live. A 409 means someone else moved the sheet meanwhile.
 *  A 200 may still be `{noOp:true}` — content already live, no regrade. */
export async function approveScoringDraft(version, expectedLiveVersion) {
  const resp = await apiClient.post(`/admin/scoring-configs/${version}/approve`, { expectedLiveVersion });
  return resp?.data ?? null;
}

/** The AI author (campaign-scoring-editor Phase 1.6): reads the campaign's
 *  brief server-side, writes a full sheet, returns {draft, rationale,
 *  simulation}. The draft is inert like any other — same preview + approve
 *  gates; the AI never makes anything live. `description` is the optional
 *  one-line steer (sanitized + length-capped server-side). */
export async function proposeScoringSheet(campaignId, description = '') {
  const resp = await apiClient.post('/admin/scoring-configs/propose', {
    campaignId, description,
  });
  return resp?.data ?? null;
}

/** Rescore-now (Phase 1.5): re-grade this campaign's stale leads inside one
 *  bounded request. The response says exactly how far it got — `remaining`
 *  and `more` are the honest leftovers for another press or the sweep. */
export async function rescoreCampaignScoring(campaignId) {
  const resp = await apiClient.post('/admin/scoring-configs/rescore', { campaignId });
  return resp?.data ?? null;
}

/** Pre-create resolve (Phase 2): what a NEW campaign with this product would
 *  score under — no campaign id exists yet, so the walk starts at the
 *  product tier (or global when no product is picked). Strict, like every
 *  editor read. */
export async function fetchScoringSheetForProduct(productKey) {
  const qs = productKey ? `productKey=${encodeURIComponent(productKey)}&strict=1` : 'strict=1';
  const resp = await apiClient.get(`/admin/scoring-configs/resolve?${qs}`);
  return resp?.data ?? null;
}
