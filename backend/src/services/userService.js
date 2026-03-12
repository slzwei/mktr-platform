import { Op } from 'sequelize';
import { User, sequelize, Prospect, LeadPackageAssignment, ProspectActivity } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';

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

/**
 * Deactivate a user (soft delete): log activity, unassign prospects, remove package assignments, set isActive=false.
 */
export async function deactivateUser(userId, actorId) {
  const user = await User.findByPk(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  await sequelize.transaction(async (t) => {
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

    await LeadPackageAssignment.destroy({
      where: { agentId: userId }, transaction: t
    });

    await user.update({ isActive: false }, { transaction: t });
  });

  return { message: 'User deactivated and assignments removed' };
}

/**
 * Permanently delete a user: log activity, unassign prospects, remove package assignments, destroy user record.
 */
export async function permanentlyDeleteUser(userId, actorId) {
  const user = await User.findByPk(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  await sequelize.transaction(async (t) => {
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

    await Prospect.update(
      { assignedAgentId: null },
      { where: { assignedAgentId: userId }, transaction: t }
    );

    await LeadPackageAssignment.destroy({
      where: { agentId: userId }, transaction: t
    });

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
      where: { agentId: { [Op.in]: userIds } },
      transaction: t
    });

    deletedCount = await User.destroy({
      where: { id: { [Op.in]: userIds } },
      transaction: t
    });
  });

  return { deletedCount, message: `${deletedCount} users permanently deleted` };
}
