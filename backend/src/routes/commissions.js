import express from 'express';
import { Op } from 'sequelize';
import { Commission, User, Campaign, LeadPackage, sequelize } from '../models/index.js';
import { authenticateToken, requireAdmin, requireAgentOrAdmin } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

// Get all commissions
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    limit = 10, 
    status, 
    type, 
    agentId, 
    campaignId,
    dateFrom,
    dateTo,
    period
  } = req.query;
  
  const offset = (page - 1) * limit;
  const whereConditions = {};
  
  // Non-admin users can only see their own commissions
  if (req.user.role === 'agent') {
    whereConditions.agentId = req.user.id;
  } else if (req.user.role === 'driver_partner') {
    // driver_partner does not have entries in commissions table yet; return empty set
    return res.json({ success: true, data: { commissions: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0, itemsPerPage: parseInt(limit) } } });
  } else if (req.user.role !== 'admin') {
    // Other roles might see commissions from their campaigns
    const userCampaigns = await Campaign.findAll({
      where: { createdBy: req.user.id },
      attributes: ['id']
    });
    const campaignIds = userCampaigns.map(c => c.id);
    whereConditions.campaignId = { [Op.in]: campaignIds };
  }
  
  if (status) {
    whereConditions.status = status;
  }
  
  if (type) {
    whereConditions.type = type;
  }
  
  if (agentId && req.user.role === 'admin') {
    whereConditions.agentId = agentId;
  }
  
  if (campaignId) {
    whereConditions.campaignId = campaignId;
  }
  
  if (dateFrom || dateTo) {
    whereConditions.earnedDate = {};
    if (dateFrom) whereConditions.earnedDate[Op.gte] = new Date(dateFrom);
    if (dateTo) whereConditions.earnedDate[Op.lte] = new Date(dateTo);
  }
  
  if (period) {
    const now = new Date();
    let startDate;
    
    switch (period) {
      case 'today': {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      }
      case 'week': {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      }
      case 'month': {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      }
      case 'quarter': {
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
        break;
      }
      case 'year': {
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      }
      default: {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      }
    }
    
    if (startDate) {
      whereConditions.earnedDate = {
        [Op.gte]: startDate,
        [Op.lte]: now
      };
    }
  }

  const { count, rows: commissions } = await Commission.findAndCountAll({
    where: whereConditions,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['earnedDate', 'DESC']],
    include: [
      {
        association: 'agent',
        attributes: ['id', 'firstName', 'lastName', 'email']
      },
      {
        association: 'campaign',
        attributes: ['id', 'name', 'type']
      },
      {
        association: 'prospect',
        attributes: ['id', 'firstName', 'lastName', 'email', 'company']
      },
      {
        association: 'leadPackage',
        attributes: ['id', 'name', 'type', 'price']
      },
      {
        association: 'approver',
        attributes: ['id', 'firstName', 'lastName']
      }
    ]
  });

  res.json({
    success: true,
    data: {
      commissions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    }
  });
}));

// Create new commission (Admin only)
router.post('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { agentId, amount, type, description, campaignId, prospectId, leadPackageId, metadata } = req.body;

  if (!agentId || !amount || !type) {
    throw new AppError('Agent ID, amount, and type are required', 400);
  }

  // Verify agent exists
  const agent = await User.findOne({
    where: { id: agentId, role: 'agent', isActive: true }
  });

  if (!agent) {
    throw new AppError('Invalid or inactive agent', 400);
  }

  // Calculate commission details
  let baseAmount = null;
  let rate = null;

  if (leadPackageId) {
    const leadPackage = await LeadPackage.findByPk(leadPackageId);
    if (leadPackage) {
      baseAmount = leadPackage.price;
      rate = leadPackage.commissionStructure?.agentCommission || 0.1; // 10% default
    }
  }

  const commission = await Commission.create({
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

  res.status(201).json({
    success: true,
    message: 'Commission created successfully',
    data: { commission }
  });
}));

