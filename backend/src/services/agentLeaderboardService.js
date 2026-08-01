import { Op } from 'sequelize';
import { Prospect, sequelize } from '../models/index.js';

/**
 * Get monthly performance for an agent over the last 12 months.
 */
export async function getAgentMonthlyPerformance(agentId) {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  twelveMonthsAgo.setDate(1);
  twelveMonthsAgo.setHours(0, 0, 0, 0);

  const [prospectRows, conversionRows] = await Promise.all([
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
      prospects,
      conversions,
      conversionRate: prospects > 0 ? (conversions / prospects * 100).toFixed(2) : 0
    });
  }
  return performance;
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
  const { period = 'month', metric = 'conversions', limit = 10 } = query;

  const startDate = periodToStartDate(period);
  const now = new Date();

  let leaderboard = [];

  switch (metric) {
    case 'prospects': {
      leaderboard = await getProspectLeaderboard(startDate, now, limit);
      break;
    }
    // The retired 'commissions' metric falls through to conversions — the
    // commission domain is gone; conversions is the closest live measure.
    case 'conversions':
    default: {
      leaderboard = await getConversionLeaderboard(startDate, now, limit);
    }
  }

  return { period, metric, leaderboard };
}
