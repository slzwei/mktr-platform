import { Op } from 'sequelize';
import { User, Prospect, Commission, Campaign, LeadPackage, LeadPackageAssignment, sequelize } from '../models/index.js';

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
 * Get monthly performance for an agent over the last 12 months.
 */
export async function getAgentMonthlyPerformance(agentId) {
  const performance = [];
  const now = new Date();

  for (let i = 11; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);

    const [commissions, prospects, conversions] = await Promise.all([
      Commission.sum('amount', {
        where: {
          agentId,
          earnedDate: { [Op.gte]: monthStart, [Op.lte]: monthEnd }
        }
      }) || 0,
      Prospect.count({
        where: {
          assignedAgentId: agentId,
          createdAt: { [Op.gte]: monthStart, [Op.lte]: monthEnd }
        }
      }),
      Prospect.count({
        where: {
          assignedAgentId: agentId,
          leadStatus: 'won',
          conversionDate: { [Op.gte]: monthStart, [Op.lte]: monthEnd }
        }
      })
    ]);

    performance.push({
      month: monthStart.toISOString().substring(0, 7),
      commissions,
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
      [sequelize.fn('COUNT', sequelize.col('id')), 'commissionCount']
    ],
    include: [
      {
        association: 'agent',
        attributes: ['id', 'firstName', 'lastName', 'email', 'avatar']
      }
    ],
    group: ['agentId', 'agent.id', 'agent.firstName', 'agent.lastName', 'agent.email', 'agent.avatar'],
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
      [sequelize.fn('COUNT', sequelize.col('id')), 'conversions']
    ],
    include: [
      {
        association: 'assignedAgent',
        attributes: ['id', 'firstName', 'lastName', 'email', 'avatar']
      }
    ],
    group: ['assignedAgentId', 'assignedAgent.id', 'assignedAgent.firstName', 'assignedAgent.lastName', 'assignedAgent.email', 'assignedAgent.avatar'],
    order: [[sequelize.fn('COUNT', sequelize.col('id')), 'DESC']],
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
      [sequelize.fn('COUNT', sequelize.col('id')), 'prospects']
    ],
    include: [
      {
        association: 'assignedAgent',
        attributes: ['id', 'firstName', 'lastName', 'email', 'avatar']
      }
    ],
    group: ['assignedAgentId', 'assignedAgent.id', 'assignedAgent.firstName', 'assignedAgent.lastName', 'assignedAgent.email', 'assignedAgent.avatar'],
    order: [[sequelize.fn('COUNT', sequelize.col('id')), 'DESC']],
    limit: parseInt(limit)
  });

  return results.map((result, index) => ({
    rank: index + 1,
    agent: result.assignedAgent,
    value: parseInt(result.dataValues.prospects),
    metric: 'New Prospects'
  }));
}
