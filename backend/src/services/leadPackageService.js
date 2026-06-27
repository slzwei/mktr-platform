import { Op } from 'sequelize';
import { LeadPackage, LeadPackageAssignment, User, Campaign, Prospect, sequelize } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

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
 * Update a lead package template. Only whitelisted fields are mutable —
 * `id` and `createdBy` are never reassigned. Re-fetches with the campaign
 * association so the response matches the list/get shape the admin UI expects.
 */
export async function updatePackage(id, fields) {
  const pkg = await LeadPackage.findByPk(id);
  if (!pkg) {
    throw new AppError('Package not found', 404);
  }

  const ALLOWED = ['name', 'description', 'price', 'leadCount', 'campaignId', 'type', 'isPublic', 'status'];
  const updates = {};
  for (const key of ALLOWED) {
    if (fields[key] !== undefined) {
      updates[key] = fields[key];
    }
  }

  if (Object.keys(updates).length > 0) {
    await pkg.update(updates);
  }

  const updated = await LeadPackage.findByPk(id, {
    include: [{
      model: Campaign,
      as: 'campaign',
      attributes: ['id', 'name', 'status']
    }]
  });

  return { package: updated };
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

  // New funded package → trigger the held-queue sweep for its campaign (async,
  // fire-and-forget). NOTE: auto-release is currently DISABLED (held leads are
  // manual-only) so this sweep no-ops — retained as the hook to re-enable it.
  if (pkg.campaignId) {
    // Dynamic import keeps releaseSweep (and its systemAgent/webhook graph) out of this
    // module's static dependency graph — avoids coupling and keeps unit-test mocks lean.
    import('./releaseSweep.js')
      .then((m) => m.sweepCampaign(pkg.campaignId))
      .catch((err) => logger.error('[ReleaseSweep] assignPackage trigger failed', { error: err?.message || String(err) }));
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
 * External (mktr-leads buyer app) → an agent's OWN lead-package assignments.
 *
 * Self-scoping by design: resolves the agent by `mktrLeadsId` AND `role:'agent'` AND
 * `isActive:true` — the SAME guard as releaseHeldProspect's destination resolver, so a
 * stale / cross-source / non-agent id can never read someone's packages. An unknown or
 * ineligible id returns an empty list (never throws, never leaks existence). Returns a
 * flat, display-ready DTO; the only id exposed is the assignment's own.
 *
 * Called by externalAgentPackagesController (HMAC + AGENT_PACKAGES_EXTERNAL_ENABLED gated).
 */
export async function getExternalAgentPackages(mktrLeadsId) {
  if (!mktrLeadsId || typeof mktrLeadsId !== 'string') return { packages: [] };

  const agent = await User.findOne({
    where: { mktrLeadsId, role: 'agent', isActive: true },
    attributes: ['id']
  });
  if (!agent) return { packages: [] };

  const assignments = await LeadPackageAssignment.findAll({
    // Only states an agent's "My Packages" view should reflect: 'active' = still
    // receivable, 'completed' = ran dry (shown as the OUT-OF-LEADS card — the COUNT,
    // not the enum, drives that on the app side via derivePackageState).
    // 'cancelled'/'expired' are dead — never receivable — so excluding them keeps a
    // stale assignment with leftover credits from inflating the headline.
    // NOTE: do NOT add 'exhausted' here — it is NOT a label in the live enum
    // (enum_lead_package_assignments_status = active|completed|cancelled|expired), so
    // Postgres throws "invalid input value for enum" on the IN-list and the whole
    // query 500s for EVERY agent (this exact bug blanked the screen, fixed 2026-06-27).
    where: { agentId: agent.id, status: ['active', 'completed'] },
    include: [
      {
        model: LeadPackage,
        as: 'package',
        attributes: ['name', 'type', 'qualityScore', 'currency', 'commissionStructure', 'validityPeriod'],
        include: [{ model: Campaign, as: 'campaign', attributes: ['name'] }]
      }
    ],
    order: [['purchaseDate', 'DESC']]
  });

  const packages = assignments.map((a) => {
    const pkg = a.package || null;
    const validityDays = pkg?.validityPeriod ?? null;
    const purchasedAt = a.purchaseDate ? new Date(a.purchaseDate) : null;
    // Expiry is derived, not stored — only when the package carries a validity window.
    const expiresAt =
      purchasedAt && Number.isFinite(validityDays) && validityDays > 0
        ? new Date(purchasedAt.getTime() + validityDays * 86400000).toISOString()
        : null;
    // commissionStructure is JSON ({ agentCommission, ... }), default 0. Pass the agent's
    // per-lead cut through only when it's a positive number — the UI hides it otherwise so
    // a default/absent value never renders as a misleading "$0/lead".
    const agentCommission = pkg?.commissionStructure?.agentCommission;
    return {
      id: a.id,
      name: pkg?.name || 'Lead package',
      type: pkg?.type || null,
      status: a.status,
      leadsRemaining: a.leadsRemaining,
      leadsTotal: a.leadsTotal,
      qualityScore: pkg?.qualityScore ?? null,
      commissionPerLead: typeof agentCommission === 'number' && agentCommission > 0 ? agentCommission : null,
      currency: pkg?.currency || 'USD',
      campaignName: pkg?.campaign?.name || null,
      purchaseDate: purchasedAt ? purchasedAt.toISOString() : null,
      validityDays,
      expiresAt
    };
  });

  return { packages };
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
      // 'completed' is the terminal "no credits left" status used everywhere else
      // (leadCredits.js natural drain). 'exhausted' is NOT in the live Postgres enum
      // (enum_lead_package_assignments_status) so writing it throws a DatabaseError.
      status: newCount === 0 ? 'completed' : 'active'
    });

    // Top-up (credits increased) → trigger the held-queue sweep for this campaign.
    // NOTE: auto-release is DISABLED (held leads are manual-only) — this sweep no-ops today.
    if (newCount > prevCount) {
      const pkg = await LeadPackage.findByPk(assignment.leadPackageId, { attributes: ['campaignId'] });
      if (pkg?.campaignId) {
        import('./releaseSweep.js')
          .then((m) => m.sweepCampaign(pkg.campaignId))
          .catch((err) => logger.error('[ReleaseSweep] updateAssignment trigger failed', { error: err?.message || String(err) }));
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

/**
 * Pure aggregation of active package assignments into per-agent delivery-pool
 * rows (sum remaining credits, list assignments, track last assignment). Kept
 * pure + exported so it unit-tests without a DB. Accepts Sequelize instances or
 * plain objects (reads `.agent`, `.leadsRemaining`, `.leadPackageId`, etc.).
 */
export function aggregateDeliveryPoolAgents(assignments = []) {
  const byAgent = new Map();
  for (const a of assignments) {
    const agent = a.agent;
    if (!agent) continue;
    const entry = byAgent.get(agent.id) || {
      agentId: agent.id,
      fullName: agent.fullName || `${agent.firstName || ''} ${agent.lastName || ''}`.trim() || null,
      email: agent.email || null,
      phone: agent.phone || null,
      remainingCredits: 0,
      lastPackageAssignedAt: null,
      assignments: [],
    };
    entry.remainingCredits += a.leadsRemaining;
    entry.assignments.push({
      id: a.id,
      packageId: a.leadPackageId,
      packageName: a.package?.name || null,
      leadsRemaining: a.leadsRemaining,
      leadsTotal: a.leadsTotal,
      purchaseDate: a.purchaseDate,
    });
    if (!entry.lastPackageAssignedAt || new Date(a.purchaseDate) > new Date(entry.lastPackageAssignedAt)) {
      entry.lastPackageAssignedAt = a.purchaseDate;
    }
    byAgent.set(agent.id, entry);
  }
  return [...byAgent.values()];
}

/**
 * Campaign-first delivery pool: the agents actually in this campaign's lead
 * round-robin, with remaining credits. Mirrors the live routing pool
 * (systemAgent.resolveLeadRouting step 4 / campaignReadinessService): active
 * LeadPackageAssignments for packages whose campaignId = :campaignId, restricted
 * to active role:'agent' users. NOT CampaignAgentAssignment (which the router
 * never consults).
 */
export async function getCampaignDeliveryPool(campaignId) {
  const campaign = await Campaign.findByPk(campaignId, {
    attributes: ['id', 'name', 'is_active', 'status', 'enforceLeadQuota'],
  });
  if (!campaign) throw new AppError('Campaign not found', 404);

  const packages = await LeadPackage.findAll({
    where: { campaignId },
    attributes: ['id', 'name', 'leadCount', 'price', 'status'],
    order: [['createdAt', 'DESC']],
  });
  const packageIds = packages.map((p) => p.id);

  let agents = [];
  if (packageIds.length > 0) {
    const assignments = await LeadPackageAssignment.findAll({
      where: { leadPackageId: { [Op.in]: packageIds }, status: 'active' },
      include: [
        {
          model: User,
          as: 'agent',
          where: { role: 'agent', isActive: true },
          required: true,
          attributes: ['id', 'firstName', 'lastName', 'fullName', 'email', 'phone'],
        },
        { model: LeadPackage, as: 'package', attributes: ['id', 'name'] },
      ],
      order: [['purchaseDate', 'DESC']],
    });

    agents = aggregateDeliveryPoolAgents(assignments);
  }

  const remainingCredits = agents.reduce((sum, ag) => sum + ag.remainingCredits, 0);
  const fundedAgents = agents.filter((a) => a.remainingCredits > 0).length;

  // Internally-releasable holds only — external-buyer holds
  // (no_funded_external_buyer) must never release to Lyfe, so they don't count
  // toward this internal delivery pool.
  const heldLeads = await Prospect.count({
    where: { campaignId, quarantinedAt: { [Op.ne]: null }, quarantineReason: 'no_funded_agent' },
  });

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      is_active: campaign.is_active,
      status: campaign.status,
      enforceLeadQuota: campaign.enforceLeadQuota,
    },
    totals: { fundedAgents, remainingCredits, heldLeads },
    packages: packages.map((p) => p.toJSON()),
    agents,
  };
}

/**
 * Bulk-assign one campaign package to many agents (campaign-first funding).
 * Race-safe: a per-package advisory xact lock serializes concurrent admin
 * assigns so the skip-existing read + insert can't duplicate active assignments
 * (no unique (agentId,leadPackageId) index exists). Idempotent — agents already
 * holding an active assignment for this package are skipped, not duplicated.
 * Fires exactly ONE releaseSweep after commit (not per agent).
 */
export async function bulkAssignPackage({ campaignId, packageId, agentIds }) {
  if (!campaignId || !packageId || !Array.isArray(agentIds) || agentIds.length === 0) {
    throw new AppError('campaignId, packageId and a non-empty agentIds array are required', 400);
  }
  const uniqueAgentIds = [...new Set(agentIds)];

  const pkg = await LeadPackage.findByPk(packageId);
  if (!pkg) throw new AppError('Package not found', 404);
  if (String(pkg.campaignId) !== String(campaignId)) {
    throw new AppError('Package does not belong to this campaign', 400);
  }

  const validAgents = await User.findAll({
    where: { id: { [Op.in]: uniqueAgentIds }, role: 'agent', isActive: true },
    attributes: ['id'],
  });
  const validIds = validAgents.map((a) => a.id);
  const invalid = uniqueAgentIds.filter((id) => !validIds.includes(id));

  let assignedIds = [];
  let skipped = [];
  if (validIds.length > 0) {
    await sequelize.transaction(async (t) => {
      await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:k))', {
        replacements: { k: `lpa:${packageId}` },
        transaction: t,
      });

      const existing = await LeadPackageAssignment.findAll({
        where: { leadPackageId: packageId, agentId: { [Op.in]: validIds }, status: 'active' },
        attributes: ['agentId'],
        transaction: t,
      });
      const existingIds = new Set(existing.map((e) => e.agentId));
      skipped = validIds.filter((id) => existingIds.has(id));
      assignedIds = validIds.filter((id) => !existingIds.has(id));

      if (assignedIds.length > 0) {
        await LeadPackageAssignment.bulkCreate(
          assignedIds.map((agentId) => ({
            agentId,
            leadPackageId: packageId,
            leadsTotal: pkg.leadCount,
            leadsRemaining: pkg.leadCount,
            priceSnapshot: pkg.price,
            status: 'active',
            purchaseDate: new Date(),
          })),
          { transaction: t }
        );
      }
    });
  }

  if (assignedIds.length > 0 && pkg.campaignId) {
    import('./releaseSweep.js')
      .then((m) => m.sweepCampaign(pkg.campaignId))
      .catch((err) => logger.error('[ReleaseSweep] bulkAssignPackage trigger failed', { error: err?.message || String(err) }));
  }

  return {
    assigned: assignedIds.length,
    assignedAgentIds: assignedIds,
    skipped,
    invalid,
    leadsPerAgent: pkg.leadCount,
    packageName: pkg.name,
  };
}
