import { Op } from 'sequelize';
import { Campaign, QrTag, Prospect, Device, sequelize } from '../models/index.js';
import { getTenantId } from '../middleware/tenant.js';
import { storageService } from './storage.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Build tenant-aware WHERE clause for campaigns, scoped by user role.
 */
function buildCampaignWhere(req, extra = {}) {
  const where = { ...extra };

  try {
    const dialect = Campaign.sequelize.getDialect();
    const hasTenantId = !!Campaign.rawAttributes.tenant_id;
    if (dialect === 'postgres' && hasTenantId) {
      where.tenant_id = getTenantId(req);
    }
  } catch (_) { /* skip in dev */ }

  if (req.user.role !== 'admin') {
    where[Op.or] = [
      { createdBy: req.user.id },
      { isPublic: true }
    ];
  }

  return where;
}

function buildOwnerWhere(req, extra = {}) {
  const where = { ...extra };

  try {
    const dialect = Campaign.sequelize.getDialect();
    const hasTenantId = !!Campaign.rawAttributes.tenant_id;
    if (dialect === 'postgres' && hasTenantId) {
      where.tenant_id = getTenantId(req);
    }
  } catch (_) { }

  if (req.user.role !== 'admin') {
    where.createdBy = req.user.id;
  }

  return where;
}

/**
 * List campaigns with pagination, filtering, and role-based scoping.
 */
export async function listCampaigns(user, query, req) {
  const { page = 1, limit = 10, status, type, search, createdBy } = query;
  const offset = (page - 1) * limit;

  const where = buildCampaignWhere(req);

  if (status) where.status = status;
  if (type) where.type = type;
  if (createdBy && user.role === 'admin') where.createdBy = createdBy;

  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { description: { [Op.iLike]: `%${search}%` } }
    ];
  }

  const { count, rows: campaigns } = await Campaign.findAndCountAll({
    where,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['createdAt', 'DESC']],
    include: [
      { association: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'] },
      { association: 'qrTags', attributes: ['id', 'label', 'name', 'type'] },
      { association: 'prospects', attributes: ['id', 'firstName', 'lastName', 'leadStatus'] }
    ]
  });

  return {
    campaigns,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / limit),
      totalItems: count,
      itemsPerPage: parseInt(limit)
    }
  };
}

/**
 * Get a single campaign by ID with full associations.
 */
export async function getCampaign(id, req) {
  const where = buildCampaignWhere(req, { id });

  const campaign = await Campaign.findOne({
    where,
    include: [
      { association: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'] },
      {
        association: 'qrTags',
        attributes: ['id', 'label', 'name', 'type', 'campaignId', 'carId'],
        include: [{ association: 'car', attributes: ['id', 'make', 'model', 'plate_number'] }]
      },
      {
        association: 'prospects',
        attributes: ['id', 'firstName', 'lastName', 'email', 'leadStatus', 'assignedAgentId'],
        include: [{ association: 'assignedAgent', attributes: ['id', 'firstName', 'lastName', 'email'] }]
      },
      { association: 'leadPackages', attributes: ['id', 'name', 'type', 'price', 'leadCount'] }
    ]
  });

  if (!campaign) throw new AppError('Campaign not found', 404);
  return campaign;
}

/**
 * Create a new campaign.
 */
export async function createCampaign(body, user) {
  const { name, min_age, max_age, start_date, end_date, is_active, assigned_agents, commission_amount_driver, commission_amount_fleet, ad_playlist } = body;

  const campaignData = {
    name,
    min_age: min_age || 18,
    max_age: max_age || 65,
    start_date,
    end_date,
    is_active: is_active !== undefined ? is_active : true,
    assigned_agents: assigned_agents || [],
    ad_playlist: ad_playlist || [],
    createdBy: user.id,
    status: is_active ? 'active' : 'draft',
    type: body.type || 'lead_generation'
  };
  if (commission_amount_driver !== undefined) campaignData.commission_amount_driver = commission_amount_driver;
  if (commission_amount_fleet !== undefined) campaignData.commission_amount_fleet = commission_amount_fleet;

  return Campaign.create(campaignData);
}

/**
 * Update a campaign. Triggers device fan-out if content changed.
 */
export async function updateCampaign(id, body, req) {
  const where = buildOwnerWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);

  const { name, min_age, max_age, start_date, end_date, is_active, assigned_agents, design_config, commission_amount_driver, commission_amount_fleet, ad_playlist } = body;

  const updateData = {};
  if (name) updateData.name = name;
  if (min_age !== undefined) updateData.min_age = min_age;
  if (max_age !== undefined) updateData.max_age = max_age;
  if (start_date) updateData.start_date = start_date;
  if (end_date) updateData.end_date = end_date;
  if (is_active !== undefined) {
    updateData.is_active = is_active;
    updateData.status = is_active ? 'active' : 'draft';
  }
  if (assigned_agents !== undefined) updateData.assigned_agents = assigned_agents;
  if (ad_playlist !== undefined) updateData.ad_playlist = ad_playlist;
  if (design_config !== undefined) updateData.design_config = design_config;
  if (commission_amount_driver !== undefined) updateData.commission_amount_driver = commission_amount_driver;
  if (commission_amount_fleet !== undefined) updateData.commission_amount_fleet = commission_amount_fleet;

  await campaign.update(updateData);

  // Fan-out: notify devices assigned to this campaign
  await notifyDevices(id);

  return campaign;
}

