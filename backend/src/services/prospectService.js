import { Op } from 'sequelize';
import { Prospect, User, Campaign, QrTag, Commission, Attribution, ProspectActivity, sequelize } from '../models/index.js';
import { resolveAssignedAgentId, getSystemAgentId } from './systemAgent.js';
import { deductLeadCredit } from './leadCredits.js';
import { buildProspectWhere } from '../middleware/prospectScope.js';
import { AppError } from '../middleware/errorHandler.js';

const PROSPECT_UPDATE_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'company', 'jobTitle',
  'leadStatus', 'priority', 'leadSource', 'notes',
  'nextFollowUpDate', 'lastContactDate', 'assignedAgentId',
  'demographics', 'location', 'tags'
];

/**
 * Create a new prospect (lead capture).
 * Resolves attribution, normalizes input, wraps DB writes in a transaction.
 * Returns { prospect, assignedAgentId } — caller handles email side-effect.
 */
export async function createProspect(body, user, { cookies, headers } = {}) {
  const incoming = { ...body };

  // Bind attribution by session cookie (sid)
  const sid = cookies?.sid || headers?.['x-session-id'];
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

  // If qrTagId is provided but campaignId is missing/null, derive from QR tag
  if (incoming.qrTagId && !incoming.campaignId) {
    const qr = await QrTag.findByPk(incoming.qrTagId);
    if (qr?.campaignId) {
      incoming.campaignId = qr.campaignId;
    }
  }

  // Resolve secure assignment (agent/admin override -> qr owner -> campaign -> system)
  const assignedAgentId = await resolveAssignedAgentId({
    reqUser: user,
    requestedAgentId: body.assignedAgentId,
    campaignId: incoming.campaignId,
    qrTagId: incoming.qrTagId
  });

  // Enforce: a phone can register once per campaign, but can register for different campaigns
  if (incoming.phone && incoming.campaignId) {
    const normalizedPhone = String(incoming.phone).replace(/\D/g, '');
    const existing = await Prospect.findOne({
      where: {
        campaignId: incoming.campaignId,
        phone: normalizedPhone
      }
    });
    if (existing) {
      throw new AppError('This phone number has already signed up for this campaign.', 409);
    }
    // Persist normalized phone
    incoming.phone = normalizedPhone;
  }

  // Handle Date of Birth -> Age mapping
  if (body.date_of_birth) {
    const dob = new Date(body.date_of_birth);
    if (!isNaN(dob.getTime())) {
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
        age--;
      }

      incoming.demographics = {
        ...(incoming.demographics || {}),
        age: age,
        dateOfBirth: body.date_of_birth
      };
    }
  }

  // Handle Postal Code -> Location mapping
  if (body.postal_code) {
    incoming.location = {
      ...(incoming.location || {}),
      zipCode: body.postal_code,
      postalCode: body.postal_code
    };
  }

  // Handle Education and Income mapping
  if (body.education_level || body.monthly_income) {
    incoming.demographics = {
      ...(incoming.demographics || {}),
    };
    if (body.education_level) incoming.demographics.education = body.education_level;
    if (body.monthly_income) incoming.demographics.income = body.monthly_income;
  }

  // Wrap all DB writes in a transaction for data integrity
  const prospect = await sequelize.transaction(async (t) => {
    const newProspect = await Prospect.create({ ...incoming, assignedAgentId }, { transaction: t });

    // Fetch names for rich activity log
    const [sourceCampaign, sourceQrTag] = await Promise.all([
      incoming.campaignId ? Campaign.findByPk(incoming.campaignId, { transaction: t }) : null,
      incoming.qrTagId ? QrTag.findByPk(incoming.qrTagId, { transaction: t }) : null
    ]);

    const campaignName = sourceCampaign?.name || 'Unknown Campaign';
    const qrTagName = sourceQrTag?.name || 'Unknown QR';
    const activityDescription = `Prospect signed up for ${campaignName} campaign via ${qrTagName} QR code`;

    // Activity: created
    await ProspectActivity.create({
      prospectId: newProspect.id,
      type: 'created',
      actorUserId: user?.id || null,
      description: activityDescription,
      metadata: { leadSource: incoming.leadSource, campaignId: newProspect.campaignId, qrTagId: newProspect.qrTagId }
    }, { transaction: t });

    // Activity: assigned
    await ProspectActivity.create({
      prospectId: newProspect.id,
      type: 'assigned',
      actorUserId: user?.id || null,
      description: `Assigned to agent ${assignedAgentId}`,
      metadata: { assignedAgentId }
    }, { transaction: t });

    // Deduct lead credit from agent's package
    if (assignedAgentId) {
      await deductLeadCredit(assignedAgentId, 1, t).catch(err => console.error('Failed to deduct credit:', err));
    }

    // Update QR tag analytics
    if (newProspect.qrTagId && sourceQrTag) {
      const analytics = sourceQrTag.analytics || {};
      analytics.conversions = (analytics.conversions || 0) + 1;
      await sourceQrTag.update({ analytics }, { transaction: t });
    }

    // Update campaign metrics
    if (newProspect.campaignId && sourceCampaign) {
      const metrics = sourceCampaign.metrics || {};
      metrics.leads = (metrics.leads || 0) + 1;
      await sourceCampaign.update({ metrics }, { transaction: t });
    }

    return newProspect;
  });

  return { prospect, assignedAgentId };
}

