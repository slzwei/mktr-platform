import { Op } from 'sequelize';
import { Commission, User, Campaign, LeadPackage, sequelize } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Parse a period string into a start date.
 */
function periodToStartDate(period) {
  const now = new Date();
  switch (period) {
    case 'today': return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'week': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'month': return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3);
      return new Date(now.getFullYear(), q * 3, 1);
    }
    case 'year': return new Date(now.getFullYear(), 0, 1);
    default: return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}

/**
 * Build role-scoped WHERE clause for commissions.
 */
async function buildCommissionWhere(user) {
  const where = {};
  if (user.role === 'agent') {
    where.agentId = user.id;
  } else if (user.role === 'driver_partner') {
    return null; // signal: return empty set
  } else if (user.role !== 'admin') {
    const userCampaigns = await Campaign.findAll({
      where: { createdBy: user.id },
      attributes: ['id']
    });
    where.campaignId = { [Op.in]: userCampaigns.map(c => c.id) };
  }
  return where;
}

const COMMISSION_LIST_INCLUDES = [
  { association: 'agent', attributes: ['id', 'firstName', 'lastName', 'email'] },
  { association: 'campaign', attributes: ['id', 'name', 'type'] },
  { association: 'prospect', attributes: ['id', 'firstName', 'lastName', 'email', 'company'] },
  { association: 'leadPackage', attributes: ['id', 'name', 'type', 'price'] },
  { association: 'approver', attributes: ['id', 'firstName', 'lastName'] }
];

/**
 * List commissions with pagination, filtering, and role-based scoping.
 */
export async function listCommissions(user, query) {
  const { page = 1, limit = 10, status, type, agentId, campaignId, dateFrom, dateTo, period } = query;
  const offset = (page - 1) * limit;

  const roleWhere = await buildCommissionWhere(user);
  if (roleWhere === null) {
    return {
      commissions: [],
      pagination: { currentPage: 1, totalPages: 0, totalItems: 0, itemsPerPage: parseInt(limit) }
    };
  }

  const where = { ...roleWhere };

  if (status) where.status = status;
  if (type) where.type = type;
  if (agentId && user.role === 'admin') where.agentId = agentId;
  if (campaignId) where.campaignId = campaignId;

  if (dateFrom || dateTo) {
    where.earnedDate = {};
    if (dateFrom) where.earnedDate[Op.gte] = new Date(dateFrom);
    if (dateTo) where.earnedDate[Op.lte] = new Date(dateTo);
  }

  if (period) {
    const now = new Date();
    where.earnedDate = { [Op.gte]: periodToStartDate(period), [Op.lte]: now };
  }

  const { count, rows: commissions } = await Commission.findAndCountAll({
    where,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['earnedDate', 'DESC']],
    include: COMMISSION_LIST_INCLUDES
  });

  return {
    commissions,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / limit),
      totalItems: count,
      itemsPerPage: parseInt(limit)
    }
  };
}

/**
 * Get a single commission by ID, scoped by role.
 */
export async function getCommission(id, user) {
  const roleWhere = await buildCommissionWhere(user);
  if (roleWhere === null) throw new AppError('Commission not found or access denied', 404);

  const where = { id, ...roleWhere };

  const commission = await Commission.findOne({
    where,
    include: [
      { association: 'agent', attributes: ['id', 'firstName', 'lastName', 'email', 'phone'] },
      { association: 'campaign', attributes: ['id', 'name', 'type', 'description'] },
      { association: 'prospect', attributes: ['id', 'firstName', 'lastName', 'email', 'company', 'leadStatus'] },
      { association: 'leadPackage', attributes: ['id', 'name', 'type', 'price', 'leadCount'] },
      { association: 'approver', attributes: ['id', 'firstName', 'lastName', 'email'] },
      { association: 'processor', attributes: ['id', 'firstName', 'lastName', 'email'] }
    ]
  });

  if (!commission) throw new AppError('Commission not found or access denied', 404);
  return commission;
}

/**
 * Create a new commission (admin only).
 */
