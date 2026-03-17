import { Op } from 'sequelize';
import { User, Prospect, Commission, Campaign, LeadPackage, LeadPackageAssignment, sequelize } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { getSystemAgentId } from './systemAgent.js';
import { sendRoleInvitation } from './invitationService.js';
import { getAgentInviteEmail, getAgentInviteSubject, getAgentInviteText } from './emailTemplates.js';

// ---------------------------------------------------------------------------
// Helpers (existing)
// ---------------------------------------------------------------------------

/**
 * Fetch counts of unique campaigns each agent is assigned to via active lead packages.
 * Returns an object keyed by agent ID string, with integer counts as values.
 */
export async function getAssignedCampaignCounts() {
  const allAssignments = await LeadPackageAssignment.findAll({
    where: { status: 'active', leadsRemaining: { [Op.gt]: 0 } },
    include: [{
      model: LeadPackage,
      as: 'package',
      attributes: ['campaignId'],
      required: true
    }]
  });

  const assignedCounts = {};
  for (const assignment of allAssignments) {
    if (assignment.package && assignment.package.campaignId) {
      const agentId = String(assignment.agentId);
      if (!assignedCounts[agentId]) assignedCounts[agentId] = new Set();
      assignedCounts[agentId].add(assignment.package.campaignId);
    }
  }
  // Convert Sets to counts
  Object.keys(assignedCounts).forEach(k => {
    assignedCounts[k] = assignedCounts[k].size;
  });

  return assignedCounts;
}

/**
 * Compute stats object for a single agent row (with eager-loaded associations).
 * @param {object} agent - Sequelize User instance with assignedProspects, commissions, createdCampaigns, assignedPackages loaded
 * @param {object} assignedCounts - Map of agentId -> number of assigned campaigns
 * @returns {object} Plain object with stats attached
 */
export function computeAgentStats(agent, assignedCounts) {
  const totalProspects = agent.assignedProspects.length;
  const convertedProspects = agent.assignedProspects.filter(p => p.leadStatus === 'won').length;
  const totalCommissions = agent.commissions.reduce((sum, c) => sum + parseFloat(c.amount), 0);
  const paidCommissions = agent.commissions.filter(c => c.status === 'paid').reduce((sum, c) => sum + parseFloat(c.amount), 0);
  const createdCampaignsCount = agent.createdCampaigns.length;
  const assignedCampaignsCount = assignedCounts[String(agent.id)] || 0;
  const tiedCampaignsCount = createdCampaignsCount + assignedCampaignsCount;
  const activeCreatedCampaigns = agent.createdCampaigns.filter(c => c.status === 'active').length;

  // Calculate total leads owed (manual + active packages)
  const manualLeads = agent.owed_leads_count || 0;
  const packageLeads = agent.assignedPackages
    ? agent.assignedPackages.reduce((sum, pkg) => sum + (pkg.leadsRemaining || 0), 0)
    : 0;
  const totalLeadsOwed = manualLeads + packageLeads;

  return {
    ...agent.toJSON(),
    owed_leads_count: totalLeadsOwed,
    owed_leads_manual_count: manualLeads,
    stats: {
      totalProspects,
      convertedProspects,
      conversionRate: totalProspects > 0 ? (convertedProspects / totalProspects * 100).toFixed(2) : 0,
      totalCommissions,
      paidCommissions,
      pendingCommissions: totalCommissions - paidCommissions,
      totalCampaigns: createdCampaignsCount,
      activeCampaigns: activeCreatedCampaigns,
      tiedCampaignsCount
    }
  };
}

/**
 * Compute stats for a single agent using pre-computed subquery counts (listAgents).
 * Avoids loading all prospects/commissions into memory.
 */
export function computeAgentStatsFromCounts(agent, assignedCounts) {
  const plain = agent.toJSON();
  const totalProspects = parseInt(plain.prospectCount) || 0;
  const convertedProspects = parseInt(plain.convertedCount) || 0;
  const totalCommissions = parseFloat(plain.totalCommissions) || 0;
  const paidCommissions = parseFloat(plain.paidCommissions) || 0;
  const createdCampaignsCount = parseInt(plain.createdCampaignsCount) || 0;
  const activeCampaignsCount = parseInt(plain.activeCampaignsCount) || 0;
  const assignedCampaignsCount = assignedCounts[String(agent.id)] || 0;
  const tiedCampaignsCount = createdCampaignsCount + assignedCampaignsCount;

  // Calculate total leads owed (manual + active packages)
  const manualLeads = agent.owed_leads_count || 0;
  const packageLeads = plain.assignedPackages
    ? plain.assignedPackages.reduce((sum, pkg) => sum + (pkg.leadsRemaining || 0), 0)
    : 0;
  const totalLeadsOwed = manualLeads + packageLeads;

  return {
    ...plain,
    owed_leads_count: totalLeadsOwed,
    owed_leads_manual_count: manualLeads,
    stats: {
      totalProspects,
      convertedProspects,
      conversionRate: totalProspects > 0 ? (convertedProspects / totalProspects * 100).toFixed(2) : 0,
      totalCommissions,
      paidCommissions,
      pendingCommissions: totalCommissions - paidCommissions,
      totalCampaigns: createdCampaignsCount,
      activeCampaigns: activeCampaignsCount,
      tiedCampaignsCount
    }
  };
}