/**
 * Get a single prospect by ID, scoped to user access.
 */
export async function getProspect(id, user) {
  const scopeFilter = await buildProspectWhere(user);
  const whereConditions = { id, ...scopeFilter };

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

  return prospect;
}

/**
 * Update a prospect. Handles status-change-to-won commission logic.
 */
export async function updateProspect(id, body, user) {
  const scopeFilter = await buildProspectWhere(user);
  const whereConditions = { id, ...scopeFilter };

  const prospect = await Prospect.findOne({
    where: whereConditions,
    include: [{ association: 'assignedAgent', attributes: ['firstName', 'lastName', 'email'] }]
  });

  if (!prospect) {
    throw new AppError('Prospect not found or access denied', 404);
  }

  const oldStatus = prospect.leadStatus;
  const oldAssignedAgentId = prospect.assignedAgentId;
  const oldAssignedAgent = prospect.assignedAgent;

  const safeUpdates = Object.fromEntries(
    Object.entries(body).filter(([k]) => PROSPECT_UPDATE_FIELDS.includes(k))
  );
  await prospect.update(safeUpdates);

  // Check for manual unassignment
  if (oldAssignedAgentId && body.assignedAgentId === null) {
    const agentName = oldAssignedAgent
      ? `${oldAssignedAgent.firstName} ${oldAssignedAgent.lastName}`.trim() || oldAssignedAgent.email
      : 'Unknown Agent';

    await ProspectActivity.create({
      prospectId: prospect.id,
      type: 'updated',
      actorUserId: user.id,
      description: `Lead manually unassigned from ${agentName} by ${user.firstName || 'Admin'}`,
      metadata: {
        previousAssignedAgentId: oldAssignedAgentId,
        reason: 'manual_unassignment'
      }
    });
  }

  // If status changed to 'won', create commission and update metrics atomically
  if (oldStatus !== 'won' && safeUpdates.leadStatus === 'won') {
    // Block conversion if assigned to System Agent
    const systemId = await getSystemAgentId();
    if (prospect.assignedAgentId && prospect.assignedAgentId === systemId) {
      throw new AppError('Lead must be assigned to a real agent before marking as won', 400);
    }

    await sequelize.transaction(async (t) => {
      // Create commission for assigned agent
      if (prospect.assignedAgentId) {
        const commissionAmount = parseFloat(process.env.DEFAULT_COMMISSION_AMOUNT || '50');
        await Commission.create({
          type: 'conversion',
          amount: commissionAmount,
          status: 'pending',
          description: `Lead conversion: ${prospect.firstName} ${prospect.lastName}`,
          agentId: prospect.assignedAgentId,
          campaignId: prospect.campaignId,
          prospectId: prospect.id,
          earnedDate: new Date()
        }, { transaction: t });
      }

      // Update campaign metrics
      if (prospect.campaignId) {
        const campaign = await Campaign.findByPk(prospect.campaignId, { transaction: t });
        if (campaign) {
          const metrics = campaign.metrics || {};
          metrics.conversions = (metrics.conversions || 0) + 1;
          await campaign.update({ metrics }, { transaction: t });
        }
      }

      // Set conversion date
      prospect.conversionDate = new Date();
      await prospect.save({ transaction: t });
    });
  }

  return prospect;
}

/**
 * Delete a prospect, scoped to user access.
 */
