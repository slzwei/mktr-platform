import express from 'express';
import { Op } from 'sequelize';
import { Prospect, User, Campaign, QrTag, Commission, Attribution, ProspectActivity, sequelize } from '../models/index.js';
import { resolveAssignedAgentId, getSystemAgentId } from '../services/systemAgent.js';
import { authenticateToken, requireAgentOrAdmin } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

// Get all prospects
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    limit = 10, 
    leadStatus, 
    priority, 
    leadSource, 
    assignedAgentId, 
    campaignId,
    search,
    dateFrom,
    dateTo
  } = req.query;
  
  const offset = (page - 1) * limit;
  const whereConditions = {};
  
  // Non-admin users can only see prospects assigned to them (agents) or from their campaigns (others)
  if (req.user.role === 'agent') {
    whereConditions.assignedAgentId = req.user.id;
  } else if (req.user.role !== 'admin') {
    // Other roles can only see prospects from their campaigns
    const userCampaigns = await Campaign.findAll({
      where: { createdBy: req.user.id },
      attributes: ['id']
    });
    const campaignIds = userCampaigns.map(c => c.id);
    whereConditions.campaignId = { [Op.in]: campaignIds };
  }
  
  if (leadStatus) {
    whereConditions.leadStatus = leadStatus;
  }
  
  if (priority) {
    whereConditions.priority = priority;
  }
  
  if (leadSource) {
    whereConditions.leadSource = leadSource;
  }
  
  if (assignedAgentId) {
    whereConditions.assignedAgentId = assignedAgentId;
  }
  
  if (campaignId) {
    whereConditions.campaignId = campaignId;
  }
  
  if (search) {
    whereConditions[Op.or] = [
      { firstName: { [Op.iLike]: `%${search}%` } },
      { lastName: { [Op.iLike]: `%${search}%` } },
      { email: { [Op.iLike]: `%${search}%` } },
      { company: { [Op.iLike]: `%${search}%` } }
    ];
  }
  
  if (dateFrom || dateTo) {
    whereConditions.createdAt = {};
    if (dateFrom) whereConditions.createdAt[Op.gte] = new Date(dateFrom);
    if (dateTo) whereConditions.createdAt[Op.lte] = new Date(dateTo);
  }

  const { count, rows: prospects } = await Prospect.findAndCountAll({
    where: whereConditions,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['createdAt', 'DESC']],
    include: [
      {
        association: 'assignedAgent',
        attributes: ['id', 'firstName', 'lastName', 'email']
      },
      {
        association: 'campaign',
        attributes: ['id', 'name', 'type', 'status']
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

// Create new prospect (lead capture)
router.post('/', validate(schemas.prospectCreate), asyncHandler(async (req, res) => {
  const incoming = { ...req.body };

  // Bind attribution by session cookie (sid)
  const sid = req.cookies?.sid || req.headers['x-session-id'];
  if (sid) {
    const attribution = await Attribution.findOne({
      where: { sessionId: sid },
      order: [['lastTouchAt', 'DESC']]
    });
    if (attribution) {
      incoming.attributionId = attribution.id;
      incoming.qrTagId = attribution.qrTagId || incoming.qrTagId;
      incoming.sessionId = sid;
    }
  }

  // Resolve secure assignment (agent/admin override -> qr owner -> campaign -> system)
  const assignedAgentId = await resolveAssignedAgentId({
    reqUser: req.user,
    requestedAgentId: req.body.assignedAgentId,
    campaignId: incoming.campaignId,
    qrTagId: incoming.qrTagId
  });

  // Enforce: a phone can register once per campaign, but can register for different campaigns
  if (incoming.phone && incoming.campaignId) {
    const normalizedPhone = String(incoming.phone).replace(/\D/g, '');
    const existing = await Prospect.findOne({
      where: {
        campaignId: incoming.campaignId,
        phone: { [Op.iLike]: normalizedPhone }
      }
    });
    if (existing) {
      throw new AppError('This phone number has already signed up for this campaign.', 409);
    }
    // Persist normalized phone
    incoming.phone = normalizedPhone;
  }

  const prospect = await Prospect.create({ ...incoming, assignedAgentId });

  // Activity: created
  await ProspectActivity.create({
    prospectId: prospect.id,
    type: 'created',
    actorUserId: req.user?.id || null,
    description: `Prospect created via ${incoming.leadSource || 'unknown'} for campaign ${prospect.campaignId || 'N/A'}`,
    metadata: { leadSource: incoming.leadSource, campaignId: prospect.campaignId, qrTagId: prospect.qrTagId }
  });

  // Activity: assigned
  await ProspectActivity.create({
    prospectId: prospect.id,
    type: 'assigned',
    actorUserId: req.user?.id || null,
    description: `Assigned to agent ${assignedAgentId}`,
    metadata: { assignedAgentId }
  });

  // If this came from a QR code, update QR tag analytics
  if (prospect.qrTagId) {
    const qrTag = await QrTag.findByPk(prospect.qrTagId);
    if (qrTag) {
      const analytics = qrTag.analytics || {};
      analytics.conversions = (analytics.conversions || 0) + 1;
      await qrTag.update({ analytics });
    }
  }

  // Update campaign metrics
  if (prospect.campaignId) {
    const campaign = await Campaign.findByPk(prospect.campaignId);
    if (campaign) {
      const metrics = campaign.metrics || {};
      metrics.leads = (metrics.leads || 0) + 1;
      await campaign.update({ metrics });
    }
  }

  res.status(201).json({
    success: true,
    message: 'Prospect created successfully',
    data: { prospect }
  });
}));

// Get prospect by ID
router.get('/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const whereConditions = { id };
  
  // Non-admin users can only see prospects assigned to them or from their campaigns
  if (req.user.role === 'agent') {
    whereConditions.assignedAgentId = req.user.id;
  } else if (req.user.role !== 'admin') {
    const userCampaigns = await Campaign.findAll({
      where: { createdBy: req.user.id },
      attributes: ['id']
    });
    const campaignIds = userCampaigns.map(c => c.id);
    whereConditions.campaignId = { [Op.in]: campaignIds };
  }

  const prospect = await Prospect.findOne({
    where: whereConditions,
    include: [
      {
        association: 'assignedAgent',
        attributes: ['id', 'firstName', 'lastName', 'email', 'phone']
      },
      {
        association: 'campaign',
        attributes: ['id', 'name', 'type', 'status', 'description']
      },
      {
        association: 'qrTag',
        attributes: ['id', 'name', 'type', 'location']
      },
      {
        association: 'commissions',
        attributes: ['id', 'type', 'amount', 'status', 'earnedDate']
      },
      {
        association: 'activities',
        attributes: ['id', 'type', 'description', 'metadata', 'createdAt'],
        order: [['createdAt', 'ASC']]
      }
    ]
  });

  if (!prospect) {
    throw new AppError('Prospect not found or access denied', 404);
  }

  res.json({
    success: true,
    data: { prospect }
  });
}));

// Update prospect
router.put('/:id', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const whereConditions = { id };
  
  // Non-admin users can only update prospects assigned to them
  if (req.user.role === 'agent') {
    whereConditions.assignedAgentId = req.user.id;
  } else if (req.user.role !== 'admin') {
    const userCampaigns = await Campaign.findAll({
      where: { createdBy: req.user.id },
      attributes: ['id']
    });
    const campaignIds = userCampaigns.map(c => c.id);
    whereConditions.campaignId = { [Op.in]: campaignIds };
  }

  const prospect = await Prospect.findOne({ where: whereConditions });
  
  if (!prospect) {
    throw new AppError('Prospect not found or access denied', 404);
  }

  const oldStatus = prospect.leadStatus;
  await prospect.update(req.body);

  // If status changed to 'won', create commission and update metrics
  if (oldStatus !== 'won' && req.body.leadStatus === 'won') {
    // Block conversion if assigned to System Agent
    const systemId = await getSystemAgentId();
    if (prospect.assignedAgentId && prospect.assignedAgentId === systemId) {
      throw new AppError('Lead must be assigned to a real agent before marking as won', 400);
    }
    // Create commission for assigned agent
    if (prospect.assignedAgentId) {
      await Commission.create({
        type: 'conversion',
        amount: 50.00, // Default commission amount
        status: 'pending',
        description: `Lead conversion: ${prospect.firstName} ${prospect.lastName}`,
        agentId: prospect.assignedAgentId,
        campaignId: prospect.campaignId,
        prospectId: prospect.id,
        earnedDate: new Date()
      });
    }

    // Update campaign metrics
    if (prospect.campaignId) {
      const campaign = await Campaign.findByPk(prospect.campaignId);
      if (campaign) {
        const metrics = campaign.metrics || {};
        metrics.conversions = (metrics.conversions || 0) + 1;
        await campaign.update({ metrics });
      }
    }

    // Set conversion date
    prospect.conversionDate = new Date();
    await prospect.save();
  }

  res.json({
    success: true,
    message: 'Prospect updated successfully',
    data: { prospect }
  });
}));

