import * as commissionService from '../services/commissionService.js';

// Get all commissions
export async function listCommissions(req, res) {
  const data = await commissionService.listCommissions(req.user, req.query);
  res.json({ success: true, data });
}

// Create new commission
export async function createCommission(req, res) {
  const commission = await commissionService.createCommission(req.body);
  res.status(201).json({
    success: true,
    message: 'Commission created successfully',
    data: { commission },
  });
}

// Get commission statistics
export async function getCommissionStats(req, res) {
  const data = await commissionService.getCommissionStats(req.user, req.query);
  res.json({ success: true, data });
}

// Get agent commission summary
export async function getAgentCommissionSummary(req, res) {
  const { year } = req.query;
  const data = await commissionService.getAgentCommissionSummary(req.params.agentId, year ? parseInt(year) : undefined);
  res.json({ success: true, data });
}

// Get commission by ID
export async function getCommission(req, res) {
  const commission = await commissionService.getCommission(req.params.id, req.user);
  res.json({ success: true, data: { commission } });
}

// Update commission
export async function updateCommission(req, res) {
  const commission = await commissionService.updateCommission(req.params.id, req.body);
  res.json({
    success: true,
    message: 'Commission updated successfully',
    data: { commission },
  });
}

// Approve commission
export async function approveCommission(req, res) {
  const commission = await commissionService.approveCommission(req.params.id, req.user.id, req.body?.notes);
  res.json({
    success: true,
    message: 'Commission approved successfully',
    data: { commission },
  });
}

// Mark commission as paid
export async function payCommission(req, res) {
  const commission = await commissionService.payCommission(req.params.id, req.user.id, req.body);
  res.json({
    success: true,
    message: 'Commission marked as paid successfully',
    data: { commission },
  });
}

// Bulk approve commissions
export async function bulkApproveCommissions(req, res) {
  const affectedCount = await commissionService.bulkApproveCommissions(
    req.body.commissionIds,
    req.user.id,
    req.body.notes
  );
  res.json({
    success: true,
    message: `${affectedCount} commissions approved successfully`,
    data: { affectedCount },
  });
}
