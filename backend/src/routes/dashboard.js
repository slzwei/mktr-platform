import express from 'express';
import { authenticateToken, requireAgentOrAdmin, requireRole } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import * as dashboardService from '../services/dashboardService.js';

const router = express.Router();

// Get dashboard overview statistics
router.get('/overview', authenticateToken, asyncHandler(async (req, res) => {
  const { period = '30d' } = req.query;
  const stats = await dashboardService.getOverview(req.user.id, req.user.role, period);

  res.json({
    success: true,
    data: { period, stats, lastUpdated: new Date() }
  });
}));

// Get analytics data for charts
router.get('/analytics', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { type, period = '30d', agentId, campaignId } = req.query;

  if (!type) throw new AppError('Invalid analytics type', 400);

  const analytics = await dashboardService.getAnalytics(
    req.user.id, req.user.role, type, period, { agentId, campaignId }
  );

  res.json({
    success: true,
    data: { type, period, analytics }
  });
}));

// Driver Partner: successful submissions trend
router.get('/driver/scans', authenticateToken, requireRole('driver_partner', 'admin'), asyncHandler(async (req, res) => {
  const data = await dashboardService.getDriverScans(req.user.id, req.query.period);

  res.json({ success: true, data });
}));

// Driver Partner: computed commissions
router.get('/driver/commissions', authenticateToken, requireRole('driver_partner', 'admin'), asyncHandler(async (req, res) => {
  const commissions = await dashboardService.getDriverCommissions(req.user.id, req.query.period);

  res.json({ success: true, data: { commissions } });
}));

export default router;
