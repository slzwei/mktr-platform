import express from 'express';
import { Op } from 'sequelize';
import { Campaign, QrTag, Prospect, sequelize } from '../models/index.js';
import { getTenantId } from '../middleware/tenant.js';
import { authenticateToken, requireAgentOrAdmin } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { storageService } from '../services/storage.js';

const router = express.Router();

// Get all campaigns
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, type, search, createdBy } = req.query;
  const offset = (page - 1) * limit;

  const whereConditions = {};
  // Apply tenant filter only when the column exists (e.g., prod Postgres). In local SQLite,
  // the column may not exist yet, so we skip to avoid 500s.
  try {
    const dialect = Campaign.sequelize.getDialect();
    // [FIX] Ensure the model actually has the attribute defined before trying to filter by it.
    // This prevents "column client_id does not exist" errors if schema drifts.
    const hasTenantId = !!Campaign.rawAttributes.tenant_id;

    if (dialect === 'postgres' && hasTenantId) {
      whereConditions.tenant_id = getTenantId(req);
    }
  } catch (_) {
    // Best-effort guard; skip tenant condition in dev
  }

  // Non-admin users can only see their own campaigns or public ones
  if (req.user.role !== 'admin') {
    whereConditions[Op.or] = [
      { createdBy: req.user.id },
      { isPublic: true }
    ];
  }

  if (status) {
    whereConditions.status = status;
  }

  if (type) {
    whereConditions.type = type;
  }

  if (createdBy && req.user.role === 'admin') {
    whereConditions.createdBy = createdBy;
  }

  if (search) {
    whereConditions[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { description: { [Op.iLike]: `%${search}%` } }
    ];
  }

  const { count, rows: campaigns } = await Campaign.findAndCountAll({
    where: whereConditions,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['createdAt', 'DESC']],
    include: [
      {
        association: 'creator',
        attributes: ['id', 'firstName', 'lastName', 'email']
      },
      {
        association: 'qrTags',
        attributes: ['id', 'label', 'name', 'type']
      },
      {
        association: 'prospects',
        attributes: ['id', 'firstName', 'lastName', 'leadStatus']
      }
    ]
  });

  res.json({
    success: true,
    data: {
      campaigns,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    }
  });
}));

// Create new campaign
router.post('/', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  console.log('📦 Create Campaign request by user:', req.user?.id, 'role:', req.user?.role, 'body:', req.body);
  const { name, min_age, max_age, start_date, end_date, is_active, assigned_agents, commission_amount_driver, commission_amount_fleet, ad_playlist } = req.body;

  const campaignData = {
    name,
    min_age: min_age || 18,
    max_age: max_age || 65,
    start_date,
    end_date,
    is_active: is_active !== undefined ? is_active : true,
    assigned_agents: assigned_agents || [],
    ad_playlist: ad_playlist || [],
    createdBy: req.user.id,
    status: is_active ? 'active' : 'draft',
    type: req.body.type || 'lead_generation'
  };
  if (commission_amount_driver !== undefined) campaignData.commission_amount_driver = commission_amount_driver;
  if (commission_amount_fleet !== undefined) campaignData.commission_amount_fleet = commission_amount_fleet;

  const campaign = await Campaign.create(campaignData);
  console.log('✅ Campaign created:', campaign?.id);

  res.status(201).json({
    success: true,
    message: 'Campaign created successfully',
    data: { campaign }
  });
}));

// Get campaign by ID
router.get('/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const whereConditions = { id };
  try {
    const dialect = Campaign.sequelize.getDialect();
    const hasTenantId = !!Campaign.rawAttributes.tenant_id;
    if (dialect === 'postgres' && hasTenantId) {
      whereConditions.tenant_id = getTenantId(req);
    }
  } catch (_) { }

  // Non-admin users can only see their own campaigns or public ones
  if (req.user.role !== 'admin') {
    whereConditions[Op.or] = [
      { createdBy: req.user.id },
      { isPublic: true }
    ];
  }

  const campaign = await Campaign.findOne({
    where: whereConditions,
    include: [
      {
        association: 'creator',
        attributes: ['id', 'firstName', 'lastName', 'email']
      },
      {
        association: 'qrTags',
        include: [
          {
            association: 'car',
            attributes: ['id', 'make', 'model', 'plate_number']
          }
        ]
      },
      {
        association: 'prospects',
        include: [
          {
            association: 'assignedAgent',
            attributes: ['id', 'firstName', 'lastName', 'email']
          }
        ]
      },
      {
        association: 'leadPackages',
        attributes: ['id', 'name', 'type', 'price', 'leadCount']
      }
    ]
  });

  if (!campaign) {
    throw new AppError('Campaign not found', 404);
  }

  res.json({
    success: true,
    data: { campaign }
  });
}));

