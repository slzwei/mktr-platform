import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { getRoleInviteEmail, getRoleInviteSubject, getRoleInviteText } from '../services/emailTemplates.js';
import { sendRoleInvitation } from '../services/invitationService.js';
import { getSystemAgentId } from '../services/systemAgent.js';
import {
  createUser,
  listUsers,
  inviteUser,
  getUserById,
  updateUser,
  listActiveAgents,
  getUserStatsOverview,
  toggleUserStatus,
  updateApprovalStatus,
  deactivateUser,
  permanentlyDeleteUser,
  bulkDeleteUsers
} from '../services/userService.js';

/**
 * POST /api/users
 * Create a new user (Admin only).
 */
export const create = asyncHandler(async (req, res) => {
  const user = await createUser(req.body);

  res.status(201).json({
    success: true,
    message: 'User created successfully',
    data: { user: user.toJSON() }
  });
});

/**
 * GET /api/users
 * Paginated user list with role / status / search filters (Admin only).
 */
export const list = asyncHandler(async (req, res) => {
  const { users, pagination } = await listUsers(req.query);

  res.json({
    success: true,
    data: { users, pagination }
  });
});

/**
 * POST /api/users/invite
 * Invite a new user by role (Admin only).
 * Email sending stays in the controller layer.
 */
export const invite = asyncHandler(async (req, res) => {
  const { email, full_name, role, owed_leads_count = 0 } = req.body;

  // Validate role and build extra fields via service
  const { extraFields, roleLabel } = await inviteUser(
    email, full_name, role, owed_leads_count, req.user?.email
  );

  // Email-sending orchestration stays in controller
  const { user, inviteLink } = await sendRoleInvitation({
    email,
    fullName: full_name,
    role,
    inviterEmail: req.user?.email,
    extraFields,
    getEmailContent: ({ firstName, inviteLink, companyName, companyUrl, expiryDays, roleLabel }) => ({
      subject: getRoleInviteSubject({ companyName, roleLabel }),
      html: getRoleInviteEmail({ firstName, inviteLink, companyName, companyUrl, expiryDays, roleLabel }),
      text: getRoleInviteText({ firstName, inviteLink, companyName, expiryDays, roleLabel })
    })
  });

  res.status(201).json({ success: true, message: `${roleLabel} invited`, data: { user: user.toJSON(), inviteLink } });
});

/**
 * GET /api/users/:id
 * Get user by ID. Self-access allowed; admin/agent can view any user.
 */
export const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Access check: users can only view their own profile unless admin/agent
  if (req.user.id !== id && !['admin', 'agent'].includes(req.user.role)) {
    throw new AppError('Access denied', 403);
  }

  const user = await getUserById(id);

  res.json({
    success: true,
    data: { user }
  });
});

/**
 * PUT /api/users/:id
 * Update user fields. Self-update or admin.
 */
export const update = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Access check
  if (req.user.id !== id && req.user.role !== 'admin') {
    throw new AppError('Access denied', 403);
  }

  const isAdmin = req.user.role === 'admin';
  const user = await updateUser(id, req.body, isAdmin);

  res.json({
    success: true,
    message: 'User updated successfully',
    data: { user: user.toJSON() }
  });
});

/**
 * DELETE /api/users/:id
 * Soft-delete (deactivate) a user (Admin only).
 */
export const remove = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (req.user.id === id) {
    throw new AppError('Cannot delete your own account', 400);
  }

  const systemAgentId = await getSystemAgentId();
  if (id === systemAgentId) {
    throw new AppError('Cannot delete the System Agent', 400);
  }

  const result = await deactivateUser(id, req.user.id);
  res.json({ success: true, message: result.message });
});

/**
 * POST /api/users/bulk-delete
 * Bulk permanent delete (Admin only).
 */
export const bulkRemove = asyncHandler(async (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new AppError('ids array is required', 400);
  }

  if (ids.includes(req.user.id)) {
    throw new AppError('Cannot delete your own account', 400);
  }

  const systemAgentId = await getSystemAgentId();
  if (ids.includes(systemAgentId)) {
    throw new AppError('Cannot delete the System Agent', 400);
  }

  const result = await bulkDeleteUsers(ids, req.user.id);
  res.json({ success: true, message: result.message });
});

/**
 * DELETE /api/users/:id/permanent
 * Permanently delete a user (Admin only).
 */
export const permanentRemove = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (req.user.id === id) {
    throw new AppError('Cannot delete your own account', 400);
  }

  const systemAgentId = await getSystemAgentId();
  if (id === systemAgentId) {
    throw new AppError('Cannot delete the System Agent', 400);
  }

  const result = await permanentlyDeleteUser(id, req.user.id);
  res.json({ success: true, message: result.message });
});

/**
 * GET /api/users/agents/list
 * Active agents for assignment dropdowns.
 */
export const agents = asyncHandler(async (req, res) => {
  const agentList = await listActiveAgents();

  res.json({
    success: true,
    data: { agents: agentList }
  });
});

/**
 * GET /api/users/stats/overview
 * User counts by role/status (Admin only).
 */
export const statsOverview = asyncHandler(async (req, res) => {
  const stats = await getUserStatsOverview();

  res.json({
    success: true,
    data: stats
  });
});

/**
 * PATCH /api/users/:id/status
 * Activate or deactivate a user (Admin only).
 */
export const patchStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    throw new AppError('isActive must be a boolean value', 400);
  }

  if (req.user.id === id && !isActive) {
    throw new AppError('Cannot deactivate your own account', 400);
  }

  const systemAgentId = await getSystemAgentId();
  if (id === systemAgentId && !isActive) {
    throw new AppError('Cannot deactivate the System Agent', 400);
  }

  const user = await toggleUserStatus(id, isActive);

  res.json({
    success: true,
    message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
    data: { user: user.toJSON() }
  });
});

/**
 * PATCH /api/users/:id/approval
 * Update approval status (Admin only).
 */
export const patchApproval = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { approvalStatus } = req.body;

  const user = await updateApprovalStatus(id, approvalStatus);

  res.json({
    success: true,
    message: `User marked as ${approvalStatus}`,
    data: { user: user.toJSON() }
  });
});
