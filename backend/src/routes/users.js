import express from 'express';
import { Op } from 'sequelize';
import { User, sequelize } from '../models/index.js';
import { authenticateToken, requireAdmin, requireAgentOrAdmin } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

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
  const { page = 1, limit = 10, role, search, status } = req.query;
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

  const { count, rows: users } = await User.findAndCountAll({
    where: whereConditions,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['createdAt', 'DESC']],
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
    // Allow admin to update email as part of editing invited/pending agents
    if (email) updateData.email = email;
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

// Permanently delete user (Admin only)
router.delete('/:id/permanent', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Prevent admin from deleting themselves
  if (req.user.id === id) {
    throw new AppError('Cannot delete your own account', 400);
  }

  const user = await User.findByPk(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Only allow permanent delete for agents (safety)
  if (user.role !== 'agent') {
    throw new AppError('Only agent accounts can be permanently deleted', 400);
  }

  await user.destroy();

  res.json({
    success: true,
    message: 'User permanently deleted'
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

export default router;
