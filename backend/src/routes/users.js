import express from 'express';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { User, sequelize, Prospect, LeadPackageAssignment, ProspectActivity } from '../models/index.js';
import { authenticateToken, requireAdmin, requireAgentOrAdmin } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { sendEmail } from '../services/mailer.js';
import { getRoleInviteEmail, getRoleInviteSubject, getRoleInviteText } from '../services/emailTemplates.js';
import { getSystemAgentId } from '../services/systemAgent.js';

const router = express.Router();

// Create new user (Admin only)
router.post('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { email, firstName, lastName, phone, role, isActive, owed_leads_count } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ where: { email } });
  if (existingUser) {
    throw new AppError('User with this email already exists', 400);
  }

  // Create new user (without password for agent creation)
  const user = await User.create({
    email,
    firstName,
    lastName,
    phone,
    role: role || 'customer',
    isActive: isActive !== undefined ? isActive : true,
    owed_leads_count: owed_leads_count || 0
  });

  res.status(201).json({
    success: true,
    message: 'User created successfully',
    data: { user: user.toJSON() }
  });
}));

// Get all users (Admin only)
router.get('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, role, search, status, sortBy = 'createdAt', order = 'DESC' } = req.query;
  const offset = (page - 1) * limit;

  const whereConditions = {};

  if (role) {
    whereConditions.role = role;
  }

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

  const allowedSortFields = ['createdAt', 'role', 'firstName', 'lastName', 'fullName', 'email', 'isActive', 'approvalStatus'];
  const normalizedSortBy = allowedSortFields.includes(String(sortBy)) ? String(sortBy) : 'createdAt';
  const normalizedOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const { count, rows: users } = await User.findAndCountAll({
    where: whereConditions,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [[normalizedSortBy, normalizedOrder]],
    include: [
      { association: 'fleetOwnerProfile', required: false },
      { association: 'driverProfile', required: false }
    ]
  });

  res.json({
    success: true,
    data: {
      users,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    }
  });
}));

// Invite a new user (Admin only) - supports agent, fleet_owner, driver_partner
router.post('/invite', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { email, full_name, role, owed_leads_count = 0 } = req.body;

  if (!email || !full_name || !role) {
    throw new AppError('email, full_name and role are required', 400);
  }

  const allowedRoles = ['agent', 'fleet_owner', 'driver_partner'];
  if (!allowedRoles.includes(role)) {
    throw new AppError('Invalid role. Must be one of agent, fleet_owner, driver_partner', 400);
  }

  if (req.user?.email && String(req.user.email).toLowerCase() === String(email).toLowerCase()) {
    throw new AppError('You cannot invite your own email address', 400);
  }

  const existing = await User.findOne({ where: { email } });
  if (existing) {
    throw new AppError('A user with this email already exists. Permanently delete the existing user first to send a new invitation.', 400);
  }

  const nameParts = String(full_name).trim().split(/\s+/);
  const firstName = nameParts[0] || 'User';
  const lastName = nameParts.slice(1).join(' ') || '';

  const invitationToken = uuidv4();
  const invitationExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const creationData = {
    email,
    firstName,
    lastName,
    role,
    isActive: true,
    emailVerified: false,
    invitationToken,
    invitationExpires
  };
  if (role === 'agent') {
    creationData.owed_leads_count = parseInt(owed_leads_count) || 0;
  }

  const user = await User.create(creationData);

  const frontendBase = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';
  const inviteLink = `${frontendBase}/auth/accept-invite?token=${encodeURIComponent(invitationToken)}&email=${encodeURIComponent(email)}`;

  const roleLabel = role === 'agent' ? 'Agent' : role === 'fleet_owner' ? 'Fleet Owner' : 'Driver Partner';
  const subject = getRoleInviteSubject({ companyName: process.env.COMPANY_NAME || 'MKTR', roleLabel });
  const html = getRoleInviteEmail({
    firstName,
    inviteLink,
    companyName: process.env.COMPANY_NAME || 'MKTR',
    companyUrl: process.env.COMPANY_URL || process.env.FRONTEND_BASE_URL || 'http://localhost:5173',
    expiryDays: 7,
    roleLabel
  });
  const text = getRoleInviteText({ firstName, inviteLink, companyName: process.env.COMPANY_NAME || 'MKTR', expiryDays: 7, roleLabel });
  await sendEmail({ to: email, subject, html, text });

  res.status(201).json({ success: true, message: `${roleLabel} invited`, data: { user: user.toJSON(), inviteLink } });
}));

