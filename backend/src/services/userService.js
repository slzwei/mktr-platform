import { Op } from 'sequelize';
import { User, Campaign, Commission, sequelize, Prospect, LeadPackageAssignment, ProspectActivity, WalletLedger } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Wallet-account closure policy (docs/plans/agent-wallet-commitments.md):
 * deactivation/deletion must never erase or strand paid credits. Throws 409
 * when the user holds a balance or open wallet commitments — the admin
 * resolves those first (campaign takedown, or a manual adjustment to zero).
 */
async function assertNoOpenWalletState(userIds, { transaction } = {}) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const funded = await User.count({
    where: { id: { [Op.in]: ids }, walletBalanceCents: { [Op.gt]: 0 } },
    transaction
  });
  if (funded > 0) {
    throw new AppError('User has a wallet balance. Zero it (manual adjustment, note required) before deactivating or deleting.', 409);
  }
  const openCommitments = await LeadPackageAssignment.count({
    where: { agentId: { [Op.in]: ids }, source: 'wallet', status: 'active', leadsRemaining: { [Op.gt]: 0 } },
    transaction
  });
  if (openCommitments > 0) {
    throw new AppError('User has open wallet commitments. They resolve only by delivery or campaign takedown.', 409);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Log prospect unassignment activity when agents are removed.
 * Shared by deactivate, permanent delete, and bulk delete flows.
 *
 * @param {Array} prospects - Array of prospect instances (must include id, optionally assignedAgentId)
 * @param {Object|string} agentNameMap - Either a map { agentId: "Name" } or a single agent name string
 * @param {string} actorId - The admin user performing the action
 * @param {string} reason - Machine-readable reason (e.g. 'agent_deactivated', 'agent_deleted')
 * @param {string} reasonLabel - Human-readable label for the description (e.g. 'deactivated', 'deleted')
 * @param {object} transaction - Sequelize transaction
 */
async function logProspectUnassignment(prospects, agentNameMap, actorId, reason, reasonLabel, transaction) {
  if (!prospects || prospects.length === 0) return;

  const activityRecords = prospects.map(p => {
    const agentName = typeof agentNameMap === 'string'
      ? agentNameMap
      : (agentNameMap[p.assignedAgentId] || 'Unknown Agent');

    return {
      prospectId: p.id,
      type: 'updated',
      actorUserId: actorId,
      description: `Lead unassigned because agent ${agentName} was ${reasonLabel}`,
      metadata: {
        previousAssignedAgentId: p.assignedAgentId || p.id, // fallback for single-agent queries that only have prospect id
        reason
      }
    };
  });

  await ProspectActivity.bulkCreate(activityRecords, { transaction });
}

// ---------------------------------------------------------------------------
// NEW service functions (extracted from routes/users.js)
// ---------------------------------------------------------------------------

/**
 * Create a new user (without password — admin-driven user creation).
 * @param {{ email: string, firstName: string, lastName: string, phone?: string, role?: string, isActive?: boolean, owed_leads_count?: number }} data
 * @returns {Promise<User>}
 */
export async function createUser(data) {
  const { email, firstName, lastName, phone, role, isActive, owed_leads_count } = data;

  const existingUser = await User.findOne({ where: { email } });
  if (existingUser) {
    throw new AppError('User with this email already exists', 400);
  }

  const user = await User.create({
    email,
    firstName,
    lastName,
    phone,
    role: role || 'customer',
    isActive: isActive !== undefined ? isActive : true,
    owed_leads_count: owed_leads_count || 0
  });

  return user;
}

/**
 * Paginated user list with optional role / status / search filters.
 * @param {{ page?: number, limit?: number, role?: string, search?: string, status?: string, sortBy?: string, order?: string }} query
 * @returns {Promise<{ users: User[], pagination: object }>}
 */
export async function listUsers(query) {
  const { page = 1, limit = 10, role, search, status, sortBy = 'createdAt', order = 'DESC' } = query;
  const offset = (page - 1) * limit;

  const whereConditions = {};

  if (role) {
    whereConditions.role = role;
  }

  if (status) {
    whereConditions.isActive = status === 'active';
  }

  if (search) {
    const sanitizedSearch = String(search).slice(0, 100).replace(/%/g, '\\%').replace(/_/g, '\\_');
    whereConditions[Op.or] = [
      { firstName: { [Op.iLike]: `%${sanitizedSearch}%` } },
      { lastName: { [Op.iLike]: `%${sanitizedSearch}%` } },
      { email: { [Op.iLike]: `%${sanitizedSearch}%` } }
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

  return {
    users,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(count / limit),
      totalItems: count,
      itemsPerPage: parseInt(limit)
    }
  };
}

/**
 * Invite a new user via the invitation flow.
 * Validates role, builds extraFields, delegates to invitationService.
 *
 * @param {string} email
 * @param {string} fullName
 * @param {string} role
 * @param {number} owedLeadsCount
 * @param {string} inviterEmail
 * @param {Function} getEmailContent - template callback passed through to invitationService
 * @returns {Promise<{ user: User, inviteLink: string, roleLabel: string }>}
 */
export async function inviteUser(email, fullName, role, owedLeadsCount, inviterEmail, getEmailContent) {
  // NOTE: sendRoleInvitation is called by the controller (it owns email concerns),
  // so this function only handles validation and extra-field assembly.
  if (!role) {
    throw new AppError('email, full_name and role are required', 400);
  }

  // 'redeem_ops' arrives WITHOUT a sub-role via this generic path — the user is
  // created capability-less until a super admin grants one (the dedicated
  // POST /api/redeem-ops/team/invite sets the sub-role at invite time and is the
  // preferred flow — docs/redeem-ops/PERMISSION_MATRIX.md).
  const allowedRoles = ['agent', 'fleet_owner', 'driver_partner', 'redeem_ops'];
  if (!allowedRoles.includes(role)) {
    throw new AppError('Invalid role. Must be one of agent, fleet_owner, driver_partner, redeem_ops', 400);
  }

  const extraFields = {};
  if (role === 'agent') {
    extraFields.owed_leads_count = parseInt(owedLeadsCount) || 0;
  }

  const roleLabel = role === 'agent' ? 'Agent' : role === 'fleet_owner' ? 'Fleet Owner' : 'Driver Partner';

  return { extraFields, roleLabel };
}

/**
 * Get a single user by primary key with associations.
 * @param {string} id
 * @returns {Promise<User>}
 */
export async function getUserById(id) {
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

  return user;
}

/**
 * Update user fields. Admin-only fields (role, isActive, owed_leads_count, email) are
 * gated by the `isAdmin` flag. Google-linked accounts cannot change email.
 *
 * @param {string} id
 * @param {object} updates - raw body fields
 * @param {boolean} isAdmin - whether the caller is an admin
 * @returns {Promise<User>}
 */
export async function updateUser(id, updates, isAdmin) {
  const { firstName, lastName, phone, avatar, role, isActive, owed_leads_count, email, dateOfBirth } = updates;

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
  if (isAdmin) {
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

  return user;
}

/**
 * List active agents (for assignment dropdowns).
 * @returns {Promise<User[]>}
 */
export async function listActiveAgents() {
  const agents = await User.findAll({
    where: {
      role: 'agent',
      isActive: true
    },
    attributes: ['id', 'firstName', 'lastName', 'email', 'phone'],
    order: [['firstName', 'ASC']]
  });

  return agents;
}

/**
 * User counts by role/status plus recent users (last 7 days).
 * @returns {Promise<{ totalUsers: number, activeUsers: number, usersByRole: Array, recentUsers: Array }>}
 */
export async function getUserStatsOverview() {
  const [totalUsers, activeUsers, usersByRole, recentUsers] = await Promise.all([
    User.count(),
    User.count({ where: { isActive: true } }),
    User.findAll({
      attributes: [
        'role',
        [sequelize.fn('COUNT', sequelize.col('role')), 'count']
      ],
      group: ['role']
    }),
    User.findAll({
      where: {
        createdAt: {
          [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        }
      },
      limit: 10,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'firstName', 'lastName', 'email', 'role', 'createdAt']
    })
  ]);

  return {
    totalUsers,
    activeUsers,
    usersByRole: usersByRole.map(item => ({
      role: item.role,
      count: parseInt(item.dataValues.count)
    })),
    recentUsers
  };
}

/**
 * Toggle user active status. Guards against self-deactivation and System Agent deactivation
 * are enforced by the controller.
 *
 * @param {string} id
 * @param {boolean} isActive
 * @returns {Promise<User>}
 */
export async function toggleUserStatus(id, isActive) {
  const user = await User.findByPk(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  await user.update({ isActive });

  return user;
}

/**
 * Update approval status (pending | approved | rejected).
 * @param {string} id
 * @param {string} approvalStatus
 * @returns {Promise<User>}
 */
export async function updateApprovalStatus(id, approvalStatus) {
  if (!['pending', 'approved', 'rejected'].includes(approvalStatus)) {
    throw new AppError('Invalid approval status', 400);
  }

  const user = await User.findByPk(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  await user.update({ approvalStatus });

  return user;
}

// ---------------------------------------------------------------------------
// Existing functions (unchanged)
// ---------------------------------------------------------------------------

/**
 * Deactivate a user (soft delete): log activity, unassign prospects, remove package assignments, set isActive=false.
 */
export async function deactivateUser(userId, actorId) {
  const user = await User.findByPk(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  await sequelize.transaction(async (t) => {
    // Lock the user row FIRST, then run the wallet guard INSIDE the same
    // transaction — serializes against walletService.commit's own user lock,
    // so a commit can't slip between the guard check and the deactivation.
    await User.findByPk(userId, { transaction: t, lock: t.LOCK.UPDATE });
    await assertNoOpenWalletState(userId, { transaction: t });

    const assignedProspects = await Prospect.findAll({
      where: { assignedAgentId: userId },
      attributes: ['id'],
      transaction: t
    });

    if (assignedProspects.length > 0) {
      const agentName = `${user.firstName} ${user.lastName}`.trim() || user.email;
      // For single-agent operations, set assignedAgentId on each prospect object so the logger can read it
      const enriched = assignedProspects.map(p => ({ id: p.id, assignedAgentId: userId }));
      await logProspectUnassignment(enriched, agentName, actorId, 'agent_deactivated', 'deactivated', t);
    }

    await Prospect.update(
      { assignedAgentId: null },
      { where: { assignedAgentId: userId }, transaction: t }
    );

    // Wallet-source rows are financial history — never destroyed here (the
    // pre-check above guarantees none are still open).
    await LeadPackageAssignment.destroy({
      where: { agentId: userId, source: { [Op.ne]: 'wallet' } }, transaction: t
    });

    await user.update({ isActive: false }, { transaction: t });
  });

  return { message: 'User deactivated and assignments removed' };
}

/**
 * Permanently delete a user: pre-check RESTRICT constraints, log activity, destroy user record.
 * CASCADE/SET NULL FK rules handle child cleanup automatically.
 */
export async function permanentlyDeleteUser(userId, actorId) {
  const user = await User.findByPk(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // RESTRICT checks: block deletion if user owns campaigns or has commissions as agent
  const campaignCount = await Campaign.count({ where: { createdBy: userId } });
  if (campaignCount > 0) {
    throw new AppError('Cannot delete user who created campaigns. Reassign campaigns first.', 409);
  }

  const commissionCount = await Commission.count({ where: { agentId: userId } });
  if (commissionCount > 0) {
    throw new AppError('Cannot delete user with commissions. Archive commissions first.', 409);
  }

  // Wallet history is a DB-level RESTRICT (wallet_ledger.agentId) — pre-check
  // for a friendly 409 instead of a raw FK error. Any ledger row blocks
  // hard-deletion permanently: financial history is never erased.
  const walletHistoryCount = await WalletLedger.count({ where: { agentId: userId } });
  if (walletHistoryCount > 0) {
    throw new AppError('Cannot delete user with wallet history. Deactivate the account instead.', 409);
  }

  await sequelize.transaction(async (t) => {
    // Log unassignment activity before deletion (for audit trail)
    const assignedProspects = await Prospect.findAll({
      where: { assignedAgentId: userId },
      attributes: ['id'],
      transaction: t
    });

    if (assignedProspects.length > 0) {
      const agentName = `${user.firstName} ${user.lastName}`.trim() || user.email;
      const enriched = assignedProspects.map(p => ({ id: p.id, assignedAgentId: userId }));
      await logProspectUnassignment(enriched, agentName, actorId, 'agent_deleted', 'deleted', t);
    }

    // CASCADE handles: fleet_owners, drivers, lead_package_assignments, user_payouts
    // SET NULL handles: prospects.assignedAgentId, qr_tags.ownerUserId, commissions.approvedBy/processedBy, etc.
    await user.destroy({ transaction: t });
  });

  return { message: 'User and related assignments permanently deleted' };
}

/**
 * Bulk delete users: log activity, unassign prospects, remove package assignments, destroy all matching users.
 * Returns the number of users deleted.
 */
export async function bulkDeleteUsers(userIds, actorId) {
  let deletedCount = 0;

  // Same wallet guards as single delete: open state 409s, and ANY ledger
  // history blocks hard-deletion (DB RESTRICT would abort the tx anyway).
  await assertNoOpenWalletState(userIds);
  const walletHistoryCount = await WalletLedger.count({ where: { agentId: { [Op.in]: userIds } } });
  if (walletHistoryCount > 0) {
    throw new AppError('One or more users have wallet history and cannot be hard-deleted. Deactivate them instead.', 409);
  }

  await sequelize.transaction(async (t) => {
    // Fetch agent info for activity logs
    const agents = await User.findAll({
      where: { id: { [Op.in]: userIds } },
      attributes: ['id', 'firstName', 'lastName', 'email'],
      transaction: t
    });
    const agentNameMap = agents.reduce((acc, agent) => {
      acc[agent.id] = `${agent.firstName} ${agent.lastName}`.trim() || agent.email;
      return acc;
    }, {});

    // Find assigned prospects
    const assignedProspects = await Prospect.findAll({
      where: { assignedAgentId: { [Op.in]: userIds } },
      attributes: ['id', 'assignedAgentId'],
      transaction: t
    });

    if (assignedProspects.length > 0) {
      await logProspectUnassignment(assignedProspects, agentNameMap, actorId, 'agent_deleted_bulk', 'deleted', t);
    }

    await Prospect.update(
      { assignedAgentId: null },
      { where: { assignedAgentId: { [Op.in]: userIds } }, transaction: t }
    );

    await LeadPackageAssignment.destroy({
      where: { agentId: { [Op.in]: userIds }, source: { [Op.ne]: 'wallet' } },
      transaction: t
    });

    deletedCount = await User.destroy({
      where: { id: { [Op.in]: userIds } },
      transaction: t
    });
  });

  return { deletedCount, message: `${deletedCount} users permanently deleted` };
}