// Get commission by ID
router.get('/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const whereConditions = { id };
  
  // Non-admin users can only see their own commissions
  if (req.user.role === 'agent') {
    whereConditions.agentId = req.user.id;
  } else if (req.user.role !== 'admin') {
    const userCampaigns = await Campaign.findAll({
      where: { createdBy: req.user.id },
      attributes: ['id']
    });
    const campaignIds = userCampaigns.map(c => c.id);
    whereConditions.campaignId = { [Op.in]: campaignIds };
  }

  const commission = await Commission.findOne({
    where: whereConditions,
    include: [
      {
        association: 'agent',
        attributes: ['id', 'firstName', 'lastName', 'email', 'phone']
      },
      {
        association: 'campaign',
        attributes: ['id', 'name', 'type', 'description']
      },
      {
        association: 'prospect',
        attributes: ['id', 'firstName', 'lastName', 'email', 'company', 'leadStatus']
      },
      {
        association: 'leadPackage',
        attributes: ['id', 'name', 'type', 'price', 'leadCount']
      },
      {
        association: 'approver',
        attributes: ['id', 'firstName', 'lastName', 'email']
      },
      {
        association: 'processor',
        attributes: ['id', 'firstName', 'lastName', 'email']
      }
    ]
  });

  if (!commission) {
    throw new AppError('Commission not found or access denied', 404);
  }

  res.json({
    success: true,
    data: { commission }
  });
}));

// Update commission (Admin only)
router.put('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  const commission = await Commission.findByPk(id);
  
  if (!commission) {
    throw new AppError('Commission not found', 404);
  }

  // Don't allow updating paid commissions
  if (commission.status === 'paid') {
    throw new AppError('Cannot update paid commissions', 400);
  }

  await commission.update(updateData);

  res.json({
    success: true,
    message: 'Commission updated successfully',
    data: { commission }
  });
}));

// Approve commission (Admin only)
router.patch('/:id/approve', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;

  const commission = await Commission.findByPk(id);
  
  if (!commission) {
    throw new AppError('Commission not found', 404);
  }

  if (commission.status !== 'pending') {
    throw new AppError('Only pending commissions can be approved', 400);
  }

  await commission.update({
    status: 'approved',
    approvedBy: req.user.id,
    metadata: {
      ...commission.metadata,
      approvalNotes: notes,
      approvedAt: new Date()
    }
  });

  res.json({
    success: true,
    message: 'Commission approved successfully',
    data: { commission }
  });
}));

// Mark commission as paid (Admin only)
router.patch('/:id/pay', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { paymentMethod, transactionId, processingFee = 0, notes } = req.body;

  const commission = await Commission.findByPk(id);
  
  if (!commission) {
    throw new AppError('Commission not found', 404);
  }

  if (commission.status !== 'approved') {
    throw new AppError('Only approved commissions can be marked as paid', 400);
  }

  const netAmount = commission.amount - parseFloat(processingFee);

  await commission.update({
    status: 'paid',
    paidDate: new Date(),
    processedBy: req.user.id,
    paymentInfo: {
      method: paymentMethod,
      transactionId,
      processingFee: parseFloat(processingFee),
      netAmount,
      paidDate: new Date(),
      notes
    }
  });

  res.json({
    success: true,
    message: 'Commission marked as paid successfully',
    data: { commission }
  });
}));

// Bulk approve commissions (Admin only)
router.patch('/bulk/approve', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { commissionIds, notes } = req.body;

  if (!commissionIds || !Array.isArray(commissionIds)) {
    throw new AppError('Commission IDs array is required', 400);
  }

  const result = await Commission.update(
    {
      status: 'approved',
      approvedBy: req.user.id,
      metadata: sequelize.literal(`
        CASE 
          WHEN metadata IS NULL THEN '{"approvalNotes": "${notes || ''}", "approvedAt": "${new Date().toISOString()}"}'::jsonb
          ELSE metadata || '{"approvalNotes": "${notes || ''}", "approvedAt": "${new Date().toISOString()}"}'::jsonb
        END
      `)
    },
    {
      where: {
        id: { [Op.in]: commissionIds },
        status: 'pending'
      }
    }
  );

  res.json({
    success: true,
    message: `${result[0]} commissions approved successfully`,
    data: { affectedCount: result[0] }
  });
}));

