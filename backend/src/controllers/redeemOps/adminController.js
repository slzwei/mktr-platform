import { Op } from 'sequelize';
import Joi from 'joi';
import { asyncHandler, AppError } from '../../middleware/errorHandler.js';
import { User, RedeemOpsAuditEvent, sequelize } from '../../models/index.js';
import { sendRoleInvitation } from '../../services/invitationService.js';
import {
  getRoleInviteSubject,
  getRoleInviteEmail,
  getRoleInviteText,
} from '../../services/emailTemplates.js';
import { REDEEM_OPS_SUB_ROLES } from '../../services/redeemOps/permissions.js';
import { SUB_ROLE_LABELS, publicConstants } from '../../services/redeemOps/constants.js';
import { recordAuditEvent } from '../../services/redeemOps/auditService.js';

const TEAM_ATTRIBUTES = [
  'id', 'email', 'firstName', 'lastName', 'fullName',
  'role', 'redeemOpsRole', 'isActive', 'lastLogin', 'createdAt',
];

// Internal admin surface — loud-fail Joi (no stripUnknown), matching house convention
// for non-public routes (middleware/validation.js header comment).
const inviteSchema = Joi.object({
  email: Joi.string().email().required(),
  full_name: Joi.string().min(1).max(100).required(),
  redeemOpsRole: Joi.string().valid(...REDEEM_OPS_SUB_ROLES).required(),
});

const setRoleSchema = Joi.object({
  redeemOpsRole: Joi.string().valid(...REDEEM_OPS_SUB_ROLES).allow(null).required(),
});

/** GET /api/redeem-ops/team — everyone holding Redeem Ops access. */
export const listTeam = asyncHandler(async (req, res) => {
  const team = await User.findAll({
    where: {
      [Op.or]: [{ role: 'redeem_ops' }, { redeemOpsRole: { [Op.ne]: null } }],
    },
    attributes: TEAM_ATTRIBUTES,
    order: [['createdAt', 'ASC']],
  });
  res.json({ success: true, data: { team } });
});

/**
 * POST /api/redeem-ops/team/invite — invite an outreach/ops staff member.
 * Creates a `role='redeem_ops'` user with the sub-role and sends the standard
 * role-invite email (invitationService + emailTemplates, same flow as /api/users/invite).
 */
export const inviteTeamMember = asyncHandler(async (req, res) => {
  const { error, value } = inviteSchema.validate(req.body, { abortEarly: false });
  if (error) {
    throw new AppError(error.details.map((d) => d.message).join(', '), 400);
  }
  const { email, full_name, redeemOpsRole } = value;
  const roleLabel = `Redeem Ops — ${SUB_ROLE_LABELS[redeemOpsRole]}`;

  // Access grant + its audit row commit atomically (Codex review finding 4):
  // a persisted invite without an audit trail must be impossible. The invite
  // email is best-effort inside the service; a rolled-back tx just leaves a
  // dead token link, never an unaudited account.
  const { user, inviteLink } = await sequelize.transaction(async (t) => {
    const result = await sendRoleInvitation({
      email,
      fullName: full_name,
      role: 'redeem_ops',
      inviterEmail: req.user?.email,
      extraFields: { redeemOpsRole },
      transaction: t,
      getEmailContent: ({ firstName, inviteLink: link, companyName, companyUrl, expiryDays }) => ({
        subject: getRoleInviteSubject({ companyName, roleLabel }),
        html: getRoleInviteEmail({ firstName, inviteLink: link, companyName, companyUrl, expiryDays, roleLabel }),
        text: getRoleInviteText({ firstName, inviteLink: link, companyName, expiryDays, roleLabel }),
      }),
    });
    await recordAuditEvent({
      actorUser: req.user,
      action: 'access.invited',
      entityType: 'user',
      entityId: result.user.id,
      after: { email, redeemOpsRole },
      requestId: req.id || null,
      transaction: t,
    });
    return result;
  });

  res.status(201).json({
    success: true,
    message: `${roleLabel} invited`,
    data: { user: user.toJSON(), inviteLink },
  });
});

/**
 * PATCH /api/redeem-ops/team/:userId/role — grant, change, or revoke (null) a sub-role.
 * Only `redeem_ops` staff and `admin` users may hold one (PERMISSION_MATRIX.md §1);
 * granting to agents/drivers/customers is rejected. Update + audit are atomic.
 */
