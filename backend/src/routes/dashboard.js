import express from 'express';
import { authenticateToken, requireAgentOrAdmin, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as ctrl from '../controllers/dashboardController.js';

export const meta = { path: '/api/dashboard' };

const router = express.Router();

// Get dashboard overview statistics
router.get('/overview', authenticateToken, asyncHandler(ctrl.getOverview));

// Get analytics data for charts
router.get('/analytics', authenticateToken, requireAgentOrAdmin, asyncHandler(ctrl.getAnalytics));

// Admin rebuild Phase B — needs-attention aggregates, lead series, funnel (admin-only)
router.get('/attention', authenticateToken, requireRole('admin'), asyncHandler(ctrl.getAttention));
router.get('/series', authenticateToken, requireRole('admin'), asyncHandler(ctrl.getSeries));
router.get('/funnel', authenticateToken, requireRole('admin'), asyncHandler(ctrl.getFunnel));

// Driver Partner: successful submissions trend
router.get('/driver/scans', authenticateToken, requireRole('driver_partner', 'admin'), asyncHandler(ctrl.getDriverScans));

// Driver Partner: computed commissions
router.get('/driver/commissions', authenticateToken, requireRole('driver_partner', 'admin'), asyncHandler(ctrl.getDriverCommissions));

export default router;
