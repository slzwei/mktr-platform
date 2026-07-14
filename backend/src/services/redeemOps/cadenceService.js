import { Op, QueryTypes } from 'sequelize';
import {
  OutreachCadence, OutreachCadenceStep, OutreachCadenceTransition, OutreachCadenceEnrollment,
  OutreachSuppression, OutreachTask, PartnerOrganisation, PartnerContact, PartnerLocation,
  User, sequelize,
} from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { hasCapability } from './permissions.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { makeTaskService } from './taskService.js';
import { makePartnerService } from './partnerService.js';
import { normalizePhone } from '../prospectHelpers.js';
import {
  CHANNEL_DISPOSITIONS, CADENCE_TERMINAL_DISPOSITIONS, CADENCE_WILDCARD_DISPOSITION,
  CADENCE_CHANNELS, CADENCE_TIME_WINDOWS, TASK_PRIORITIES, LOST_REASONS,
} from './constants.js';

/**
 * Cadence engine (docs/plans/redeem-ops-cadences.md §5) — the generator the
 * outreach layer was missing: reps decide what to say, the engine decides when
 * and what's next. Advance is SYNCHRONOUS inside completeCadenceTask's
 * transaction (lock order enrollment → partner → task); the reconcile tick only
 * repairs faults. Exits ride the P0 hook registry, registered from bootstrap.
 */

const WINDOW_START_SGT = { any: 10, morning: 9.5, afternoon: 15, off_peak: 15 };
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
const RECONCILE_LOCK_KEY = 9157001;

/**
 * Schedule a step: `anchor + delayDays` on the SGT calendar, clamped into the
 * window's start hour. Never due-in-the-past: a delay-0 step whose window
 * already passed is due NOW (same-day branches like "WhatsApp after a 6pm
 * no-answer call" must not slip to tomorrow); a delayed step rolls forward a
 * day. No weekend skip — F&B merchants trade weekends.
 */
export function sgtWindowClamp(anchor, delayDays, timeWindow, now = new Date()) {
  const startHour = WINDOW_START_SGT[timeWindow] ?? WINDOW_START_SGT.any;
  const hours = Math.floor(startHour);
  const minutes = Math.round((startHour - hours) * 60);

  const atWindow = (base, plusDays) => {
    const sgt = new Date(base.getTime() + SGT_OFFSET_MS);
    return new Date(
      Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate() + plusDays, hours, minutes) - SGT_OFFSET_MS
    );
  };

  let due = atWindow(anchor, delayDays);
  if (due.getTime() > now.getTime()) return due;
  if (delayDays === 0) return new Date(now);
  // A rolled-forward day can still be in the past if the anchor is old
  // (reconciler repairs, resumes) — walk forward until it isn't.
  due = atWindow(anchor, delayDays + 1);
  let guard = 0;
  while (due.getTime() <= now.getTime() && guard < 366) {
    due = atWindow(due, 1);
    guard += 1;
  }
  return due;
}

const DISPOSITION_LABELS = {
  connected: 'connected', no_answer: 'no answer', sent: 'sent', replied: 'replied',
  not_interested: 'not interested', met: 'met in person', closed: 'outlet closed', done: 'done',
};

/** Honest activity for each (channel, disposition) — §5.2.5. */
export function activityForDisposition(channel, disposition) {
  if (disposition === 'replied') {
    const type = { whatsapp: 'whatsapp_reply', email: 'email_reply', call: 'call_connected', instagram_dm: 'instagram_dm' }[channel] || 'follow_up';
    return { type, direction: 'inbound' };
  }
  if (disposition === 'not_interested') {
    const map = {
      call: { type: 'call_connected', direction: 'outbound' },
      whatsapp: { type: 'whatsapp_reply', direction: 'inbound' },
      email: { type: 'email_reply', direction: 'inbound' },
      instagram_dm: { type: 'instagram_dm', direction: 'inbound' },
      visit: { type: 'visit', direction: 'outbound' },
    };
    return map[channel] || { type: 'follow_up', direction: 'outbound' };
  }
  switch (channel) {
    case 'call': return { type: disposition === 'connected' ? 'call_connected' : 'call_attempt', direction: 'outbound' };
    case 'whatsapp': return { type: 'whatsapp_sent', direction: 'outbound' };
    case 'email': return { type: 'email_sent', direction: 'outbound' };
    case 'instagram_dm': return { type: 'instagram_dm', direction: 'outbound' };
    case 'visit': return { type: 'visit', direction: 'outbound' };
    default: return { type: 'follow_up', direction: 'outbound' };
  }
}

const CHANNEL_TASK_TYPE = {
  call: 'call', whatsapp: 'follow_up', email: 'follow_up',
  instagram_dm: 'follow_up', visit: 'other', custom: 'other',
};

