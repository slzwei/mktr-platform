import express from 'express';
import { requireRedeemOps } from '../middleware/redeemOpsAuth.js';
import * as ctrl from '../controllers/redeemOps/activationsController.js';

/**
 * Redeem Ops Phase 5 — Activations + read-only MKTR campaign reference
 * (docs/redeem-ops/ROUTE_MAP.md §1, MKTR_INTEGRATION.md §1). Campaign editing
 * never happens here — the projection is attribute-allowlisted and the UI
 * deep-links back to mktr.sg for management.
 */
export const meta = {
  path: '/api/redeem-ops',
  flag: 'REDEEM_OPS_ENABLED',
  flagDefault: 'false',
};

const router = express.Router();

// Read-only MKTR campaign projection (link picker + detail card)
router.get('/campaigns', requireRedeemOps('campaigns.read_reference'), ctrl.searchCampaigns);

// Activations
router.get('/activations', requireRedeemOps('activations.view'), ctrl.listActivations);
router.post('/activations', requireRedeemOps('activations.manage'), ctrl.createActivation);
router.get('/activations/:id', requireRedeemOps('activations.view'), ctrl.getActivation);
router.patch('/activations/:id/campaign', requireRedeemOps('activations.link_campaign'), ctrl.linkCampaign);
router.patch('/activations/:id/allocation', requireRedeemOps('activations.allocate_inventory'), ctrl.changeAllocation);
router.patch('/activations/:id/status', requireRedeemOps('activations.manage'), ctrl.setStatus);
router.get('/activations/:id/campaign-metrics', requireRedeemOps('campaigns.read_reference'), ctrl.getCampaignMetrics);

export default router;
