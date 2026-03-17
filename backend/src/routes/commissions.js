import express from 'express';
import { authenticateToken, requireAdmin, requireAgentOrAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as ctrl from '../controllers/commissionController.js';

export const meta = {
  mounts: [
    { path: '/api/commissions' },
    { path: '/api/leadgen/commissions', flag: 'ENABLE_DOMAIN_PREFIXES' },
  ],
};

const router = express.Router();

// Get all commissions
router.get('/', authenticateToken, asyncHandler(ctrl.listCommissions));

// Create new commission (Admin only)
router.post('/', authenticateToken, requireAdmin, asyncHandler(ctrl.createCommission));

// Get commission statistics
router.get('/stats/overview', authenticateToken, requireAgentOrAdmin, asyncHandler(ctrl.getCommissionStats));

// Get agent commission summary
router.get('/agents/:agentId/summary', authenticateToken, requireAdmin, asyncHandler(ctrl.getAgentCommissionSummary));

// Get commission by ID
router.get('/:id', authenticateToken, asyncHandler(ctrl.getCommission));

// Update commission (Admin only)
router.put('/:id', authenticateToken, requireAdmin, asyncHandler(ctrl.updateCommission));

// Approve commission (Admin only)
router.patch('/:id/approve', authenticateToken, requireAdmin, asyncHandler(ctrl.approveCommission));

// Mark commission as paid (Admin only)
router.patch('/:id/pay', authenticateToken, requireAdmin, asyncHandler(ctrl.payCommission));

// Bulk approve commissions (Admin only)
router.patch('/bulk/approve', authenticateToken, requireAdmin, asyncHandler(ctrl.bulkApproveCommissions));

export default router;
