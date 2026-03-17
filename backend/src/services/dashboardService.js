import { Op } from 'sequelize';
import {
  User, Campaign, Prospect, QrTag, Commission,
  Car, Driver, FleetOwner, Impression, sequelize
} from '../models/index.js';

// Defensive helpers for optional columns / missing tables
const safeSum = async (model, column, options = {}) => {
  try {
    const val = await model.sum(column, options);
    return Number(val) || 0;
  } catch (_) { return 0; }
};
const safeCount = async (model, options = {}) => {
  try { return await model.count(options); } catch (_) { return 0; }
};

/**
 * Get dashboard overview statistics based on user role.
 */
export async function getOverview(userId, userRole, period = '30d') {
  const now = new Date();
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  switch (userRole) {
    case 'admin': return getAdminStats(startDate, now);
    case 'agent': return getAgentStats(userId, startDate, now);
    case 'fleet_owner': return getFleetOwnerStats(userId, startDate, now);
    default: return getCustomerStats(userId);
  }
}

// ---- Admin Stats (with simple TTL cache) ----

let adminStatsCache = null;
let adminStatsCacheTime = 0;
const ADMIN_CACHE_TTL_MS = 30000; // 30 seconds

/** Reset admin stats cache (useful for tests that change period between calls). */
export function resetAdminStatsCache() {
  adminStatsCache = null;
  adminStatsCacheTime = 0;
}

async function getAdminStats(startDate, endDate) {
  const now = Date.now();
  if (adminStatsCache && (now - adminStatsCacheTime) < ADMIN_CACHE_TTL_MS) {
    return adminStatsCache;
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    totalUsers, activeUsers, totalCampaigns, activeCampaigns,
    totalProspects, newProspects, totalCommissions, pendingCommissions,
    totalQrTags, totalScans, totalCars, activeCars, impressionsToday
  ] = await Promise.all([
    safeCount(User),
    safeCount(User, { where: { isActive: true } }),
    safeCount(Campaign, { where: { status: { [Op.ne]: 'archived' } } }),
    safeCount(Campaign, { where: { [Op.or]: [{ status: 'active' }, { is_active: true }] } }),
    safeCount(Prospect),
    safeCount(Prospect, { where: { createdAt: { [Op.gte]: startDate } } }),
    safeSum(Commission, 'amount'),
    safeSum(Commission, 'amount', { where: { status: 'pending' } }),
    safeCount(QrTag),
    safeSum(QrTag, 'scanCount'),
    safeCount(Car),
    safeCount(Car, { where: { status: 'active' } }),
    safeCount(Impression, { where: { occurredAt: { [Op.gte]: todayStart } } })
  ]);

  const userGrowth = await getUserGrowthTrend(startDate, endDate);
  const recentActivities = await getRecentActivities(10);

  const result = {
    users: { total: totalUsers, active: activeUsers, growth: userGrowth },
    campaigns: { total: totalCampaigns, active: activeCampaigns },
    prospects: { total: totalProspects, new: newProspects },
    commissions: { total: totalCommissions, pending: pendingCommissions },
    qrCodes: { total: totalQrTags, totalScans },
    fleet: { totalCars, activeCars },
    impressions: { today: impressionsToday },
    recentActivities
  };

  adminStatsCache = result;
  adminStatsCacheTime = Date.now();
  return result;
}

// ---- Agent Stats ----

async function getAgentStats(userId, startDate, endDate) {
  const [
    assignedProspects, newProspects, convertedProspects,
    totalCommissions, pendingCommissions, paidCommissions,
    myCampaigns, activeCampaigns
  ] = await Promise.all([
    Prospect.count({ where: { assignedAgentId: userId } }),
    Prospect.count({ where: { assignedAgentId: userId, createdAt: { [Op.gte]: startDate } } }),
    Prospect.count({ where: { assignedAgentId: userId, leadStatus: 'won' } }),
    Commission.sum('amount', { where: { agentId: userId } }).then(v => v || 0),
    Commission.sum('amount', { where: { agentId: userId, status: 'pending' } }).then(v => v || 0),
    Commission.sum('amount', { where: { agentId: userId, status: 'paid' } }).then(v => v || 0),
    Campaign.count({ where: { createdBy: userId } }),
    Campaign.count({ where: { createdBy: userId, status: 'active' } })
  ]);

  const conversionRate = assignedProspects > 0
    ? (convertedProspects / assignedProspects * 100).toFixed(2) : 0;

  const recentProspects = await Prospect.findAll({
    where: { assignedAgentId: userId },
    limit: 5,
    order: [['createdAt', 'DESC']],
    attributes: ['id', 'firstName', 'lastName', 'email', 'leadStatus', 'createdAt'],
    include: [{ association: 'campaign', attributes: ['id', 'name'] }]
  });

  const commissionTrend = await getCommissionTrend(userId, startDate, endDate);

  return {
    prospects: { assigned: assignedProspects, new: newProspects, converted: convertedProspects, conversionRate: parseFloat(conversionRate) },
    commissions: { total: totalCommissions, pending: pendingCommissions, paid: paidCommissions, trend: commissionTrend },
    campaigns: { total: myCampaigns, active: activeCampaigns },
    recentProspects
  };
}