/**
 * Soft-delete (archive) a campaign.
 */
export async function archiveCampaign(id, req) {
  const where = buildOwnerWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);

  if (campaign.status === 'archived') {
    throw new AppError('Campaign is already archived', 400);
  }

  await campaign.update({ status: 'archived' });
  await detachCarQrTags(id);
  return campaign;
}

/**
 * Restore a campaign from archived state.
 */
export async function restoreCampaign(id, req) {
  const where = buildOwnerWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);

  if (campaign.status !== 'archived') {
    throw new AppError('Campaign is not archived', 400);
  }

  await campaign.update({ status: 'draft' });
  return campaign;
}

/**
 * Permanently delete an archived campaign and its storage assets.
 */
export async function permanentlyDeleteCampaign(id, req) {
  const where = buildOwnerWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);

  if (campaign.status !== 'archived') {
    throw new AppError('Campaign must be archived before permanent deletion', 400);
  }

  await detachCarQrTags(id);
  await deleteStorageAssets(campaign);
  await campaign.destroy();
}

/**
 * Duplicate a campaign (reset metrics).
 */
export async function duplicateCampaign(id, body, req) {
  const where = buildCampaignWhere(req, { id });
  const original = await Campaign.findOne({ where });
  if (!original) throw new AppError('Campaign not found or access denied', 404);

  return Campaign.create({
    ...original.toJSON(),
    id: undefined,
    name: body.name || `${original.name} (Copy)`,
    status: 'draft',
    createdBy: req.user.id,
    spentAmount: 0,
    metrics: { views: 0, clicks: 0, conversions: 0, leads: 0, revenue: 0 },
    createdAt: undefined,
    updatedAt: undefined
  });
}

/**
 * Get campaign analytics (QR + prospect funnel).
 */
export async function getCampaignAnalytics(id, req) {
  const where = buildCampaignWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);

  const qrTags = await QrTag.findAll({
    where: { campaignId: id },
    attributes: ['id', 'name', 'scanCount', 'uniqueScanCount', 'lastScanned', 'analytics']
  });

  const prospectStats = await Prospect.findAll({
    where: { campaignId: id },
    attributes: [
      'leadStatus',
      [sequelize.fn('COUNT', sequelize.col('leadStatus')), 'count']
    ],
    group: ['leadStatus']
  });

  const totalProspects = await Prospect.count({ where: { campaignId: id } });
  const qualifiedProspects = await Prospect.count({
    where: { campaignId: id, leadStatus: ['qualified', 'proposal_sent', 'negotiating', 'won'] }
  });
  const convertedProspects = await Prospect.count({
    where: { campaignId: id, leadStatus: 'won' }
  });

  return {
    campaign: {
      metrics: campaign.metrics,
      totalQrTags: qrTags.length,
      totalScans: qrTags.reduce((sum, tag) => sum + tag.scanCount, 0),
      totalUniqueScans: qrTags.reduce((sum, tag) => sum + tag.uniqueScanCount, 0)
    },
    prospects: {
      total: totalProspects,
      qualified: qualifiedProspects,
      converted: convertedProspects,
      conversionRate: totalProspects > 0 ? (convertedProspects / totalProspects * 100).toFixed(2) : 0,
      byStatus: prospectStats.map(stat => ({
        status: stat.leadStatus,
        count: parseInt(stat.dataValues.count)
      }))
    },
    qrTags: qrTags.map(tag => ({
      id: tag.id,
      name: tag.name,
      scanCount: tag.scanCount,
      uniqueScanCount: tag.uniqueScanCount,
      lastScanned: tag.lastScanned,
      conversionRate: tag.scanCount > 0
        ? ((tag.analytics?.conversions || 0) / tag.scanCount * 100).toFixed(2) : 0
    }))
  };
}

/**
 * Update campaign metrics (merge).
 */
export async function updateCampaignMetrics(id, metrics, req) {
  const where = buildOwnerWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);

  const updatedMetrics = { ...campaign.metrics, ...metrics };
  await campaign.update({ metrics: updatedMetrics });
  return campaign;
}

// ---- Internal helpers ----

async function detachCarQrTags(campaignId) {
  try {
    await QrTag.update({ campaignId: null }, { where: { campaignId, type: 'car' } });
  } catch (_) { /* non-fatal */ }
}

async function deleteStorageAssets(campaign) {
  if (!storageService.isEnabled() || !Array.isArray(campaign.ad_playlist)) return;

  const deletePromises = campaign.ad_playlist.map(async (item) => {
    if (!item.url) return;
    try {
      const urlObj = new URL(item.url);
      const key = urlObj.pathname.substring(1);
      if (key && key.length > 1) await storageService.deleteObject(key);
    } catch (_) { /* continue */ }
  });
  await Promise.allSettled(deletePromises);
}

async function notifyDevices(campaignId) {
  try {
    const { pushService } = await import('./pushService.js');
    const affectedDevices = await Device.findAll({
      where: {
        [Op.or]: [
          { campaignId },
          { campaignIds: { [Op.contains]: [campaignId] } }
        ]
      },
      attributes: ['id']
    });

    affectedDevices.forEach(d => {
      pushService.sendEvent(d.id, 'REFRESH_MANIFEST', {
        timestamp: Date.now(),
        reason: 'campaign_content_update'
      });
    });
  } catch (_) { /* non-fatal */ }
}
