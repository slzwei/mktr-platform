import { Op } from 'sequelize';
import { User, Prospect, Commission, Campaign, LeadPackage, LeadPackageAssignment, sequelize } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { getSystemAgentId } from './systemAgent.js';
import { sendRoleInvitation } from './invitationService.js';
import { getAgentInviteEmail, getAgentInviteSubject, getAgentInviteText } from './emailTemplates.js';

// Re-export helpers from focused modules so existing `import * as agentService` still works
export { getAssignedCampaignCounts, getAgentPackageBreakdowns, computeAgentStats, computeAgentStatsFromCounts } from './agentStatsHelpers.js';
export { getAgentMonthlyPerformance, getCommissionLeaderboard, getConversionLeaderboard, getProspectLeaderboard, getLeaderboard } from './agentLeaderboardService.js';

// Internal imports used by functions in this file
import { getAssignedCampaignCounts, getAgentPackageBreakdowns, computeAgentStatsFromCounts } from './agentStatsHelpers.js';
import { getAgentMonthlyPerformance } from './agentLeaderboardService.js';

// ---------------------------------------------------------------------------
// NEW service functions (extracted from routes/agents.js)
// ---------------------------------------------------------------------------

/**
 * Resolve a period string to a start date for filtering.
 */
function periodToStartDate(period) {
  const now = new Date();
  switch (period) {
    case 'week':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'quarter': {
      const quarter = Math.floor(now.getMonth() / 3);
      return new Date(now.getFullYear(), quarter * 3, 1);
    }
    case 'year':
      return new Date(now.getFullYear(), 0, 1);
    default:
      return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}

// Sortable User columns exposed via the agent listing. Anything not in this
// set falls back to `createdAt`. Defense-in-depth against ORDER BY injection
// — Sequelize already rejects unknown column names, but explicit whitelisting
// produces a clean default instead of a 500 + matches the userService pattern.
export const ALLOWED_SORT_FIELDS = Object.freeze(['createdAt', 'firstName', 'lastName', 'fullName', 'email', 'isActive', 'lastLogin']);

/**
 * Normalize user-supplied sortBy + order into safe Sequelize values.
 * Exposed for unit testing.
 */
export function normalizeAgentSort(sortBy, order) {
  const safeSortBy = ALLOWED_SORT_FIELDS.includes(String(sortBy)) ? String(sortBy) : 'createdAt';
  const safeOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  return { sortBy: safeSortBy, order: safeOrder };
}

/**
 * List agents with pagination, search, and computed stats.
 */
export async function listAgents(query) {
  const { page = 1, limit = 10, search, status, sortBy = 'createdAt', order = 'DESC', period } = query;
  // Clamp pagination so malformed query params (?page=0, ?limit=-1) don't reach
  // Sequelize as a negative/NaN LIMIT/OFFSET, which throws → 500.
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 10), 200);
  const offset = (pageNum - 1) * limitNum;

  // Phase B: validated rolling window for assignedThisPeriod (additive keys).
  // Server-computed ISO literal — never user input.
  const periodDays = { '7d': 7, '30d': 30, '90d': 90 }[period] || 30;
  const periodStartIso = new Date(Date.now() - periodDays * 24 * 3600e3).toISOString();

  const whereConditions = { role: 'agent' };

  // Hide the System Agent from listings
  const systemId = await getSystemAgentId();
  if (systemId) {
    whereConditions.id = { [Op.ne]: systemId };
  }

  if (status) {
    whereConditions.isActive = status === 'active';
  }

  if (search) {
    const sanitizedSearch = String(search).slice(0, 100).replace(/%/g, '\\%').replace(/_/g, '\\_');
    whereConditions[Op.or] = [
      { firstName: { [Op.iLike]: `%${sanitizedSearch}%` } },
      { lastName: { [Op.iLike]: `%${sanitizedSearch}%` } },
      { email: { [Op.iLike]: `%${sanitizedSearch}%` } }
    ];
  }

  const { sortBy: normalizedSortBy, order: normalizedOrder } = normalizeAgentSort(sortBy, order);

  const { count, rows: agents } = await User.findAndCountAll({
    where: whereConditions,
    limit: limitNum,
    offset,
    order: [[normalizedSortBy, normalizedOrder]],
    attributes: {
      exclude: ['password'],
      include: [
        [sequelize.literal('(SELECT COUNT(*) FROM prospects WHERE prospects."assignedAgentId" = "User".id)'), 'prospectCount'],
        [sequelize.literal('(SELECT COUNT(*) FROM prospects WHERE prospects."assignedAgentId" = "User".id AND prospects."leadStatus" = \'won\')'), 'convertedCount'],
        [sequelize.literal('(SELECT COALESCE(SUM(amount), 0) FROM commissions WHERE commissions."agentId" = "User".id AND commissions.status != \'cancelled\')'), 'totalCommissions'],
        [sequelize.literal('(SELECT COALESCE(SUM(amount), 0) FROM commissions WHERE commissions."agentId" = "User".id AND commissions.status = \'paid\')'), 'paidCommissions'],
        [sequelize.literal('(SELECT COUNT(*) FROM campaigns WHERE campaigns."createdBy" = "User".id)'), 'createdCampaignsCount'],
        [sequelize.literal('(SELECT COUNT(*) FROM campaigns WHERE campaigns."createdBy" = "User".id AND campaigns.status = \'active\')'), 'activeCampaignsCount'],
        // Phase B roster aggregates (admin rebuild): period assignment volume,
        // recency, and open wallet-commitment demand (0s for internal agents —
        // the UI renders "—" when mktrLeadsId is null).
        [sequelize.literal(`(SELECT COUNT(*) FROM prospects WHERE prospects."assignedAgentId" = "User".id AND prospects."createdAt" >= '${periodStartIso}')::int`), 'assignedThisPeriod'],
        [sequelize.literal('(SELECT MAX(prospects."createdAt") FROM prospects WHERE prospects."assignedAgentId" = "User".id)'), 'lastAssignedAt'],
        [sequelize.literal('(SELECT COALESCE(SUM(lpa."leadsRemaining"), 0)::int FROM lead_package_assignments lpa WHERE lpa."agentId" = "User".id AND lpa."source" = \'wallet\' AND lpa.status = \'active\')'), 'committedLeads'],
        [sequelize.literal('(SELECT COALESCE(SUM(lpa."leadsRemaining" * lpa."unitPriceCents"), 0)::int FROM lead_package_assignments lpa WHERE lpa."agentId" = "User".id AND lpa."source" = \'wallet\' AND lpa.status = \'active\' AND lpa."unitPriceCents" IS NOT NULL)'), 'committedValueCents'],
      ]
    },
    include: [
      {
        association: 'assignedPackages',
        where: { status: 'active' },
        attributes: ['leadsRemaining'],
        required: false
      }
    ]
  });

  // Compute counts of campaigns where agents have active lead packages,
  // plus the per-campaign remaining-credit breakdown (separate grouped query —
  // not a deeper include on this paginated findAndCountAll).
  const [assignedCounts, packageBreakdowns] = await Promise.all([
    getAssignedCampaignCounts(),
    getAgentPackageBreakdowns(),
  ]);

  // Calculate agent statistics from subquery counts
  const agentsWithStats = agents.map(agent => computeAgentStatsFromCounts(agent, assignedCounts, packageBreakdowns));

  return {
    agents: agentsWithStats,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(count / limitNum),
      totalItems: count,
      itemsPerPage: limitNum
    }
  };
}

