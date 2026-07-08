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
};