export async function createCommission({ agentId, amount, type, description, campaignId, prospectId, leadPackageId, metadata }) {
  if (!agentId || !amount || !type) {
    throw new AppError('Agent ID, amount, and type are required', 400);
  }

  const agent = await User.findOne({ where: { id: agentId, role: 'agent', isActive: true } });
  if (!agent) throw new AppError('Invalid or inactive agent', 400);

  let baseAmount = null;
  let rate = null;

  if (leadPackageId) {
    const pkg = await LeadPackage.findByPk(leadPackageId);
    if (pkg) {
      baseAmount = pkg.price;
      rate = pkg.commissionStructure?.agentCommission || 0.1;
    }
  }

  return Commission.create({
    agentId,
    amount: parseFloat(amount),
    baseAmount,
    rate,
    type,
    description,
    campaignId,
    prospectId,
    leadPackageId,
    metadata,
    earnedDate: new Date()
  });
}

/**
 * Update a commission (cannot update paid commissions).
 */
export async function updateCommission(id, updateData) {
  const commission = await Commission.findByPk(id);
  if (!commission) throw new AppError('Commission not found', 404);
  if (commission.status === 'paid') throw new AppError('Cannot update paid commissions', 400);

  await commission.update(updateData);
  return commission;
}

/**
 * Approve a pending commission.
 */
export async function approveCommission(id, userId, notes) {
  const commission = await Commission.findByPk(id);
  if (!commission) throw new AppError('Commission not found', 404);
  if (commission.status !== 'pending') throw new AppError('Only pending commissions can be approved', 400);

  await commission.update({
    status: 'approved',
    approvedBy: userId,
    metadata: {
      ...commission.metadata,
      approvalNotes: notes,
      approvedAt: new Date()
    }
  });

  return commission;
}

/**
 * Mark an approved commission as paid.
 */
export async function payCommission(id, userId, { paymentMethod, transactionId, processingFee = 0, notes }) {
  const commission = await Commission.findByPk(id);
  if (!commission) throw new AppError('Commission not found', 404);
  if (commission.status !== 'approved') throw new AppError('Only approved commissions can be marked as paid', 400);

  const netAmount = commission.amount - parseFloat(processingFee);

  await commission.update({
    status: 'paid',
    paidDate: new Date(),
    processedBy: userId,
    paymentInfo: {
      method: paymentMethod,
      transactionId,
      processingFee: parseFloat(processingFee),
      netAmount,
      paidDate: new Date(),
      notes
    }
  });

  return commission;
}

/**
 * Bulk approve pending commissions.
 */
export async function bulkApproveCommissions(commissionIds, userId, notes) {
  if (!commissionIds || !Array.isArray(commissionIds)) {
    throw new AppError('Commission IDs array is required', 400);
  }

  const result = await Commission.update(
    {
      status: 'approved',
      approvedBy: userId,
      metadata: sequelize.literal(`
        CASE
          WHEN metadata IS NULL THEN '{"approvalNotes": "${notes || ''}", "approvedAt": "${new Date().toISOString()}"}'::jsonb
          ELSE metadata || '{"approvalNotes": "${notes || ''}", "approvedAt": "${new Date().toISOString()}"}'::jsonb
        END
      `)
    },
    { where: { id: { [Op.in]: commissionIds }, status: 'pending' } }
  );

  return result[0]; // affected count
}

/**
 * Get commission statistics for a period.
 */