export function makeCadenceService(overrides = {}) {
  const d = {
    OutreachCadence, OutreachCadenceStep, OutreachCadenceTransition, OutreachCadenceEnrollment,
    OutreachSuppression, OutreachTask, PartnerOrganisation, PartnerContact, PartnerLocation,
    User, sequelize, logger,
    audit: makeRedeemOpsAuditService(),
    tasks: makeTaskService(),
    partners: makePartnerService(),
    enrollmentCap: parseInt(process.env.REDEEM_OPS_CADENCE_CAP, 10) || 60,
    now: () => new Date(),
    ...overrides,
  };

  const isManager = (user) =>
    user.role === 'admin' || ['super_admin', 'ops_admin', 'bdm'].includes(user.redeemOpsRole);

  const canActOnPartner = (user, partner) => isManager(user) || partner.ownerUserId === user.id;

  // Drafts (publishedAt NULL) are private to their creator + admins. "Admins"
  // = the settings.manage tier — the set that could author everything before
  // drafts existed. bdm manages partners, not other people's unfinished work.
  const isCadenceAdmin = (user) => hasCapability(user, 'settings.manage');
  const canSeeCadence = (user, cadence) =>
    !!cadence.publishedAt || (!!user && (isCadenceAdmin(user) || cadence.createdBy === user.id));
  const canAuthorRow = (user, cadence) => isCadenceAdmin(user) || cadence.createdBy === user.id;

  // ── Definition lookup ──────────────────────────────────────────────────────

  async function listCadences({ includeRetired = false, forUser = null } = {}) {
    // No forUser (internal callers) = the safe view: published only.
    const draftScope = forUser && isCadenceAdmin(forUser)
      ? {}
      : { [Op.or]: [{ publishedAt: { [Op.ne]: null } }, ...(forUser ? [{ createdBy: forUser.id }] : [])] };
    return d.OutreachCadence.findAll({
      where: { ...(includeRetired ? {} : { isActive: true }), ...draftScope },
      include: [
        { model: d.OutreachCadenceStep, as: 'steps' },
        { model: d.OutreachCadenceTransition, as: 'transitions' },
      ],
      order: [['key', 'ASC'], ['version', 'DESC'], [{ model: d.OutreachCadenceStep, as: 'steps' }, 'stepOrder', 'ASC']],
    });
  }

  // ── Definition authoring (builder — docs/plans/redeem-ops-cadences.md §8.5) ──
  //
  // The builder speaks a LINEAR dialect: an ordered step list where each step
  // carries its own delay/window and a single `continueOn` disposition that
  // advances to the next step; everything else finishes (terminal dispositions
  // are engine-level). That compiles losslessly onto the edge model — and both
  // seeded cadences are expressible in it, so the editor can round-trip them.

  function validateBuilderDefinition(def) {
    const name = String(def.name || '').trim();
    if (!name || name.length > 120) throw new AppError('A cadence name (max 120 chars) is required', 400);
    const rawSteps = Array.isArray(def.steps) ? def.steps : [];
    if (rawSteps.length < 1 || rawSteps.length > 20) {
      throw new AppError('A cadence needs between 1 and 20 steps', 400);
    }
    const steps = rawSteps.map((s, i) => {
      const channel = String(s.channel || '');
      if (!CADENCE_CHANNELS.includes(channel)) throw new AppError(`Step ${i + 1}: unknown channel`, 400);
      const title = String(s.title || '').trim();
      if (!title || title.length > 160) throw new AppError(`Step ${i + 1}: a title (max 160 chars) is required`, 400);
      const delayDays = Number.parseInt(s.delayDays, 10);
      if (!Number.isInteger(delayDays) || delayDays < 0 || delayDays > 60) {
        throw new AppError(`Step ${i + 1}: delay must be 0–60 days`, 400);
      }
      const timeWindow = s.timeWindow || 'any';
      if (!CADENCE_TIME_WINDOWS.includes(timeWindow)) throw new AppError(`Step ${i + 1}: unknown time window`, 400);
      const priority = s.priority || 'medium';
      if (!TASK_PRIORITIES.includes(priority)) throw new AppError(`Step ${i + 1}: unknown priority`, 400);
      const isLast = i === rawSteps.length - 1;
      let continueOn = null;
      if (!isLast) {
        continueOn = s.continueOn || (channel === 'call' ? 'no_answer' : CADENCE_WILDCARD_DISPOSITION);
        const allowed = [...(CHANNEL_DISPOSITIONS[channel] || []), CADENCE_WILDCARD_DISPOSITION]
          .filter((x) => !CADENCE_TERMINAL_DISPOSITIONS.includes(x));
        if (!allowed.includes(continueOn)) {
          throw new AppError(`Step ${i + 1}: '${continueOn}' cannot advance a ${channel} step`, 400);
        }
      }
      return {
        channel, title, continueOn, delayDays, timeWindow, priority,
        script: s.script ? String(s.script).slice(0, 5000) : null,
      };
    });
    return { name, description: def.description ? String(def.description).slice(0, 2000) : null, steps };
  }

  async function insertDefinitionTx({ key, version, name, description, steps, publishedAt = null }, user, t) {
    const cadence = await d.OutreachCadence.create({
      key, version, name, description, publishedAt, createdBy: user.id,
    }, { transaction: t });
    const created = [];
    for (let i = 0; i < steps.length; i += 1) {
      created.push(await d.OutreachCadenceStep.create({
        cadenceId: cadence.id, stepOrder: i + 1, channel: steps[i].channel,
        title: steps[i].title, scriptTemplate: steps[i].script, priority: steps[i].priority,
      }, { transaction: t }));
    }
    await d.OutreachCadenceTransition.create({
      cadenceId: cadence.id, fromStepId: null, disposition: CADENCE_WILDCARD_DISPOSITION,
      toStepId: created[0].id, delayDays: steps[0].delayDays, timeWindow: steps[0].timeWindow,
    }, { transaction: t });
    for (let i = 0; i < steps.length - 1; i += 1) {
      await d.OutreachCadenceTransition.create({
        cadenceId: cadence.id, fromStepId: created[i].id, disposition: steps[i].continueOn,
        toStepId: created[i + 1].id, delayDays: steps[i + 1].delayDays, timeWindow: steps[i + 1].timeWindow,
      }, { transaction: t });
    }
    return cadence;
  }

  function slugifyKey(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 56) || 'cadence';
  }

  async function createCadence(def, user, requestId = null) {
    const norm = validateBuilderDefinition(def);
    // publish defaults TRUE (pre-draft behavior); a draft is the explicit opt-in.
    const publishedAt = def.publish === false ? null : d.now();
    return d.sequelize.transaction(async (t) => {
      await d.sequelize.query('SELECT pg_advisory_xact_lock(9157002)', { transaction: t });
      let key = slugifyKey(norm.name);
      const clashes = await d.OutreachCadence.count({ where: { key }, transaction: t });
      if (clashes > 0) key = `${key}_${Date.now().toString(36)}`.slice(0, 64);
      const cadence = await insertDefinitionTx({ ...norm, key, version: 1, publishedAt }, user, t);
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'cadence.created', entityType: 'outreach_cadence',
        entityId: cadence.id, after: { key, name: norm.name, steps: norm.steps.length, draft: !publishedAt },
        requestId, transaction: t,
      });
      return cadence;
    });
  }

  /**
   * Editing = a NEW version of the same key; every active row of the key is
   * retired in the same transaction. Live enrollments keep the version they
   * started on (they FK the old row); the picker only offers active versions.
   */
  async function createCadenceVersion(cadenceId, def, user, requestId = null) {
    const norm = validateBuilderDefinition(def);
    return d.sequelize.transaction(async (t) => {
      await d.sequelize.query('SELECT pg_advisory_xact_lock(9157002)', { transaction: t });
      const base = await d.OutreachCadence.findByPk(cadenceId, { transaction: t, lock: t.LOCK.UPDATE });
      // Invisible draft = same 404 as missing, so its existence never leaks.
      if (!base || !canSeeCadence(user, base)) throw new AppError('Cadence not found', 404);
      if (!canAuthorRow(user, base)) {
        throw new AppError('Only the creator or an admin can edit this cadence', 403);
      }
      // Draft-ness carries over; publish:true flips a draft live at save time.
      // Once published there is no unpublish — the team may already rely on it.
      const publishedAt = base.publishedAt || (def.publish === true ? d.now() : null);
      const latest = await d.OutreachCadence.max('version', { where: { key: base.key }, transaction: t });
      await d.OutreachCadence.update(
        { isActive: false },
        { where: { key: base.key, isActive: true }, transaction: t }
      );
      const cadence = await insertDefinitionTx({ ...norm, key: base.key, version: latest + 1, publishedAt }, user, t);
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'cadence.version_created', entityType: 'outreach_cadence',
        entityId: cadence.id,
        before: { version: base.version }, after: { version: latest + 1, name: norm.name, steps: norm.steps.length },
        requestId, transaction: t,
      });
      return cadence;
    });
  }

  async function retireCadence(cadenceId, user, requestId = null) {
    return d.sequelize.transaction(async (t) => {
      const cadence = await d.OutreachCadence.findByPk(cadenceId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!cadence || !canSeeCadence(user, cadence)) throw new AppError('Cadence not found', 404);
      if (!canAuthorRow(user, cadence)) {
        throw new AppError('Only the creator or an admin can retire this cadence', 403);
      }
      if (!cadence.isActive) return cadence;
      await cadence.update({ isActive: false }, { transaction: t });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'cadence.retired', entityType: 'outreach_cadence',
        entityId: cadence.id, after: { key: cadence.key, version: cadence.version },
        requestId, transaction: t,
      });
      return cadence;
    });
  }

  /** Publish a draft team-wide. Creator or admin; idempotent; no unpublish. */
  async function publishCadence(cadenceId, user, requestId = null) {
    return d.sequelize.transaction(async (t) => {
      const cadence = await d.OutreachCadence.findByPk(cadenceId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!cadence || !canSeeCadence(user, cadence)) throw new AppError('Cadence not found', 404);
      if (!canAuthorRow(user, cadence)) {
        throw new AppError('Only the creator or an admin can publish this cadence', 403);
      }
      if (!cadence.isActive) throw new AppError('A retired version cannot be published', 409);
      if (cadence.publishedAt) return cadence;
      await cadence.update({ publishedAt: d.now() }, { transaction: t });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'cadence.published', entityType: 'outreach_cadence',
        entityId: cadence.id, after: { key: cadence.key, version: cadence.version },
        requestId, transaction: t,
      });
      return cadence;
    });
  }

  async function resolveCadenceTx({ cadenceId, cadenceKey }, user, t) {
    // Drafts resolve only for their creator + admins — same 404 as a missing
    // cadence so their existence never leaks to peers.
    const visible = (c) => c && c.isActive && canSeeCadence(user, c);
    if (cadenceId) {
      const cadence = await d.OutreachCadence.findByPk(cadenceId, { transaction: t });
      if (!visible(cadence)) throw new AppError('Cadence not found or retired', 404);
      return cadence;
    }
    if (cadenceKey) {
      const cadence = await d.OutreachCadence.findOne({
        where: { key: cadenceKey, isActive: true },
        order: [['version', 'DESC']],
        transaction: t,
      });
      if (!visible(cadence)) throw new AppError('Cadence not found or retired', 404);
      return cadence;
    }
    throw new AppError('cadenceId or cadenceKey is required', 400);
  }

  async function resolveTransitionTx(cadenceId, fromStepId, disposition, t) {
    const base = { cadenceId, fromStepId: fromStepId ?? null };
    const exact = await d.OutreachCadenceTransition.findOne({ where: { ...base, disposition }, transaction: t });
    if (exact) return exact;
    if (disposition === CADENCE_WILDCARD_DISPOSITION) return null;
    return d.OutreachCadenceTransition.findOne({
      where: { ...base, disposition: CADENCE_WILDCARD_DISPOSITION }, transaction: t,
    });
  }

  // ── Materialization (§5.3) ────────────────────────────────────────────────

  async function resolveRecipientTx(partner, channel, t) {
    if (channel === 'custom') return { recipient: null, ok: true };
    const contacts = await d.PartnerContact.findAll({
      where: { partnerOrganisationId: partner.id, archivedAt: null },
      order: [['isPrimary', 'DESC'], ['createdAt', 'ASC']],
      transaction: t,
    });
    const primary = contacts[0] || null;
    if (channel === 'call' || channel === 'whatsapp') {
      const phone = primary?.whatsapp || primary?.mobile
        || contacts.find((c) => c.mobile || c.whatsapp)?.mobile
        || partner.primaryPhone;
      return phone ? { recipient: String(phone), ok: true, contactId: primary?.id || null } : { ok: false, reason: 'no_phone' };
    }
    if (channel === 'email') {
      const email = primary?.email || contacts.find((c) => c.email)?.email || partner.primaryEmail;
      return email ? { recipient: String(email).toLowerCase(), ok: true, contactId: primary?.id || null } : { ok: false, reason: 'no_email' };
    }
    if (channel === 'instagram_dm') {
      return partner.instagramHandle
        ? { recipient: `@${String(partner.instagramHandle).replace(/^@/, '')}`, ok: true }
        : { ok: false, reason: 'no_instagram_handle' };
    }
    if (channel === 'visit') {
      const location = await d.PartnerLocation.findOne({
        where: { partnerOrganisationId: partner.id, isActive: true },
        order: [['createdAt', 'ASC']],
        transaction: t,
      });
      return location
        ? { recipient: [location.name, location.addressLine].filter(Boolean).join(', ').slice(0, 160) || 'registered outlet', ok: true }
        : { ok: false, reason: 'no_active_location' };
    }
    return { ok: false, reason: 'unknown_channel' };
  }

  async function isSuppressedTx(channel, recipient, t) {
    if (!recipient || !['call', 'whatsapp', 'email'].includes(channel)) return false;
    const value = channel === 'email' ? recipient.toLowerCase() : (normalizePhone(recipient) || recipient);
    const hit = await d.OutreachSuppression.findOne({
      where: {
        channel: { [Op.in]: [channel, 'any'] },
        value,
        [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: d.now() } }],
      },
      transaction: t,
    });
    return !!hit;
  }

  /** Allowlisted plain-text merge — an unresolved token blocks the step. */
  function renderTemplate(template, ctx) {
    if (!template) return { text: null, ok: true };
    const text = template.replace(/{{\s*([a-z_]+)\s*}}/gi, (m, key) => {
      const k = key.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ctx, k) ? String(ctx[k] ?? '') : m;
    });
    return /{{[^}]+}}/.test(text) ? { ok: false } : { text, ok: true };
  }

  async function tryMaterializeTx(enrollment, partner, step, timing, actorUser, t) {
    if (!partner.ownerUserId) return { blocked: true, reason: 'partner_unowned' };
    const resolved = await resolveRecipientTx(partner, step.channel, t);
    if (!resolved.ok) return { blocked: true, reason: resolved.reason };
    if (await isSuppressedTx(step.channel, resolved.recipient, t)) {
      return { blocked: true, reason: 'suppressed' };
    }

    const primaryContact = resolved.contactId
      ? await d.PartnerContact.findByPk(resolved.contactId, { attributes: ['id', 'name'], transaction: t })
      : null;
    const rendered = renderTemplate(step.scriptTemplate, {
      partner_name: partner.tradingName || partner.brandName || partner.legalName || 'there',
      contact_name: primaryContact?.name || 'there',
      category: partner.category || '',
      recipient: resolved.recipient || '',
    });
    if (!rendered.ok) return { blocked: true, reason: 'unresolved_template' };

    const dueAt = sgtWindowClamp(d.now(), timing.delayDays, timing.timeWindow, d.now());
    // System contexts (sweep resume, reconciler) have no acting user — the
    // partner owner stands in: they're the assignee anyway, so the row rules
    // in createTaskTx pass without a manager check.
    const actor = actorUser || { id: partner.ownerUserId };
    const task = await d.tasks.createTaskTx({
      title: step.title,
      partnerOrganisationId: partner.id,
      contactId: resolved.contactId || null,
      assigneeUserId: partner.ownerUserId,
      dueAt,
      priority: step.priority || 'medium',
      type: CHANNEL_TASK_TYPE[step.channel] || 'other',
      description: rendered.text || null,
    }, actor, t);
    // Provenance rides a second write so taskService stays cadence-agnostic;
    // the partial unique index (one open task per enrollment) bites HERE.
    await task.update({
      cadenceEnrollmentId: enrollment.id,
      cadenceStepId: step.id,
      snapshotRecipient: resolved.recipient || null,
    }, { transaction: t });
    return { task };
  }

  /**
   * Land the enrollment on `step` (materialize its task), chaining through
   * blocked steps via their '*' edges; finishes the enrollment if the chain
   * runs out (§5.3).
   */
  async function placeAtStepTx(enrollment, partner, step, timing, actorUser, t) {
    let cur = step;
    let curTiming = timing;
    let guard = 0;
    while (cur) {
      const mat = await tryMaterializeTx(enrollment, partner, cur, curTiming, actorUser, t);
      if (!mat.blocked) {
        await enrollment.update({ currentStepId: cur.id }, { transaction: t });
        return { task: mat.task, step: cur };
      }
      await d.audit.recordAuditEvent({
        actorUser, actorType: actorUser ? 'staff' : 'system', action: 'cadence.step_blocked',
        entityType: 'outreach_cadence_enrollment', entityId: enrollment.id,
        after: { stepId: cur.id, stepTitle: cur.title, reason: mat.reason }, transaction: t,
      });
      if (mat.reason === 'partner_unowned') {
        await endEnrollmentTx(enrollment, { state: 'exited', exitReason: 'released' }, actorUser, t);
        return { finished: true, reason: mat.reason };
      }
      const edge = await resolveTransitionTx(enrollment.cadenceId, cur.id, CADENCE_WILDCARD_DISPOSITION, t);
      if (!edge || !edge.toStepId) {
        await endEnrollmentTx(enrollment, { state: 'completed', exitReason: 'finished' }, actorUser, t);
        return { finished: true, reason: mat.reason };
      }
      cur = await d.OutreachCadenceStep.findByPk(edge.toStepId, { transaction: t });
      curTiming = { delayDays: edge.delayDays, timeWindow: edge.timeWindow };
      guard += 1;
      if (guard > 30) throw new AppError('Cadence step chain exceeded limit', 500);
    }
    return { finished: true };
  }

  // ── Enrollment lifecycle ──────────────────────────────────────────────────

  async function endEnrollmentTx(enrollment, { state, exitReason }, actorUser, t) {
    await d.OutreachTask.update(
      { status: 'cancelled' },
      {
        where: { cadenceEnrollmentId: enrollment.id, status: { [Op.in]: ['open', 'in_progress'] } },
        transaction: t,
      }
    );
    await enrollment.update({ state, exitReason, endedAt: d.now() }, { transaction: t });
    await d.tasks.recomputeNextTaskAt(enrollment.partnerOrganisationId, t);
    await d.audit.recordAuditEvent({
      actorUser, actorType: actorUser ? 'staff' : 'system', action: 'cadence.ended',
      entityType: 'outreach_cadence_enrollment', entityId: enrollment.id,
      after: { state, exitReason }, transaction: t,
    });
    return enrollment;
  }

  async function liveEnrollmentForPartnerTx(partnerId, t, { states = ['active', 'paused'] } = {}) {
    return d.OutreachCadenceEnrollment.findOne({
      where: { partnerOrganisationId: partnerId, state: { [Op.in]: states } },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
  }

  async function enrollPartner(partnerId, { cadenceId, cadenceKey, overrideCapacity = false }, user, requestId = null) {
    return d.sequelize.transaction(async (t) => {
      const partner = await d.PartnerOrganisation.findByPk(partnerId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!partner || partner.mergedIntoId || partner.archivedAt) throw new AppError('Partner not found', 404);
      if (!partner.ownerUserId) throw new AppError('Claim the business first — cadence tasks need an owner to be assigned to', 409);
      if (!canActOnPartner(user, partner)) throw new AppError('You can only enroll businesses you own', 403);
      if (['PARTNERED', 'LOST'].includes(partner.pipelineStage)) {
        throw new AppError(`A ${partner.pipelineStage === 'LOST' ? 'Lost' : 'Partnered'} business cannot be enrolled — revive it first`, 409);
      }

      const cadence = await resolveCadenceTx({ cadenceId, cadenceKey }, user, t);

      const existing = await liveEnrollmentForPartnerTx(partnerId, t);
      if (existing) throw new AppError('This business is already in a cadence', 409);

      // Per-owner capacity — serialized via an advisory xact lock so two
      // concurrent enrollments cannot both squeeze under the cap (§5.1).
      await d.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:k))', {
        replacements: { k: `cadence-cap:${partner.ownerUserId}` }, transaction: t,
      });
      const liveCount = await d.OutreachCadenceEnrollment.count({
        where: { state: { [Op.in]: ['active', 'paused'] } },
        include: [{
          model: d.PartnerOrganisation, as: 'partner', attributes: [],
          where: { ownerUserId: partner.ownerUserId },
        }],
        transaction: t,
      });
      if (liveCount >= d.enrollmentCap && !(overrideCapacity && isManager(user))) {
        throw new AppError(
          `Cap reached: ${liveCount} businesses already in cadences for this owner (max ${d.enrollmentCap}). Finish or stop some first.`,
          409
        );
      }

      const enrollment = await d.OutreachCadenceEnrollment.create({
        cadenceId: cadence.id, partnerOrganisationId: partnerId, enrolledBy: user.id,
      }, { transaction: t });

      const entry = await resolveTransitionTx(cadence.id, null, CADENCE_WILDCARD_DISPOSITION, t);
      if (!entry || !entry.toStepId) throw new AppError('Cadence has no entry step — definition is broken', 500);
      const firstStep = await d.OutreachCadenceStep.findByPk(entry.toStepId, { transaction: t });
      const placed = await placeAtStepTx(
        enrollment, partner, firstStep,
        { delayDays: entry.delayDays, timeWindow: entry.timeWindow }, user, t
      );

      await d.audit.recordAuditEvent({
        actorUser: user, action: 'cadence.enrolled', entityType: 'outreach_cadence_enrollment',
        entityId: enrollment.id,
        after: { cadenceKey: cadence.key, version: cadence.version, partnerId, capacityOverride: !!overrideCapacity },
        requestId, transaction: t,
      });
      return { enrollment, cadence, firstTask: placed.task || null, finishedImmediately: !!placed.finished };
    });
  }

  // ── Completion — the linearizable core (§5.2) ─────────────────────────────

  async function completeCadenceTask(taskId, { disposition, alsoMarkLost = false, lostReason = null }, user, requestId = null) {
    return d.sequelize.transaction(async (t) => {
      // Non-locking probe for ids only. GLOBAL lock order is partner →
      // enrollment → task: the P0 hooks fire inside transactions that already
      // hold the partner lock, so every other path must take it first too.
      const probe = await d.OutreachTask.findByPk(taskId, {
        attributes: ['id', 'cadenceEnrollmentId', 'partnerOrganisationId'], transaction: t,
      });
      if (!probe) throw new AppError('Task not found', 404);
      if (!probe.cadenceEnrollmentId) {
        throw new AppError('Not a cadence task — complete it through the normal task update', 400);
      }

      const partner = await d.PartnerOrganisation.findByPk(probe.partnerOrganisationId, {
        transaction: t, lock: t.LOCK.UPDATE,
      });
      if (!partner || partner.mergedIntoId) throw new AppError('Partner not found', 404);

      const enrollment = await d.OutreachCadenceEnrollment.findByPk(probe.cadenceEnrollmentId, {
        transaction: t, lock: t.LOCK.UPDATE,
      });
      if (!enrollment) throw new AppError('Enrollment not found', 404);
      if (enrollment.state !== 'active') {
        throw new AppError(`This cadence is ${enrollment.state} — the task is no longer actionable`, 409);
      }

      const task = await d.OutreachTask.findByPk(taskId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!['open', 'in_progress'].includes(task.status)) {
        throw new AppError('This task was already completed or cancelled', 409);
      }
      if (enrollment.currentStepId !== task.cadenceStepId) {
        throw new AppError('This task is no longer the cadence’s current step — refresh', 409);
      }
      if (!isManager(user) && task.assigneeUserId !== user.id) {
        throw new AppError('You can only complete your own tasks', 403);
      }

      const step = await d.OutreachCadenceStep.findByPk(task.cadenceStepId, { transaction: t });
      const valid = CHANNEL_DISPOSITIONS[step.channel] || [];
      if (!valid.includes(disposition)) {
        throw new AppError(`'${disposition}' is not a valid outcome for a ${step.channel} step`, 400);
      }
      if (alsoMarkLost && !LOST_REASONS.includes(lostReason || 'not_interested')) {
        throw new AppError('Unknown lost reason', 400);
      }

      // 1. Complete the task (direct — the generic PATCH path refuses cadence tasks).
      await task.update({ status: 'completed', completedAt: d.now(), completedBy: user.id }, { transaction: t });

      // 2. Log the honest activity. Suppressed hooks: the engine handles its own
      //    exits below — this activity must not re-enter it.
      const mapped = activityForDisposition(step.channel, disposition);
      await d.partners.logActivityTx(partner.id, {
        type: mapped.type,
        direction: mapped.direction,
        summary: `${step.title} — ${DISPOSITION_LABELS[disposition] || disposition}`,
        contactId: task.contactId || null,
      }, user, t, { suppressCadenceHooks: true, requestId });

      await enrollment.update({ lastDisposition: disposition }, { transaction: t });

      // 3. Terminal dispositions end the enrollment; the stage move (if asked
      //    for) happens in the SAME transaction so no contradictory half-state
      //    can survive a crash (§5.2.6).
      let nextTask = null;
      if (CADENCE_TERMINAL_DISPOSITIONS.includes(disposition)) {
        const exitReason = disposition === 'replied' ? 'replied' : 'not_interested';
        await endEnrollmentTx(enrollment, { state: 'exited', exitReason }, user, t);
        if (disposition === 'not_interested' && alsoMarkLost) {
          await d.partners.changeStageTx(partner.id, 'LOST', user, t, {
            lostReason: lostReason || 'not_interested', requestId,
          });
        }
      } else {
        const edge = await resolveTransitionTx(enrollment.cadenceId, step.id, disposition, t);
        if (!edge || !edge.toStepId) {
          await endEnrollmentTx(enrollment, { state: 'completed', exitReason: 'finished' }, user, t);
        } else {
          const nextStep = await d.OutreachCadenceStep.findByPk(edge.toStepId, { transaction: t });
          const placed = await placeAtStepTx(
            enrollment, partner, nextStep,
            { delayDays: edge.delayDays, timeWindow: edge.timeWindow }, user, t
          );
          nextTask = placed.task || null;
        }
      }

      await d.tasks.recomputeNextTaskAt(partner.id, t);
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'cadence.task_completed', entityType: 'outreach_task',
        entityId: taskId, after: { disposition, enrollmentState: enrollment.state }, requestId, transaction: t,
      });

      return { task, enrollment, nextTask };
    });
  }

  // ── Manual pause / resume / stop (partner-scoped; pause ≠ snooze §5.4) ───

  async function withOwnedLiveEnrollment(partnerId, user, states, fn) {
    return d.sequelize.transaction(async (t) => {
      // partner → enrollment (global lock order)
      const partner = await d.PartnerOrganisation.findByPk(partnerId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!partner || partner.mergedIntoId) throw new AppError('Partner not found', 404);
      if (!canActOnPartner(user, partner)) throw new AppError('You can only manage cadences on businesses you own', 403);
      const enrollment = await liveEnrollmentForPartnerTx(partnerId, t, { states });
      if (!enrollment) throw new AppError('No live cadence on this business', 404);
      return fn(enrollment, partner, t);
    });
  }

  async function pauseEnrollment(partnerId, user, requestId = null) {
    return withOwnedLiveEnrollment(partnerId, user, ['active'], async (enrollment, partner, t) => {
      await d.OutreachTask.update(
        { status: 'cancelled' },
        { where: { cadenceEnrollmentId: enrollment.id, status: { [Op.in]: ['open', 'in_progress'] } }, transaction: t }
      );
      await enrollment.update({ state: 'paused', pausedAt: d.now() }, { transaction: t });
      await d.tasks.recomputeNextTaskAt(partnerId, t);
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'cadence.paused', entityType: 'outreach_cadence_enrollment',
        entityId: enrollment.id, requestId, transaction: t,
      });
      return enrollment;
    });
  }

  async function resumeEnrollmentTx(enrollment, partner, actorUser, t) {
    await enrollment.update({ state: 'active', pausedAt: null }, { transaction: t });
    const step = await d.OutreachCadenceStep.findByPk(enrollment.currentStepId, { transaction: t });
    if (!step) {
      return endEnrollmentTx(enrollment, { state: 'completed', exitReason: 'finished' }, actorUser, t);
    }
    await placeAtStepTx(enrollment, partner, step, { delayDays: 0, timeWindow: 'any' }, actorUser, t);
    await d.audit.recordAuditEvent({
      actorUser, actorType: actorUser ? 'staff' : 'system', action: 'cadence.resumed',
      entityType: 'outreach_cadence_enrollment', entityId: enrollment.id, transaction: t,
    });
    return enrollment;
  }

  async function resumeEnrollment(partnerId, user, requestId = null) {
    return withOwnedLiveEnrollment(partnerId, user, ['paused'], (enrollment, partner, t) =>
      resumeEnrollmentTx(enrollment, partner, user, t));
  }

  async function stopEnrollment(partnerId, user, requestId = null) {
    return withOwnedLiveEnrollment(partnerId, user, ['active', 'paused'], (enrollment, partner, t) =>
      endEnrollmentTx(enrollment, { state: 'exited', exitReason: 'manual_stop' }, user, t));
  }

  // ── Read model for the UI card ────────────────────────────────────────────

  async function getPartnerCadence(partnerId) {
    const live = await d.OutreachCadenceEnrollment.findOne({
      where: { partnerOrganisationId: partnerId, state: { [Op.in]: ['active', 'paused'] } },
      include: [
        { model: d.OutreachCadence, as: 'cadence', include: [{ model: d.OutreachCadenceStep, as: 'steps' }] },
        { model: d.OutreachCadenceStep, as: 'currentStep' },
      ],
    });
    const enrollment = live || await d.OutreachCadenceEnrollment.findOne({
      where: { partnerOrganisationId: partnerId },
      include: [
        { model: d.OutreachCadence, as: 'cadence', include: [{ model: d.OutreachCadenceStep, as: 'steps' }] },
        { model: d.OutreachCadenceStep, as: 'currentStep' },
      ],
      order: [['createdAt', 'DESC']],
    });
    if (!enrollment) return { enrollment: null, openTask: null };
    const openTask = await d.OutreachTask.findOne({
      where: { cadenceEnrollmentId: enrollment.id, status: { [Op.in]: ['open', 'in_progress'] } },
    });
    const json = enrollment.toJSON();
    if (json.cadence?.steps) json.cadence.steps.sort((a, b) => a.stepOrder - b.stepOrder);
    return { enrollment: json, openTask };
  }

  // ── Hook handlers (registered from bootstrap — §5.4) ─────────────────────

  async function exitLiveForPartnerTx(partnerId, exitReason, actorUser, t) {
    const enrollment = await liveEnrollmentForPartnerTx(partnerId, t);
    if (!enrollment) return null;
    return endEnrollmentTx(enrollment, { state: 'exited', exitReason }, actorUser, t);
  }

  function hookHandlers() {
    return {
      onInboundActivity: ({ partner, user, transaction }) =>
        exitLiveForPartnerTx(partner.id, 'replied', user, transaction),
      onStageChange: async ({ partner, toStage, user, transaction }) => {
        if (['MEETING', 'PROPOSAL', 'PARTNERED'].includes(toStage)) {
          await exitLiveForPartnerTx(partner.id, 'stage_advanced', user, transaction);
        } else if (toStage === 'LOST') {
          await exitLiveForPartnerTx(partner.id, 'lost', user, transaction);
        }
      },
      onSnooze: async ({ partner, user, transaction: t }) => {
        const enrollment = await liveEnrollmentForPartnerTx(partner.id, t, { states: ['active'] });
        if (!enrollment) return;
        await d.OutreachTask.update(
          { status: 'cancelled' },
          { where: { cadenceEnrollmentId: enrollment.id, status: { [Op.in]: ['open', 'in_progress'] } }, transaction: t }
        );
        await enrollment.update({ state: 'paused', pausedAt: d.now() }, { transaction: t });
        await d.tasks.recomputeNextTaskAt(partner.id, t);
      },
      onUnsnooze: async ({ partner, partnerId, user, transaction }) => {
        const pid = partner?.id || partnerId;
        const run = async (t) => {
          const enrollment = await liveEnrollmentForPartnerTx(pid, t, { states: ['paused'] });
          if (!enrollment) return;
          const p = await d.PartnerOrganisation.findByPk(pid, { transaction: t, lock: t.LOCK.UPDATE });
          if (!p || p.mergedIntoId || p.archivedAt) return;
          await resumeEnrollmentTx(enrollment, p, user || null, t);
        };
        // Sweep wake arrives without a transaction — open our own.
        if (transaction) return run(transaction);
        return d.sequelize.transaction(run);
      },
      onRelease: ({ partnerId, user, transaction }) =>
        exitLiveForPartnerTx(partnerId, 'released', user, transaction),
      onReassign: async ({ partner, toUserId, transaction: t }) => {
        const enrollment = await liveEnrollmentForPartnerTx(partner.id, t);
        if (!enrollment) return;
        await d.OutreachTask.update(
          { assigneeUserId: toUserId },
          { where: { cadenceEnrollmentId: enrollment.id, status: { [Op.in]: ['open', 'in_progress'] } }, transaction: t }
        );
      },
      // BEFORE task repointing (P0 ordering) — the duplicate's cadence dies with it.
      onMergeDuplicate: ({ duplicate, user, transaction }) =>
        exitLiveForPartnerTx(duplicate.id, 'merged', user, transaction),
    };
  }

  // ── Reconcile tick (§5.6) — fault repair only ─────────────────────────────

  async function reconcile() {
    return d.sequelize.transaction(async (t) => {
      const [[{ locked }]] = await d.sequelize.query(
        `SELECT pg_try_advisory_xact_lock(${RECONCILE_LOCK_KEY}) AS locked`, { transaction: t }
      );
      if (!locked) return { skipped: true };

      let repaired = 0;
      let resumed = 0;

      // Candidate scans take NO row locks — per-candidate repair re-locks in
      // the global partner → enrollment order and re-validates under lock.

      // (a) paused enrollments whose partner is awake — the sweep-wake hook
      //     failed or crashed mid-way; finish the resume it owed.
      const strandedPaused = await d.sequelize.query(
        `SELECT e.id, e."partnerOrganisationId" AS pid FROM outreach_cadence_enrollments e
           JOIN partner_organisations p ON p.id = e."partnerOrganisationId"
          WHERE e.state = 'paused' AND e."pausedAt" < NOW() - INTERVAL '10 minutes'
            AND p.availability NOT IN ('follow_up_later')
            AND p."archivedAt" IS NULL AND p."mergedIntoId" IS NULL
            AND p."ownerUserId" IS NOT NULL
          LIMIT 50`,
        { transaction: t, type: QueryTypes.SELECT }
      );
      for (const row of strandedPaused) {
        const partner = await d.PartnerOrganisation.findByPk(row.pid, { transaction: t, lock: t.LOCK.UPDATE });
        const enrollment = await d.OutreachCadenceEnrollment.findByPk(row.id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!partner || !enrollment || enrollment.state !== 'paused' || partner.availability === 'follow_up_later') continue;
        await resumeEnrollmentTx(enrollment, partner, null, t);
        resumed += 1;
      }

      // (b) active enrollments with no open task and no recent write — a fault
      //     (deliberate stops are 'exited', engine advances are atomic).
      const orphans = await d.sequelize.query(
        `SELECT e.id, e."partnerOrganisationId" AS pid FROM outreach_cadence_enrollments e
           JOIN partner_organisations p ON p.id = e."partnerOrganisationId"
          WHERE e.state = 'active' AND e."updatedAt" < NOW() - INTERVAL '15 minutes'
            AND p."archivedAt" IS NULL AND p."mergedIntoId" IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM outreach_tasks ot
               WHERE ot."cadenceEnrollmentId" = e.id AND ot.status IN ('open', 'in_progress'))
          LIMIT 50`,
        { transaction: t, type: QueryTypes.SELECT }
      );
      for (const row of orphans) {
        const partner = await d.PartnerOrganisation.findByPk(row.pid, { transaction: t, lock: t.LOCK.UPDATE });
        const enrollment = await d.OutreachCadenceEnrollment.findByPk(row.id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!partner || !enrollment || enrollment.state !== 'active') continue;
        const hasOpen = await d.OutreachTask.count({
          where: { cadenceEnrollmentId: enrollment.id, status: { [Op.in]: ['open', 'in_progress'] } },
          transaction: t,
        });
        if (hasOpen > 0) continue;
        if (!partner.ownerUserId) {
          await endEnrollmentTx(enrollment, { state: 'exited', exitReason: 'released' }, null, t);
        } else {
          const step = await d.OutreachCadenceStep.findByPk(enrollment.currentStepId, { transaction: t });
          if (!step) {
            await endEnrollmentTx(enrollment, { state: 'completed', exitReason: 'finished' }, null, t);
          } else {
            await placeAtStepTx(enrollment, partner, step, { delayDays: 0, timeWindow: 'any' }, null, t);
          }
        }
        repaired += 1;
      }

      if (repaired > 0 || resumed > 0) {
        d.logger.info('redeem_ops.cadence.reconcile.done', { repaired, resumed });
      }
      return { repaired, resumed };
    });
  }

  return {
    listCadences, createCadence, createCadenceVersion, retireCadence, publishCadence,
    enrollPartner, completeCadenceTask,
    pauseEnrollment, resumeEnrollment, stopEnrollment,
    getPartnerCadence, hookHandlers, reconcile,
    // exported for tests
    sgtWindowClamp, activityForDisposition, validateBuilderDefinition,
  };
}

const _default = makeCadenceService();
export default _default;
