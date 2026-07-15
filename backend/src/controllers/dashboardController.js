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

// ── Admin rebuild Phase B (docs/plans/mktr-admin-rebuild-implementation.md) ──

// Needs-attention aggregates (admin-only; the UI composes queue rows from facts)
export async function getAttention(req, res) {
  const data = await dashboardService.getAttention();
  res.json({ success: true, data });
}

// Daily lead series, SGT-midnight buckets
export async function getSeries(req, res) {
  const period = dashboardService.normalizePeriod(req.query.period);
  const data = await dashboardService.getLeadSeries(period);
  res.json({ success: true, data: { period, ...data } });
}

// Scans→submits→assigned→won funnel (scans prorated + flagged estimated)
export async function getFunnel(req, res) {
  const period = dashboardService.normalizePeriod(req.query.period);
  const data = await dashboardService.getFunnel(period);
  res.json({ success: true, data: { period, ...data } });
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
