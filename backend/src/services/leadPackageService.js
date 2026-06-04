import { LeadPackage, LeadPackageAssignment, User, Campaign } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { sweepCampaign } from './releaseSweep.js';

/**
 * List lead packages with optional filters.
 * Agents only see active + public packages.
 */
export async function listPackages({ status, campaignId, userRole }) {
  const where = {};
  if (status) where.status = status;
  if (campaignId) where.campaignId = campaignId;

  if (userRole === 'agent') {
    where.status = 'active';
    where.isPublic = true;
  }

  const packages = await LeadPackage.findAll({
    where,
    include: [
      {
        model: Campaign,
        as: 'campaign',
        attributes: ['id', 'name', 'status']
      }
    ],
    order: [['createdAt', 'DESC']]
  });

  return { packages };
}

/**
 * Create a new lead package template.
 */
export async function createPackage({ name, price, leadCount, campaignId, type, createdBy }) {
  if (!name || price === undefined || price === null || !leadCount || !campaignId) {
    throw new AppError('Missing required fields', 400);
  }

  const pkg = await LeadPackage.create({
    name,
    price,
    leadCount,
    campaignId,
    type: type || 'basic',
    createdBy,
    status: 'active'
  });

  return { package: pkg };
}

/**
 * Assign a package to an agent. Returns the assignment and data needed for email.
 */
export async function assignPackage({ agentId, packageId }) {
  if (!agentId || !packageId) {
    throw new AppError('Agent ID and Package ID are required', 400);
  }

  const agent = await User.findByPk(agentId);
  if (!agent) throw new AppError('Agent not found', 404);

  const pkg = await LeadPackage.findByPk(packageId, {
    include: [{
      model: Campaign,
      as: 'campaign',
      attributes: ['name']
    }]
  });
  if (!pkg) throw new AppError('Package not found', 404);

  const assignment = await LeadPackageAssignment.create({
    agentId,
    leadPackageId: packageId,
    leadsTotal: pkg.leadCount,
    leadsRemaining: pkg.leadCount,
    priceSnapshot: pkg.price,
    status: 'active',
    purchaseDate: new Date()
  });

  // New funded package → drain any held lead-quota queue for its campaign (async,
  // fire-and-forget; the assignment response must not wait on the sweep).
  if (pkg.campaignId) {
    sweepCampaign(pkg.campaignId).catch((err) =>
      logger.error('[ReleaseSweep] assignPackage trigger failed', { error: err?.message || String(err) })
    );
  }

  return {
    assignment,
    agent,
    packageInfo: {
      name: pkg.name,
      campaignName: pkg.campaign ? pkg.campaign.name : 'N/A',
      leadCount: pkg.leadCount
    }
  };
}

/**
 * Get assignments for a specific agent.
 */
export async function getAgentAssignments({ agentId, requesterId, requesterRole }) {
  logger.info('GET assignments', { agentId, requesterId, requesterRole });

  if (requesterRole !== 'admin' && requesterId !== agentId) {
    logger.error('Access denied for agent assignments', { requesterId, agentId });
    throw new AppError('Access denied', 403);
  }

  const assignments = await LeadPackageAssignment.findAll({
    where: { agentId },
    include: [
      {
        model: LeadPackage,
        as: 'package',
        attributes: ['name', 'description'],
        include: [{
          model: Campaign,
          as: 'campaign',
          attributes: ['id', 'name']
        }]
      }
    ],
    order: [['purchaseDate', 'DESC']]
  });
  logger.info('Found assignments', { count: assignments.length });

  return { assignments };
}

/**
 * Delete a package assignment by ID.
 */
export async function deleteAssignment(id) {
  const assignment = await LeadPackageAssignment.findByPk(id);
  if (!assignment) {
    throw new AppError('Assignment not found', 404);
  }

  await assignment.destroy();
}

/**
 * Update a package assignment (e.g. leadsRemaining).
 */
export async function updateAssignment(id, { leadsRemaining }) {
  const assignment = await LeadPackageAssignment.findByPk(id);
  if (!assignment) {
    throw new AppError('Assignment not found', 404);
  }

  if (leadsRemaining !== undefined) {
    const newCount = parseInt(leadsRemaining, 10);
    if (isNaN(newCount) || newCount < 0) {
      throw new AppError('Invalid lead count', 400);
    }

    const prevCount = assignment.leadsRemaining;
    await assignment.update({
      leadsRemaining: newCount,
      status: newCount === 0 ? 'exhausted' : 'active'
    });

    // Top-up (credits increased) → drain the held queue for this assignment's campaign.
    if (newCount > prevCount) {
      const pkg = await LeadPackage.findByPk(assignment.leadPackageId, { attributes: ['campaignId'] });
      if (pkg?.campaignId) {
        sweepCampaign(pkg.campaignId).catch((err) =>
          logger.error('[ReleaseSweep] updateAssignment trigger failed', { error: err?.message || String(err) })
        );
      }
    }
  }

  return { assignment };
}

/**
 * Delete or archive a lead package. Archives if assignments exist.
 */
export async function deletePackage(id) {
  const pkg = await LeadPackage.findByPk(id);
  if (!pkg) {
    throw new AppError('Package not found', 404);
  }

  const assignmentCount = await LeadPackageAssignment.count({
    where: { leadPackageId: id }
  });

  if (assignmentCount > 0) {
    await pkg.update({ status: 'archived' });
    return {
      archived: true,
      message: 'Package archived (assignments exist)',
      package: pkg
    };
  } else {
    await pkg.destroy();
    return {
      archived: false,
      message: 'Package deleted successfully'
    };
  }
}
