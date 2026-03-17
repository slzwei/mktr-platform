import { Op } from 'sequelize';
import { Prospect, Commission, sequelize } from '../models/index.js';

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
