import express from 'express';
import { authenticateToken, requireAdmin, requireAgentOrAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as commissionService from '../services/commissionService.js';

const router = express.Router();

// Get all commissions
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const data = await commissionService.listCommissions(req.user, req.query);

  res.json({ success: true, data });
}));

// Create new commission (Admin only)
router.post('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const commission = await commissionService.createCommission(req.body);

  res.status(201).json({
    success: true,
    message: 'Commission created successfully',
    data: { commission }
  });
}));

// Get commission statistics
router.get('/stats/overview', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const data = await commissionService.getCommissionStats(req.user, req.query);

  res.json({ success: true, data });
}));

// Get agent commission summary
router.get('/agents/:agentId/summary', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { year } = req.query;
  const data = await commissionService.getAgentCommissionSummary(req.params.agentId, year ? parseInt(year) : undefined);

  res.json({ success: true, data });
}));

// Get commission by ID
router.get('/:id', authenticateToken, asyncHandler(async (req, res) => {
  const commission = await commissionService.getCommission(req.params.id, req.user);

  res.json({ success: true, data: { commission } });
}));

// Update commission (Admin only)
router.put('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const commission = await commissionService.updateCommission(req.params.id, req.body);

  res.json({
    success: true,
    message: 'Commission updated successfully',
    data: { commission }
  });
}));

// Approve commission (Admin only)
router.patch('/:id/approve', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const commission = await commissionService.approveCommission(req.params.id, req.user.id, req.body.notes);

  res.json({
    success: true,
    message: 'Commission approved successfully',
    data: { commission }
  });
}));

// Mark commission as paid (Admin only)
router.patch('/:id/pay', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const commission = await commissionService.payCommission(req.params.id, req.user.id, req.body);

  res.json({
    success: true,
    message: 'Commission marked as paid successfully',
    data: { commission }
  });
}));

// Bulk approve commissions (Admin only)
router.patch('/bulk/approve', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const affectedCount = await commissionService.bulkApproveCommissions(
    req.body.commissionIds, req.user.id, req.body.notes
  );

  res.json({
    success: true,
    message: `${affectedCount} commissions approved successfully`,
    data: { affectedCount }
  });
}));

export default router;
