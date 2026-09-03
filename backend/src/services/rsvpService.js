import { Op, Sequelize } from 'sequelize';
import { sequelize, RsvpEvent, RsvpResponse } from '../models/index.js';
import { AppError } from '../middleware/appError.js';
import { UUID_PARAM_RE } from '../middleware/uuidParam.js';
import { logger } from '../utils/logger.js';
import {
  clampLayout, defaultLayout, layoutProblems, publicLayout, consentTemplateOf,
  isValidRsvpSlug, slugProblem, RSVP_SLUG_RE, LIMITS, sanitizeText,
} from '../utils/rsvpLayout.js';
import { buildSubmissionSchema, buildAnswersSchema, sanitizeAnswers, parseClosesAt, pickSourceMetadata } from '../utils/rsvpAnswers.js';
import { toCsv } from '../utils/csv.js';
import { CURRENT_RSVP_CONSENT_VERSION, resolveRsvpConsent, renderRsvpConsentCopy, hashConsentCopy } from './rsvpConsentRegistry.js';
import { emailNormKey } from './repeatSignup.js';
import { normalizePhone } from './prospectHelpers.js';

/**
 * RSVP pages (docs/plans/rsvp-pages.md §5). Admin CRUD + lifecycle, the public
 * read, and the submit transaction. Every layout write goes through the clamp;
 * every public read goes through publicLayout (rebuild, never dump).
 *
 * Lifecycle (§5.2): draft → 404 to the public; published + open → form DTO;
 * published but closed / past closesAt / full → an unavailable DTO with the
 * page chrome (a shared link must never turn into a mysterious 404).
 *
 * Capacity (§5.3): the event row is locked FOR UPDATE for the whole submit,
 * `going` rows are counted under that lock, and the unique (event, email)
 * index is the backstop. No derived counter anywhere.
 */

const GOING_COUNT_SQL = `(SELECT COUNT(*) FROM rsvp_responses r WHERE r."rsvpEventId" = "RsvpEvent"."id" AND r.status = 'going')`;
const RESPONSE_COUNT_SQL = `(SELECT COUNT(*) FROM rsvp_responses r WHERE r."rsvpEventId" = "RsvpEvent"."id")`;
const COUNT_ATTRS = {
  include: [
    [Sequelize.literal(GOING_COUNT_SQL), 'goingCount'],
    [Sequelize.literal(RESPONSE_COUNT_SQL), 'responseCount'],
  ],
};

function typed(status, code, message, extra = {}) {
  const err = new AppError(message, status);
  err.data = { code, ...extra };
  return err;
}

const num = (v) => Number(v || 0);

function toAdminDto(row, { withLayout = false } = {}) {
  const goingCount = num(row.get('goingCount'));
  const responseCount = num(row.get('responseCount'));
  const dto = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    organiserName: row.organiserName,
    status: row.status,
    capacity: row.capacity,
    closesAt: row.closesAt,
    consentVersion: row.consentVersion,
    retentionUntil: row.retentionUntil,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    goingCount,
    responseCount,
    // Field key/type/options are immutable and undeletable once anyone has responded.
    frozen: responseCount > 0,
    // Slug + organiser are immutable once published (links are out, copy was seen).
    locked: Boolean(row.publishedAt),
  };
  if (withLayout) {
    dto.layout = row.layout;
    const custom = consentTemplateOf(row.layout);
    dto.consent = {
      version: row.consentVersion,
      // Rendered from the event's own template when it has one, else the era default.
      copy: renderRsvpConsentCopy(row.consentVersion, row.organiserName, custom),
      custom,
      defaultTemplate: resolveRsvpConsent(row.consentVersion)?.template || resolveRsvpConsent(CURRENT_RSVP_CONSENT_VERSION)?.template || '',
    };
    dto.problems = publishProblems(row);
  }
  return dto;
}

function toResponseDto(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    answers: row.answers,
    status: row.status,
    consentVersion: row.consentVersion,
    consentCopyHash: row.consentCopyHash,
    consentCopy: row.consentCopy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadEvent(id, { transaction } = {}) {
  const row = await RsvpEvent.findByPk(id, { attributes: COUNT_ATTRS, transaction });
  if (!row) throw typed(404, 'not_found', 'RSVP event not found');
  return row;
}

/** Slug rules (§7): shape + reserved roots + uniqueness. Typed so the designer can explain. */
async function assertSlugFree(slug, excludeId) {
  const problem = slugProblem(slug);
  if (problem) throw typed(400, `slug_${problem}`, problem === 'reserved' ? 'That slug is reserved' : 'Slug must be 3–40 lowercase letters, digits or hyphens');
  const where = { slug, ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) };
  const taken = await RsvpEvent.findOne({ where, attributes: ['id'] });
  if (taken) throw typed(409, 'slug_taken', 'That slug is already in use');
}