export const setTeamRole = asyncHandler(async (req, res) => {
  const { error, value } = setRoleSchema.validate(req.body, { abortEarly: false });
  if (error) {
    throw new AppError(error.details.map((d) => d.message).join(', '), 400);
  }
  const target = await User.findByPk(req.params.userId);
  if (!target) throw new AppError('User not found', 404);
  if (!['redeem_ops', 'admin'].includes(target.role)) {
    throw new AppError('Only Redeem Ops staff or admins can hold a Redeem Ops sub-role', 400);
  }

  const before = { redeemOpsRole: target.redeemOpsRole };
  await sequelize.transaction(async (t) => {
    await target.update({ redeemOpsRole: value.redeemOpsRole }, { transaction: t });
    await recordAuditEvent({
      actorUser: req.user,
      action: value.redeemOpsRole ? 'access.role_granted' : 'access.role_revoked',
      entityType: 'user',
      entityId: target.id,
      before,
      after: { redeemOpsRole: value.redeemOpsRole },
      requestId: req.id || null,
      transaction: t,
    });
  });

  res.json({ success: true, data: { user: target.toJSON() } });
});

const updateMemberSchema = Joi.object({
  fullName: Joi.string().min(1).max(100),
  phone: Joi.string().min(8).max(20).allow('', null),
  isActive: Joi.boolean(),
}).min(1);

/**
 * PATCH /api/redeem-ops/team/:userId — admin edit of a member's details and
 * active state. Deactivation is a hard lock-out (authenticateToken rejects
 * inactive users on every request). You cannot deactivate yourself.
 */
export const updateTeamMember = asyncHandler(async (req, res) => {
  const { error, value } = updateMemberSchema.validate(req.body, { abortEarly: false });
  if (error) {
    throw new AppError(error.details.map((d) => d.message).join(', '), 400);
  }
  const target = await User.findByPk(req.params.userId);
  if (!target) throw new AppError('User not found', 404);
  if (!['redeem_ops', 'admin'].includes(target.role)) {
    throw new AppError('Not a Redeem Ops team member', 400);
  }
  if (value.isActive === false && target.id === req.user.id) {
    throw new AppError('You cannot deactivate your own account', 400);
  }

  const updates = {};
  if (value.fullName !== undefined) {
    const trimmed = String(value.fullName).trim();
    const parts = trimmed.split(/\s+/);
    updates.firstName = parts[0] || target.firstName;
    updates.lastName = parts.slice(1).join(' ') || '';
    // fullName is a stored column that would otherwise shadow the new name
    updates.fullName = trimmed;
  }
  if (value.phone !== undefined) updates.phone = value.phone || null;
  if (value.isActive !== undefined) updates.isActive = value.isActive;

  const before = {
    firstName: target.firstName,
    lastName: target.lastName,
    phone: target.phone,
    isActive: target.isActive,
  };
  await sequelize.transaction(async (t) => {
    await target.update(updates, { transaction: t });
    await recordAuditEvent({
      actorUser: req.user,
      action: value.isActive === false
        ? 'access.deactivated'
        : value.isActive === true && before.isActive === false
          ? 'access.reactivated'
          : 'access.member_updated',
      entityType: 'user',
      entityId: target.id,
      before,
      after: updates,
      requestId: req.id || null,
      transaction: t,
    });
  });

  res.json({ success: true, data: { user: target.toJSON() } });
});

/** GET /api/redeem-ops/audit — filterable, paginated audit trail (newest first). */
export const listAudit = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));

  const where = {};
  if (req.query.entityType) where.entityType = String(req.query.entityType);
  if (req.query.entityId) where.entityId = String(req.query.entityId);
  if (req.query.actorUserId) where.actorUserId = String(req.query.actorUserId);
  if (req.query.action) where.action = String(req.query.action);

  const { rows, count } = await RedeemOpsAuditEvent.findAndCountAll({
    where,
    include: [{ model: User, as: 'actor', attributes: ['id', 'fullName', 'email'] }],
    order: [['createdAt', 'DESC']],
    limit,
    offset: (page - 1) * limit,
  });

  res.json({
    success: true,
    data: {
      events: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    },
  });
});

/** GET /api/redeem-ops/meta/constants — stages/types/roles/capabilities for the SPA. */
export const getConstants = asyncHandler(async (req, res) => {
  res.json({ success: true, data: publicConstants() });
});
