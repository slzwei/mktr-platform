import { Op } from 'sequelize';
import {
  OutreachTask, PartnerOrganisation, PartnerContact, User, sequelize,
  OutreachCadenceStep, OutreachCadence,
} from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { TASK_STATUSES, TASK_PRIORITIES } from './constants.js';

const TASK_TYPES = ['follow_up', 'call', 'meeting', 'proposal', 'admin', 'other'];
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Singapore calendar date for counters/snapshots, independent of server TZ. */
export function sgDateKey(now = new Date()) {
  return new Date(now.getTime() + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

/** "Today" in Singapore time regardless of server TZ. */
export function sgtDayWindow(now = new Date()) {
  const sgt = new Date(now.getTime() + SGT_OFFSET_MS);
  const startUtcMs = Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate()) - SGT_OFFSET_MS;
  return { start: new Date(startUtcMs), end: new Date(startUtcMs + 24 * 60 * 60 * 1000) };
}

/**
 * Tasks & follow-ups (docs/redeem-ops/ERD.md §3.7, brief §19). Row-level rule:
 * managers (admin/super_admin/ops_admin/bdm) act on any task; everyone else only
 * on tasks they are assigned to or created. Task changes recompute the partner's
 * denormalized nextTaskAt.
 *
 * P0 tx primitives (docs/plans/redeem-ops-cadences.md §3): the write paths are
 * `*Tx` functions that run inside a CALLER-owned transaction with the partner
 * row locked before any task write — lock order is partner → task everywhere,
 * matching the cadence engine's enrollment → partner → task. The public
 * `createTask`/`updateTask` keep their exact signatures and behavior as thin
 * one-transaction wrappers.
 */
export function makeTaskService(overrides = {}) {
  const d = {
    OutreachTask, PartnerOrganisation, PartnerContact, User, sequelize, logger,
    OutreachCadenceStep, OutreachCadence, ...overrides,
  };

  const isManager = (user) =>
    user.role === 'admin' || ['super_admin', 'ops_admin', 'bdm'].includes(user.redeemOpsRole);

  async function recomputeNextTaskAt(partnerOrganisationId, transaction = null) {
    const next = await d.OutreachTask.min('dueAt', {
      where: { partnerOrganisationId, status: { [Op.in]: ['open', 'in_progress'] } },
      transaction,
    });
    await d.PartnerOrganisation.update(
      { nextTaskAt: next || null },
      { where: { id: partnerOrganisationId }, transaction }
    );
  }

  async function createTaskTx(body, user, t) {
    if (!body.title || !String(body.title).trim()) throw new AppError('Title is required', 400);
    if (!body.partnerOrganisationId) throw new AppError('partnerOrganisationId is required', 400);
    if (!body.dueAt || Number.isNaN(new Date(body.dueAt).getTime())) throw new AppError('A valid dueAt is required', 400);
    if (body.priority && !TASK_PRIORITIES.includes(body.priority)) throw new AppError('Unknown priority', 400);
    if (body.type && !TASK_TYPES.includes(body.type)) throw new AppError('Unknown task type', 400);

    const partner = await d.PartnerOrganisation.findByPk(body.partnerOrganisationId, {
      transaction: t, lock: t.LOCK.UPDATE,
    });
    if (!partner || partner.mergedIntoId) throw new AppError('Partner not found', 404);

    const assigneeUserId = body.assigneeUserId || user.id;
    if (assigneeUserId !== user.id && !isManager(user)) {
      throw new AppError('Only managers can assign tasks to others', 403);
    }
    const assignee = await d.User.findByPk(assigneeUserId, { transaction: t });
    if (!assignee || !assignee.isActive || !(assignee.role === 'redeem_ops' || assignee.role === 'admin' || assignee.redeemOpsRole)) {
      throw new AppError('Assignee must be an active Redeem Ops staff member', 400);
    }

    const task = await d.OutreachTask.create(
      {
        title: String(body.title).trim(),
        partnerOrganisationId: body.partnerOrganisationId,
        contactId: body.contactId || null,
        assigneeUserId,
        createdBy: user.id,
        dueAt: new Date(body.dueAt),
        hasTime: !!body.hasTime,
        priority: body.priority || 'medium',
        type: body.type || 'follow_up',
        description: body.description || null,
      },
      { transaction: t }
    );
    await recomputeNextTaskAt(body.partnerOrganisationId, t);
    return task;
  }

  async function createTask(body, user) {
    return d.sequelize.transaction(async (t) => createTaskTx(body, user, t));
  }

  async function listTasks(query, user) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));

    const where = {};
    // Scope: managers may look across the team; everyone else sees their own.
    if (isManager(user) && query.assigneeUserId) where.assigneeUserId = String(query.assigneeUserId);
    else if (isManager(user) && query.scope === 'team') { /* no assignee filter */ }
    else where.assigneeUserId = user.id;

    if (query.partnerId) where.partnerOrganisationId = String(query.partnerId);
    if (query.status && TASK_STATUSES.includes(query.status)) where.status = query.status;
    else if (!query.status) where.status = { [Op.in]: ['open', 'in_progress'] };
    else if (query.status === 'all') delete where.status;

    const { start, end } = sgtDayWindow();
    if (query.due === 'today') where.dueAt = { [Op.gte]: start, [Op.lt]: end };
    if (query.due === 'overdue') where.dueAt = { [Op.lt]: start };
    if (query.due === 'upcoming') where.dueAt = { [Op.gte]: end };

    const { rows, count } = await d.OutreachTask.findAndCountAll({
      where,
      include: [
        { model: d.PartnerOrganisation, as: 'partner', attributes: ['id', 'tradingName', 'legalName', 'brandName'] },
        { model: d.User, as: 'assignee', attributes: ['id', 'fullName'] },
        { model: d.PartnerContact, as: 'contact', attributes: ['id', 'name'] },
        {
          model: d.OutreachCadenceStep, as: 'cadenceStep', required: false,
          attributes: ['id', 'stepOrder', 'channel', 'title'],
          include: [{ model: d.OutreachCadence, as: 'cadence', attributes: ['id', 'key', 'name', 'version'] }],
        },
      ],
      order: [['dueAt', 'ASC']],
      limit,
      offset: (page - 1) * limit,
    });
    return { tasks: rows, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } };
  }

  async function updateTaskTx(taskId, body, user, t) {
    // Non-locking probe first: the partner must be locked BEFORE the task row
    // (lock order partner → task; partnerOrganisationId is immutable on tasks,
    // so the probe cannot go stale between the two reads).
    const probe = await d.OutreachTask.findByPk(taskId, {
      attributes: ['id', 'partnerOrganisationId'], transaction: t,
    });
    if (!probe) throw new AppError('Task not found', 404);
    await d.PartnerOrganisation.findByPk(probe.partnerOrganisationId, {
      transaction: t, lock: t.LOCK.UPDATE,
    });
    const task = await d.OutreachTask.findByPk(taskId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!task) throw new AppError('Task not found', 404);
    if (!isManager(user) && task.assigneeUserId !== user.id && task.createdBy !== user.id) {
      throw new AppError('You can only update your own tasks', 403);
    }

    // Cadence tasks bypass-guard (docs/plans/redeem-ops-cadences.md §5.5):
    // status/schedule/assignee changes must go through the cadence engine —
    // the generic PATCH may only touch cosmetic fields.
    if (task.cadenceEnrollmentId) {
      const CADENCE_EDITABLE = ['description', 'priority'];
      const blocked = Object.keys(body).filter((k) => body[k] !== undefined && !CADENCE_EDITABLE.includes(k));
      if (blocked.length > 0) {
        throw new AppError(
          'This task is driven by a cadence — record an outcome to complete it, or stop the cadence on the business. Only description and priority can be edited here.',
          409
        );
      }
    }

    const updates = {};
    for (const f of ['title', 'description', 'dueAt', 'hasTime', 'priority', 'type', 'contactId']) {
      if (body[f] !== undefined) updates[f] = body[f];
    }
    if (body.assigneeUserId !== undefined) {
      if (!isManager(user)) throw new AppError('Only managers can reassign tasks', 403);
      updates.assigneeUserId = body.assigneeUserId;
    }
    if (body.status !== undefined) {
      if (!TASK_STATUSES.includes(body.status)) throw new AppError('Unknown status', 400);
      updates.status = body.status;
      if (body.status === 'completed') {
        updates.completedAt = new Date();
        updates.completedBy = user.id;
      }
      if (body.status === 'open' || body.status === 'in_progress') {
        updates.completedAt = null;
        updates.completedBy = null;
      }
    }
    if (updates.priority && !TASK_PRIORITIES.includes(updates.priority)) throw new AppError('Unknown priority', 400);

    await task.update(updates, { transaction: t });
    await recomputeNextTaskAt(task.partnerOrganisationId, t);
    return task;
  }

  async function updateTask(taskId, body, user) {
    return d.sequelize.transaction(async (t) => updateTaskTx(taskId, body, user, t));
  }

  return {
    createTask, createTaskTx, listTasks, updateTask, updateTaskTx,
    recomputeNextTaskAt, isManager,
  };
}

const _default = makeTaskService();
export default _default;