export async function checkSlugAvailability(slug, { excludeEventId } = {}) {
  const problem = slugProblem(slug);
  if (problem) return { slug, available: false, reason: problem };
  const where = { slug, ...(excludeEventId ? { id: { [Op.ne]: excludeEventId } } : {}) };
  const taken = await RsvpEvent.findOne({ where, attributes: ['id'] });
  return { slug, available: !taken, reason: taken ? 'taken' : null };
}

function publishProblems(row) {
  const problems = [];
  if (!row.slug) problems.push('slug_missing');
  else if (!isValidRsvpSlug(row.slug)) problems.push('slug_invalid');
  if (!row.organiserName) problems.push('organiser_missing');
  problems.push(...layoutProblems(row.layout));
  return problems;
}

// ───────────────────────────── admin ─────────────────────────────

export async function listEvents() {
  const rows = await RsvpEvent.findAll({ attributes: COUNT_ATTRS, order: [['createdAt', 'DESC']] });
  return rows.map((r) => toAdminDto(r));
}

export async function getEvent(id) {
  return toAdminDto(await loadEvent(id), { withLayout: true });
}

export async function createEvent(input, user) {
  const title = sanitizeText(input.title, LIMITS.title);
  if (!title) throw typed(400, 'title_required', 'Title is required');
  const organiserName = sanitizeText(input.organiserName, LIMITS.title);
  const slug = typeof input.slug === 'string' && input.slug.trim() ? input.slug.trim() : null;
  if (slug) await assertSlugFree(slug);
  const row = await RsvpEvent.create({
    title,
    organiserName,
    slug,
    status: 'draft',
    layout: defaultLayout(),
    capacity: null,
    closesAt: null,
    consentVersion: CURRENT_RSVP_CONSENT_VERSION,
    createdBy: user.id,
  });
  return getEvent(row.id);
}

export async function updateEvent(id, patch) {
  const row = await loadEvent(id);
  const locked = Boolean(row.publishedAt);
  const responseCount = num(row.get('responseCount'));
  const changes = {};

  if ('title' in patch) {
    const title = sanitizeText(patch.title, LIMITS.title);
    if (!title) throw typed(400, 'title_required', 'Title is required');
    changes.title = title;
  }
  if ('organiserName' in patch) {
    const organiserName = sanitizeText(patch.organiserName, LIMITS.title);
    if (organiserName !== row.organiserName) {
      if (locked) throw typed(409, 'organiser_frozen', 'The organiser name is fixed once the event is published');
      changes.organiserName = organiserName;
    }
  }
  if ('slug' in patch) {
    const slug = typeof patch.slug === 'string' && patch.slug.trim() ? patch.slug.trim() : null;
    if (slug !== row.slug) {
      if (locked) throw typed(409, 'slug_frozen', 'The link is fixed once the event is published');
      if (slug) await assertSlugFree(slug, row.id);
      changes.slug = slug;
    }
  }
  if ('capacity' in patch) {
    const c = patch.capacity;
    if (c === null) changes.capacity = null;
    else if (Number.isInteger(c) && c >= 1) changes.capacity = c;
    else throw typed(400, 'capacity_invalid', 'Capacity must be a whole number of at least 1, or empty');
  }
  if ('closesAt' in patch) {
    const d = parseClosesAt(patch.closesAt);
    if (d === undefined) throw typed(400, 'closes_at_invalid', 'closesAt must be an ISO date-time (an SGT wall time is accepted without an offset)');
    changes.closesAt = d;
  }
  if ('retentionUntil' in patch) {
    const d = parseClosesAt(patch.retentionUntil);
    if (d === undefined) throw typed(400, 'retention_invalid', 'retentionUntil must be an ISO date-time (an SGT wall time is accepted without an offset)');
    changes.retentionUntil = d;
  }
  if ('layout' in patch) {
    changes.layout = clampLayout(patch.layout, { frozen: responseCount > 0 ? row.layout?.fields : null });
  }

  if (Object.keys(changes).length > 0) await row.update(changes);
  return getEvent(row.id);
}

