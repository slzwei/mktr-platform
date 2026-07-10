import { Op } from 'sequelize';
import {
  PartnerOrganisation, PartnerLocation, PartnerContact, PartnerAssignmentEvent,
  PartnerStageEvent, OutreachActivity, RewardOffer, Activation, RedeemOpsAuditEvent,
  User, sequelize,
} from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { makeDedupeService } from './dedupeService.js';
import { hasCapability } from './permissions.js';
import { deriveMatchingKeys, postalDistrictOf } from './normalizers.js';
import {
  PIPELINE_STAGES, STAGE_TRANSITIONS, PARTNER_AVAILABILITY,
  ACTIVITY_TYPES, MEANINGFUL_ACTIVITY_TYPES,
} from './constants.js';
import { makeOnboardingService } from './onboardingService.js';

/**
 * Partner CRM core (docs/redeem-ops/ERD.md §3.1–3.6, brief §13–§18).
 * Row-level "own" scoping lives HERE (not in middleware): outreach_execs act only
 * on partners they own; managers (bdm/ops_admin/super_admin/admin) act on any.
 */
export function makePartnerService(overrides = {}) {
  const d = {
    PartnerOrganisation, PartnerLocation, PartnerContact, PartnerAssignmentEvent,
    PartnerStageEvent, OutreachActivity, RewardOffer, Activation, RedeemOpsAuditEvent,
    User, sequelize, logger,
    audit: makeRedeemOpsAuditService(),
    dedupe: makeDedupeService(),
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
          category: body.category || null,
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
        after: { name: displayNameOf(body), category: body.category || null },
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

  async function changeStage(id, toStage, user, reason = null, requestId = null) {
    if (!PIPELINE_STAGES.includes(toStage)) throw new AppError('Unknown stage', 400);
    const partner = await getLivePartner(id);
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
    // to EVERYONE incl. admins): a close must record who agreed and how to reach
    // them — at least one active contact, plus a phone or email somewhere on the
    // record. Everything else (terms, outlets, launch) belongs to the onboarding
    // checklist that seeding kicks off below.
    if (toStage === 'PARTNERED') {
      const contacts = await d.PartnerContact.findAll({
        where: { partnerOrganisationId: id, archivedAt: null },
        attributes: ['id', 'mobile', 'email'],
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

    const availability =
      toStage === 'FOLLOW_UP_LATER' ? 'follow_up_later'
      : toStage === 'DISQUALIFIED' ? 'disqualified'
      : partner.ownerUserId ? 'owned' : 'available';

    await d.sequelize.transaction(async (t) => {
      await partner.update({ pipelineStage: toStage, availability, staleFlag: false }, { transaction: t });
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
    });
    return partner;
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
    const partner = await getLivePartner(id);
    if (!canActOnRow(user, partner)) {
      throw new AppError('You can only move businesses you own', 403);
    }
    const last = await d.PartnerStageEvent.findOne({
      where: { partnerOrganisationId: id },
      order: [['createdAt', 'DESC']],
    });
    if (!last || !last.fromStage || last.toStage !== partner.pipelineStage) {
      throw new AppError('Nothing to undo', 400);
    }
    if (last.actorUserId !== user.id) {
      throw new AppError('Only the person who made the move can undo it', 403);
    }
    if (Date.now() - new Date(last.createdAt).getTime() > 5 * 60 * 1000) {
      throw new AppError('The undo window (5 minutes) has passed', 400);
    }

    const fromStage = partner.pipelineStage;
    const toStage = last.fromStage;
    const availability =
      toStage === 'FOLLOW_UP_LATER' ? 'follow_up_later'
      : toStage === 'DISQUALIFIED' ? 'disqualified'
      : partner.ownerUserId ? 'owned' : 'available';

    await d.sequelize.transaction(async (t) => {
      await partner.update({ pipelineStage: toStage, availability }, { transaction: t });
      await d.PartnerStageEvent.create(
        { partnerOrganisationId: id, fromStage, toStage, actorUserId: user.id, reason: 'undo' },
        { transaction: t }
      );
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'stage.undone', entityType: 'partner_organisation',
        entityId: id, before: { stage: fromStage }, after: { stage: toStage },
        reason: 'undo', requestId, transaction: t,
      });
    });
    return partner;
  }

  async function getTimeline(id, query = {}) {
    await getLivePartner(id, { attributes: ['id', 'mergedIntoId'] });
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
    const [activities, stageEvents, assignmentEvents, auditEvents] = await Promise.all([
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
          action: { [Op.in]: ['partner.created', 'partner.edited'] },
        },
        include: [{ model: d.User, as: 'actor', attributes: ['id', 'fullName'] }],
        order: [['createdAt', 'DESC']],
        limit,
      }),
    ]);

    const entries = [
      ...activities.map((a) => ({ kind: 'activity', at: a.occurredAt, data: a })),
      ...stageEvents.map((e) => ({ kind: 'stage', at: e.createdAt, data: e })),
      ...assignmentEvents.map((e) => ({ kind: 'assignment', at: e.createdAt, data: e })),
      ...auditEvents.map((e) => ({ kind: 'audit', at: e.createdAt, data: e })),
    ].sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, limit);

    return { entries };
  }

  async function logActivity(id, body, user, requestId = null) {
    if (!ACTIVITY_TYPES.includes(body.type)) throw new AppError('Unknown activity type', 400);
    if (!body.summary || !String(body.summary).trim()) throw new AppError('Summary is required', 400);
    const partner = await getLivePartner(id);
    if (!canActOnRow(user, partner) && !hasCapability(user, 'partners.reassign')) {
      // redemption_ops may log notes on any partner (fulfilment context)
      if (!(user.redeemOpsRole === 'redemption_ops' && hasCapability(user, 'activities.log'))) {
        throw new AppError('You can only log activity on businesses you own', 403);
      }
    }

    const meaningful = MEANINGFUL_ACTIVITY_TYPES.includes(body.type);
    return d.sequelize.transaction(async (t) => {
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
      return activity;
    });
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
  ];

  async function mergePartners(survivorId, duplicateId, user, reason = null, requestId = null) {
    if (survivorId === duplicateId) throw new AppError('Cannot merge a business into itself', 400);
    return d.sequelize.transaction(async (t) => {
      const survivor = await getLivePartner(survivorId, { transaction: t, lock: t.LOCK.UPDATE });
      const duplicate = await getLivePartner(duplicateId, { transaction: t, lock: t.LOCK.UPDATE });

      for (const [Model, fk] of REPOINT_TARGETS()) {
        await Model.update({ [fk]: survivorId }, { where: { [fk]: duplicateId }, transaction: t });
      }

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
    getTimeline, logActivity, editActivity, voidActivity,
    addContact, updateContact, archiveContact, addLocation, updateLocation,
    mergePartners, deletePartner, canActOnRow,
  };
}

const _default = makePartnerService();
export default _default;