// Get user by ID
router.get('/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Users can only view their own profile unless they're admin/agent
  if (req.user.id !== id && !['admin', 'agent'].includes(req.user.role)) {
    throw new AppError('Access denied', 403);
  }

  const user = await User.findByPk(id, {
    include: [
      { association: 'fleetOwnerProfile', required: false },
      { association: 'driverProfile', required: false },
      { association: 'createdCampaigns', required: false },
      { association: 'assignedProspects', required: false }
    ]
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.json({
    success: true,
    data: { user }
  });
}));

// Update user (Admin only or self)
router.put('/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { firstName, lastName, phone, avatar, role, isActive, owed_leads_count, email, dateOfBirth } = req.body;

  // Users can only update their own profile unless they're admin
  if (req.user.id !== id && req.user.role !== 'admin') {
    throw new AppError('Access denied', 403);
  }

  const user = await User.findByPk(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const updateData = {};

  if (firstName) updateData.firstName = firstName;
  if (lastName) updateData.lastName = lastName;
  if (phone) updateData.phone = phone;
  if (avatar) updateData.avatar = avatar;
  if (dateOfBirth) updateData.dateOfBirth = dateOfBirth;

  // Only admins can update role, status, and owed_leads_count
  if (req.user.role === 'admin') {
    if (role) updateData.role = role;
    if (typeof isActive === 'boolean') updateData.isActive = isActive;
    if (typeof owed_leads_count === 'number') updateData.owed_leads_count = owed_leads_count;
    // Do not allow editing email for Google-linked accounts
    if (email) {
      if (user.googleSub) {
        throw new AppError('Email for Google-linked account cannot be changed.', 400);
      }
      updateData.email = email;
    }
  }

  await user.update(updateData);

  res.json({
    success: true,
    message: 'User updated successfully',
    data: { user: user.toJSON() }
  });
}));

// Delete user (Admin only)
router.delete('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Prevent admin from deleting themselves
  if (req.user.id === id) {
    throw new AppError('Cannot delete your own account', 400);
  }

  // Prevent deleting System Agent
  const systemAgentId = await getSystemAgentId();
  if (id === systemAgentId) {
    throw new AppError('Cannot delete the System Agent', 400);
  }

  const user = await User.findByPk(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Soft delete by deactivating
  await user.update({ isActive: false });

  res.json({
    success: true,
    message: 'User deactivated successfully'
  });
}));

// Bulk delete users (Admin only)
router.post('/bulk-delete', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new AppError('ids array is required', 400);
  }

  // Prevent admin from deleting themselves
  if (ids.includes(req.user.id)) {
    throw new AppError('Cannot delete your own account', 400);
  }

  // Prevent deleting System Agent
  const systemAgentId = await getSystemAgentId();
  if (ids.includes(systemAgentId)) {
    throw new AppError('Cannot delete the System Agent', 400);
  }

  await sequelize.transaction(async (t) => {
    // 0. Fetch agents to get their names for activity logs
    const agents = await User.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: ['id', 'firstName', 'lastName', 'email'],
      transaction: t
    });
    const agentMap = agents.reduce((acc, agent) => {
      acc[agent.id] = agent;
      return acc;
    }, {});

    // 0.5 Find prospects assigned to these agents to log activity
    const assignedProspects = await Prospect.findAll({
      where: { assignedAgentId: { [Op.in]: ids } },
      attributes: ['id', 'assignedAgentId'],
      transaction: t
    });

    if (assignedProspects.length > 0) {
      const activityRecords = assignedProspects.map(p => {
        const agent = agentMap[p.assignedAgentId];
        const agentName = agent ? `${agent.firstName} ${agent.lastName}`.trim() : (agent?.email || 'Unknown Agent');
        return {
          prospectId: p.id,
          type: 'updated',
          actorUserId: req.user.id,
          description: `Lead unassigned because agent ${agentName} was deleted`,
          metadata: {
            previousAssignedAgentId: p.assignedAgentId,
            reason: 'agent_deleted_bulk'
          }
        };
      });

      // Use bulkCreate for performance
      await ProspectActivity.bulkCreate(activityRecords, { transaction: t });
    }

    // 1. Unassign prospects
    await Prospect.update(
      { assignedAgentId: null },
      { where: { assignedAgentId: { [Op.in]: ids } }, transaction: t }
    );

    // 2. Remove package assignments
    await LeadPackageAssignment.destroy({
      where: { agentId: { [Op.in]: ids } },
      transaction: t
    });

    // 3. Delete the users
    const deletedCount = await User.destroy({
      where: { id: { [Op.in]: ids } },
      transaction: t
    });

    res.json({
      success: true,
      message: `${deletedCount} users permanently deleted`
    });
  });
}));