// ---- Fleet Owner Stats ----

async function getFleetOwnerStats(userId, startDate, endDate) {
  const fleetOwner = await FleetOwner.findOne({ where: { userId } });
  if (!fleetOwner) return { error: 'Fleet owner profile not found' };

  const [totalCars, activeCars, totalDrivers, activeDrivers, totalQrTags, totalScans] = await Promise.all([
    Car.count({ where: { fleetOwnerId: fleetOwner.id } }),
    Car.count({ where: { fleetOwnerId: fleetOwner.id, status: 'active' } }),
    Driver.count({ where: { fleetOwnerId: fleetOwner.id } }),
    Driver.count({ where: { fleetOwnerId: fleetOwner.id, status: 'active' } }),
    QrTag.count({ include: [{ association: 'car', where: { fleetOwnerId: fleetOwner.id } }] }),
    QrTag.sum('scanCount', { include: [{ association: 'car', where: { fleetOwnerId: fleetOwner.id } }] }).then(v => v || 0)
  ]);

  const utilizationRate = totalCars > 0 ? (activeCars / totalCars * 100).toFixed(2) : 0;

  const carsByStatus = await Car.findAll({
    where: { fleetOwnerId: fleetOwner.id },
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('status')), 'count']],
    group: ['status']
  });

  const recentActivities = await getFleetActivities(fleetOwner.id, 10);

  return {
    fleet: {
      totalCars, activeCars, utilizationRate: parseFloat(utilizationRate),
      carsByStatus: carsByStatus.map(i => ({ status: i.status, count: parseInt(i.dataValues.count) }))
    },
    drivers: { total: totalDrivers, active: activeDrivers },
    qrCodes: { total: totalQrTags, totalScans },
    recentActivities
  };
}

// ---- Customer Stats ----

async function getCustomerStats(userId) {
  return { interactions: { total: 0, recent: 0 } };
}

// ---- Analytics ----

export async function getAnalytics(userId, userRole, type, period = '30d', filters = {}) {
  const now = new Date();
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  switch (type) {
    case 'prospects': return getProspectAnalytics(userId, userRole, startDate, now, filters);
    case 'commissions': return getCommissionAnalytics(userId, userRole, startDate, now, filters);
    case 'campaigns': return getCampaignAnalytics(userId, userRole, startDate, now, filters);
    case 'qr_codes': return getQRAnalytics(userId, userRole, startDate, now);
    default: return {};
  }
}

export async function getDriverScans(userId, period = '30d') {
  const now = new Date();
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 1;
  const startDate = period === 'all' ? null
    : period === '1d' ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const whereProspect = {};
  if (startDate) whereProspect.createdAt = { [Op.gte]: startDate, [Op.lte]: now };

  const prospects = await Prospect.findAll({
    where: whereProspect,
    include: [{ association: 'qrTag', required: true, include: [{ association: 'car', required: true, where: { current_driver_id: userId } }] }],
    attributes: ['id', 'createdAt']
  });

  let trend = [];
  if (period === 'all') {
    trend = [];
  } else if (period === '1d') {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ label: `${h}:00`, count: 0 }));
    for (const p of prospects) {
      const dt = new Date(p.createdAt);
      if (dt >= startDate && dt <= now) buckets[dt.getHours()].count += 1;
    }
    trend = buckets;
  } else {
    const map = new Map();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      map.set(d.toISOString().split('T')[0], 0);
    }
    for (const p of prospects) {
      const key = new Date(p.createdAt).toISOString().split('T')[0];
      if (map.has(key)) map.set(key, (map.get(key) || 0) + 1);
    }
    trend = Array.from(map.entries()).map(([day, count]) => ({ label: day.slice(5), count }));
  }

  return { trend, total: prospects.length };
}