// Delete prospect
router.delete('/:id', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const whereConditions = { id };
  
  // Non-admin users can only delete prospects assigned to them
  if (req.user.role === 'agent') {
    whereConditions.assignedAgentId = req.user.id;
  } else if (req.user.role !== 'admin') {
    const userCampaigns = await Campaign.findAll({
      where: { createdBy: req.user.id },
      attributes: ['id']
    });
    const campaignIds = userCampaigns.map(c => c.id);
    whereConditions.campaignId = { [Op.in]: campaignIds };
  }

  const prospect = await Prospect.findOne({ where: whereConditions });
  
  if (!prospect) {
    throw new AppError('Prospect not found or access denied', 404);
  }

  await prospect.destroy();

  res.json({
    success: true,
    message: 'Prospect deleted successfully'
  });
}));

// Assign prospect to agent
router.patch('/:id/assign', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { agentId } = req.body;

  if (!agentId) {
    throw new AppError('Agent ID is required', 400);
  }

  // Verify agent exists and is active
  const agent = await User.findOne({
    where: { 
      id: agentId, 
      role: 'agent', 
      isActive: true 
    }
  });

  if (!agent) {
    throw new AppError('Invalid or inactive agent', 400);
  }

  const prospect = await Prospect.findByPk(id);
  
  if (!prospect) {
    throw new AppError('Prospect not found', 404);
  }

  await prospect.update({ 
    assignedAgentId: agentId,
    lastContactDate: new Date()
  });

  // Activity: assigned
  await ProspectActivity.create({
    prospectId: prospect.id,
    type: 'assigned',
    actorUserId: req.user?.id || null,
    description: `Assigned to agent ${agentId}`,
    metadata: { assignedAgentId: agentId }
  });

  res.json({
    success: true,
    message: 'Prospect assigned successfully',
    data: { prospect }
  });
}));

