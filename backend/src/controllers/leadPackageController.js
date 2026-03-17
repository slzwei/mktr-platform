import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import * as leadPackageService from '../services/leadPackageService.js';
import { sendPackageAssignmentEmail } from '../services/mailer.js';

export const listPackages = asyncHandler(async (req, res) => {
  const { status, campaignId } = req.query;
  const data = await leadPackageService.listPackages({
    status,
    campaignId,
    userRole: req.user.role
  });

  res.json({ success: true, data });
});

export const createPackage = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw new AppError('Access denied', 403);
  }

  const { name, price, leadCount, campaignId, type } = req.body;
  const data = await leadPackageService.createPackage({
    name,
    price,
    leadCount,
    campaignId,
    type,
    createdBy: req.user.id
  });

  res.status(201).json({ success: true, data });
});

export const assignPackage = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw new AppError('Access denied', 403);
  }

  const { agentId, packageId } = req.body;
  const { assignment, agent, packageInfo } = await leadPackageService.assignPackage({
    agentId,
    packageId
  });

  // Send email notification (async, don't block response)
  sendPackageAssignmentEmail(agent, packageInfo)
    .catch(err => console.error('Failed to send package assignment email:', err));

  res.status(201).json({
    success: true,
    message: 'Package assigned successfully',
    data: { assignment }
  });
});

export const getAgentAssignments = asyncHandler(async (req, res) => {
  const { agentId } = req.params;
  const data = await leadPackageService.getAgentAssignments({
    agentId,
    requesterId: req.user.id,
    requesterRole: req.user.role
  });

  res.json({ success: true, data });
});

export const deleteAssignment = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw new AppError('Access denied', 403);
  }

  await leadPackageService.deleteAssignment(req.params.id);

  res.json({
    success: true,
    message: 'Assignment deleted successfully'
  });
});

export const updateAssignment = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw new AppError('Access denied', 403);
  }

  const { leadsRemaining } = req.body;
  const data = await leadPackageService.updateAssignment(req.params.id, { leadsRemaining });

  res.json({
    success: true,
    message: 'Assignment updated successfully',
    data
  });
});

export const deletePackage = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw new AppError('Access denied', 403);
  }

  const result = await leadPackageService.deletePackage(req.params.id);

  if (result.archived) {
    res.json({
      success: true,
      message: result.message,
      data: { package: result.package }
    });
  } else {
    res.json({
      success: true,
      message: result.message
    });
  }
});