export async function publishEvent(id) {
  const row = await loadEvent(id);
  const problems = publishProblems(row);
  if (problems.length > 0) throw typed(422, 'not_publishable', 'The event is not ready to publish', { problems });
  await row.update({
    status: 'published',
    publishedAt: row.publishedAt || new Date(),
    // The era in force NOW governs every response from here; each response
    // stamps its own copy of it, so re-publishing after a wording change is safe.
    consentVersion: CURRENT_RSVP_CONSENT_VERSION,
  });
  logger.info({ rsvpEventId: row.id, slug: row.slug }, 'rsvp.event.published');
  return getEvent(row.id);
}

export async function closeEvent(id) {
  const row = await loadEvent(id);
  if (row.status !== 'published') throw typed(409, 'not_published', 'Only a published event can be closed');
  await row.update({ status: 'closed' });
  return getEvent(row.id);
}

/** Drafts nobody has responded to may be deleted; anything else waits for the purge path (§8.4, P3). */
export async function deleteEvent(id) {
  const row = await loadEvent(id);
  if (row.status !== 'draft' || num(row.get('responseCount')) > 0) {
    throw typed(409, 'delete_refused', 'Only an unpublished draft with no responses can be deleted');
  }
  await row.destroy();
  return { deleted: true };
}

/**
 * Irreversible purge (§8.4): the event row and, by CASCADE, every response —
 * the only intended trigger of that cascade. Refused while published (close
 * first); audited with actor, reason and the row count it took.
 */
export async function purgeEvent(id, { actorId, reason }) {
  const row = await loadEvent(id);
  if (row.status === 'published') throw typed(409, 'purge_refused', 'Close the event before purging it');
  const responseCount = num(row.get('responseCount'));
  await row.destroy();
  logger.warn({ rsvpEventId: id, slug: row.slug, responseCount, actorId, reason }, 'rsvp.event.purged');
  return { purged: true, responseCount };
}

/** Retention sweep: closed/draft events past retentionUntil go the same way. Published ones wait to be closed. */
export async function purgeExpiredEvents(now = new Date()) {
  const rows = await RsvpEvent.findAll({
    where: { retentionUntil: { [Op.lte]: now }, status: { [Op.ne]: 'published' } },
    attributes: COUNT_ATTRS,
  });
  let purged = 0;
  for (const row of rows) {
    const responseCount = num(row.get('responseCount'));
    await row.destroy();
    purged++;
    logger.warn({ rsvpEventId: row.id, slug: row.slug, responseCount, retentionUntil: row.retentionUntil }, 'rsvp.event.purged_by_retention');
  }
  return { purged };
}