// ---------------------------------------------------------------------------
// Leaderboard / stats helpers (existing)
// ---------------------------------------------------------------------------

/**
 * Get monthly performance for an agent over the last 12 months.
 */
export async function getAgentMonthlyPerformance(agentId) {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  twelveMonthsAgo.setDate(1);
  twelveMonthsAgo.setHours(0, 0, 0, 0);

  const [commissionRows, prospectRows, conversionRows] = await Promise.all([
    sequelize.query(`
      SELECT DATE_TRUNC('month', "earnedDate") AS month, COALESCE(SUM(amount), 0)::float AS total
      FROM commissions WHERE "agentId" = :agentId AND "earnedDate" >= :since
      GROUP BY month ORDER BY month
    `, { replacements: { agentId, since: twelveMonthsAgo }, type: sequelize.QueryTypes.SELECT }),

    sequelize.query(`
      SELECT DATE_TRUNC('month', "createdAt") AS month, COUNT(*)::int AS count
      FROM prospects WHERE "assignedAgentId" = :agentId AND "createdAt" >= :since
      GROUP BY month ORDER BY month
    `, { replacements: { agentId, since: twelveMonthsAgo }, type: sequelize.QueryTypes.SELECT }),

    sequelize.query(`
      SELECT DATE_TRUNC('month', "conversionDate") AS month, COUNT(*)::int AS count
      FROM prospects WHERE "assignedAgentId" = :agentId AND "leadStatus" = 'won' AND "conversionDate" >= :since
      GROUP BY month ORDER BY month
    `, { replacements: { agentId, since: twelveMonthsAgo }, type: sequelize.QueryTypes.SELECT }),
  ]);

  // Build lookup maps keyed by YYYY-MM
  const toKey = (r) => r.month instanceof Date ? r.month.toISOString().slice(0, 7) : String(r.month).slice(0, 7);
  const commMap = new Map(commissionRows.map(r => [toKey(r), r.total]));
  const prospMap = new Map(prospectRows.map(r => [toKey(r), r.count]));
  const convMap = new Map(conversionRows.map(r => [toKey(r), r.count]));

  const now = new Date();
  const performance = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    const prospects = prospMap.get(key) || 0;
    const conversions = convMap.get(key) || 0;
    performance.push({
      month: key,
      commissions: commMap.get(key) || 0,
      prospects,
      conversions,
      conversionRate: prospects > 0 ? (conversions / prospects * 100).toFixed(2) : 0
    });
  }
  return performance;
}

/**
 * Commission leaderboard for a date range.
 */
export async function getCommissionLeaderboard(startDate, endDate, limit) {
  const results = await Commission.findAll({
    where: {
      earnedDate: { [Op.gte]: startDate, [Op.lte]: endDate },
      status: { [Op.in]: ['approved', 'paid'] }
    },
    attributes: [
      'agentId',
      [sequelize.fn('SUM', sequelize.col('amount')), 'totalCommissions'],
      [sequelize.fn('COUNT', sequelize.col('Commission.id')), 'commissionCount']
    ],
    include: [
      {
        association: 'agent',
        attributes: ['id', 'firstName', 'lastName', 'email', 'avatar']
      }
    ],
    group: ['Commission.agentId', 'agent.id', 'agent.firstName', 'agent.lastName', 'agent.email', 'agent.avatar'],
    order: [[sequelize.fn('SUM', sequelize.col('amount')), 'DESC']],
    limit: parseInt(limit)
  });

  return results.map((result, index) => ({
    rank: index + 1,
    agent: result.agent,
    value: parseFloat(result.dataValues.totalCommissions),
    count: parseInt(result.dataValues.commissionCount),
    metric: 'Total Commissions'
  }));
}

/**
 * Conversion leaderboard for a date range.
 */