// Update campaign
router.put('/:id', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, min_age, max_age, start_date, end_date, is_active, assigned_agents, design_config, commission_amount_driver, commission_amount_fleet, ad_playlist } = req.body;

  const whereConditions = { id };
  try {
    const dialect = Campaign.sequelize.getDialect();
    const hasTenantId = !!Campaign.rawAttributes.tenant_id;
    if (dialect === 'postgres' && hasTenantId) {
      whereConditions.tenant_id = getTenantId(req);
    }
  } catch (_) { }

  // Non-admin users can only update their own campaigns
  if (req.user.role !== 'admin') {
    whereConditions.createdBy = req.user.id;
  }

  const campaign = await Campaign.findOne({ where: whereConditions });

  if (!campaign) {
    throw new AppError('Campaign not found or access denied', 404);
  }

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

  // [PUSH] Fan-out Trigger: Notify all devices assigned to this campaign
  // We need to check both legacy 'campaignId' and modern 'campaignIds' (JSON array)
  try {
    // Dynamic import to avoid circular dep
    const { pushService } = await import('../services/pushService.js');
    const { Device } = await import('../models/index.js');
    const { Op } = await import('sequelize');

    // Find devices that have this campaign assigned
    const affectedDevices = await Device.findAll({
      where: {
        [Op.or]: [
          { campaignId: id }, // Legacy
          // PostgreSQL JSON/JSONB containment check. 
          // For SQLite (dev), this might be tricky, so we might need a fallback or just accept it's prod-only feature.
          // However, safe robust way for JSON arrays in SQL is using Op.contains if supported or string search if text.
          // Assuming standard Postgres here as per env.
          { campaignIds: { [Op.contains]: [id] } }
        ]
      },
      attributes: ['id']
    });

    if (affectedDevices.length > 0) {
      console.log(`[Campaign] Notifying ${affectedDevices.length} devices of campaign update: ${id}`);
      affectedDevices.forEach(d => {
        pushService.sendEvent(d.id, 'REFRESH_MANIFEST', {
          timestamp: Date.now(),
          reason: 'campaign_content_update'
        });
      });
    }
  } catch (err) {
    console.error('[Campaign] Failed to trigger fan-out update', err);
    // Don't fail the request, just log it
  }

  res.json({
    success: true,
    message: 'Campaign updated successfully',
    data: { campaign }
  });
}));

// Delete campaign
router.delete('/:id', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const whereConditions = { id };
  try {
    const dialect = Campaign.sequelize.getDialect();
    const hasTenantId = !!Campaign.rawAttributes.tenant_id;
    if (dialect === 'postgres' && hasTenantId) {
      whereConditions.tenant_id = getTenantId(req);
    }
  } catch (_) { }

  // Non-admin users can only delete their own campaigns
  if (req.user.role !== 'admin') {
    whereConditions.createdBy = req.user.id;
  }

  const campaign = await Campaign.findOne({ where: whereConditions });

  if (!campaign) {
    throw new AppError('Campaign not found or access denied', 404);
  }

  // Archive instead of hard delete
  await campaign.update({ status: 'archived' });

  // Detach car QR codes from this campaign when archived via DELETE
  try {
    await QrTag.update(
      { campaignId: null },
      { where: { campaignId: id, type: 'car' } }
    );
  } catch (e) {
    // non-fatal
  }

  res.json({
    success: true,
    message: 'Campaign archived successfully'
  });
}));

// Get campaign analytics
router.get('/:id/analytics', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const whereConditions = { id };
  try {
    const dialect = Campaign.sequelize.getDialect();
    const hasTenantId = !!Campaign.rawAttributes.tenant_id;
    if (dialect === 'postgres' && hasTenantId) {
      whereConditions.tenant_id = getTenantId(req);
    }
  } catch (_) { }

  // Non-admin users can only see analytics for their own campaigns or public ones
  if (req.user.role !== 'admin') {
    whereConditions[Op.or] = [
      { createdBy: req.user.id },
      { isPublic: true }
    ];
  }

  const campaign = await Campaign.findOne({ where: whereConditions });

  if (!campaign) {
    throw new AppError('Campaign not found or access denied', 404);
  }

  // Get QR code analytics
  const qrTags = await QrTag.findAll({
    where: { campaignId: id },
    attributes: ['id', 'name', 'scanCount', 'uniqueScanCount', 'lastScanned', 'analytics']
  });

  // Get prospect analytics
  const prospectStats = await Prospect.findAll({
    where: { campaignId: id },
    attributes: [
      'leadStatus',
      [sequelize.fn('COUNT', sequelize.col('leadStatus')), 'count']
    ],
    group: ['leadStatus']
  });

  // Get conversion funnel data
  const totalProspects = await Prospect.count({ where: { campaignId: id } });
  const qualifiedProspects = await Prospect.count({
    where: {
      campaignId: id,
      leadStatus: ['qualified', 'proposal_sent', 'negotiating', 'won']
    }
  });
  const convertedProspects = await Prospect.count({
    where: { campaignId: id, leadStatus: 'won' }
  });

  const analytics = {
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
      conversionRate: tag.scanCount > 0 ?
        ((tag.analytics?.conversions || 0) / tag.scanCount * 100).toFixed(2) : 0
    }))
  };

  res.json({
    success: true,
    data: { analytics }
  });
}));