/**
 * Get a single agent with detailed stats.
 * @param {string} agentId
 * @param {object} requestingUser - { id, role }
 */
export async function getAgentDetail(agentId, requestingUser) {
  // Non-admin users can only view their own profile
  if (requestingUser.role !== 'admin' && requestingUser.id !== agentId) {
    throw new AppError('Access denied', 403);
  }

  const agent = await User.findOne({
    where: { id: agentId, role: 'agent' },
    attributes: { exclude: ['password'] },
    include: [
      {
        association: 'assignedProspects',
        include: [
          { association: 'campaign', attributes: ['id', 'name'] }
        ]
      },
      {
        association: 'commissions',
        include: [
          { association: 'campaign', attributes: ['id', 'name'] },
          { association: 'prospect', attributes: ['id', 'firstName', 'lastName'] }
        ]
      },
      {
        association: 'createdCampaigns',
        include: [
          { association: 'prospects', attributes: ['id', 'leadStatus'] }
        ]
      },
      {
        association: 'assignedPackages',
        include: [
          { association: 'package', attributes: ['id', 'name', 'price', 'type'] }
        ]
      }
    ]
  });

  if (!agent) {
    throw new AppError('Agent not found', 404);
  }

  // Calculate detailed statistics
  const totalProspects = agent.assignedProspects.length;
  const prospectsByStatus = agent.assignedProspects.reduce((acc, prospect) => {
    acc[prospect.leadStatus] = (acc[prospect.leadStatus] || 0) + 1;
    return acc;
  }, {});

  const totalCommissions = agent.commissions.reduce((sum, c) => sum + parseFloat(c.amount), 0);
  const commissionsByStatus = agent.commissions.reduce((acc, commission) => {
    acc[commission.status] = (acc[commission.status] || 0) + parseFloat(commission.amount);
    return acc;
  }, {});

  // Monthly performance (last 12 months)
  const monthlyPerformance = await getAgentMonthlyPerformance(agentId);

  return {
    ...agent.toJSON(),
    stats: {
      prospects: {
        total: totalProspects,
        byStatus: prospectsByStatus,
        conversionRate: totalProspects > 0 ? (prospectsByStatus.won || 0) / totalProspects * 100 : 0
      },
      commissions: {
        total: totalCommissions,
        byStatus: commissionsByStatus,
        average: agent.commissions.length > 0 ? totalCommissions / agent.commissions.length : 0
      },
      campaigns: {
        total: agent.createdCampaigns.length,
        active: agent.createdCampaigns.filter(c => c.status === 'active').length,
        totalLeads: agent.createdCampaigns.reduce((sum, c) => sum + c.prospects.length, 0)
      },
      monthlyPerformance
    }
  };
}