// Get commission statistics
router.get('/stats/overview', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { period = 'month', agentId } = req.query;
  
  const whereConditions = {};
  
  // Non-admin users see stats for their own commissions
  if (req.user.role === 'agent') {
    whereConditions.agentId = req.user.id;
  } else if (agentId && req.user.role === 'admin') {
    whereConditions.agentId = agentId;
  }
  
  // Calculate period
  const now = new Date();
  let startDate;
  
  switch (period) {
    case 'week': {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    }
    case 'month': {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    }
    case 'quarter': {
      const quarter = Math.floor(now.getMonth() / 3);
      startDate = new Date(now.getFullYear(), quarter * 3, 1);
      break;
    }
    case 'year': {
      startDate = new Date(now.getFullYear(), 0, 1);
      break;
    }
    default: {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }
  }
  
  whereConditions.earnedDate = {
    [Op.gte]: startDate,
    [Op.lte]: now
  };

  // Total commissions
  const totalCommissions = await Commission.sum('amount', { where: whereConditions });
  const totalCount = await Commission.count({ where: whereConditions });

  // Commissions by status
  const commissionsByStatus = await Commission.findAll({
    where: whereConditions,
    attributes: [
      'status',
      [sequelize.fn('COUNT', sequelize.col('status')), 'count'],
      [sequelize.fn('SUM', sequelize.col('amount')), 'total']
    ],
    group: ['status']
  });

  // Commissions by type
  const commissionsByType = await Commission.findAll({
    where: whereConditions,
    attributes: [
      'type',
      [sequelize.fn('COUNT', sequelize.col('type')), 'count'],
      [sequelize.fn('SUM', sequelize.col('amount')), 'total']
    ],
    group: ['type']
  });

  // Top earning campaigns
  const topCampaigns = await Commission.findAll({
    where: whereConditions,
    attributes: [
      [sequelize.fn('SUM', sequelize.col('amount')), 'total']
    ],
    include: [
      {
        association: 'campaign',
        attributes: ['id', 'name', 'type']
      }
    ],
    group: ['campaign.id', 'campaign.name', 'campaign.type'],
    order: [[sequelize.fn('SUM', sequelize.col('amount')), 'DESC']],
    limit: 5
  });

  // Monthly trend (last 12 months)
  const monthlyTrend = [];
  for (let i = 11; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    
    const monthTotal = await Commission.sum('amount', {
      where: {
        ...whereConditions,
        earnedDate: {
          [Op.gte]: monthStart,
          [Op.lte]: monthEnd
        }
      }
    });
    
    monthlyTrend.push({
      month: monthStart.toISOString().substring(0, 7), // YYYY-MM format
      total: monthTotal || 0
    });
  }

  res.json({
    success: true,
    data: {
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
    }
  });
}));

// Get agent commission summary
router.get('/agents/:agentId/summary', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { agentId } = req.params;
  const { year = new Date().getFullYear() } = req.query;

  // Verify agent exists
  const agent = await User.findOne({
    where: { id: agentId, role: 'agent' },
    attributes: ['id', 'firstName', 'lastName', 'email']
  });

  if (!agent) {
    throw new AppError('Agent not found', 404);
  }

  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);

  const whereConditions = {
    agentId,
    earnedDate: {
      [Op.gte]: yearStart,
      [Op.lte]: yearEnd
    }
  };

  // Total earnings
  const totalEarnings = await Commission.sum('amount', { where: whereConditions });
  const totalCommissions = await Commission.count({ where: whereConditions });
  const paidAmount = await Commission.sum('amount', { 
    where: { ...whereConditions, status: 'paid' }
  });
  const pendingAmount = await Commission.sum('amount', { 
    where: { ...whereConditions, status: 'pending' }
  });

  // Monthly breakdown
  const monthlyBreakdown = [];
  for (let month = 0; month < 12; month++) {
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    
    const monthTotal = await Commission.sum('amount', {
      where: {
        ...whereConditions,
        earnedDate: {
          [Op.gte]: monthStart,
          [Op.lte]: monthEnd
        }
      }
    });
    
    monthlyBreakdown.push({
      month: month + 1,
      total: monthTotal || 0
    });
  }

  res.json({
    success: true,
    data: {
      agent,
      summary: {
        totalEarnings: totalEarnings || 0,
        totalCommissions,
        paidAmount: paidAmount || 0,
        pendingAmount: pendingAmount || 0,
        averageCommission: totalCommissions > 0 ? (totalEarnings / totalCommissions).toFixed(2) : 0
      },
      monthlyBreakdown
    }
  });
}));

export default router;