// Cursor = base64url(anchor row id). The (createdAt, id) tuple comparison runs
// INSIDE Postgres against the anchor's own row: a JS Date is millisecond-
// precise, timestamptz is microsecond-precise, so an ISO timestamp in the
// cursor re-admits the anchor row on the next page (caught by the routes test).
const encodeCursor = (row) => Buffer.from(row.id, 'utf8').toString('base64url');
function decodeCursor(cursor) {
  try {
    const id = Buffer.from(String(cursor), 'base64url').toString('utf8');
    return UUID_PARAM_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function listResponses(eventId, { cursor, limit } = {}) {
  await loadEvent(eventId);
  const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const where = { rsvpEventId: eventId };
  if (cursor) {
    const anchorId = decodeCursor(cursor);
    const anchor = anchorId
      ? await RsvpResponse.findOne({ where: { id: anchorId, rsvpEventId: eventId }, attributes: ['id'] })
      : null;
    if (!anchor) throw typed(400, 'cursor_invalid', 'Invalid cursor');
    // anchorId is regex-validated as a uuid above — safe to inline.
    where[Op.and] = [Sequelize.literal(
      `("RsvpResponse"."createdAt", "RsvpResponse"."id") > (SELECT a."createdAt", a.id FROM rsvp_responses a WHERE a.id = '${anchorId}')`
    )];
  }
  const rows = await RsvpResponse.findAll({
    where,
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
    limit: size + 1,
  });
  const page = rows.slice(0, size);
  return {
    responses: page.map(toResponseDto),
    nextCursor: rows.length > size ? encodeCursor(page[page.length - 1]) : null,
  };
}

/** Responses beyond this many rows are not exported (documented ceiling, §5.1). */
export const RESPONSES_EXPORT_CEILING = 5000;

const BUILTIN_KEYS = ['name', 'email', 'phone'];

function formatAnswer(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join('; ');
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return v;
}

/** One CSV of every response, custom answers as columns headed by their labels. */
export async function exportResponsesCsv(eventId) {
  const event = await loadEvent(eventId);
  const custom = (Array.isArray(event.layout?.fields) ? event.layout.fields : []).filter((f) => !BUILTIN_KEYS.includes(f.key));
  const rows = await RsvpResponse.findAll({
    where: { rsvpEventId: eventId },
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
    limit: RESPONSES_EXPORT_CEILING,
  });
  const columns = [
    { name: 'name', get: (r) => r.name },
    { name: 'email', get: (r) => r.email },
    { name: 'phone', get: (r) => r.phone || '' },
    { name: 'status', get: (r) => r.status },
    ...custom.map((f) => ({ name: f.label || f.key, get: (r) => formatAnswer(r.answers?.[f.key]) })),
    { name: 'consent_version', get: (r) => r.consentVersion },
    { name: 'consent_copy', get: (r) => r.consentCopy || '' },
    { name: 'submitted_at', get: (r) => (r.createdAt ? r.createdAt.toISOString() : '') },
    { name: 'updated_at', get: (r) => (r.updatedAt ? r.updatedAt.toISOString() : '') },
  ];
  return {
    filename: `rsvp-${event.slug || event.id}-responses.csv`,
    csv: toCsv(columns, rows),
    truncated: rows.length >= RESPONSES_EXPORT_CEILING,
  };
}

/**
 * Admin correction / cancellation of one attendee (§8.4). Email is the dedupe
 * key and stays immutable; custom answers are re-validated against the
 * event's own field defs as a whole (existing merged with the patch), so a
 * correction can never store what the form could not; reactivating a
 * cancelled seat needs a free seat, checked under the event lock like a
 * submit. The consent stamp is untouched by construction.
 */
export async function updateResponse(eventId, responseId, patch) {
  return sequelize.transaction(async (t) => {
    const event = await RsvpEvent.findByPk(eventId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!event) throw typed(404, 'not_found', 'RSVP event not found');
    const row = await RsvpResponse.findOne({ where: { id: responseId, rsvpEventId: eventId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!row) throw typed(404, 'not_found', 'Response not found');
    if ('email' in patch) throw typed(400, 'email_immutable', "The email address is the attendee's identity for this event and cannot be edited");

    const changes = {};
    if ('name' in patch) {
      const name = sanitizeText(patch.name, 120);
      if (!name) throw typed(400, 'invalid', 'Name is required');
      changes.name = name;
    }
    if ('phone' in patch) {
      changes.phone = typeof patch.phone === 'string' && patch.phone.trim() ? String(normalizePhone(patch.phone.trim())).slice(0, 24) : null;
    }
    if ('answers' in patch) {
      const fields = (Array.isArray(event.layout?.fields) ? event.layout.fields : []).filter((f) => !BUILTIN_KEYS.includes(f.key));
      const merged = { ...(row.answers || {}), ...(patch.answers && typeof patch.answers === 'object' ? patch.answers : {}) };
      const { error, value } = buildAnswersSchema(fields).validate(merged, { abortEarly: false });
      if (error) throw validationError(error);
      changes.answers = sanitizeAnswers(fields, value);
    }
    if ('status' in patch && patch.status !== row.status) {
      if (patch.status === 'going' && event.capacity != null) {
        const going = await RsvpResponse.count({ where: { rsvpEventId: event.id, status: 'going' }, transaction: t });
        if (going >= event.capacity) throw typed(409, 'full', 'This event is full');
      }
      changes.status = patch.status;
    }
    if (Object.keys(changes).length > 0) {
      await row.update(changes, { transaction: t, fields: [...Object.keys(changes), 'updatedAt'] });
    }
    return toResponseDto(row);
  });
}

// ───────────────────────────── public ─────────────────────────────

function publicState(row, now = Date.now()) {
  if (row.status === 'closed') return 'closed';
  if (row.closesAt && row.closesAt.getTime() <= now) return 'ended';
  if (row.capacity != null && num(row.get('goingCount')) >= row.capacity) return 'full';
  return 'open';
}

/** null = 404 (unknown, draft, or never published). Otherwise the state DTO. */
export async function getPublicEvent(slug) {
  if (typeof slug !== 'string' || !RSVP_SLUG_RE.test(slug)) return null;
  const row = await RsvpEvent.findOne({ where: { slug }, attributes: COUNT_ATTRS });
  if (!row || row.status === 'draft' || !row.publishedAt) return null;
  const state = publicState(row);
  return {
    slug: row.slug,
    title: row.title,
    organiserName: row.organiserName,
    state,
    closesAt: row.closesAt,
    layout: publicLayout(row.layout),
    ...(state === 'open' ? { consent: currentConsent(row) } : {}),
  };
}

/** What the confirmation email needs, detached from the row (the txn is over by then). */
const eventSnapshot = (row) => ({ id: row.id, title: row.title, slug: row.slug, organiserName: row.organiserName, layout: row.layout });

/** The sentence an attendee sees right now + its hash — what the page echoes back and what a response stamps. */
function currentConsent(row) {
  const copy = renderRsvpConsentCopy(row.consentVersion, row.organiserName, consentTemplateOf(row.layout));
  return { version: row.consentVersion, copy, hash: hashConsentCopy(copy) };
}

function validationError(joiError) {
  const errors = joiError.details.map((d) => ({ field: d.path.join('.'), message: d.message }));
  return typed(400, 'invalid', 'Validation Error', { errors });
}

/**
 * The submit transaction. Returns { created, reactivated } or { ignored } for
 * a honeypot hit (the caller answers 200 either way — bots learn nothing).
 */
export async function submitResponse(slug, body, { referrer } = {}) {
  if (typeof slug !== 'string' || !RSVP_SLUG_RE.test(slug)) throw typed(404, 'not_found', 'Event not found');
  return sequelize.transaction(async (t) => {
    const event = await RsvpEvent.findOne({ where: { slug }, transaction: t, lock: t.LOCK.UPDATE });
    if (!event || event.status === 'draft' || !event.publishedAt) throw typed(404, 'not_found', 'Event not found');
    if (event.status === 'closed') throw typed(409, 'closed', 'This event is no longer taking RSVPs');
    if (event.closesAt && event.closesAt.getTime() <= Date.now()) throw typed(409, 'ended', 'RSVPs for this event have closed');

    const fields = Array.isArray(event.layout?.fields) ? event.layout.fields : [];
    const { error, value } = buildSubmissionSchema(fields).validate(body, { abortEarly: false });
    if (error) throw validationError(error);
    if (value.website) return { ignored: true };

    const answers = sanitizeAnswers(fields, value.answers);
    const emailNormalized = emailNormKey(answers.email);
    const name = typeof answers.name === 'string' ? answers.name : '';
    if (!emailNormalized || !name) throw typed(400, 'invalid', 'Validation Error', { errors: [{ field: 'answers', message: 'name and email are required' }] });
    const phone = typeof answers.phone === 'string' && answers.phone ? String(normalizePhone(answers.phone)).slice(0, 24) : null;
    const { name: _n, email: _e, phone: _p, ...customAnswers } = answers;

    const era = resolveRsvpConsent(event.consentVersion);
    if (!era) throw new AppError(`Unknown RSVP consent era ${event.consentVersion}`, 500);
    const consent = currentConsent(event);
    // The page echoes the hash of the sentence it displayed. A mismatch means the
    // wording changed under the attendee: refuse and hand back the current copy.
    if (value.consentHash && value.consentHash !== consent.hash) {
      throw typed(409, 'consent_changed', 'The consent wording was updated. Please read it again and resubmit.', { consent });
    }

    const capacity = event.capacity;
    const going = await RsvpResponse.count({ where: { rsvpEventId: event.id, status: 'going' }, transaction: t });
    const existing = await RsvpResponse.findOne({ where: { rsvpEventId: event.id, emailNormalized }, transaction: t, lock: t.LOCK.UPDATE });

    if (existing) {
      const reactivated = existing.status !== 'going';
      if (reactivated && capacity != null && going >= capacity) throw typed(409, 'full', 'This event is full');
      // Consent columns are deliberately absent from `fields`: write-once evidence.
      await existing.update(
        { name, email: answers.email, phone, answers: customAnswers, status: 'going' },
        { transaction: t, fields: ['name', 'email', 'phone', 'answers', 'status', 'updatedAt'] }
      );
      return { created: false, reactivated, id: existing.id, notify: { event: eventSnapshot(event), response: { email: answers.email, name }, updated: !reactivated } };
    }

    if (capacity != null && going >= capacity) throw typed(409, 'full', 'This event is full');
    const row = await RsvpResponse.create({
      rsvpEventId: event.id,
      name,
      email: answers.email,
      emailNormalized,
      phone,
      answers: customAnswers,
      status: 'going',
      consentVersion: event.consentVersion,
      consentCopyHash: consent.hash,
      consentCopy: consent.copy,
      sourceMetadata: pickSourceMetadata(value.source, referrer),
    }, { transaction: t });
    return { created: true, reactivated: false, id: row.id, notify: { event: eventSnapshot(event), response: { email: answers.email, name }, updated: false } };
  }).catch((err) => {
    // The event lock serialises same-email submits, so this is belt-and-braces.
    if (err?.name === 'SequelizeUniqueConstraintError') throw typed(409, 'duplicate', 'You have already responded — please try again');
    throw err;
  });
}
