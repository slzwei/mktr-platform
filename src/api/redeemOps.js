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
  async changeStage(id, toStage, reason) {
    const res = await apiClient.patch(`/redeem-ops/partners/${id}/stage`, { toStage, reason });
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
};