export async function getDriverCommissions(userId, period = '30d') {
  const now = new Date();
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const startDate = period === 'all' ? null : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const whereProspect = {};
  if (startDate) whereProspect.createdAt = { [Op.gte]: startDate, [Op.lte]: now };

  const prospects = await Prospect.findAll({
    where: whereProspect,
    include: [
      { association: 'campaign', attributes: ['id', 'name', 'commission_amount_driver'] },
      { association: 'qrTag', required: true, include: [{ association: 'car', required: true, where: { current_driver_id: userId } }] }
    ],
    order: [['createdAt', 'DESC']]
  });

  return prospects.map(p => ({
    id: p.id,
    status: 'pending',
    created_date: p.createdAt,
    campaign: p.campaign ? { id: p.campaign.id, name: p.campaign.name } : null,
    amount_driver: Number(p.campaign?.commission_amount_driver || 0)
  }));
}

// ---- Helpers ----

async function getUserGrowthTrend(startDate, endDate) {
  const [results] = await sequelize.query(`
    SELECT DATE("createdAt") AS day, COUNT(*)::int AS count
    FROM users
    WHERE "createdAt" BETWEEN :start AND :end
    GROUP BY DATE("createdAt")
    ORDER BY day
  `, { replacements: { start: startDate, end: endDate } });

  // Fill in zero-count days
  const dayMap = new Map(results.map(r => [r.day, r.count]));
  const trend = [];
  const d = new Date(startDate);
  while (d <= endDate) {
    const key = d.toISOString().slice(0, 10);
    trend.push({ date: key, count: dayMap.get(key) || 0 });
    d.setDate(d.getDate() + 1);
  }
  return trend;
}

async function getCommissionTrend(userId, startDate, endDate) {
  const whereClause = userId ? 'AND "agentId" = :userId' : '';
  const [results] = await sequelize.query(`
    SELECT DATE("earnedDate") AS day, COALESCE(SUM(amount), 0)::float AS total
    FROM commissions
    WHERE "earnedDate" BETWEEN :start AND :end ${whereClause}
    GROUP BY DATE("earnedDate")
    ORDER BY day
  `, { replacements: { start: startDate, end: endDate, userId } });

  const dayMap = new Map(results.map(r => [r.day, parseFloat(r.total)]));
  const trend = [];
  const d = new Date(startDate);
  while (d <= endDate) {
    const key = d.toISOString().slice(0, 10);
    trend.push({ date: key, amount: dayMap.get(key) || 0 });
    d.setDate(d.getDate() + 1);
  }
  return trend;
}

async function getRecentActivities(limit) {
  const chunk = Math.max(1, Math.floor(limit / 3));
  const [recentProspects, recentCampaigns, recentScans] = await Promise.all([
    Prospect.findAll({
      limit: chunk, order: [['createdAt', 'DESC']],
      attributes: ['id', 'firstName', 'lastName', 'createdAt'],
      include: [{ association: 'campaign', attributes: ['name'] }]
    }),
    Campaign.findAll({
      limit: chunk, order: [['createdAt', 'DESC']],
      attributes: ['id', 'name', 'createdAt', 'status'],
      include: [{ association: 'creator', attributes: ['firstName', 'lastName'] }]
    }),
    QrTag.findAll({
      where: { lastScanned: { [Op.not]: null } },
      limit: chunk, order: [['lastScanned', 'DESC']],
      attributes: ['id', 'name', 'lastScanned', 'scanCount']
    })
  ]);

  const activities = [
    ...recentProspects.map(p => ({
      type: 'prospect', id: p.id,
      description: `New prospect: ${p.firstName} ${p.lastName}`,
      timestamp: p.createdAt,
      metadata: { campaign: p.campaign?.name }
    })),
    ...recentCampaigns.map(c => ({
      type: 'campaign', id: c.id,
      description: `Campaign ${c.status}: ${c.name}`,
      timestamp: c.createdAt,
      metadata: { creator: c.creator ? `${c.creator.firstName} ${c.creator.lastName}` : 'Unknown' }
    })),
    ...recentScans.map(q => ({
      type: 'qr_scan', id: q.id,
      description: `QR code scanned: ${q.name}`,
      timestamp: q.lastScanned,
      metadata: { scanCount: q.scanCount }
    }))
  ];

  return activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);
}