// Update campaign metrics
router.patch('/:id/metrics', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { metrics } = req.body;

  const whereConditions = { id };

  // Non-admin users can only update their own campaigns
  if (req.user.role !== 'admin') {
    whereConditions.createdBy = req.user.id;
  }

  const campaign = await Campaign.findOne({ where: whereConditions });

  if (!campaign) {
    throw new AppError('Campaign not found or access denied', 404);
  }

  const updatedMetrics = { ...campaign.metrics, ...metrics };
  await campaign.update({ metrics: updatedMetrics });

  res.json({
    success: true,
    message: 'Campaign metrics updated successfully',
    data: { campaign }
  });
}));

// Duplicate campaign
router.post('/:id/duplicate', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  const whereConditions = { id };

  // Non-admin users can only duplicate their own campaigns or public ones
  if (req.user.role !== 'admin') {
    whereConditions[Op.or] = [
      { createdBy: req.user.id },
      { isPublic: true }
    ];
  }

  const originalCampaign = await Campaign.findOne({ where: whereConditions });

  if (!originalCampaign) {
    throw new AppError('Campaign not found or access denied', 404);
  }

  const duplicatedCampaign = await Campaign.create({
    ...originalCampaign.toJSON(),
    id: undefined,
    name: name || `${originalCampaign.name} (Copy)`,
    status: 'draft',
    createdBy: req.user.id,
    spentAmount: 0,
    metrics: {
      views: 0,
      clicks: 0,
      conversions: 0,
      leads: 0,
      revenue: 0
    },
    createdAt: undefined,
    updatedAt: undefined
  });

  res.status(201).json({
    success: true,
    message: 'Campaign duplicated successfully',
    data: { campaign: duplicatedCampaign }
  });
}));

// Archive campaign
router.patch('/:id/archive', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const whereConditions = { id };

  // Non-admin users can only archive their own campaigns
  if (req.user.role !== 'admin') {
    whereConditions.createdBy = req.user.id;
  }

  const campaign = await Campaign.findOne({ where: whereConditions });

  if (!campaign) {
    throw new AppError('Campaign not found or access denied', 404);
  }

  // Don't archive if already archived
  if (campaign.status === 'archived') {
    throw new AppError('Campaign is already archived', 400);
  }

  await campaign.update({ status: 'archived' });

  // Detach car QR codes from this campaign when archived (car QR is unique per car)
  try {
    await QrTag.update(
      { campaignId: null },
      { where: { campaignId: id, type: 'car' } }
    );
  } catch (e) {
    // non-fatal
  }

  res.json({
    success: true,
    message: 'Campaign archived successfully',
    data: { campaign }
  });
}));

// Restore campaign from archive
router.patch('/:id/restore', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const whereConditions = { id };

  // Non-admin users can only restore their own campaigns
  if (req.user.role !== 'admin') {
    whereConditions.createdBy = req.user.id;
  }

  const campaign = await Campaign.findOne({ where: whereConditions });

  if (!campaign) {
    throw new AppError('Campaign not found or access denied', 404);
  }

  // Only restore if archived
  if (campaign.status !== 'archived') {
    throw new AppError('Campaign is not archived', 400);
  }

  await campaign.update({ status: 'draft' });

  res.json({
    success: true,
    message: 'Campaign restored successfully',
    data: { campaign }
  });
}));

// Permanently delete campaign
router.delete('/:id/permanent', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const whereConditions = { id };

  // Non-admin users can only delete their own campaigns
  if (req.user.role !== 'admin') {
    whereConditions.createdBy = req.user.id;
  }

  const campaign = await Campaign.findOne({ where: whereConditions });

  if (!campaign) {
    throw new AppError('Campaign not found or access denied', 404);
  }

  // Only allow permanent deletion of archived campaigns
  if (campaign.status !== 'archived') {
    throw new AppError('Campaign must be archived before permanent deletion', 400);
  }

  // Detach car QR codes from this campaign before permanent deletion
  try {
    await QrTag.update(
      { campaignId: null },
      { where: { campaignId: id, type: 'car' } }
    );
  } catch (e) {
    // non-fatal
  }

  // Delete media files from storage
  if (storageService.isEnabled() && campaign.ad_playlist && Array.isArray(campaign.ad_playlist)) {
    console.log(`🗑️ Cleaning up ${campaign.ad_playlist.length} files for campaign ${id}`);
    const deletePromises = campaign.ad_playlist.map(async (item) => {
      if (!item.url) return;
      try {
        // Extract key from URL
        // Handles both CDN (https://cdn.com/key) and Direct (https://bucket.region.com/key)
        const urlObj = new URL(item.url);
        const key = urlObj.pathname.substring(1); // remove leading slash

        // Safety check: ensure we don't try to delete something empty or root
        if (key && key.length > 1) {
          await storageService.deleteObject(key);
          console.log(`   - Deleted: ${key}`);
        }
      } catch (err) {
        console.warn(`   ! Failed to delete file ${item.url}:`, err.message);
        // Continue deleting others even if one fails
      }
    });

    // Wait for all deletions (best effort)
    await Promise.allSettled(deletePromises);
  }

  await campaign.destroy();

  res.json({
    success: true,
    message: 'Campaign permanently deleted'
  });
}));

export default router;
