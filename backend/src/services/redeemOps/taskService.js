import { Op } from 'sequelize';
import { sgtDayWindow } from '../../utils/sgtTime.js';
import {
  OutreachTask, PartnerOrganisation, PartnerContact, User, sequelize,
  OutreachCadenceStep, OutreachCadence, OutreachEmail,
} from '../../models/index.js';
import { AppError } from '../../middleware/appError.js';
import { logger } from '../../utils/logger.js';
import { TASK_STATUSES, TASK_PRIORITIES } from './constants.js';
import { isManagerTier } from './permissions.js';

const TASK_TYPES = ['follow_up', 'call', 'meeting', 'proposal', 'admin', 'other'];
// SGT calendar maths lives in utils/sgtTime.js (P4-7); re-exported for
// existing importers of this module's original home.
export { sgDateKey, sgtDayWindow } from '../../utils/sgtTime.js';

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
    OutreachCadenceStep, OutreachCadence, OutreachEmail, ...overrides,
  };

  const isManager = (user) =>
    isManagerTier(user);

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
    // 'all' opts out of the status filter; unrecognised values (like absence)
    // fall back to open work rather than silently unfiltering the list.
    if (query.status === 'all') { /* no status filter */ }
    else if (TASK_STATUSES.includes(query.status)) where.status = query.status;
    else where.status = { [Op.in]: ['open', 'in_progress'] };

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
          attributes: ['id', 'stepOrder', 'channel', 'title', 'mode'],
          include: [{ model: d.OutreachCadence, as: 'cadence', attributes: ['id', 'key', 'name', 'version'] }],
        },
        // The live machine-send state for auto steps (scheduled/held/failed) —
        // sent/cancelled rows stay out of the payload.
        {
          model: d.OutreachEmail, as: 'outboxEmails', required: false,
          attributes: ['id', 'status', 'holdReason', 'nextAttemptAt', 'toAddress', 'lastError'],
          where: { status: { [Op.in]: ['queued', 'needs_approval', 'sending', 'failed'] } },
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
      // emailSubject joins the allowlist (Phase B): the auto-sender reads
      // body+subject FROM THE TASK at send time, so editing here IS editing
      // what sends. The sender 409s edits only while a row is mid-`sending`.
      const CADENCE_EDITABLE = ['description', 'priority', 'emailSubject'];
      const blocked = Object.keys(body).filter((k) => body[k] !== undefined && !CADENCE_EDITABLE.includes(k));
      if (blocked.length > 0) {
        throw new AppError(
          'This task is driven by a cadence — record an outcome to complete it, or stop the cadence on the business. Only description and priority can be edited here.',
          409
        );
      }
      // C3 edit-vs-claim guard: while the auto-sender holds the row
      // (`sending`), an accepted edit could lose the race with the wire —
      // refuse for the few seconds it takes rather than send stale text.
      if ((body.description !== undefined || body.emailSubject !== undefined) && d.OutreachEmail) {
        const inFlight = await d.OutreachEmail.count({
          where: { taskId: task.id, status: 'sending' }, transaction: t,
        });
        if (inFlight > 0) {
          throw new AppError('This email is sending right now — try again in a few seconds', 409);
        }
      }
    }

    const updates = {};
    for (const f of ['title', 'description', 'dueAt', 'hasTime', 'priority', 'type', 'contactId', 'emailSubject']) {
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
