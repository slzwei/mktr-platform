import express from 'express';
import { Op } from 'sequelize';
import { 
  User, 
  Campaign, 
  Prospect, 
  QrTag, 
  Commission, 
  Car, 
  Driver, 
  FleetOwner,
  sequelize
} from '../models/index.js';
import { authenticateToken, requireAgentOrAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// Get dashboard overview statistics
router.get('/overview', authenticateToken, asyncHandler(async (req, res) => {
  const { period = '30d' } = req.query;
  const userId = req.user.id;
  const userRole = req.user.role;

  // Calculate date range
  const now = new Date();
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  let stats = {};

  switch (userRole) {
    case 'admin':
      stats = await getAdminStats(startDate, now);
      break;
    case 'agent':
      stats = await getAgentStats(userId, startDate, now);
      break;
    case 'fleet_owner':
      stats = await getFleetOwnerStats(userId, startDate, now);
      break;
    default:
      stats = await getCustomerStats(userId, startDate, now);
  }

  res.json({
    success: true,
    data: {
      period,
      stats,
      lastUpdated: now
    }
  });
}));

// Admin dashboard statistics
async function getAdminStats(startDate, endDate) {
  const [
    totalUsers,
    activeUsers,
    totalCampaigns,
    activeCampaigns,
    totalProspects,
    newProspects,
    totalCommissions,
    pendingCommissions,
    totalQrTags,
    totalScans,
    totalCars,
    activeCars
  ] = await Promise.all([
    User.count(),
    User.count({ where: { isActive: true } }),
    Campaign.count(),
    Campaign.count({ where: { status: 'active' } }),
    Prospect.count(),
    Prospect.count({ where: { createdAt: { [Op.gte]: startDate } } }),
    Commission.sum('amount') || 0,
    Commission.sum('amount', { where: { status: 'pending' } }) || 0,
    QrTag.count(),
    QrTag.sum('scanCount') || 0,
    Car.count(),
    Car.count({ where: { status: 'active' } })
  ]);

  // User growth trend
  const userGrowth = await getUserGrowthTrend(startDate, endDate);
  
  // Recent activities
  const recentActivities = await getRecentActivities(10);

  return {
    users: {
      total: totalUsers,
      active: activeUsers,
      growth: userGrowth
    },
    campaigns: {
      total: totalCampaigns,
      active: activeCampaigns
    },
    prospects: {
      total: totalProspects,
      new: newProspects
    },
    commissions: {
      total: totalCommissions,
      pending: pendingCommissions
    },
    qrCodes: {
      total: totalQrTags,
      totalScans: totalScans
    },
    fleet: {
      totalCars,
      activeCars
    },
    recentActivities
  };
}

// Agent dashboard statistics
async function getAgentStats(userId, startDate, endDate) {
  const [
    assignedProspects,
    newProspects,
    convertedProspects,
    totalCommissions,
    pendingCommissions,
    paidCommissions,
    myCampaigns,
    activeCampaigns
  ] = await Promise.all([
    Prospect.count({ where: { assignedAgentId: userId } }),
    Prospect.count({ 
      where: { 
        assignedAgentId: userId,
        createdAt: { [Op.gte]: startDate }
      }
    }),
    Prospect.count({ 
      where: { 
        assignedAgentId: userId,
        leadStatus: 'won'
      }
    }),
    Commission.sum('amount', { where: { agentId: userId } }) || 0,
    Commission.sum('amount', { 
      where: { 
        agentId: userId,
        status: 'pending'
      }
    }) || 0,
    Commission.sum('amount', { 
      where: { 
        agentId: userId,
        status: 'paid'
      }
    }) || 0,
    Campaign.count({ where: { createdBy: userId } }),
    Campaign.count({ 
      where: { 
        createdBy: userId,
        status: 'active'
      }
    })
  ]);

  // Conversion rate
  const conversionRate = assignedProspects > 0 ? 
    (convertedProspects / assignedProspects * 100).toFixed(2) : 0;

  // Recent prospects
  const recentProspects = await Prospect.findAll({
    where: { assignedAgentId: userId },
    limit: 5,
    order: [['createdAt', 'DESC']],
    attributes: ['id', 'firstName', 'lastName', 'email', 'leadStatus', 'createdAt'],
    include: [
      {
        association: 'campaign',
        attributes: ['id', 'name']
      }
    ]
  });

  // Commission trend
  const commissionTrend = await getCommissionTrend(userId, startDate, endDate);

  return {
    prospects: {
      assigned: assignedProspects,
      new: newProspects,
      converted: convertedProspects,
      conversionRate: parseFloat(conversionRate)
    },
    commissions: {
      total: totalCommissions,
      pending: pendingCommissions,
      paid: paidCommissions,
      trend: commissionTrend
    },
    campaigns: {
      total: myCampaigns,
      active: activeCampaigns
    },
    recentProspects
  };
}

// Fleet Owner dashboard statistics
async function getFleetOwnerStats(userId, startDate, endDate) {
  // Get fleet owner profile
  const fleetOwner = await FleetOwner.findOne({ where: { userId } });
  if (!fleetOwner) {
    return { error: 'Fleet owner profile not found' };
  }

  const [
    totalCars,
    activeCars,
    totalDrivers,
    activeDrivers,
    totalQrTags,
    totalScans
  ] = await Promise.all([
    Car.count({ where: { fleetOwnerId: fleetOwner.id } }),
    Car.count({ 
      where: { 
        fleetOwnerId: fleetOwner.id,
        status: 'active'
      }
    }),
    Driver.count({ where: { fleetOwnerId: fleetOwner.id } }),
    Driver.count({ 
      where: { 
        fleetOwnerId: fleetOwner.id,
        status: 'active'
      }
    }),
    QrTag.count({ 
      include: [{
        association: 'car',
        where: { fleetOwnerId: fleetOwner.id }
      }]
    }),
    QrTag.sum('scanCount', {
      include: [{
        association: 'car',
        where: { fleetOwnerId: fleetOwner.id }
      }]
    }) || 0
  ]);

  // Fleet utilization rate
  const utilizationRate = totalCars > 0 ? 
    (activeCars / totalCars * 100).toFixed(2) : 0;

  // Recent car activities (QR scans, assignments)
  const recentActivities = await getFleetActivities(fleetOwner.id, 10);

  // Car status distribution
  const carsByStatus = await Car.findAll({
    where: { fleetOwnerId: fleetOwner.id },
    attributes: [
      'status',
      [sequelize.fn('COUNT', sequelize.col('status')), 'count']
    ],
    group: ['status']
  });

  return {
    fleet: {
      totalCars,
      activeCars,
      utilizationRate: parseFloat(utilizationRate),
      carsByStatus: carsByStatus.map(item => ({
        status: item.status,
        count: parseInt(item.dataValues.count)
      }))
    },
    drivers: {
      total: totalDrivers,
      active: activeDrivers
    },
    qrCodes: {
      total: totalQrTags,
      totalScans: totalScans
    },
    recentActivities
  };
}

// Customer dashboard statistics
async function getCustomerStats(userId, startDate, endDate) {
  // Basic stats for customers
  const [
    myProspectRequests,
    myInteractions
  ] = await Promise.all([
    Prospect.count({ 
      where: { 
        email: req.user.email // Assuming customer might have submitted leads
      }
    }),
    0 // Placeholder for interaction tracking
  ]);

  return {
    interactions: {
      total: myInteractions,
      recent: myProspectRequests
    }
  };
}

// Helper function to get user growth trend
async function getUserGrowthTrend(startDate, endDate) {
  const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  const trend = [];

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const nextDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);
    
    const count = await User.count({
      where: {
        createdAt: {
          [Op.gte]: date,
          [Op.lt]: nextDate
        }
      }
    });

    trend.push({
      date: date.toISOString().split('T')[0],
      count
    });
  }

  return trend;
}