/**
 * Update an agent's profile fields.
 * @param {string} agentId
 * @param {object} updates - { firstName, lastName, phone, avatar, isActive }
 * @param {object} requestingUser - { id, role }
 */
export async function updateAgent(agentId, updates, requestingUser) {
  // Non-admin users can only update their own profile (except isActive)
  if (requestingUser.role !== 'admin' && requestingUser.id !== agentId) {
    throw new AppError('Access denied', 403);
  }

  const agent = await User.findOne({
    where: { id: agentId, role: 'agent' }
  });

  if (!agent) {
    throw new AppError('Agent not found', 404);
  }

  const { firstName, lastName, phone, avatar, isActive } = updates;
  const updateData = {};
  if (firstName) updateData.firstName = firstName;
  if (lastName) updateData.lastName = lastName;
  if (phone) updateData.phone = phone;
  if (avatar) updateData.avatar = avatar;

  // Only admins can update isActive status
  if (requestingUser.role === 'admin' && typeof isActive === 'boolean') {
    updateData.isActive = isActive;
  }

  await agent.update(updateData);

  return agent.toJSON();
}

/**
 * Get paginated prospects for an agent.
 */
export async function getAgentProspects(agentId, query, requestingUser) {
  if (requestingUser.role !== 'admin' && requestingUser.id !== agentId) {
    throw new AppError('Access denied', 403);
  }

  const { page = 1, limit = 10, status, priority, search } = query;
  const offset = (page - 1) * limit;

  const whereConditions = { assignedAgentId: agentId };

  if (status) {
    whereConditions.leadStatus = status;
  }

  if (priority) {
    whereConditions.priority = priority;
  }

  if (search) {
    const sanitizedSearch = String(search).slice(0, 100).replace(/%/g, '\\%').replace(/_/g, '\\_');
    whereConditions[Op.or] = [
      { firstName: { [Op.iLike]: `%${sanitizedSearch}%` } },
      { lastName: { [Op.iLike]: `%${sanitizedSearch}%` } },
      { email: { [Op.iLike]: `%${sanitizedSearch}%` } },
      { company: { [Op.iLike]: `%${sanitizedSearch}%` } }
    ];
  }

  const { count, rows: prospects } = await Prospect.findAndCountAll({
    where: whereConditions,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['createdAt', 'DESC']],
    include: [
      {
        association: 'campaign',
        attributes: ['id', 'name', 'type']
      },
      {
        association: 'qrTag',
        attributes: ['id', 'name', 'type']
      }
    ]
  });

  return {
    prospects,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / limit),
      totalItems: count,
      itemsPerPage: parseInt(limit)
    }
  };
}

/**
 * Get paginated commissions for an agent.
 */