export async function getCommissionStats(user, query) {
  const { period = 'month', agentId } = query;
  const where = {};

  if (user.role === 'agent') {
    where.agentId = user.id;
  } else if (agentId && user.role === 'admin') {
    where.agentId = agentId;
  }

  const now = new Date();
  const startDate = periodToStartDate(period);
  where.earnedDate = { [Op.gte]: startDate, [Op.lte]: now };

  const [totalCommissions, totalCount, commissionsByStatus, commissionsByType, topCampaigns] = await Promise.all([
    Commission.sum('amount', { where }),
    Commission.count({ where }),
    Commission.findAll({
      where,
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('status')), 'count'],
        [sequelize.fn('SUM', sequelize.col('amount')), 'total']
      ],
      group: ['status']
    }),
    Commission.findAll({
      where,
      attributes: [
        'type',
        [sequelize.fn('COUNT', sequelize.col('type')), 'count'],
        [sequelize.fn('SUM', sequelize.col('amount')), 'total']
      ],
      group: ['type']
    }),
    Commission.findAll({
      where,
      attributes: [[sequelize.fn('SUM', sequelize.col('amount')), 'total']],
      include: [{ association: 'campaign', attributes: ['id', 'name', 'type'] }],
      group: ['campaign.id', 'campaign.name', 'campaign.type'],
      order: [[sequelize.fn('SUM', sequelize.col('amount')), 'DESC']],
      limit: 5
    })
  ]);

  // Monthly trend (last 12 months) — single GROUP BY query
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const agentFilter = where.agentId ? 'AND "agentId" = :trendAgentId' : '';
  const [monthlyResults] = await sequelize.query(`
    SELECT DATE_TRUNC('month', "earnedDate") AS month, COALESCE(SUM(amount), 0)::float AS total
    FROM commissions
    WHERE "earnedDate" >= :since ${agentFilter}
    GROUP BY month ORDER BY month
  `, { replacements: { since: twelveMonthsAgo, trendAgentId: where.agentId || null } });

  const toMonthKey = (r) => r.month instanceof Date ? r.month.toISOString().slice(0, 7) : String(r.month).slice(0, 7);
  const monthMap = new Map(monthlyResults.map(r => [toMonthKey(r), r.total]));
  const monthlyTrend = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    monthlyTrend.push({ month: key, total: monthMap.get(key) || 0 });
  }

  return {
    summary: {
      totalAmount: totalCommissions || 0,
      totalCount,
      averageCommission: totalCount > 0 ? (totalCommissions / totalCount).toFixed(2) : 0
    },
    byStatus: commissionsByStatus.map(item => ({
      status: item.status,
      count: parseInt(item.dataValues.count),
      total: parseFloat(item.dataValues.total || 0)
    })),
    byType: commissionsByType.map(item => ({
      type: item.type,
      count: parseInt(item.dataValues.count),
      total: parseFloat(item.dataValues.total || 0)
    })),
    topCampaigns: topCampaigns.map(item => ({
      campaign: item.campaign,
      total: parseFloat(item.dataValues.total)
    })),
    monthlyTrend
  };
}

/**
 * Get agent commission summary for a given year.
 */
export async function getAgentCommissionSummary(agentId, year = new Date().getFullYear()) {
  const agent = await User.findOne({
    where: { id: agentId, role: 'agent' },
    attributes: ['id', 'firstName', 'lastName', 'email']
  });
  if (!agent) throw new AppError('Agent not found', 404);

  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const where = { agentId, earnedDate: { [Op.gte]: yearStart, [Op.lte]: yearEnd } };

  const [totalEarnings, totalCommissions, paidAmount, pendingAmount] = await Promise.all([
    Commission.sum('amount', { where }),
    Commission.count({ where }),
    Commission.sum('amount', { where: { ...where, status: 'paid' } }),
    Commission.sum('amount', { where: { ...where, status: 'pending' } })
  ]);

  // Single GROUP BY query instead of 12 sequential queries
  const [monthlyResults] = await sequelize.query(`
    SELECT EXTRACT(MONTH FROM "earnedDate")::int AS month, COALESCE(SUM(amount), 0)::float AS total
    FROM commissions
    WHERE "agentId" = :agentId AND "earnedDate" >= :yearStart AND "earnedDate" <= :yearEnd
    GROUP BY month ORDER BY month
  `, { replacements: { agentId, yearStart, yearEnd } });

  const monthTotalMap = new Map(monthlyResults.map(r => [r.month, r.total]));
  const monthlyBreakdown = [];
  for (let month = 1; month <= 12; month++) {
    monthlyBreakdown.push({ month, total: monthTotalMap.get(month) || 0 });
  }

  return {
    agent,
    summary: {
      totalEarnings: totalEarnings || 0,
      totalCommissions,
      paidAmount: paidAmount || 0,
      pendingAmount: pendingAmount || 0,
      averageCommission: totalCommissions > 0 ? (totalEarnings / totalCommissions).toFixed(2) : 0
    },
    monthlyBreakdown
  };
}