// Helper function to get commission trend
async function getCommissionTrend(userId, startDate, endDate) {
  const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  const trend = [];

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const nextDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);
    
    const amount = await Commission.sum('amount', {
      where: {
        agentId: userId,
        earnedDate: {
          [Op.gte]: date,
          [Op.lt]: nextDate
        }
      }
    }) || 0;

    trend.push({
      date: date.toISOString().split('T')[0],
      amount
    });
  }

  return trend;
}

// Helper function to get recent activities
async function getRecentActivities(limit) {
  // Get recent prospects, campaigns, and QR scans
  const [recentProspects, recentCampaigns, recentScans] = await Promise.all([
    Prospect.findAll({
      limit: limit / 3,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'firstName', 'lastName', 'createdAt'],
      include: [{ association: 'campaign', attributes: ['name'] }]
    }),
    Campaign.findAll({
      limit: limit / 3,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'name', 'createdAt', 'status'],
      include: [{ association: 'creator', attributes: ['firstName', 'lastName'] }]
    }),
    QrTag.findAll({
      where: { lastScanned: { [Op.not]: null } },
      limit: limit / 3,
      order: [['lastScanned', 'DESC']],
      attributes: ['id', 'name', 'lastScanned', 'scanCount']
    })
  ]);

  // Combine and sort activities
  const activities = [
    ...recentProspects.map(p => ({
      type: 'prospect',
      id: p.id,
      description: `New prospect: ${p.firstName} ${p.lastName}`,
      timestamp: p.createdAt,
      metadata: { campaign: p.campaign?.name }
    })),
    ...recentCampaigns.map(c => ({
      type: 'campaign',
      id: c.id,
      description: `Campaign ${c.status}: ${c.name}`,
      timestamp: c.createdAt,
      metadata: { creator: `${c.creator.firstName} ${c.creator.lastName}` }
    })),
    ...recentScans.map(q => ({
      type: 'qr_scan',
      id: q.id,
      description: `QR code scanned: ${q.name}`,
      timestamp: q.lastScanned,
      metadata: { scanCount: q.scanCount }
    }))
  ];

  return activities
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
}

