import { Op } from 'sequelize';
import {
  PartnerOrganisation, PartnerLocation, PartnerContact, PartnerAssignmentEvent,
  PartnerStageEvent, OutreachActivity, OutreachTask, ProspectingPoolMember,
  PartnerOnboardingItem, RewardOffer, Activation,
  RedeemOpsAuditEvent, User, sequelize,
} from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { makeDedupeService } from './dedupeService.js';
import { hasCapability } from './permissions.js';
import { deriveMatchingKeys, postalDistrictOf } from './normalizers.js';
import {
  PIPELINE_STAGES, STAGE_TRANSITIONS, PARTNER_AVAILABILITY,
  ACTIVITY_TYPES, MEANINGFUL_ACTIVITY_TYPES, LOST_REASONS,
} from './constants.js';
import { makeOnboardingService } from './onboardingService.js';
import { makeCategoryService } from './categoryService.js';
import { fireCadenceHook } from './cadenceHooks.js';

/**
 * Partner CRM core (docs/redeem-ops/ERD.md §3.1–3.6, brief §13–§18).
 * Row-level "own" scoping lives HERE (not in middleware): outreach_execs act only
 * on partners they own; managers (bdm/ops_admin/super_admin/admin) act on any.
 *
 * P0 tx primitives (docs/plans/redeem-ops-cadences.md §3): the stage machine,
 * snooze, and activity logging expose `*Tx` variants that run inside a
 * CALLER-owned transaction with the partner row locked (`FOR UPDATE`) before
 * any decision is made, and fire the cadence hook registry inside that same
 * transaction. The public wrappers keep their exact signatures and behavior.
 */