export async function getConversionLeaderboard(startDate, endDate, limit) {
  const results = await Prospect.findAll({
    where: {
      conversionDate: { [Op.gte]: startDate, [Op.lte]: endDate },
      leadStatus: 'won'
    },
    attributes: [
      'assignedAgentId',
      [sequelize.fn('COUNT', sequelize.col('Prospect.id')), 'conversions']
    ],
    include: [
      {
        association: 'assignedAgent',
        attributes: ['id', 'firstName', 'lastName', 'email', 'avatar']
      }
    ],
    group: ['Prospect.assignedAgentId', 'assignedAgent.id', 'assignedAgent.firstName', 'assignedAgent.lastName', 'assignedAgent.email', 'assignedAgent.avatar'],
    order: [[sequelize.fn('COUNT', sequelize.col('Prospect.id')), 'DESC']],
    limit: parseInt(limit)
  });

  return results.map((result, index) => ({
    rank: index + 1,
    agent: result.assignedAgent,
    value: parseInt(result.dataValues.conversions),
    metric: 'Conversions'
  }));
}

/**
 * Prospect leaderboard for a date range.
 */
export async function getProspectLeaderboard(startDate, endDate, limit) {
  const results = await Prospect.findAll({
    where: {
      createdAt: { [Op.gte]: startDate, [Op.lte]: endDate }
    },
    attributes: [
      'assignedAgentId',
      [sequelize.fn('COUNT', sequelize.col('Prospect.id')), 'prospects']
    ],
    include: [
      {
        association: 'assignedAgent',
        attributes: ['id', 'firstName', 'lastName', 'email', 'avatar']
      }
    ],
    group: ['Prospect.assignedAgentId', 'assignedAgent.id', 'assignedAgent.firstName', 'assignedAgent.lastName', 'assignedAgent.email', 'assignedAgent.avatar'],
    order: [[sequelize.fn('COUNT', sequelize.col('Prospect.id')), 'DESC']],
    limit: parseInt(limit)
  });

  return results.map((result, index) => ({
    rank: index + 1,
    agent: result.assignedAgent,
    value: parseInt(result.dataValues.prospects),
    metric: 'New Prospects'
  }));
}

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

/**
 * List agents with pagination, search, and computed stats.
 */
export async function listAgents(query) {
  const { page = 1, limit = 10, search, status, sortBy = 'createdAt', order = 'DESC' } = query;
  const offset = (page - 1) * limit;

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
    const sanitizedSearch = String(search).slice(0, 100);
    whereConditions[Op.or] = [
      { firstName: { [Op.iLike]: `%${sanitizedSearch}%` } },
      { lastName: { [Op.iLike]: `%${sanitizedSearch}%` } },
      { email: { [Op.iLike]: `%${sanitizedSearch}%` } }
    ];
  }

  const { count, rows: agents } = await User.findAndCountAll({
    where: whereConditions,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [[sortBy, order.toUpperCase()]],
    attributes: {
      exclude: ['password'],
      include: [
        [sequelize.literal('(SELECT COUNT(*) FROM prospects WHERE prospects."assignedAgentId" = "User".id)'), 'prospectCount'],
        [sequelize.literal('(SELECT COUNT(*) FROM prospects WHERE prospects."assignedAgentId" = "User".id AND prospects."leadStatus" = \'won\')'), 'convertedCount'],
        [sequelize.literal('(SELECT COALESCE(SUM(amount), 0) FROM commissions WHERE commissions."agentId" = "User".id AND commissions.status != \'cancelled\')'), 'totalCommissions'],
        [sequelize.literal('(SELECT COALESCE(SUM(amount), 0) FROM commissions WHERE commissions."agentId" = "User".id AND commissions.status = \'paid\')'), 'paidCommissions'],
        [sequelize.literal('(SELECT COUNT(*) FROM campaigns WHERE campaigns."createdBy" = "User".id)'), 'createdCampaignsCount'],
        [sequelize.literal('(SELECT COUNT(*) FROM campaigns WHERE campaigns."createdBy" = "User".id AND campaigns.status = \'active\')'), 'activeCampaignsCount'],
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

  // Compute counts of campaigns where agents have active lead packages
  const assignedCounts = await getAssignedCampaignCounts();

  // Calculate agent statistics from subquery counts
  const agentsWithStats = agents.map(agent => computeAgentStatsFromCounts(agent, assignedCounts));

  return {
    agents: agentsWithStats,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / limit),
      totalItems: count,
      itemsPerPage: parseInt(limit)
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
    const sanitizedSearch = String(search).slice(0, 100);
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
 * Get leaderboard data for a given period and metric.
 */
export async function getLeaderboard(query) {
  const { period = 'month', metric = 'commissions', limit = 10 } = query;

  const startDate = periodToStartDate(period);
  const now = new Date();

  let leaderboard = [];

  switch (metric) {
    case 'commissions': {
      leaderboard = await getCommissionLeaderboard(startDate, now, limit);
      break;
    }
    case 'conversions': {
      leaderboard = await getConversionLeaderboard(startDate, now, limit);
      break;
    }
    case 'prospects': {
      leaderboard = await getProspectLeaderboard(startDate, now, limit);
      break;
    }
    default: {
      leaderboard = await getCommissionLeaderboard(startDate, now, limit);
    }
  }

  return { period, metric, leaderboard };
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