// Helper function to get fleet activities
async function getFleetActivities(fleetOwnerId, limit) {
  const activities = [];

  // Recent car assignments
  const recentAssignments = await Car.findAll({
    where: { 
      fleetOwnerId,
      currentDriverId: { [Op.not]: null }
    },
    limit,
    order: [['updatedAt', 'DESC']],
    include: [
      {
        association: 'currentDriver',
        include: [{ association: 'user', attributes: ['firstName', 'lastName'] }]
      }
    ]
  });

  activities.push(...recentAssignments.map(car => ({
    type: 'car_assignment',
    id: car.id,
    description: `${car.make} ${car.model} assigned to ${car.currentDriver.user.firstName} ${car.currentDriver.user.lastName}`,
    timestamp: car.updatedAt
  })));

  return activities
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
}

// Get analytics data for charts
router.get('/analytics', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { type, period = '30d', agentId, campaignId } = req.query;
  const userId = req.user.id;
  const userRole = req.user.role;

  // Calculate date range
  const now = new Date();
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  let analyticsData = {};

  switch (type) {
    case 'prospects':
      analyticsData = await getProspectAnalytics(userId, userRole, startDate, now, { agentId, campaignId });
      break;
    case 'commissions':
      analyticsData = await getCommissionAnalytics(userId, userRole, startDate, now, { agentId });
      break;
    case 'campaigns':
      analyticsData = await getCampaignAnalytics(userId, userRole, startDate, now, { campaignId });
      break;
    case 'qr_codes':
      analyticsData = await getQRAnalytics(userId, userRole, startDate, now);
      break;
    default:
      throw new AppError('Invalid analytics type', 400);
  }

  res.json({
    success: true,
    data: {
      type,
      period,
      analytics: analyticsData
    }
  });
}));

// Analytics helper functions
async function getProspectAnalytics(userId, userRole, startDate, endDate, filters) {
  const whereConditions = {
    createdAt: { [Op.gte]: startDate, [Op.lte]: endDate }
  };

  // Apply role-based filtering
  if (userRole === 'agent') {
    whereConditions.assignedAgentId = userId;
  } else if (userRole !== 'admin') {
    const userCampaigns = await Campaign.findAll({
      where: { createdBy: userId },
      attributes: ['id']
    });
    whereConditions.campaignId = { [Op.in]: userCampaigns.map(c => c.id) };
  }

  // Apply additional filters
  if (filters.agentId && userRole === 'admin') {
    whereConditions.assignedAgentId = filters.agentId;
  }
  if (filters.campaignId) {
    whereConditions.campaignId = filters.campaignId;
  }

  // Get prospects by status over time
  const prospectsByStatus = await Prospect.findAll({
    where: whereConditions,
    attributes: [
      'leadStatus',
      [sequelize.fn('DATE', sequelize.col('createdAt')), 'date'],
      [sequelize.fn('COUNT', sequelize.col('id')), 'count']
    ],
    group: ['leadStatus', sequelize.fn('DATE', sequelize.col('createdAt'))],
    order: [[sequelize.fn('DATE', sequelize.col('createdAt')), 'ASC']]
  });

  return { prospectsByStatus };
}

async function getCommissionAnalytics(userId, userRole, startDate, endDate, filters) {
  const whereConditions = {
    earnedDate: { [Op.gte]: startDate, [Op.lte]: endDate }
  };

  if (userRole === 'agent') {
    whereConditions.agentId = userId;
  }

  if (filters.agentId && userRole === 'admin') {
    whereConditions.agentId = filters.agentId;
  }

  // Get commissions over time
  const commissionTrend = await Commission.findAll({
    where: whereConditions,
    attributes: [
      [sequelize.fn('DATE', sequelize.col('earnedDate')), 'date'],
      [sequelize.fn('SUM', sequelize.col('amount')), 'amount'],
      [sequelize.fn('COUNT', sequelize.col('id')), 'count']
    ],
    group: [sequelize.fn('DATE', sequelize.col('earnedDate'))],
    order: [[sequelize.fn('DATE', sequelize.col('earnedDate')), 'ASC']]
  });

  return { commissionTrend };
}

async function getCampaignAnalytics(userId, userRole, startDate, endDate, filters) {
  const whereConditions = {
    createdAt: { [Op.gte]: startDate, [Op.lte]: endDate }
  };

  if (userRole !== 'admin') {
    whereConditions.createdBy = userId;
  }

  if (filters.campaignId) {
    whereConditions.id = filters.campaignId;
  }

  // Get campaign performance
  const campaignPerformance = await Campaign.findAll({
    where: whereConditions,
    attributes: ['id', 'name', 'metrics', 'status', 'type'],
    include: [
      {
        association: 'prospects',
        attributes: ['leadStatus'],
        separate: true
      }
    ]
  });

  return { campaignPerformance };
}

async function getQRAnalytics(userId, userRole, startDate, endDate) {
  const whereConditions = {};

  if (userRole !== 'admin') {
    whereConditions.createdBy = userId;
  }

  // Get QR code scan trends
  const qrScanTrend = await QrTag.findAll({
    where: whereConditions,
    attributes: ['id', 'name', 'scanCount', 'analytics', 'lastScanned']
  });

  return { qrScanTrend };
}

export default router;