// Bulk assign prospects
router.patch('/bulk/assign', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { prospectIds, agentId } = req.body;

  if (!prospectIds || !Array.isArray(prospectIds) || !agentId) {
    throw new AppError('Prospect IDs array and agent ID are required', 400);
  }

  // Verify agent exists and is active
  const agent = await User.findOne({
    where: { 
      id: agentId, 
      role: 'agent', 
      isActive: true 
    }
  });

  if (!agent) {
    throw new AppError('Invalid or inactive agent', 400);
  }

  const whereConditions = {
    id: { [Op.in]: prospectIds }
  };

  // Non-admin users can only assign prospects from their campaigns
  if (req.user.role !== 'admin') {
    const userCampaigns = await Campaign.findAll({
      where: { createdBy: req.user.id },
      attributes: ['id']
    });
    const campaignIds = userCampaigns.map(c => c.id);
    
    whereConditions.campaignId = { [Op.in]: campaignIds };
  }

  const result = await Prospect.update(
    { 
      assignedAgentId: agentId,
      lastContactDate: new Date()
    },
    { where: whereConditions }
  );

  res.json({
    success: true,
    message: `${result[0]} prospects assigned successfully`,
    data: { affectedCount: result[0] }
  });
}));

// Get prospect statistics
router.get('/stats/overview', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const whereConditions = {};
  
  // Non-admin users see stats for their assigned prospects or campaigns
  if (req.user.role === 'agent') {
    whereConditions.assignedAgentId = req.user.id;
  } else if (req.user.role !== 'admin') {
    const userCampaigns = await Campaign.findAll({
      where: { createdBy: req.user.id },
      attributes: ['id']
    });
    const campaignIds = userCampaigns.map(c => c.id);
    whereConditions.campaignId = { [Op.in]: campaignIds };
  }

  const totalProspects = await Prospect.count({ where: whereConditions });
  
  const prospectsByStatus = await Prospect.findAll({
    where: whereConditions,
    attributes: [
      'leadStatus',
      [sequelize.fn('COUNT', sequelize.col('leadStatus')), 'count']
    ],
    group: ['leadStatus']
  });

  const prospectsBySource = await Prospect.findAll({
    where: whereConditions,
    attributes: [
      'leadSource',
      [sequelize.fn('COUNT', sequelize.col('leadSource')), 'count']
    ],
    group: ['leadSource']
  });

  const prospectsByPriority = await Prospect.findAll({
    where: whereConditions,
    attributes: [
      'priority',
      [sequelize.fn('COUNT', sequelize.col('priority')), 'count']
    ],
    group: ['priority']
  });

  // Recent prospects
  const recentProspects = await Prospect.findAll({
    where: {
      ...whereConditions,
      createdAt: {
        [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
      }
    },
    limit: 10,
    order: [['createdAt', 'DESC']],
    attributes: ['id', 'firstName', 'lastName', 'email', 'leadStatus', 'createdAt'],
    include: [
      {
        association: 'campaign',
        attributes: ['id', 'name']
      }
    ]
  });

  // Conversion rate
  const convertedCount = await Prospect.count({
    where: { ...whereConditions, leadStatus: 'won' }
  });
  const conversionRate = totalProspects > 0 ? (convertedCount / totalProspects * 100).toFixed(2) : 0;

  res.json({
    success: true,
    data: {
      totalProspects,
      conversionRate: parseFloat(conversionRate),
      byStatus: prospectsByStatus.map(item => ({
        status: item.leadStatus,
        count: parseInt(item.dataValues.count)
      })),
      bySource: prospectsBySource.map(item => ({
        source: item.leadSource,
        count: parseInt(item.dataValues.count)
      })),
      byPriority: prospectsByPriority.map(item => ({
        priority: item.priority,
        count: parseInt(item.dataValues.count)
      })),
      recentProspects
    }
  });
}));

// Update prospect follow-up date
router.patch('/:id/follow-up', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { nextFollowUpDate, notes } = req.body;

  if (!nextFollowUpDate) {
    throw new AppError('Next follow-up date is required', 400);
  }

  const whereConditions = { id };
  
  // Non-admin users can only update prospects assigned to them
  if (req.user.role === 'agent') {
    whereConditions.assignedAgentId = req.user.id;
  }

  const prospect = await Prospect.findOne({ where: whereConditions });
  
  if (!prospect) {
    throw new AppError('Prospect not found or access denied', 404);
  }

  const updateData = {
    nextFollowUpDate: new Date(nextFollowUpDate),
    lastContactDate: new Date()
  };

  if (notes) {
    updateData.notes = notes;
  }

  const previous = prospect.toJSON();
  await prospect.update(updateData);

  // Activity: updated (admin/agent edits)
  await ProspectActivity.create({
    prospectId: prospect.id,
    type: 'updated',
    actorUserId: req.user?.id || null,
    description: `Prospect updated by ${req.user?.role || 'system'}`,
    metadata: { before: previous, after: prospect.toJSON() }
  });

  res.json({
    success: true,
    message: 'Follow-up scheduled successfully',
    data: { prospect }
  });
}));

export default router;
