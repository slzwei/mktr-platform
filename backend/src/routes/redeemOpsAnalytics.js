import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireRedeemOps } from '../middleware/redeemOpsAuth.js';
import analyticsService from '../services/redeemOps/analyticsService.js';

/**
 * Redeem Ops Phase 7 — analytics (docs/redeem-ops/ROUTE_MAP.md, brief §29).
 * Read-only aggregates; execs get their own row via scope=me, team-wide views
 * are capability-gated.
 */
export const meta = {
  path: '/api/redeem-ops',
  flag: 'REDEEM_OPS_ENABLED',
  flagDefault: 'false',
};

const router = express.Router();

router.get('/analytics/outreach', requireRedeemOps('analytics.view_own'), asyncHandler(async (req, res) => {
  const teamWide = req.user.role === 'admin'
    || ['super_admin', 'ops_admin', 'bdm', 'campaign_ops', 'redemption_ops', 'analyst'].includes(req.user.redeemOpsRole);
  const ownerUserId = req.query.scope === 'me' || !teamWide ? req.user.id : null;
  const members = await analyticsService.outreachPerformance({ ownerUserId });
  res.json({ success: true, data: { members } });
}));

router.get('/analytics/categories', requireRedeemOps('analytics.view_team'), asyncHandler(async (req, res) => {
  const categories = await analyticsService.categoryPerformance();
  res.json({ success: true, data: { categories } });
}));

router.get('/analytics/rewards', requireRedeemOps('analytics.view_team'), asyncHandler(async (req, res) => {
  const rewards = await analyticsService.rewardPerformance();
  res.json({ success: true, data: { rewards } });
}));

router.get('/analytics/activations', requireRedeemOps('analytics.view_team'), asyncHandler(async (req, res) => {
  const funnels = await analyticsService.activationFunnels();
  res.json({ success: true, data: { funnels } });
}));

export default router;