export function makePartnerService(overrides = {}) {
  const d = {
    PartnerOrganisation, PartnerLocation, PartnerContact, PartnerAssignmentEvent,
    PartnerStageEvent, OutreachActivity, OutreachTask, ProspectingPoolMember,
    PartnerOnboardingItem, RewardOffer, Activation,
    RedeemOpsAuditEvent, User, sequelize, logger,
    audit: makeRedeemOpsAuditService(),
    dedupe: makeDedupeService(),
    categories: makeCategoryService(),
    fireCadenceHook,
    // PARTNERED → seed the onboarding checklist (brief §22); injectable for tests.
    onPartnered: (partner, _user, t) => makeOnboardingService().seedChecklist(partner.id, t),
    ...overrides,
  };

  const LIVE = { mergedIntoId: null };
  const OWNER_INCLUDE = { model: d.User, as: 'owner', attributes: ['id', 'fullName', 'email'] };

  /** Managers act on any row; everyone else must own it. */
  function canActOnRow(user, partner) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (['super_admin', 'ops_admin', 'bdm'].includes(user.redeemOpsRole)) return true;
    return partner.ownerUserId === user.id;
  }

  async function getLivePartner(id, options = {}) {
    const partner = await d.PartnerOrganisation.findByPk(id, options);
    if (!partner || partner.mergedIntoId) throw new AppError('Partner not found', 404);
    return partner;
  }

  // ── List / detail ────────────────────────────────────────────────────────

  async function listPartners(query, user) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));

    const where = { ...LIVE };
    if (query.includeArchived !== 'true') {
      where.archivedAt = null;
    }
    if (query.stage && PIPELINE_STAGES.includes(query.stage)) where.pipelineStage = query.stage;
    if (query.availability && PARTNER_AVAILABILITY.includes(query.availability)) where.availability = query.availability;
    if (query.category) where.category = String(query.category);
    if (query.owner === 'me') where.ownerUserId = user.id;
    else if (query.owner === 'none') where.ownerUserId = null;
    else if (query.ownerUserId) where.ownerUserId = String(query.ownerUserId);
    if (query.flag === 'at_risk') where.atRiskFlag = true;
    if (query.flag === 'stale') where.staleFlag = true;

    if (query.search) {
      const s = String(query.search).trim();
      const like = `%${s}%`;
      where[Op.or] = [
        { tradingName: { [Op.iLike]: like } },
        { legalName: { [Op.iLike]: like } },
        { brandName: { [Op.iLike]: like } },
        { primaryPhone: s },
        { uen: s.toUpperCase() },
        { instagramHandle: s.toLowerCase().replace(/^@/, '') },
        { websiteDomain: { [Op.iLike]: like } },
      ];
    }

    const { rows, count } = await d.PartnerOrganisation.findAndCountAll({
      where,
      include: [OWNER_INCLUDE],
      order: [
        [d.sequelize.literal('"lastActivityAt" IS NULL'), 'ASC'],
        ['lastActivityAt', 'DESC'],
        ['createdAt', 'DESC'],
      ],
      limit,
      offset: (page - 1) * limit,
    });

    return {
      partners: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  }

  async function getPartner(id) {
    const partner = await getLivePartner(id, {
      include: [
        OWNER_INCLUDE,
        { model: d.PartnerContact, as: 'contacts', where: { archivedAt: null }, required: false },
        { model: d.PartnerLocation, as: 'locations', required: false },
      ],
    });
    return partner;
  }

  // ── Create / update (dedupe-gated) ───────────────────────────────────────

  function displayNameOf(body) {
    return body.tradingName || body.brandName || body.legalName || null;
  }

  async function createPartner(body, user, requestId = null) {
    if (!displayNameOf(body)) {
      throw new AppError('At least one of tradingName, brandName, or legalName is required', 400);
    }
    const keys = deriveMatchingKeys(body);
    if (!keys.normalizedName) throw new AppError('Business name is required', 400);
    const category = (await d.categories.resolveCategoryName(body.category)) ?? null;

    const { exact, potential } = await d.dedupe.findDuplicates(body);
    const overrideReason = body.overrideReason && String(body.overrideReason).trim();
    if (exact.length > 0 && !overrideReason) {
      const err = new AppError(
        'A business with the same identifier already exists. Provide overrideReason to create anyway.',
        409
      );
      err.data = { duplicates: { exact, potential } };
      throw err;
    }

    const partner = await d.sequelize.transaction(async (t) => {
      const created = await d.PartnerOrganisation.create(
        {
          legalName: body.legalName || null,
          tradingName: body.tradingName || null,
          brandName: body.brandName || null,
          ...keys,
          website: body.website || null,
          primaryPhone: body.primaryPhone || null,
          primaryEmail: body.primaryEmail ? String(body.primaryEmail).toLowerCase() : null,
          facebookUrl: body.facebookUrl || null,
          linkedinUrl: body.linkedinUrl || null,
          category,
          subcategory: body.subcategory || null,
          source: body.source || 'manual',
          tags: Array.isArray(body.tags) ? body.tags : [],
          notes: body.notes || null,
          createdBy: user.id,
        },
        { transaction: t }
      );
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'partner.created', entityType: 'partner_organisation',
        entityId: created.id,
        after: { name: displayNameOf(body), category },
        reason: overrideReason || null, requestId, transaction: t,
      });
      return created;
    });

    return { partner, warnings: potential };
  }

  const EDITABLE_FIELDS = [
    'legalName', 'tradingName', 'brandName', 'uen', 'website', 'primaryPhone', 'primaryEmail',
    'instagramHandle', 'tiktokHandle', 'facebookUrl', 'linkedinUrl', 'category', 'subcategory',
    'source', 'tags', 'notes',
  ];

  async function updatePartner(id, body, user, requestId = null) {
    const partner = await getLivePartner(id);
    if (!canActOnRow(user, partner)) {
      throw new AppError('You can only edit businesses you own', 403);
    }
    const updates = {};
    for (const f of EDITABLE_FIELDS) if (body[f] !== undefined) updates[f] = body[f];
    if (updates.category !== undefined) {
      // currentValue pass-through: an admin rename/retire must never 422 an
      // unrelated edit (the SPA sends category on every save).
      updates.category = await d.categories.resolveCategoryName(updates.category, {
        currentValue: partner.category,
      });
    }
    // Re-derive matching keys from the merged view so they never drift
    const merged = { ...partner.toJSON(), ...updates };
    Object.assign(updates, deriveMatchingKeys(merged));
    if (!updates.normalizedName) throw new AppError('Business name is required', 400);

    const before = {};
    for (const k of Object.keys(updates)) before[k] = partner.get(k);

    await d.sequelize.transaction(async (t) => {
      await partner.update(updates, { transaction: t });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'partner.edited', entityType: 'partner_organisation',
        entityId: id, before, after: updates, requestId, transaction: t,
      });
    });
    return partner;
  }

  // ── Stage machine ────────────────────────────────────────────────────────

  /**
   * A close must record who agreed and how to reach them — at least one active
   * contact, plus a phone or email somewhere on the record. Everything else
   * (terms, outlets, launch) belongs to the onboarding checklist.
   */
  async function assertPartneredEntryRequirements(id, partner, transaction = null) {
    const contacts = await d.PartnerContact.findAll({
      where: { partnerOrganisationId: id, archivedAt: null },
      attributes: ['id', 'mobile', 'email'],
      transaction,
    });
    if (contacts.length === 0) {
      throw new AppError(
        'To mark as Partnered, add the person who agreed as a contact first (Contacts tab).',
        422
      );
    }
    const reachable = partner.primaryPhone || partner.primaryEmail
      || contacts.some((c) => c.mobile || c.email);
    if (!reachable) {
      throw new AppError(
        'To mark as Partnered, add a phone or email for the business or its contact.',
        422
      );
    }
  }

  async function changeStageTx(id, toStage, user, t, { reason = null, requestId = null, lostReason = null } = {}) {
    if (!PIPELINE_STAGES.includes(toStage)) throw new AppError('Unknown stage', 400);
    if (toStage === 'LOST' && !LOST_REASONS.includes(lostReason)) {
      throw new AppError('A reason is required when marking a business as Lost', 400);
    }
    const partner = await getLivePartner(id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!canActOnRow(user, partner)) {
      throw new AppError('You can only move businesses you own', 403);
    }
    const fromStage = partner.pipelineStage;
    if (fromStage === toStage) return partner;

    const allowed = STAGE_TRANSITIONS[fromStage] || [];
    const isForcer = user.role === 'admin' || ['super_admin', 'ops_admin'].includes(user.redeemOpsRole);
    if (!allowed.includes(toStage)) {
      if (!isForcer) {
        throw new AppError(`Cannot move from ${fromStage} to ${toStage}`, 400);
      }
      if (!reason) throw new AppError('A reason is required to force a non-standard stage change', 400);
    }

    // Entry requirement for PARTNERED (Salesforce-style stage validation, applies
    // to EVERYONE incl. admins) — also enforced when an undo restores PARTNERED.
    if (toStage === 'PARTNERED') {
      await assertPartneredEntryRequirements(id, partner, t);
    }

    // LOST leaves the working pool (reuses the 'disqualified' availability so
    // pools/queue exclusions keep working); any other move wakes a snooze.
    const availability =
      toStage === 'LOST' ? 'disqualified'
      : partner.ownerUserId ? 'owned' : 'available';

    await partner.update({
      pipelineStage: toStage, availability, staleFlag: false, snoozedUntil: null,
      // lostReason persists after LOST → re-engage so an undo/relapse keeps
      // context; the UI only shows it while the stage is LOST.
      ...(toStage === 'LOST' ? { lostReason } : {}),
    }, { transaction: t });
    await d.PartnerStageEvent.create(
      { partnerOrganisationId: id, fromStage, toStage, actorUserId: user.id, reason },
      { transaction: t }
    );
    await d.audit.recordAuditEvent({
      actorUser: user, action: 'stage.changed', entityType: 'partner_organisation',
      entityId: id, before: { stage: fromStage }, after: { stage: toStage },
      reason, requestId, transaction: t,
    });
    // PARTNERED → onboarding checklist seeding hooks in here (Phase 4).
    if (toStage === 'PARTNERED' && typeof d.onPartnered === 'function') {
      await d.onPartnered(partner, user, t);
    }
    await d.fireCadenceHook('onStageChange', { partner, fromStage, toStage, user, transaction: t });
    return partner;
  }

  async function changeStage(id, toStage, user, reason = null, requestId = null, lostReason = null) {
    return d.sequelize.transaction(async (t) =>
      changeStageTx(id, toStage, user, t, { reason, requestId, lostReason }));
  }

  // ── Timeline & activities ────────────────────────────────────────────────

  /**
   * Undo the latest stage move — the board's safety net for mis-drops.
   * Server-enforced window: same actor, within 5 minutes, and only while the
   * partner is still in the stage that move produced. Reverts WITHOUT the
   * transition-legality check (it restores a state that already existed) but
   * with a stage event + audit row like any other move.
   */
  async function undoStageChange(id, user, requestId = null) {
    return d.sequelize.transaction(async (t) => {
      const partner = await getLivePartner(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!canActOnRow(user, partner)) {
        throw new AppError('You can only move businesses you own', 403);
      }
      const last = await d.PartnerStageEvent.findOne({
        where: { partnerOrganisationId: id },
        order: [['createdAt', 'DESC']],
        transaction: t,
      });
      if (!last || !last.fromStage || last.toStage !== partner.pipelineStage) {
        throw new AppError('Nothing to undo', 400);
      }
      // Undo is terminal — no undo-of-undo ping-pong.
      if (last.reason === 'undo') {
        throw new AppError('That move was already an undo', 400);
      }
      if (last.actorUserId !== user.id) {
        throw new AppError('Only the person who made the move can undo it', 403);
      }
      if (Date.now() - new Date(last.createdAt).getTime() > 5 * 60 * 1000) {
        throw new AppError('The undo window (5 minutes) has passed', 400);
      }

      const fromStage = partner.pipelineStage;
      const toStage = last.fromStage;
      // Restoring PARTNERED must meet the same entry bar as reaching it.
      if (toStage === 'PARTNERED') {
        await assertPartneredEntryRequirements(id, partner, t);
      }
      const availability =
        toStage === 'LOST' ? 'disqualified'
        : partner.ownerUserId ? 'owned' : 'available';

      // Conditional transition — a concurrent move loses cleanly instead of
      // silently overwriting it.
      const [moved] = await d.PartnerOrganisation.update(
        { pipelineStage: toStage, availability, snoozedUntil: null },
        { where: { id, pipelineStage: fromStage }, transaction: t }
      );
      if (moved === 0) {
        throw new AppError('The stage changed in the meantime — refresh and try again', 409);
      }
      await d.PartnerStageEvent.create(
        { partnerOrganisationId: id, fromStage, toStage, actorUserId: user.id, reason: 'undo' },
        { transaction: t }
      );
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'stage.undone', entityType: 'partner_organisation',
        entityId: id, before: { stage: fromStage }, after: { stage: toStage },
        reason: 'undo', requestId, transaction: t,
      });
      await d.fireCadenceHook('onStageChange', { partner, fromStage, toStage, user, transaction: t });
      return partner;
    });
  }

  /**
   * Snooze — "not now, wake me later". A flag, not a stage: the deal keeps its
   * pipeline position; availability='follow_up_later' hides it from the queue
   * until the stale sweep wakes it at snoozedUntil.
   */
  async function snoozePartnerTx(id, user, until, t, { requestId = null } = {}) {
    const partner = await getLivePartner(id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!canActOnRow(user, partner)) {
      throw new AppError('You can only snooze businesses you own', 403);
    }
    if (partner.pipelineStage === 'PARTNERED' || partner.pipelineStage === 'LOST') {
      throw new AppError('Partnered and Lost businesses cannot be snoozed', 400);
    }
    const wake = new Date(until);
    if (!until || Number.isNaN(wake.getTime()) || wake.getTime() <= Date.now()) {
      throw new AppError('Pick a wake date in the future', 400);
    }
    if (wake.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) {
      throw new AppError('Snooze at most one year ahead', 400);
    }
    await partner.update(
      { availability: 'follow_up_later', snoozedUntil: wake, staleFlag: false },
      { transaction: t }
    );
    await d.audit.recordAuditEvent({
      actorUser: user, action: 'partner.snoozed', entityType: 'partner_organisation',
      entityId: id, after: { snoozedUntil: wake.toISOString() }, requestId, transaction: t,
    });
    await d.fireCadenceHook('onSnooze', { partner, until: wake, user, transaction: t });
    return partner;
  }

  async function snoozePartner(id, user, until, requestId = null) {
    return d.sequelize.transaction(async (t) => snoozePartnerTx(id, user, until, t, { requestId }));
  }

  async function unsnoozePartnerTx(id, user, t, { requestId = null } = {}) {
    const partner = await getLivePartner(id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!canActOnRow(user, partner)) {
      throw new AppError('You can only snooze businesses you own', 403);
    }
    if (partner.availability !== 'follow_up_later' && !partner.snoozedUntil) return partner;
    await partner.update(
      { availability: partner.ownerUserId ? 'owned' : 'available', snoozedUntil: null },
      { transaction: t }
    );
    await d.audit.recordAuditEvent({
      actorUser: user, action: 'partner.unsnoozed', entityType: 'partner_organisation',
      entityId: id, requestId, transaction: t,
    });
    await d.fireCadenceHook('onUnsnooze', { partner, user, source: 'manual', transaction: t });
    return partner;
  }

  async function unsnoozePartner(id, user, requestId = null) {
    return d.sequelize.transaction(async (t) => unsnoozePartnerTx(id, user, t, { requestId }));
  }

  async function getTimeline(id, query = {}) {
    await getLivePartner(id, { attributes: ['id', 'mergedIntoId'] });
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
    const [activities, stageEvents, assignmentEvents, auditEvents, tasks] = await Promise.all([
      d.OutreachActivity.findAll({
        where: { partnerOrganisationId: id, voidedAt: null },
        include: [
          { model: d.User, as: 'actor', attributes: ['id', 'fullName'] },
          { model: d.PartnerContact, as: 'contact', attributes: ['id', 'name'] },
        ],
        order: [['occurredAt', 'DESC']],
        limit,
      }),
      d.PartnerStageEvent.findAll({
        where: { partnerOrganisationId: id },
        include: [{ model: d.User, as: 'actor', attributes: ['id', 'fullName'] }],
        order: [['createdAt', 'DESC']],
        limit,
      }),
      d.PartnerAssignmentEvent.findAll({
        where: { partnerOrganisationId: id },
        include: [
          { model: d.User, as: 'actor', attributes: ['id', 'fullName'] },
          { model: d.User, as: 'toUser', attributes: ['id', 'fullName'] },
          { model: d.User, as: 'fromUser', attributes: ['id', 'fullName'] },
        ],
        order: [['createdAt', 'DESC']],
        limit,
      }),
      // Field-history entries (Salesforce-style): creation + detail edits with
      // before/after diffs come straight off the immutable audit trail.
      d.RedeemOpsAuditEvent.findAll({
        where: {
          entityType: 'partner_organisation',
          entityId: String(id),
          action: { [Op.in]: ['partner.created', 'partner.edited', 'partner.snoozed', 'partner.unsnoozed'] },
        },
        include: [{ model: d.User, as: 'actor', attributes: ['id', 'fullName'] }],
        order: [['createdAt', 'DESC']],
        limit,
      }),
      // Tasks belong in the activity history like any CRM: creation, and the
      // completion/cancellation as its own dated entry.
      d.OutreachTask.findAll({
        where: { partnerOrganisationId: id },
        include: [
          { model: d.User, as: 'creator', attributes: ['id', 'fullName'] },
          { model: d.User, as: 'assignee', attributes: ['id', 'fullName'] },
        ],
        // updatedAt so an old task completed TODAY still makes the window
        // (completion/cancellation bump updatedAt; creation starts equal to it)
        order: [['updatedAt', 'DESC']],
        limit,
      }),
    ]);

    const taskEntries = [];
    for (const task of tasks) {
      const j = task.toJSON();
      taskEntries.push({ kind: 'task', at: j.createdAt, data: { event: 'created', task: j } });
      if (j.status === 'completed' && j.completedAt) {
        taskEntries.push({ kind: 'task', at: j.completedAt, data: { event: 'completed', task: j } });
      }
      if (j.status === 'cancelled') {
        taskEntries.push({ kind: 'task', at: j.updatedAt, data: { event: 'cancelled', task: j } });
      }
    }

    const entries = [
      ...activities.map((a) => ({ kind: 'activity', at: a.occurredAt, data: a })),
      ...stageEvents.map((e) => ({ kind: 'stage', at: e.createdAt, data: e })),
      ...assignmentEvents.map((e) => ({ kind: 'assignment', at: e.createdAt, data: e })),
      ...auditEvents.map((e) => ({ kind: 'audit', at: e.createdAt, data: e })),
      ...taskEntries,
    ].sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, limit);

    return { entries };
  }

  async function logActivityTx(id, body, user, t, { requestId = null, suppressCadenceHooks = false } = {}) {
    if (!ACTIVITY_TYPES.includes(body.type)) throw new AppError('Unknown activity type', 400);
    if (!body.summary || !String(body.summary).trim()) throw new AppError('Summary is required', 400);
    const partner = await getLivePartner(id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!canActOnRow(user, partner) && !hasCapability(user, 'partners.reassign')) {
      // redemption_ops may log notes on any partner (fulfilment context)
      if (!(user.redeemOpsRole === 'redemption_ops' && hasCapability(user, 'activities.log'))) {
        throw new AppError('You can only log activity on businesses you own', 403);
      }
    }

    const meaningful = MEANINGFUL_ACTIVITY_TYPES.includes(body.type);
    const activity = await d.OutreachActivity.create(
      {
        partnerOrganisationId: id,
        contactId: body.contactId || null,
        type: body.type,
        direction: ['outbound', 'inbound', 'internal'].includes(body.direction) ? body.direction : 'outbound',
        summary: String(body.summary).trim(),
        details: body.details || null,
        outcome: body.outcome || null,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
        actorUserId: user.id,
      },
      { transaction: t }
    );
    if (meaningful) {
      await partner.update(
        {
          lastActivityAt: activity.occurredAt,
          firstOutreachAt: partner.firstOutreachAt || activity.occurredAt,
          atRiskFlag: false,
          staleFlag: false,
        },
        { transaction: t }
      );
    }
    // A real inbound reply is a cadence exit signal. The suppress flag exists
    // for the cadence engine itself (P1): the activity IT logs on completion
    // must not re-enter the engine.
    if (meaningful && activity.direction === 'inbound' && !suppressCadenceHooks) {
      await d.fireCadenceHook('onInboundActivity', { partner, activity, user, transaction: t });
    }
    return activity;
  }

  async function logActivity(id, body, user, requestId = null) {
    return d.sequelize.transaction(async (t) => logActivityTx(id, body, user, t, { requestId }));
  }

  async function editActivity(activityId, body, user, requestId = null) {
    const activity = await d.OutreachActivity.findByPk(activityId);
    if (!activity || activity.voidedAt) throw new AppError('Activity not found', 404);
    const isManager = user.role === 'admin' || ['super_admin', 'ops_admin', 'bdm'].includes(user.redeemOpsRole);
    if (!isManager && activity.actorUserId !== user.id) {
      throw new AppError('You can only edit your own activities', 403);
    }
    const updates = {};
    for (const f of ['summary', 'details', 'outcome', 'type', 'direction', 'occurredAt', 'contactId']) {
      if (body[f] !== undefined) updates[f] = body[f];
    }
    if (updates.type && !ACTIVITY_TYPES.includes(updates.type)) throw new AppError('Unknown activity type', 400);
    const before = {};
    for (const k of Object.keys(updates)) before[k] = activity.get(k);

    await d.sequelize.transaction(async (t) => {
      await activity.update({ ...updates, editedAt: new Date(), editedBy: user.id }, { transaction: t });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'activity.edited', entityType: 'outreach_activity',
        entityId: activityId, before, after: updates, requestId, transaction: t,
      });
    });
    return activity;
  }

  async function voidActivity(activityId, user, reason, requestId = null) {
    if (!reason || !String(reason).trim()) throw new AppError('A reason is required to void an activity', 400);
    const activity = await d.OutreachActivity.findByPk(activityId);
    if (!activity || activity.voidedAt) throw new AppError('Activity not found', 404);
    const isManager = user.role === 'admin' || ['super_admin', 'ops_admin', 'bdm'].includes(user.redeemOpsRole);
    if (!isManager && activity.actorUserId !== user.id) {
      throw new AppError('You can only void your own activities', 403);
    }
    await d.sequelize.transaction(async (t) => {
      await activity.update({ voidedAt: new Date(), voidReason: String(reason).trim() }, { transaction: t });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'activity.voided', entityType: 'outreach_activity',
        entityId: activityId, reason: String(reason).trim(), requestId, transaction: t,
      });
    });
    return activity;
  }

  // ── Contacts & locations ─────────────────────────────────────────────────

  async function addContact(id, body, user) {
    const partner = await getLivePartner(id);
    if (!canActOnRow(user, partner)) throw new AppError('You can only edit businesses you own', 403);
    if (!body.name || !String(body.name).trim()) throw new AppError('Contact name is required', 400);
    return d.sequelize.transaction(async (t) => {
      if (body.isPrimary) {
        await d.PartnerContact.update(
          { isPrimary: false },
          { where: { partnerOrganisationId: id }, transaction: t }
        );
      }
      return d.PartnerContact.create(
        {
          partnerOrganisationId: id,
          name: String(body.name).trim(),
          roleTitle: body.roleTitle || null,
          mobile: body.mobile || null,
          whatsapp: body.whatsapp || null,
          email: body.email ? String(body.email).toLowerCase() : null,
          preferredChannel: body.preferredChannel || null,
          isPrimary: !!body.isPrimary,
          notes: body.notes || null,
        },
        { transaction: t }
      );
    });
  }

  async function updateContact(contactId, body, user) {
    const contact = await d.PartnerContact.findByPk(contactId);
    if (!contact || contact.archivedAt) throw new AppError('Contact not found', 404);
    const partner = await getLivePartner(contact.partnerOrganisationId);
    if (!canActOnRow(user, partner)) throw new AppError('You can only edit businesses you own', 403);
    const updates = {};
    for (const f of ['name', 'roleTitle', 'mobile', 'whatsapp', 'email', 'preferredChannel', 'isPrimary', 'notes']) {
      if (body[f] !== undefined) updates[f] = body[f];
    }
    return d.sequelize.transaction(async (t) => {
      if (updates.isPrimary === true) {
        await d.PartnerContact.update(
          { isPrimary: false },
          { where: { partnerOrganisationId: contact.partnerOrganisationId }, transaction: t }
        );
      }
      await contact.update(updates, { transaction: t });
      return contact;
    });
  }

  async function archiveContact(contactId, user) {
    const contact = await d.PartnerContact.findByPk(contactId);
    if (!contact || contact.archivedAt) throw new AppError('Contact not found', 404);
    const partner = await getLivePartner(contact.partnerOrganisationId);
    if (!canActOnRow(user, partner)) throw new AppError('You can only edit businesses you own', 403);
    await contact.update({ archivedAt: new Date(), isPrimary: false });
    return contact;
  }

  async function addLocation(id, body, user) {
    const partner = await getLivePartner(id);
    if (!canActOnRow(user, partner)) throw new AppError('You can only edit businesses you own', 403);
    return d.PartnerLocation.create({
      partnerOrganisationId: id,
      name: body.name || null,
      addressLine: body.addressLine || null,
      postalCode: body.postalCode || null,
      postalDistrict: postalDistrictOf(body.postalCode),
      area: body.area || null,
      phone: body.phone || null,
      isActive: body.isActive !== false,
      notes: body.notes || null,
    });
  }

  async function updateLocation(locationId, body, user) {
    const location = await d.PartnerLocation.findByPk(locationId);
    if (!location) throw new AppError('Location not found', 404);
    const partner = await getLivePartner(location.partnerOrganisationId);
    if (!canActOnRow(user, partner)) throw new AppError('You can only edit businesses you own', 403);
    const updates = {};
    for (const f of ['name', 'addressLine', 'postalCode', 'area', 'phone', 'isActive', 'notes']) {
      if (body[f] !== undefined) updates[f] = body[f];
    }
    if (updates.postalCode !== undefined) updates.postalDistrict = postalDistrictOf(updates.postalCode);
    await location.update(updates);
    return location;
  }

  // ── Merge ────────────────────────────────────────────────────────────────

  /**
   * Merge `duplicateId` INTO `survivorId`. Re-points children, marks the loser
   * merged+archived, preserves all history (brief §14). Extend REPOINT_TARGETS as
   * later phases add child tables (tasks, offers, activations, pool members).
   */
  const REPOINT_TARGETS = () => [
    [d.PartnerContact, 'partnerOrganisationId'],
    [d.PartnerLocation, 'partnerOrganisationId'],
    [d.OutreachActivity, 'partnerOrganisationId'],
    [d.PartnerAssignmentEvent, 'partnerOrganisationId'],
    [d.PartnerStageEvent, 'partnerOrganisationId'],
    [d.OutreachTask, 'partnerOrganisationId'],
  ];

  async function mergePartners(survivorId, duplicateId, user, reason = null, requestId = null) {
    if (survivorId === duplicateId) throw new AppError('Cannot merge a business into itself', 400);
    return d.sequelize.transaction(async (t) => {
      const survivor = await getLivePartner(survivorId, { transaction: t, lock: t.LOCK.UPDATE });
      const duplicate = await getLivePartner(duplicateId, { transaction: t, lock: t.LOCK.UPDATE });

      // Reward supply is financial state tied to the partnered record — merging
      // it silently would break the offers-only-on-PARTNERED invariant. Rare;
      // resolve by hand first.
      const [dupOffers, dupActivations] = await Promise.all([
        d.RewardOffer.count({ where: { partnerOrganisationId: duplicateId }, transaction: t }),
        d.Activation.count({ where: { partnerOrganisationId: duplicateId }, transaction: t }),
      ]);
      if (dupOffers > 0 || dupActivations > 0) {
        throw new AppError('The duplicate has rewards or activations attached — move or end those first, then merge', 409);
      }

      // Cadence hook BEFORE repointing (docs/plans/redeem-ops-cadences.md §5.4):
      // the engine must exit the duplicate's enrollment while its tasks still
      // point at the duplicate, or survivor tasks end up tied to a foreign
      // enrollment.
      await d.fireCadenceHook('onMergeDuplicate', { survivor, duplicate, user, transaction: t });

      for (const [Model, fk] of REPOINT_TARGETS()) {
        await Model.update({ [fk]: survivorId }, { where: { [fk]: duplicateId }, transaction: t });
      }

      // Pool memberships are unique per (pool, partner): repoint the ones the
      // survivor doesn't already hold, drop the collisions.
      const survivorPools = (await d.ProspectingPoolMember.findAll({
        where: { partnerOrganisationId: survivorId }, attributes: ['poolId'], transaction: t, raw: true,
      })).map((r) => r.poolId);
      await d.ProspectingPoolMember.update(
        { partnerOrganisationId: survivorId },
        {
          where: {
            partnerOrganisationId: duplicateId,
            ...(survivorPools.length ? { poolId: { [Op.notIn]: survivorPools } } : {}),
          },
          transaction: t,
        }
      );
      await d.ProspectingPoolMember.destroy({ where: { partnerOrganisationId: duplicateId }, transaction: t });

      // Onboarding items are keyed per partner — the survivor's own checklist
      // governs; the duplicate's rows go with it.
      await d.PartnerOnboardingItem.destroy({ where: { partnerOrganisationId: duplicateId }, transaction: t });

      const duplicateSnapshot = duplicate.toJSON();
      await duplicate.update(
        { mergedIntoId: survivorId, archivedAt: new Date(), ownerUserId: null, availability: 'restricted' },
        { transaction: t }
      );
      await d.PartnerAssignmentEvent.create(
        {
          partnerOrganisationId: survivorId, kind: 'merge',
          actorUserId: user.id, reason: reason || `merged ${duplicateId} into ${survivorId}`,
        },
        { transaction: t }
      );
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'partner.merged', entityType: 'partner_organisation',
        entityId: survivorId, before: { duplicate: duplicateSnapshot }, after: { survivorId },
        reason, requestId, transaction: t,
      });
      return survivor;
    });
  }

  /**
   * Bulk import (CSV rows from the UI): each row goes through the same
   * dedupe-gated createPartner as a manual add — exact duplicates are skipped
   * and counted, failures reported, every created row audited. One request per
   * chunk keeps the public rate limiter out of the picture (review finding:
   * row-per-request importing tripped the 200/15min production cap).
   */
  async function importPartners(rows, user, requestId = null) {
    const results = { created: 0, skipped: 0, failed: 0, errors: [] };
    for (const row of rows) {
      try {
        await createPartner(row, user, requestId);
        results.created += 1;
      } catch (err) {
        if (err.statusCode === 409 || err.status === 409) results.skipped += 1;
        else {
          results.failed += 1;
          if (results.errors.length < 5) {
            results.errors.push(`${row.tradingName || 'Row'}: ${err.message}`);
          }
        }
      }
    }
    return results;
  }

  /**
   * Hard-delete a mistakenly created business (docs case: typo duplicate with
   * no history). Guarded: PARTNERED rows and anything carrying reward offers
   * or activations are refused (the DB backs this with ON DELETE RESTRICT) —
   * merge or disqualify those instead. Children (contacts, locations, events,
   * activities, tasks, pool memberships) cascade at the DB level. The audit
   * row is written in the same transaction, before the destroy.
   */
  async function deletePartner(id, user, requestId = null) {
    return d.sequelize.transaction(async (t) => {
      const partner = await getLivePartner(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (partner.pipelineStage === 'PARTNERED') {
        throw new AppError('Partnered businesses cannot be deleted — merge duplicates or disqualify instead', 409);
      }
      const [offers, activations] = await Promise.all([
        d.RewardOffer.count({ where: { partnerOrganisationId: id }, transaction: t }),
        d.Activation.count({ where: { partnerOrganisationId: id }, transaction: t }),
      ]);
      if (offers > 0 || activations > 0) {
        throw new AppError('This business has rewards or activations attached — it cannot be deleted', 409);
      }
      const snapshot = partner.toJSON();
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'partner.deleted', entityType: 'partner_organisation',
        entityId: id, before: snapshot, after: null, requestId, transaction: t,
      });
      await partner.destroy({ transaction: t });
      return snapshot;
    });
  }

  return {
    listPartners, getPartner, createPartner, updatePartner, changeStage, undoStageChange,
    snoozePartner, unsnoozePartner,
    importPartners, getTimeline, logActivity, editActivity, voidActivity,
    addContact, updateContact, archiveContact, addLocation, updateLocation,
    mergePartners, deletePartner, canActOnRow,
    // P0 caller-transaction primitives (cadence engine + composed flows)
    changeStageTx, snoozePartnerTx, unsnoozePartnerTx, logActivityTx,
  };
}

const _default = makePartnerService();
export default _default;
