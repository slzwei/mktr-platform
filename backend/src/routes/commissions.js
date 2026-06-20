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

// Get all commissions (agents see own, admins see all)
router.get('/', authenticateToken, requireAgentOrAdmin, asyncHandler(ctrl.listCommissions));

// Create new commission (Admin only)
router.post('/', authenticateToken, requireAdmin, asyncHandler(ctrl.createCommission));

// Get commission statistics
router.get('/stats/overview', authenticateToken, requireAgentOrAdmin, asyncHandler(ctrl.getCommissionStats));

// Get agent commission summary
router.get('/agents/:agentId/summary', authenticateToken, requireAdmin, asyncHandler(ctrl.getAgentCommissionSummary));

// Bulk approve commissions (Admin only). MUST be registered before the
// `/:id/approve` route below, otherwise Express captures "bulk" as :id and the
// single-approve handler 500s on `invalid input syntax for type uuid: "bulk"`.
router.patch('/bulk/approve', authenticateToken, requireAdmin, asyncHandler(ctrl.bulkApproveCommissions));

// Get commission by ID (agents see own, admins see all)
router.get('/:id', authenticateToken, requireAgentOrAdmin, asyncHandler(ctrl.getCommission));

// Update commission (Admin only)
router.put('/:id', authenticateToken, requireAdmin, asyncHandler(ctrl.updateCommission));

// Approve commission (Admin only)
router.patch('/:id/approve', authenticateToken, requireAdmin, asyncHandler(ctrl.approveCommission));

// Mark commission as paid (Admin only)
router.patch('/:id/pay', authenticateToken, requireAdmin, asyncHandler(ctrl.payCommission));

export default router;