// Permanently delete user (Admin only)
router.delete('/:id/permanent', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Prevent admin from deleting themselves
  if (req.user.id === id) {
    throw new AppError('Cannot delete your own account', 400);
  }

  // Prevent deleting System Agent
  const systemAgentId = await getSystemAgentId();
  if (id === systemAgentId) {
    throw new AppError('Cannot delete the System Agent', 400);
  }

  const user = await User.findByPk(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  await sequelize.transaction(async (t) => {
    // 0. Find prospects assigned to this agent to log activity
    const assignedProspects = await Prospect.findAll({
      where: { assignedAgentId: id },
      attributes: ['id'],
      transaction: t
    });

    if (assignedProspects.length > 0) {
      const agentName = `${user.firstName} ${user.lastName}`.trim() || user.email;
      const activityRecords = assignedProspects.map(p => ({
        prospectId: p.id,
        type: 'updated',
        actorUserId: req.user.id,
        description: `Lead unassigned because agent ${agentName} was deleted`,
        metadata: {
          previousAssignedAgentId: id,
          reason: 'agent_deleted'
        }
      }));

      await ProspectActivity.bulkCreate(activityRecords, { transaction: t });
    }

    // Clean up dependencies to ensure successful deletion
    // 1. Unassign prospects
    await Prospect.update(
      { assignedAgentId: null },
      { where: { assignedAgentId: id }, transaction: t }
    );

    // 2. Remove package assignments
    await LeadPackageAssignment.destroy({
      where: { agentId: id }, transaction: t
    });

    // 3. Delete the user
    await user.destroy({ transaction: t });

    res.json({
      success: true,
      message: 'User and related assignments permanently deleted'
    });
  });
}));

// Get agents (for assignment purposes)
router.get('/agents/list', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const agents = await User.findAll({
    where: {
      role: 'agent',
      isActive: true
    },
    attributes: ['id', 'firstName', 'lastName', 'email', 'phone'],
    order: [['firstName', 'ASC']]
  });

  res.json({
    success: true,
    data: { agents }
  });
}));

// Get user statistics (Admin only)
router.get('/stats/overview', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const totalUsers = await User.count();
  const activeUsers = await User.count({ where: { isActive: true } });
  const usersByRole = await User.findAll({
    attributes: [
      'role',
      [sequelize.fn('COUNT', sequelize.col('role')), 'count']
    ],
    group: ['role']
  });

  const recentUsers = await User.findAll({
    where: {
      createdAt: {
        [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
      }
    },
    limit: 10,
    order: [['createdAt', 'DESC']],
    attributes: ['id', 'firstName', 'lastName', 'email', 'role', 'createdAt']
  });

  res.json({
    success: true,
    data: {
      totalUsers,
      activeUsers,
      usersByRole: usersByRole.map(item => ({
        role: item.role,
        count: parseInt(item.dataValues.count)
      })),
      recentUsers
    }
  });
}));

// Activate/Deactivate user (Admin only)
router.patch('/:id/status', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    throw new AppError('isActive must be a boolean value', 400);
  }

  // Prevent admin from deactivating themselves
  if (req.user.id === id && !isActive) {
    throw new AppError('Cannot deactivate your own account', 400);
  }

  // Prevent deactivating System Agent
  const systemAgentId = await getSystemAgentId();
  if (id === systemAgentId && !isActive) {
    throw new AppError('Cannot deactivate the System Agent', 400);
  }

  const user = await User.findByPk(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  await user.update({ isActive });

  res.json({
    success: true,
    message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
    data: { user: user.toJSON() }
  });
}));

// Update user approval status (Admin only)
router.patch('/:id/approval', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { approvalStatus } = req.body; // 'pending' | 'approved' | 'rejected'

  if (!['pending', 'approved', 'rejected'].includes(approvalStatus)) {
    throw new AppError('Invalid approval status', 400);
  }

  const user = await User.findByPk(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  await user.update({ approvalStatus });

  res.json({
    success: true,
    message: `User marked as ${approvalStatus}`,
    data: { user: user.toJSON() }
  });
}));

export default router;
