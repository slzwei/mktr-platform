import { apiClient } from './client';

/**
 * Redeem Ops API (Phase 1 — docs/redeem-ops/ROUTE_MAP.md). Thin wrappers over the
 * shared APIClient; every endpoint is flag-mounted server-side (REDEEM_OPS_ENABLED)
 * and capability-gated (middleware/redeemOpsAuth.js).
 */
export const redeemOpsApi = {
  async getTeam() {
    const res = await apiClient.get('/redeem-ops/team');
    return res.data?.team || [];
  },

  async inviteTeamMember({ email, fullName, redeemOpsRole }) {
    const res = await apiClient.post('/redeem-ops/team/invite', {
      email,
      full_name: fullName,
      redeemOpsRole,
    });
    return res.data;
  },

  async updateTeamMember(userId, body) {
    const res = await apiClient.patch(`/redeem-ops/team/${userId}`, body);
    return res.data?.user;
  },
  async setTeamRole(userId, redeemOpsRole) {
    const res = await apiClient.patch(`/redeem-ops/team/${userId}/role`, { redeemOpsRole });
    return res.data;
  },

  async getAudit(params = {}) {
    const res = await apiClient.get('/redeem-ops/audit', params);
    return res.data;
  },

  async getConstants() {
    const res = await apiClient.get('/redeem-ops/meta/constants');
    return res.data;
  },

  // ── Category taxonomy (admin-managed; feeds pickers everywhere) ────────
  async listCategories(params = {}) {
    const res = await apiClient.get('/redeem-ops/categories', params);
    return res.data?.categories || [];
  },
  async createCategory(body) {
    const res = await apiClient.post('/redeem-ops/categories', body);
    return res.data?.category;
  },
  async updateCategory(id, body) {
    const res = await apiClient.patch(`/redeem-ops/categories/${id}`, body);
    return res.data?.category;
  },
  async mergeCategory(id, targetId) {
    const res = await apiClient.post(`/redeem-ops/categories/${id}/merge`, { targetId });
    return res.data;
  },
  async deleteCategory(id) {
    const res = await apiClient.delete(`/redeem-ops/categories/${id}`);
    return res.data;
  },

  // ── Discover territories (admin-curated search filters) ───────────────
  async listTerritories(params = {}) {
    const res = await apiClient.get('/redeem-ops/territories', params);
    return {
      enabled: res.data?.enabled === true,
      territories: res.data?.territories || [],
    };
  },
  async createTerritory(body) {
    const res = await apiClient.post('/redeem-ops/territories', body);
    return res.data?.territory;
  },
  async updateTerritory(id, body) {
    const res = await apiClient.patch(`/redeem-ops/territories/${id}`, body);
    return res.data?.territory;
  },
  async deleteTerritory(id) {
    const res = await apiClient.delete(`/redeem-ops/territories/${id}`);
    return res.data;
  },

  // ── Discover tool (Apify prospecting) ──────────────────────────────────
  async startDiscovery(body) {
    const res = await apiClient.post('/redeem-ops/discovery/runs', body);
    return res.data?.run;
  },
  async listDiscoveryRuns(params = {}) {
    const res = await apiClient.get('/redeem-ops/discovery/runs', params);
    return {
      runs: res.data?.runs || [],
      quota: res.data?.quota || null,
      igEnabled: res.data?.igEnabled === true,
      aiEnabled: res.data?.aiEnabled === true,
    };
  },
  async suggestDiscoveryTerms(body) {
    const res = await apiClient.post('/redeem-ops/discovery/suggest-terms', body);
    return { terms: res.data?.terms || [], categories: res.data?.categories || [] };
  },
  async getDiscoveryRun(id) {
    const res = await apiClient.get(`/redeem-ops/discovery/runs/${id}`);
    return res.data; // { run, candidates }
  },
  async enrichDiscoveryCandidates(candidateIds) {
    const res = await apiClient.post('/redeem-ops/discovery/candidates/enrich', { candidateIds });
    return res.data?.run;
  },
  async addDiscoveryCandidates(runId, candidateIds) {
    const res = await apiClient.post(`/redeem-ops/discovery/runs/${runId}/add`, { candidateIds });
    return res.data; // { added, skipped, failed, notFound, errors }
  },
  async dismissDiscoveryCandidate(id) {
    const res = await apiClient.patch(`/redeem-ops/discovery/candidates/${id}`, {});
    return res.data;
  },
  async restoreDiscoveryCandidate(id) {
    const res = await apiClient.patch(`/redeem-ops/discovery/candidates/${id}`, { action: 'restore' });
    return res.data;
  },

  // ── Partner CRM (Phase 2) ──────────────────────────────────────────────
  async listPartners(params = {}) {
    const res = await apiClient.get('/redeem-ops/partners', params);
    return res.data;
  },
  async checkDuplicates(params = {}) {
    const res = await apiClient.get('/redeem-ops/partners/check-duplicates', params);
    return res.data?.duplicates || { exact: [], potential: [] };
  },
  async createPartner(body) {
    const res = await apiClient.post('/redeem-ops/partners', body);
    return res.data;
  },
  async getPartner(id) {
    const res = await apiClient.get(`/redeem-ops/partners/${id}`);
    return res.data?.partner;
  },
  async updatePartner(id, body) {
    const res = await apiClient.put(`/redeem-ops/partners/${id}`, body);
    return res.data?.partner;
  },
  async importPartners(rows) {
    const res = await apiClient.post('/redeem-ops/partners/import', { rows });
    return res.data;
  },
  async mergePartners(survivorId, duplicateId, reason) {
    const res = await apiClient.post(`/redeem-ops/partners/${survivorId}/merge`, { duplicateId, reason });
    return res.data?.partner;
  },
  async deletePartner(id, { force = false } = {}) {
    const res = await apiClient.delete(`/redeem-ops/partners/${id}${force ? '?force=true' : ''}`);
    return res;
  },
  async claimPartner(id) {
    const res = await apiClient.post(`/redeem-ops/partners/${id}/claim`, {});
    return res.data;
  },
  async releasePartner(id, reason) {
    const res = await apiClient.post(`/redeem-ops/partners/${id}/release`, { reason });
    return res.data;
  },
  async assignPartner(id, toUserId, reason) {
    const res = await apiClient.post(`/redeem-ops/partners/${id}/assign`, { toUserId, reason });
    return res.data;
  },
  async changeStage(id, toStage, reason, lostReason) {
    const res = await apiClient.patch(`/redeem-ops/partners/${id}/stage`, { toStage, reason, lostReason });
    return res.data;
  },
  async snoozePartner(id, until) {
    const res = await apiClient.post(`/redeem-ops/partners/${id}/snooze`, { until });
    return res.data;
  },
  async unsnoozePartner(id) {
    const res = await apiClient.post(`/redeem-ops/partners/${id}/unsnooze`);
    return res.data;
  },
  async undoStage(id) {
    const res = await apiClient.post(`/redeem-ops/partners/${id}/stage/undo`, {});
    return res.data;
  },
  async getTimeline(id, params = {}) {
    const res = await apiClient.get(`/redeem-ops/partners/${id}/timeline`, params);
    return res.data?.entries || [];
  },
  async logActivity(id, body) {
    const res = await apiClient.post(`/redeem-ops/partners/${id}/activities`, body);
    return res.data?.activity;
  },
  async addContact(id, body) {
    const res = await apiClient.post(`/redeem-ops/partners/${id}/contacts`, body);
    return res.data?.contact;
  },
  async updateContact(contactId, body) {
    const res = await apiClient.patch(`/redeem-ops/contacts/${contactId}`, body);
    return res.data?.contact;
  },
  async archiveContact(contactId) {
    const res = await apiClient.post(`/redeem-ops/contacts/${contactId}/archive`, {});
    return res.data;
  },
  async addLocation(id, body) {
    const res = await apiClient.post(`/redeem-ops/partners/${id}/locations`, body);
    return res.data?.location;
  },
  async updateLocation(locationId, body) {
    const res = await apiClient.patch(`/redeem-ops/locations/${locationId}`, body);
    return res.data?.location;
  },

  // ── Queue, tasks, pools (Phase 3) ──────────────────────────────────────
  async getMyQueue() {
    const res = await apiClient.get('/redeem-ops/queue');
    return res.data;
  },
  async getTeamPipeline() {
    const res = await apiClient.get('/redeem-ops/team/pipeline');
    return res.data;
  },
  async listTasks(params = {}) {
    const res = await apiClient.get('/redeem-ops/tasks', params);
    return res.data;
  },
  async createTask(body) {
    const res = await apiClient.post('/redeem-ops/tasks', body);
    return res.data?.task;
  },
  async updateTask(taskId, body) {
    const res = await apiClient.patch(`/redeem-ops/tasks/${taskId}`, body);
    return res.data?.task;
  },
  async listPools() {
    const res = await apiClient.get('/redeem-ops/pools');
    return res.data?.pools || [];
  },
  async createPool(body) {
    const res = await apiClient.post('/redeem-ops/pools', body);
    return res.data?.pool;
  },
  async addPoolMembers(poolId, partnerIds) {
    const res = await apiClient.post(`/redeem-ops/pools/${poolId}/members`, { partnerIds });
    return res.data;
  },
  async claimNextFromPool(poolId) {
    const res = await apiClient.post(`/redeem-ops/pools/${poolId}/claim-next`, {});
    return res.data;
  },

  // ── Rewards + onboarding (Phase 4) ─────────────────────────────────────
  async listRewards(params = {}) {
    const res = await apiClient.get('/redeem-ops/rewards', params);
    return res.data?.offers || [];
  },
  async getReward(id) {
    const res = await apiClient.get(`/redeem-ops/rewards/${id}`);
    return res.data;
  },
  async createReward(body) {
    const res = await apiClient.post('/redeem-ops/rewards', body);
    return res.data?.offer;
  },
  async updateReward(id, body) {
    const res = await apiClient.put(`/redeem-ops/rewards/${id}`, body);
    return res.data?.offer;
  },
  async setRewardStatus(id, status) {
    const res = await apiClient.patch(`/redeem-ops/rewards/${id}/status`, { status });
    return res.data?.offer;
  },
  async addRewardTerms(id, body) {
    const res = await apiClient.post(`/redeem-ops/rewards/${id}/terms`, body);
    return res.data?.terms;
  },
  async setRewardLocations(id, partnerLocationIds) {
    const res = await apiClient.put(`/redeem-ops/rewards/${id}/locations`, { partnerLocationIds });
    return res.data;
  },
  async adjustRewardInventory(id, body) {
    const res = await apiClient.post(`/redeem-ops/rewards/${id}/inventory`, body);
    return res.data;
  },
  async getRewardLedger(id, params = {}) {
    const res = await apiClient.get(`/redeem-ops/rewards/${id}/ledger`, params);
    return res.data?.events || [];
  },
  async getOnboarding(partnerId) {
    const res = await apiClient.get(`/redeem-ops/partners/${partnerId}/onboarding`);
    return res.data?.items || [];
  },
  async updateOnboardingItem(itemId, body) {
    const res = await apiClient.patch(`/redeem-ops/onboarding/${itemId}`, body);
    return res.data?.item;
  },

  // ── Activations + campaign reference (Phase 5) ─────────────────────────
  async searchCampaigns(params = {}) {
    const res = await apiClient.get('/redeem-ops/campaigns', params);
    return res.data?.campaigns || [];
  },
  async listActivations(params = {}) {
    const res = await apiClient.get('/redeem-ops/activations', params);
    return res.data?.activations || [];
  },
  async getActivation(id) {
    const res = await apiClient.get(`/redeem-ops/activations/${id}`);
    return res.data;
  },
  async createActivation(body) {
    const res = await apiClient.post('/redeem-ops/activations', body);
    return res.data?.activation;
  },
  async linkActivationCampaign(id, campaignId) {
    const res = await apiClient.patch(`/redeem-ops/activations/${id}/campaign`, { campaignId });
    return res.data?.activation;
  },
  async changeActivationAllocation(id, delta, reason) {
    const res = await apiClient.patch(`/redeem-ops/activations/${id}/allocation`, { delta, reason });
    return res.data?.activation;
  },
  async setActivationStatus(id, status) {
    const res = await apiClient.patch(`/redeem-ops/activations/${id}/status`, { status });
    return res.data?.activation;
  },
  async getActivationMetrics(id) {
    const res = await apiClient.get(`/redeem-ops/activations/${id}/campaign-metrics`);
    return res.data;
  },

  // ── Fulfilment (Phase 6) ───────────────────────────────────────────────
  async listEntitlements(params = {}) {
    const res = await apiClient.get('/redeem-ops/entitlements', params);
    return res.data;
  },
  async unlockEntitlement(body) {
    // { prospectId } or { presentationToken }. Manual unlock — admins only
    // in practice (server enforces the assigned-consultant binding otherwise).
    const res = await apiClient.post('/redeem-ops/entitlements/unlock', body);
    return res.data;
  },
  async resendEntitlementPass(id, { channel = 'email' } = {}) {
    // Re-mints the current credential (the old QR/link dies) and either emails
    // it or returns { link, waMessage, waUrl } once for staff to share.
    // Full response returned — the toast needs the server's message.
    return apiClient.post(`/redeem-ops/entitlements/${id}/resend-pass`, { channel });
  },
  async cancelEntitlement(id, { reason } = {}) {
    // Voids an eligible/issued entitlement: the QR/link dies, inventory is
    // returned to the activation pool, and the one-live-reward-per-phone slot
    // is freed. Server requires a non-empty reason (audited).
    const res = await apiClient.patch(`/redeem-ops/entitlements/${id}/cancel`, { reason });
    return res.data;
  },
  async reverseRedemption(redemptionId, { reason } = {}) {
    // Voids a REDEEMED reward: reverses the redemption (terminal) and cancels
    // the entitlement, which frees the one-live-reward-per-phone slot so the
    // number can earn a new reward on that activation. Audited; requires the
    // redemptions.override capability + a non-empty reason.
    const res = await apiClient.post(`/redeem-ops/redemptions/${redemptionId}/reverse`, { reason });
    return res.data;
  },
  async verifyVoucher(token) {
    const res = await apiClient.post('/redeem-ops/redemptions/verify', { token });
    return res.data;
  },
  async completeRedemption(token, extra = {}) {
    const res = await apiClient.post('/redeem-ops/redemptions/complete', { token, ...extra });
    return res.data;
  },
  async listRedemptions(params = {}) {
    const res = await apiClient.get('/redeem-ops/redemptions', params);
    return res.data;
  },

  // ── Analytics (Phase 7) ────────────────────────────────────────────────
  async getOutreachAnalytics(params = {}) {
    const res = await apiClient.get('/redeem-ops/analytics/outreach', params);
    return res.data;
  },
  async getCategoryAnalytics() {
    const res = await apiClient.get('/redeem-ops/analytics/categories');
    return res.data;
  },
  async getRewardAnalytics() {
    const res = await apiClient.get('/redeem-ops/analytics/rewards');
    return res.data;
  },
  async getActivationAnalytics() {
    const res = await apiClient.get('/redeem-ops/analytics/activations');
    return res.data;
  },
  async setActivationRenewal(id, renewalOutcome) {
    const res = await apiClient.patch(`/redeem-ops/activations/${id}/renewal`, { renewalOutcome });
    return res.data?.activation;
  },

  // ── Cadences (docs/plans/redeem-ops-cadences.md; flag REDEEM_OPS_CADENCES_ENABLED) ──
  async listCadences(params = {}) {
    const res = await apiClient.get('/redeem-ops/cadences', params);
    return {
      cadences: res.data?.cadences || [],
      aiEnabled: res.data?.aiEnabled === true,
    };
  },
  async suggestCadence(body) {
    const res = await apiClient.post('/redeem-ops/cadences/suggest', body);
    return res.data?.draft;
  },
  async createCadence(body) {
    const res = await apiClient.post('/redeem-ops/cadences', body);
    return res.data?.cadence;
  },
  async createCadenceVersion(cadenceId, body) {
    const res = await apiClient.post(`/redeem-ops/cadences/${cadenceId}/versions`, body);
    return res.data?.cadence;
  },
  async retireCadence(cadenceId) {
    const res = await apiClient.post(`/redeem-ops/cadences/${cadenceId}/retire`);
    return res.data?.cadence;
  },
  async publishCadence(cadenceId) {
    const res = await apiClient.post(`/redeem-ops/cadences/${cadenceId}/publish`);
    return res.data?.cadence;
  },
  async getPartnerCadence(partnerId) {
    const res = await apiClient.get(`/redeem-ops/partners/${partnerId}/cadence`);
    return res.data;
  },
  async enrollCadence(partnerId, body) {
    const res = await apiClient.post(`/redeem-ops/partners/${partnerId}/cadence/enroll`, body);
    return res.data;
  },
  async completeCadenceTask(taskId, body) {
    const res = await apiClient.post(`/redeem-ops/cadence-tasks/${taskId}/complete`, body);
    return res.data;
  },
  async pauseCadence(partnerId) {
    const res = await apiClient.post(`/redeem-ops/partners/${partnerId}/cadence/pause`);
    return res.data?.enrollment;
  },
  async resumeCadence(partnerId) {
    const res = await apiClient.post(`/redeem-ops/partners/${partnerId}/cadence/resume`);
    return res.data?.enrollment;
  },
  async stopCadence(partnerId) {
    const res = await apiClient.post(`/redeem-ops/partners/${partnerId}/cadence/stop`);
    return res.data?.enrollment;
  },
};