export async function getAgentCommissions(agentId, query, requestingUser) {
  if (requestingUser.role !== 'admin' && requestingUser.id !== agentId) {
    throw new AppError('Access denied', 403);
  }

  const { page = 1, limit = 10, status, type, period } = query;
  const offset = (page - 1) * limit;

  const whereConditions = { agentId };

  if (status) {
    whereConditions.status = status;
  }

  if (type) {
    whereConditions.type = type;
  }

  if (period) {
    const startDate = periodToStartDate(period);
    whereConditions.earnedDate = {
      [Op.gte]: startDate,
      [Op.lte]: new Date()
    };
  }

  const { count, rows: commissions } = await Commission.findAndCountAll({
    where: whereConditions,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['earnedDate', 'DESC']],
    include: [
      {
        association: 'campaign',
        attributes: ['id', 'name', 'type']
      },
      {
        association: 'prospect',
        attributes: ['id', 'firstName', 'lastName', 'email']
      },
      {
        association: 'leadPackage',
        attributes: ['id', 'name', 'type', 'price']
      }
    ]
  });

  // Calculate totals
  const totalAmount = commissions.reduce((sum, c) => sum + parseFloat(c.amount), 0);
  const paidAmount = commissions.filter(c => c.status === 'paid').reduce((sum, c) => sum + parseFloat(c.amount), 0);
  const pendingAmount = commissions.filter(c => c.status === 'pending').reduce((sum, c) => sum + parseFloat(c.amount), 0);

  return {
    commissions,
    summary: {
      totalAmount,
      paidAmount,
      pendingAmount,
      averageCommission: commissions.length > 0 ? totalAmount / commissions.length : 0
    },
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / limit),
      totalItems: count,
      itemsPerPage: parseInt(limit)
    }
  };
}

/**
 * Get campaigns for an agent (created or assigned via packages).
 */
export async function getAgentCampaigns(agentId, query, requestingUser) {
  if (requestingUser.role !== 'admin' && requestingUser.id !== agentId) {
    throw new AppError('Access denied', 403);
  }

  const { page = 1, limit = 10, status, type } = query;
  const offset = (page - 1) * limit;

  // Find campaign IDs this agent is assigned to (via lead package assignments)
  const agentAssignments = await LeadPackageAssignment.findAll({
    where: { agentId },
    include: [{
      model: LeadPackage,
      as: 'package',
      attributes: ['campaignId'],
      required: true
    }],
    raw: true,
    nest: true
  });
  const assignedIds = [...new Set(agentAssignments.map(a => a.package.campaignId).filter(Boolean))];

  // Query campaigns the agent created OR is assigned to via packages
  const where = {
    [Op.or]: [
      { createdBy: agentId },
      ...(assignedIds.length > 0 ? [{ id: { [Op.in]: assignedIds } }] : [])
    ]
  };
  if (status) where.status = status;
  if (type) where.type = type;

  const { count, rows: campaigns } = await Campaign.findAndCountAll({
    where,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['createdAt', 'DESC']],
    attributes: {
      include: [
        [sequelize.literal('(SELECT COUNT(*) FROM prospects WHERE prospects."campaignId" = "Campaign".id)'), 'prospectCount'],
        [sequelize.literal('(SELECT COUNT(*) FROM prospects WHERE prospects."campaignId" = "Campaign".id AND prospects."leadStatus" = \'won\')'), 'convertedCount'],
        [sequelize.literal('(SELECT COUNT(*) FROM qr_tags WHERE qr_tags."campaignId" = "Campaign".id)'), 'qrTagCount'],
      ]
    },
    include: [{ association: 'creator', attributes: ['id', 'firstName', 'lastName'] }]
  });

  // Add performance stats from subquery counts
  const campaignsWithStats = campaigns.map(campaign => {
    const plain = campaign.toJSON();
    const totalProspects = parseInt(plain.prospectCount) || 0;
    const convertedProspects = parseInt(plain.convertedCount) || 0;
    const totalScans = parseInt(plain.qrTagCount) || 0;
    return {
      ...plain,
      stats: {
        totalProspects,
        convertedProspects,
        totalScans,
        conversionRate: totalProspects > 0 ?
          (convertedProspects / totalProspects * 100).toFixed(2) : 0
      }
    };
  });

  return {
    campaigns: campaignsWithStats,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / limit),
      totalItems: count,
      itemsPerPage: parseInt(limit)
    }
  };
}

/**
 * Invite a new agent via email.
 */
export async function inviteAgent(email, fullName, owedLeadsCount, inviterUser) {
  const { user, inviteLink } = await sendRoleInvitation({
    email,
    fullName,
    role: 'agent',
    inviterEmail: inviterUser?.email,
    extraFields: { owed_leads_count: parseInt(owedLeadsCount) || 0 },
    getEmailContent: ({ firstName, inviteLink, companyName, companyUrl, expiryDays }) => ({
      subject: getAgentInviteSubject(companyName),
      html: getAgentInviteEmail({ firstName, inviteLink, companyName, companyUrl, expiryDays }),
      text: getAgentInviteText({ firstName, inviteLink, companyName, expiryDays })
    })
  });

  return { user, inviteLink };
}