export async function deleteProspect(id, user) {
  const scopeFilter = await buildProspectWhere(user);
  const whereConditions = { id, ...scopeFilter };

  const prospect = await Prospect.findOne({ where: whereConditions });

  if (!prospect) {
    throw new AppError('Prospect not found or access denied', 404);
  }

  await prospect.destroy();
}

/**
 * Assign a single prospect to an agent. Returns { prospect, agent } for email side-effect.
 */
export async function assignProspect(prospectId, agentId, user) {
  if (!agentId) {
    throw new AppError('Agent ID is required', 400);
  }

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

  const prospect = await Prospect.findByPk(prospectId);

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
    actorUserId: user?.id || null,
    description: `Assigned to agent ${agentId}`,
    metadata: { assignedAgentId: agentId }
  });

  // Deduct lead credit
  await deductLeadCredit(agentId).catch(err => console.error('Failed to deduct credit:', err));

  // Reload prospect with campaign data for email
  const prospectWithCampaign = await Prospect.findByPk(prospect.id, {
    include: [{ association: 'campaign', attributes: ['id', 'name'] }]
  });

  return { prospect, agent, prospectWithCampaign };
}

/**
 * Bulk assign prospects to an agent. Returns { affectedCount, agent } for email side-effect.
 */
export async function bulkAssignProspects(prospectIds, agentId, user) {
  if (!prospectIds || !Array.isArray(prospectIds) || !agentId) {
    throw new AppError('Prospect IDs array and agent ID are required', 400);
  }

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

  const scopeFilter = await buildProspectWhere(user);
  const whereConditions = {
    id: { [Op.in]: prospectIds },
    ...scopeFilter
  };

  const result = await Prospect.update(
    {
      assignedAgentId: agentId,
      lastContactDate: new Date()
    },
    { where: whereConditions }
  );

  const affectedCount = result[0];
  if (affectedCount > 0) {
    await deductLeadCredit(agentId, affectedCount).catch(err => console.error('Failed to deduct credits:', err));
  }

  return { affectedCount, agent };
}

/**
 * Get prospect statistics for the user's scope.
 */
export async function getProspectStats(user) {
  const whereConditions = await buildProspectWhere(user);

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
        [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
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

  return {
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
  };
}

/**
 * List prospects with pagination, filtering, and auth scoping.
 */
export async function listProspects(user, params) {
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
    dateTo,
    qrTagId
  } = params;

  const offset = (page - 1) * limit;
  const scopeFilter = await buildProspectWhere(user);
  const whereConditions = { ...scopeFilter };

  if (qrTagId) whereConditions.qrTagId = qrTagId;
  if (leadStatus) whereConditions.leadStatus = leadStatus;
  if (priority) whereConditions.priority = priority;
  if (leadSource) whereConditions.leadSource = leadSource;
  if (assignedAgentId) whereConditions.assignedAgentId = assignedAgentId;
  if (campaignId) whereConditions.campaignId = campaignId;

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

  return {
    prospects,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / limit),
      totalItems: count,
      itemsPerPage: parseInt(limit)
    }
  };
}

/**
 * Schedule a follow-up for a prospect.
 */
export async function scheduleFollowUp(id, { nextFollowUpDate, notes }, user) {
  if (!nextFollowUpDate) {
    throw new AppError('Next follow-up date is required', 400);
  }

  const scopeWhere = await buildProspectWhere(user);
  const prospect = await Prospect.findOne({ where: { id, ...scopeWhere } });

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

  await ProspectActivity.create({
    prospectId: prospect.id,
    type: 'updated',
    actorUserId: user?.id || null,
    description: `Prospect updated by ${user?.role || 'system'}`,
    metadata: { before: previous, after: prospect.toJSON() }
  });

  return prospect;
}

/**
 * Track a prospect view.
 */
export async function trackProspectView(id, user, { source, userAgent } = {}) {
  const scopeWhere = await buildProspectWhere(user);
  const prospect = await Prospect.findOne({ where: { id, ...scopeWhere } });

  if (!prospect) {
    throw new AppError('Prospect not found or access denied', 404);
  }

  await ProspectActivity.create({
    prospectId: prospect.id,
    type: 'viewed',
    actorUserId: user.id,
    description: `Prospect viewed by ${user.firstName || 'agent'} ${user.lastName || ''}`,
    metadata: {
      source: source || 'email_link',
      viewedAt: new Date(),
      userAgent
    }
  });
}