async function getFleetActivities(fleetOwnerId, limit) {
  const recentAssignments = await Car.findAll({
    where: { fleetOwnerId, currentDriverId: { [Op.not]: null } },
    limit, order: [['updatedAt', 'DESC']],
    include: [{ association: 'currentDriver', include: [{ association: 'user', attributes: ['firstName', 'lastName'] }] }]
  });

  return recentAssignments.map(car => ({
    type: 'car_assignment', id: car.id,
    description: `${car.make} ${car.model} assigned to ${car.currentDriver?.user?.firstName || 'Unknown'} ${car.currentDriver?.user?.lastName || ''}`,
    timestamp: car.updatedAt
  })).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);
}

async function getProspectAnalytics(userId, userRole, startDate, endDate, filters) {
  const where = { createdAt: { [Op.gte]: startDate, [Op.lte]: endDate } };
  if (userRole === 'agent') where.assignedAgentId = userId;
  else if (userRole !== 'admin') {
    const userCampaigns = await Campaign.findAll({ where: { createdBy: userId }, attributes: ['id'] });
    where.campaignId = { [Op.in]: userCampaigns.map(c => c.id) };
  }
  if (filters.agentId && userRole === 'admin') where.assignedAgentId = filters.agentId;
  if (filters.campaignId) where.campaignId = filters.campaignId;

  const prospectsByStatus = await Prospect.findAll({
    where,
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
  const where = { earnedDate: { [Op.gte]: startDate, [Op.lte]: endDate } };
  if (userRole === 'agent') where.agentId = userId;
  if (filters.agentId && userRole === 'admin') where.agentId = filters.agentId;

  const commissionTrend = await Commission.findAll({
    where,
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
  const where = { createdAt: { [Op.gte]: startDate, [Op.lte]: endDate } };
  if (userRole !== 'admin') where.createdBy = userId;
  if (filters.campaignId) where.id = filters.campaignId;

  const campaigns = await Campaign.findAll({
    where,
    attributes: ['id', 'name', 'status', 'type'],
    include: [{ association: 'prospects', attributes: ['leadStatus'], separate: true }]
  });

  const campaignIds = campaigns.map(c => c.id);

  if (campaignIds.length === 0) {
    return { campaignPerformance: [] };
  }

  // Bulk queries grouped by campaignId instead of N calls to computeCampaignMetrics
  const [leadCounts, conversionCounts, scanSums, revenueSums] = await Promise.all([
    Prospect.findAll({
      where: { campaignId: { [Op.in]: campaignIds } },
      attributes: ['campaignId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['campaignId'], raw: true
    }),
    Prospect.findAll({
      where: { campaignId: { [Op.in]: campaignIds }, leadStatus: 'won' },
      attributes: ['campaignId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['campaignId'], raw: true
    }),
    QrTag.findAll({
      where: { campaignId: { [Op.in]: campaignIds } },
      attributes: ['campaignId', [sequelize.fn('SUM', sequelize.col('scanCount')), 'total']],
      group: ['campaignId'], raw: true
    }),
    Commission.findAll({
      where: { campaignId: { [Op.in]: campaignIds }, status: 'paid' },
      attributes: ['campaignId', [sequelize.fn('SUM', sequelize.col('amount')), 'total']],
      group: ['campaignId'], raw: true
    }),
  ]);

  const leadsMap = new Map(leadCounts.map(r => [r.campaignId, parseInt(r.count)]));
  const convsMap = new Map(conversionCounts.map(r => [r.campaignId, parseInt(r.count)]));
  const scansMap = new Map(scanSums.map(r => [r.campaignId, parseInt(r.total) || 0]));
  const revMap = new Map(revenueSums.map(r => [r.campaignId, parseFloat(r.total) || 0]));

  const campaignPerformance = campaigns.map(c => {
    const plain = c.toJSON();
    const scans = scansMap.get(c.id) || 0;
    plain.metrics = {
      leads: leadsMap.get(c.id) || 0,
      conversions: convsMap.get(c.id) || 0,
      views: scans,
      clicks: scans,
      revenue: revMap.get(c.id) || 0,
      referrals: 0,
    };
    return plain;
  });

  return { campaignPerformance };
}

async function getQRAnalytics(userId, userRole, startDate, endDate) {
  const where = {};
  if (userRole !== 'admin') where.createdBy = userId;

  const qrScanTrend = await QrTag.findAll({
    where,
    attributes: ['id', 'name', 'scanCount', 'analytics', 'lastScanned']
  });
  return { qrScanTrend };
}
