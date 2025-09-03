import express from 'express';
import { Op } from 'sequelize';
import { User, Prospect, Commission, Campaign, sequelize } from '../models/index.js';
import { authenticateToken, requireAdmin, requireAgentOrAdmin } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

// Get all agents (Admin only)
router.get('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search, status, sortBy = 'createdAt', order = 'DESC' } = req.query;
  const offset = (page - 1) * limit;

  const whereConditions = { role: 'agent' };
  
  if (status) {
    whereConditions.isActive = status === 'active';
  }
  
  if (search) {
    whereConditions[Op.or] = [
      { firstName: { [Op.iLike]: `%${search}%` } },
      { lastName: { [Op.iLike]: `%${search}%` } },
      { email: { [Op.iLike]: `%${search}%` } }
    ];
  }

  const { count, rows: agents } = await User.findAndCountAll({
    where: whereConditions,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [[sortBy, order.toUpperCase()]],
    attributes: { exclude: ['password'] },
    include: [
      {
        association: 'assignedProspects',
        attributes: ['id', 'leadStatus'],
        separate: true
      },
      {
        association: 'commissions',
        attributes: ['id', 'amount', 'status'],
        separate: true
      },
      {
        association: 'createdCampaigns',
        attributes: ['id', 'name', 'status'],
        separate: true
      }
    ]
  });

  // Calculate agent statistics
  const agentsWithStats = agents.map(agent => {
    const totalProspects = agent.assignedProspects.length;
    const convertedProspects = agent.assignedProspects.filter(p => p.leadStatus === 'won').length;
    const totalCommissions = agent.commissions.reduce((sum, c) => sum + parseFloat(c.amount), 0);
    const paidCommissions = agent.commissions.filter(c => c.status === 'paid').reduce((sum, c) => sum + parseFloat(c.amount), 0);
    
    return {
      ...agent.toJSON(),
      stats: {
        totalProspects,
        convertedProspects,
        conversionRate: totalProspects > 0 ? (convertedProspects / totalProspects * 100).toFixed(2) : 0,
        totalCommissions,
        paidCommissions,
        pendingCommissions: totalCommissions - paidCommissions,
        totalCampaigns: agent.createdCampaigns.length,
        activeCampaigns: agent.createdCampaigns.filter(c => c.status === 'active').length
      }
    };
  });

  res.json({
    success: true,
    data: {
      agents: agentsWithStats,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    }
  });
}));

// Get agent by ID with detailed stats
router.get('/:id', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Non-admin users can only view their own profile
  if (req.user.role !== 'admin' && req.user.id !== id) {
    throw new AppError('Access denied', 403);
  }

  const agent = await User.findOne({
    where: { id, role: 'agent' },
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
  const monthlyPerformance = await getAgentMonthlyPerformance(id);

  const agentWithStats = {
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

  res.json({
    success: true,
    data: { agent: agentWithStats }
  });
}));

// Update agent profile
router.put('/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { firstName, lastName, phone, avatar, isActive } = req.body;

  // Non-admin users can only update their own profile (except isActive)
  if (req.user.role !== 'admin' && req.user.id !== id) {
    throw new AppError('Access denied', 403);
  }

  const agent = await User.findOne({
    where: { id, role: 'agent' }
  });

  if (!agent) {
    throw new AppError('Agent not found', 404);
  }

  const updateData = {};
  if (firstName) updateData.firstName = firstName;
  if (lastName) updateData.lastName = lastName;
  if (phone) updateData.phone = phone;
  if (avatar) updateData.avatar = avatar;
  
  // Only admins can update isActive status
  if (req.user.role === 'admin' && typeof isActive === 'boolean') {
    updateData.isActive = isActive;
  }

  await agent.update(updateData);

  res.json({
    success: true,
    message: 'Agent profile updated successfully',
    data: { agent: agent.toJSON() }
  });
}));

// Get agent's prospects
router.get('/:id/prospects', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 10, status, priority, search } = req.query;
  const offset = (page - 1) * limit;

  // Non-admin users can only view their own prospects
  if (req.user.role !== 'admin' && req.user.id !== id) {
    throw new AppError('Access denied', 403);
  }

  const whereConditions = { assignedAgentId: id };
  
  if (status) {
    whereConditions.leadStatus = status;
  }
  
  if (priority) {
    whereConditions.priority = priority;
  }
  
  if (search) {
    whereConditions[Op.or] = [
      { firstName: { [Op.iLike]: `%${search}%` } },
      { lastName: { [Op.iLike]: `%${search}%` } },
      { email: { [Op.iLike]: `%${search}%` } },
      { company: { [Op.iLike]: `%${search}%` } }
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

  res.json({
    success: true,
    data: {
      prospects,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    }
  });
}));

// Get agent's commissions
router.get('/:id/commissions', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 10, status, type, period } = req.query;
  const offset = (page - 1) * limit;

  // Non-admin users can only view their own commissions
  if (req.user.role !== 'admin' && req.user.id !== id) {
    throw new AppError('Access denied', 403);
  }

  const whereConditions = { agentId: id };
  
  if (status) {
    whereConditions.status = status;
  }
  
  if (type) {
    whereConditions.type = type;
  }
  
  if (period) {
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

  res.json({
    success: true,
    data: {
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
    }
  });
}));

// Get agent's campaigns
router.get('/:id/campaigns', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 10, status, type } = req.query;
  const offset = (page - 1) * limit;

  // Non-admin users can only view their own campaigns
  if (req.user.role !== 'admin' && req.user.id !== id) {
    throw new AppError('Access denied', 403);
  }

  const whereConditions = { createdBy: id };
  
  if (status) {
    whereConditions.status = status;
  }
  
  if (type) {
    whereConditions.type = type;
  }

  const { count, rows: campaigns } = await Campaign.findAndCountAll({
    where: whereConditions,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['createdAt', 'DESC']],
    include: [
      {
        association: 'prospects',
        attributes: ['id', 'leadStatus'],
        separate: true
      },
      {
        association: 'qrTags',
        attributes: ['id', 'scanCount'],
        separate: true
      }
    ]
  });

  // Add performance stats to each campaign
  const campaignsWithStats = campaigns.map(campaign => ({
    ...campaign.toJSON(),
    stats: {
      totalProspects: campaign.prospects.length,
      convertedProspects: campaign.prospects.filter(p => p.leadStatus === 'won').length,
      totalScans: campaign.qrTags.reduce((sum, qr) => sum + qr.scanCount, 0),
      conversionRate: campaign.prospects.length > 0 ? 
        (campaign.prospects.filter(p => p.leadStatus === 'won').length / campaign.prospects.length * 100).toFixed(2) : 0
    }
  }));

  res.json({
    success: true,
    data: {
      campaigns: campaignsWithStats,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    }
  });
}));

// Get agent performance leaderboard (Admin only)
router.get('/leaderboard/performance', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { period = 'month', metric = 'commissions', limit = 10 } = req.query;

  // Calculate date range
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

  res.json({
    success: true,
    data: {
      period,
      metric,
      leaderboard
    }
  });
}));

// Helper function to get agent monthly performance
async function getAgentMonthlyPerformance(agentId) {
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

// Leaderboard helper functions
async function getCommissionLeaderboard(startDate, endDate, limit) {
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

async function getConversionLeaderboard(startDate, endDate, limit) {
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

async function getProspectLeaderboard(startDate, endDate, limit) {
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

export default router;
