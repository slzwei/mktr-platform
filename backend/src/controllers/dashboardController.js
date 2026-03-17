import { AppError } from '../middleware/errorHandler.js';
import * as dashboardService from '../services/dashboardService.js';

// Get dashboard overview statistics
export async function getOverview(req, res) {
  const { period = '30d' } = req.query;
  const stats = await dashboardService.getOverview(req.user.id, req.user.role, period);

  res.json({
    success: true,
    data: { period, stats, lastUpdated: new Date() }
  });
}

// Get analytics data for charts
export async function getAnalytics(req, res) {
  const { type, period = '30d', agentId, campaignId } = req.query;

  if (!type) throw new AppError('Invalid analytics type', 400);

  const analytics = await dashboardService.getAnalytics(
    req.user.id, req.user.role, type, period, { agentId, campaignId }
  );

  res.json({
    success: true,
    data: { type, period, analytics }
  });
}

// Driver Partner: successful submissions trend
export async function getDriverScans(req, res) {
  const data = await dashboardService.getDriverScans(req.user.id, req.query.period);
  res.json({ success: true, data });
}

// Driver Partner: computed commissions
export async function getDriverCommissions(req, res) {
  const commissions = await dashboardService.getDriverCommissions(req.user.id, req.query.period);
  res.json({ success: true, data: { commissions } });
}
