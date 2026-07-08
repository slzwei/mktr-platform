import express from 'express';
import { requireRedeemOps } from '../middleware/redeemOpsAuth.js';
import * as ctrl from '../controllers/redeemOps/adminController.js';

/**
 * Redeem Ops Phase 1 — team access, audit trail, domain constants
 * (docs/redeem-ops/ROUTE_MAP.md §1). DARK by default: the route auto-loader only
 * mounts this when REDEEM_OPS_ENABLED="true" (house pattern: BILLING_ENABLED on
 * externalBilling.js). The namespace is additionally host-guarded — blocked from
 * consumer redeem.sg, allow-listed for ops.redeem.sg
 * (middleware/internalRouteHostGuard.js).
 */
export const meta = {
  path: '/api/redeem-ops',
  flag: 'REDEEM_OPS_ENABLED',
  flagDefault: 'false',
};

const router = express.Router();

// Team & access
router.get('/team', requireRedeemOps('analytics.view_team'), ctrl.listTeam);
router.post('/team/invite', requireRedeemOps('team.manage_access'), ctrl.inviteTeamMember);
router.patch('/team/:userId/role', requireRedeemOps('team.manage_access'), ctrl.setTeamRole);

// Audit trail
router.get('/audit', requireRedeemOps('audit.view'), ctrl.listAudit);

// Domain constants (any authenticated Redeem Ops principal)
router.get('/meta/constants', requireRedeemOps(), ctrl.getConstants);

export default router;
