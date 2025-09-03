import express from 'express';
import { Op } from 'sequelize';
import { Campaign, User, QrTag, Prospect, sequelize } from '../models/index.js';
import { authenticateToken, requireAgentOrAdmin } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

// Get all campaigns
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, type, search, createdBy } = req.query;
  const offset = (page - 1) * limit;

  const whereConditions = {};
  
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
        attributes: ['id', 'name', 'type', 'scanCount']
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
  const { name, min_age, max_age, start_date, end_date, is_active, assigned_agents } = req.body;

  const campaignData = {
    name,
    min_age: min_age || 18,
    max_age: max_age || 65,
    start_date,
    end_date,
    is_active: is_active !== undefined ? is_active : true,
    assigned_agents: assigned_agents || [],
    createdBy: req.user.id,
    status: is_active ? 'active' : 'draft',
    type: 'lead_generation' // Default type for campaigns
  };

  const campaign = await Campaign.create(campaignData);

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
            attributes: ['id', 'make', 'model', 'licensePlate']
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
  const { name, min_age, max_age, start_date, end_date, is_active, assigned_agents, design_config } = req.body;

  const whereConditions = { id };
  
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
  if (design_config !== undefined) updateData.design_config = design_config;

  await campaign.update(updateData);

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

  res.json({
    success: true,
    message: 'Campaign archived successfully'
  });
}));

// Get campaign analytics
router.get('/:id/analytics', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const whereConditions = { id };
  
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

export default router;
