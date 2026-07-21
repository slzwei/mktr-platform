import { sequelize, Cohort, Campaign } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

/**
 * Cohort builder (tracker "cohortapi", docs/plans/cohort-builder-backend.md).
 *
 * A cohort DEFINITION selects consumers by what they did (campaigns, draws,
 * campaign tags, prospect-level attributes); resolution then splits the
 * matched population into reachable vs excluded-with-reasons through the
 * SAME semantics as consentService.canMarketTo — granted ∧ verified latest
 * contact event in scope, no marketing suppression, not erased — plus the
 * binding 18+ age gate (consent doc §9.5-2) and, for concrete channels, a
 * destination check (an email push cannot reach a person with no email).
 *
 * INVARIANTS (Codex review round 1 dispositioned in the plan doc §10):
 *  - Nothing here widens consent reads. canMarketToBatch reproduces
 *    canMarketTo exactly over the consumerId domain (same scope rule, same
 *    three-key tie-break, same channel matching, no destination or age
 *    logic) and cohortService.test.js proves the equivalence per person,
 *    including forced timestamp ties. If canMarketTo's semantics ever
 *    change, that parity suite is the tripwire — and the batch SQL should
 *    then be folded INTO consentService (kept apart today only to stay off
 *    files carried by in-flight parallel work).
 *  - Fail-closed: resolution errors THROW (no partial audiences), unknown
 *    consumers report not_found, a dob that is missing/garbled/not a real
 *    calendar date excludes with age_unknown, and ANY valid dob claiming
 *    the person is under 18 disqualifies them (age_conflict) no matter how
 *    many adult dobs their other signups carry.
 *  - The age gate cannot be expressed away: minAge < 18 is rejected, absent
 *    ageGate defaults to 18. Ages are measured against the Singapore
 *    calendar day (pinned explicitly — DB session timezone is not). A
 *    29-Feb birthday counts as reaching the age on 1 Mar of non-leap years
 *    (the conservative, later direction).
 *  - marketingContext.campaignId selects which SCOPED grants may count for
 *    the preview; it must reference a real campaign. It is advisory for
 *    audience-building only — a future sender MUST gate each send with the
 *    campaign the message is actually about (equality enforced there), and
 *    its send log must snapshot the definition + context it resolved with;
 *    cohort rows are mutable and cannot serve as that audit record.
 *  - Cohorts are definitions, never materialized lists — every ask
 *    re-resolves so suppressions/unsubscribes bite immediately.
 *  - Attribute filters read prospect-level JSON today; tracker item "rollup"
 *    re-points them at the consumer projection later without changing the
 *    API shape. Values match EXACTLY what capture stored (display strings,
 *    e.g. "Degree") — the /facets endpoint exposes the live vocabulary so
 *    the UI never guesses.
 *  - campaigns.tags is unchecked TEXT holding JSON; it is parsed in JS
 *    (malformed rows are skipped) and NEVER cast to jsonb in SQL, where one
 *    bad row would abort the whole cohort query.
 */

export const COHORT_CHANNELS = ['all', 'email', 'whatsapp', 'sms', 'voice'];
export const EXCLUSION_REASONS = [
  'age_unknown', 'age_conflict', 'age_ineligible',
  'missing_email', 'missing_phone',
  'suppressed', 'not_consented', 'not_verified',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG_RE = /^[^\s]([\s\S]{0,62}[^\s])?$/; // 1..64 chars, no leading/trailing whitespace
const POSTAL_PREFIX_RE = /^[0-9]{2,6}$/;

const MAX_LIST = { campaignIds: 50, drawIds: 50, campaignTags: 20, postalPrefixes: 20, incomes: 20, educations: 20, genders: 10 };

function cleanStringList(value, { max, re, label }) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new AppError(`${label} must be an array`, 422);
  const out = [];
  for (const raw of value) {
    if (typeof raw !== 'string') throw new AppError(`${label} entries must be strings`, 422);
    const v = raw.trim();
    if (!v) continue;
    if (re && !re.test(v)) throw new AppError(`${label} entry "${v.slice(0, 40)}" is invalid`, 422);
    if (!out.includes(v)) out.push(v);
  }
  if (out.length > max) throw new AppError(`${label} allows at most ${max} entries`, 422);
  return out;
}

/**
 * The single hard gate on definition shape. Route-level Joi gives loud 400s
 * for live requests, but SAVED definitions come back out of the DB and must
 * re-pass here — rows outlive validators, and the §9.5-2 floor must bind
 * even if an old row (or a future bug) stored something looser.
 */
export function normalizeDefinition(definition) {
  if (definition === null || definition === undefined) definition = {};
  if (typeof definition !== 'object' || Array.isArray(definition)) {
    throw new AppError('definition must be an object', 422);
  }
  const f = definition.filters || {};
  if (typeof f !== 'object' || Array.isArray(f)) throw new AppError('filters must be an object', 422);
  const a = f.attributes || {};
  if (typeof a !== 'object' || Array.isArray(a)) throw new AppError('filters.attributes must be an object', 422);

  const filters = {
    campaignIds: cleanStringList(f.campaignIds, { max: MAX_LIST.campaignIds, re: UUID_RE, label: 'filters.campaignIds' }),
    drawIds: cleanStringList(f.drawIds, { max: MAX_LIST.drawIds, re: UUID_RE, label: 'filters.drawIds' }),
    anyDraw: f.anyDraw === true,
    campaignTags: cleanStringList(f.campaignTags, { max: MAX_LIST.campaignTags, re: TAG_RE, label: 'filters.campaignTags' }),
    attributes: {
      postalPrefixes: cleanStringList(a.postalPrefixes, { max: MAX_LIST.postalPrefixes, re: POSTAL_PREFIX_RE, label: 'filters.attributes.postalPrefixes' }),
      incomes: cleanStringList(a.incomes, { max: MAX_LIST.incomes, re: TAG_RE, label: 'filters.attributes.incomes' }),
      educations: cleanStringList(a.educations, { max: MAX_LIST.educations, re: TAG_RE, label: 'filters.attributes.educations' }),
      genders: cleanStringList(a.genders, { max: MAX_LIST.genders, re: TAG_RE, label: 'filters.attributes.genders' }),
    },
  };

  const ag = definition.ageGate || {};
  if (typeof ag !== 'object' || Array.isArray(ag)) throw new AppError('ageGate must be an object', 422);
  const minAge = ag.minAge === undefined || ag.minAge === null ? 18 : ag.minAge;
  if (!Number.isInteger(minAge) || minAge > 120) throw new AppError('ageGate.minAge must be an integer ≤ 120', 422);
  if (minAge < 18) {
    // Binding safeguard, consent doc §9.5-2: cohorts are 18+ until real
    // counsel says otherwise. Not a default — a floor.
    throw new AppError('ageGate.minAge below 18 is not permitted (consent policy §9.5-2)', 422);
  }
  let maxAge = ag.maxAge === undefined || ag.maxAge === null ? null : ag.maxAge;
  if (maxAge !== null) {
    if (!Number.isInteger(maxAge) || maxAge > 120) throw new AppError('ageGate.maxAge must be an integer ≤ 120', 422);
    if (maxAge < minAge) throw new AppError('ageGate.maxAge must be ≥ minAge', 422);
  }

  const mc = definition.marketingContext || {};
  if (typeof mc !== 'object' || Array.isArray(mc)) throw new AppError('marketingContext must be an object', 422);
  const gateCampaignId = mc.campaignId === undefined || mc.campaignId === null ? null : String(mc.campaignId);
  if (gateCampaignId !== null && !UUID_RE.test(gateCampaignId)) {
    throw new AppError('marketingContext.campaignId must be a UUID or null', 422);
  }

  return { filters, ageGate: { minAge, maxAge }, marketingContext: { campaignId: gateCampaignId } };
}

function normalizeChannel(channel) {
  const c = channel === undefined || channel === null ? 'all' : String(channel);
  if (!COHORT_CHANNELS.includes(c)) {
    throw new AppError(`channel must be one of ${COHORT_CHANNELS.join(', ')}`, 422);
  }
  return c;
}

// Ages are measured against the SINGAPORE calendar day, explicitly — the
// Sequelize connection pins no session timezone, and CURRENT_DATE would
// silently follow whatever the host DB uses.
const SGT_TODAY = `((now() AT TIME ZONE 'Asia/Singapore')::date)`;

/**
 * Real-calendar dob validation for a prospects alias: shape-anchored
 * 'YYYY-MM-DD' AND the day exists in that month (leap-aware). Built from
 * string ops + a to_date on the always-valid 'YYYY-MM-01', so no input can
 * ever raise a cast error and abort the cohort query — impossible dates
 * (2000-02-30) simply fail closed into age_unknown.
 */
function validDobSql(alias) {
  const dob = `(${alias}.demographics->>'dateOfBirth')`;
  return `(${dob} ~ '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$'
      AND substring(${dob} from 9 for 2)::int <= extract(day from (
            to_date(substring(${dob} from 1 for 7) || '-01', 'YYYY-MM-DD')
            + interval '1 month - 1 day'))::int)`;
}

/**
 * Build the population + gate SQL for a normalized definition. Async because
 * campaignTags resolve to campaign ids in JS first (see header invariant).
 * Returns { withSql, replacements } — callers append their own SELECT over
 * `gated`.
 *
 * All values ride Sequelize replacements; no user text is ever interpolated.
 */
async function buildResolution(d, def, channel) {
  const repl = {};
  const conds = ['c."erasedAt" IS NULL'];
  const { filters, ageGate, marketingContext } = def;

  if (filters.campaignIds.length) {
    repl.campaignIds = filters.campaignIds;
    conds.push(`EXISTS (
      SELECT 1 FROM prospects pc
       WHERE pc."consumerId" = c.id AND pc."campaignId" IN (:campaignIds))`);
  }

  if (filters.drawIds.length || filters.anyDraw) {
    // Two independently-indexed branches (prospect link → idx_de_prospect;
    // hash fallback → idx_de_phone_hash) instead of one OR-join the planner
    // cannot serve. The hash branch exists for entries whose prospect was
    // HARD-DELETED while the person still stands; PDPA erasure is not that
    // case — it rewrites the entry hash to the all-zeros sentinel and nulls
    // the consumer's hash, so erased people cannot resurface here (and the
    // erasedAt condition above already drops them).
    const drawCond = (alias) => (filters.drawIds.length ? `AND ${alias}."drawId" IN (:drawIds)` : '');
    if (filters.drawIds.length) repl.drawIds = filters.drawIds;
    conds.push(`(EXISTS (
        SELECT 1 FROM draw_entries de
        JOIN prospects dp ON dp.id = de."prospectId"
         WHERE dp."consumerId" = c.id ${drawCond('de')})
      OR EXISTS (
        SELECT 1 FROM draw_entries de2
         WHERE c."phoneHash" IS NOT NULL AND de2."phoneHash" = c."phoneHash"
           ${drawCond('de2')}))`);
  }

  if (filters.campaignTags.length) {
    const tagCampaignIds = await resolveTagCampaignIds(d, filters.campaignTags);
    if (!tagCampaignIds.length) {
      conds.push('false'); // tags nobody carries → empty cohort, loudly countable
    } else {
      repl.tagCampaignIds = tagCampaignIds;
      conds.push(`EXISTS (
        SELECT 1 FROM prospects tp
         WHERE tp."consumerId" = c.id AND tp."campaignId" IN (:tagCampaignIds))`);
    }
  }

  // Each attribute list is its own EXISTS: income may come from one signup
  // and postal from another — both are facts about the person (the same
  // union "rollup" will later materialize).
  const attrs = filters.attributes;
  if (attrs.postalPrefixes.length) {
    // Prefixes are validated digits-only, so no LIKE metacharacters exist;
    // patterns are still built server-side, never from raw text.
    repl.postalPatterns = attrs.postalPrefixes.map((p) => `${p}%`);
    conds.push(`EXISTS (
      SELECT 1 FROM prospects pp
       WHERE pp."consumerId" = c.id
         AND COALESCE(pp.location->>'postalCode', pp.location->>'zipCode')
             LIKE ANY ((ARRAY[:postalPatterns])::text[]))`);
  }
  const attrIn = { incomes: 'income', educations: 'education', genders: 'gender' };
  for (const [key, field] of Object.entries(attrIn)) {
    if (attrs[key].length) {
      repl[key] = attrs[key];
      conds.push(`EXISTS (
        SELECT 1 FROM prospects p_${field}
         WHERE p_${field}."consumerId" = c.id
           AND (p_${field}.demographics->>'${field}') IN (:${key}))`);
    }
  }

  // ── Age gate (§9.5-2, ALWAYS on) ─────────────────────────────────────────
  // dob is a 'YYYY-MM-DD' string inside prospects.demographics; compare
  // STRINGS against to_char cutoffs — ISO dates order lexicographically and
  // nothing here can raise a cast error (see validDobSql).
  //
  // Three per-person facts:
  //  - in_window: SOME valid dob satisfies the whole [minAge, maxAge] window
  //    (both bounds on the SAME row — conflicting dobs cannot combine).
  //  - minor_claim: SOME valid dob puts the person under EIGHTEEN — the
  //    binding floor, deliberately independent of the cohort's minAge. Any
  //    under-18 claim disqualifies outright, no matter what other signups say.
  //  - dob_known: SOME valid dob exists at all.
  repl.minAge = ageGate.minAge;
  repl.adultYears = 18;
  const minCut = `to_char((${SGT_TODAY} - make_interval(years => :minAge)), 'YYYY-MM-DD')`;
  const adultCut = `to_char((${SGT_TODAY} - make_interval(years => :adultYears)), 'YYYY-MM-DD')`;
  let windowSql = `(pd.demographics->>'dateOfBirth') <= ${minCut}`;
  if (ageGate.maxAge !== null) {
    // age ≤ maxAge ⟺ dob AFTER (today − (maxAge+1) years).
    repl.maxAgePlus1 = ageGate.maxAge + 1;
    windowSql += ` AND (pd.demographics->>'dateOfBirth') > to_char((${SGT_TODAY} - make_interval(years => :maxAgePlus1)), 'YYYY-MM-DD')`;
  }
  const inWindowSql = `EXISTS (
    SELECT 1 FROM prospects pd
     WHERE pd."consumerId" = c.id AND ${validDobSql('pd')} AND ${windowSql})`;
  const minorClaimSql = `EXISTS (
    SELECT 1 FROM prospects pm
     WHERE pm."consumerId" = c.id AND ${validDobSql('pm')}
       AND (pm.demographics->>'dateOfBirth') > ${adultCut})`;
  const dobKnownSql = `EXISTS (
    SELECT 1 FROM prospects pk
     WHERE pk."consumerId" = c.id AND ${validDobSql('pk')})`;

  // Destination availability for concrete channels: consent alone cannot
  // make an email push reach a person with no email. Channel 'all' is the
  // abstract consent question (parity with canMarketTo) and requires none.
  const hasDestSql = channel === 'email'
    ? `(c.email IS NOT NULL AND c.email <> '')`
    : channel === 'all' ? 'true' : `(c.phone IS NOT NULL)`;

  // ── The marketing gate — canMarketTo, set-based ──────────────────────────
  // Same scope rule (campaign scope competes with explicit GLOBAL acts on
  // recency; null scope = global acts only), same tie-break (occurredAt,
  // createdAt, id DESC), same channel matching (channel IN ('all', :channel)).
  // The parity suite in cohortService.test.js is what licenses this SQL.
  repl.channel = channel;
  const scopeCond = marketingContext.campaignId
    ? `(ce."campaignId" = :gateCampaignId OR ce."campaignId" IS NULL)`
    : `ce."campaignId" IS NULL`;
  if (marketingContext.campaignId) repl.gateCampaignId = marketingContext.campaignId;

  const withSql = `
    WITH pop AS (
      SELECT c.id, c."firstName", c."lastName", c.phone, c.email,
             c."verifiedSignupCount", c."lastSeenAt",
             ${inWindowSql} AS in_window,
             ${minorClaimSql} AS minor_claim,
             ${dobKnownSql} AS dob_known,
             ${hasDestSql} AS has_dest
        FROM consumers c
       WHERE ${conds.join('\n         AND ')}
    ),
    gated AS (
      SELECT p.*,
             EXISTS (
               SELECT 1 FROM consumer_suppressions s
                WHERE s."consumerId" = p.id AND s.channel IN ('all', :channel)
             ) AS suppressed,
             COALESCE(l.granted, false) AS granted,
             COALESCE(l.verified, false) AS verified
        FROM pop p
        LEFT JOIN LATERAL (
          SELECT ce.granted, ce.verified
            FROM consent_events ce
           WHERE ce."consumerId" = p.id AND ce.kind = 'contact'
             AND ${scopeCond}
           ORDER BY ce."occurredAt" DESC, ce."createdAt" DESC, ce.id DESC
           LIMIT 1
        ) l ON true
    )`;

  return { withSql, replacements: repl };
}

/**
 * campaigns.tags is TEXT under a JS getter — parse it HERE, skipping
 * malformed rows, so no cohort query ever casts unchecked text to jsonb.
 * Case-sensitive exact tag match; /facets exposes the live vocabulary.
 */
async function resolveTagCampaignIds(d, tags) {
  const rows = await d.Campaign.findAll({ attributes: ['id', 'tags'], raw: true });
  const wanted = new Set(tags);
  const out = [];
  for (const r of rows) {
    if (typeof r.tags !== 'string' || !r.tags) continue;
    let parsed;
    try { parsed = JSON.parse(r.tags); } catch { continue; }
    if (Array.isArray(parsed) && parsed.some((t) => typeof t === 'string' && wanted.has(t))) {
      out.push(r.id);
    }
  }
  return out;
}

/** Gate scope must reference a real campaign — a preview against a phantom
 * scope would silently downgrade to "no scoped grants ever match". */
async function assertGateCampaignExists(d, def) {
  const id = def.marketingContext.campaignId;
  if (!id) return;
  const n = await d.Campaign.count({ where: { id } });
  if (!n) throw new AppError('marketingContext.campaignId does not reference a campaign', 422);
}

const REACHABLE_SQL = '(in_window AND NOT minor_claim AND has_dest AND NOT suppressed AND granted AND verified)';

function reasonsForRow(row, channel) {
  const reasons = [];
  if (!row.dob_known) reasons.push('age_unknown');
  else if (row.minor_claim) reasons.push(row.in_window ? 'age_conflict' : 'age_ineligible');
  else if (!row.in_window) reasons.push('age_ineligible');
  if (!row.has_dest) reasons.push(channel === 'email' ? 'missing_email' : 'missing_phone');
  if (row.suppressed) reasons.push('suppressed');
  if (!row.granted) reasons.push('not_consented');
  else if (!row.verified) reasons.push('not_verified');
  return reasons;
}

const defaultDeps = { sequelize, Cohort, Campaign, logger };

export function makeCohortService(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };

  /**
   * Aggregate preview: filter-matched total, reachable, and overlapping
   * per-reason exclusion counts — one resolution round trip, no member
   * materialization.
   */
  async function previewCohort(definition, { channel } = {}) {
    const def = normalizeDefinition(definition);
    const ch = normalizeChannel(channel);
    await assertGateCampaignExists(d, def);
    const { withSql, replacements } = await buildResolution(d, def, ch);
    const [[agg]] = await d.sequelize.query(`${withSql}
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE ${REACHABLE_SQL})::int AS reachable,
             count(*) FILTER (WHERE NOT dob_known)::int AS age_unknown,
             count(*) FILTER (WHERE dob_known AND minor_claim AND in_window)::int AS age_conflict,
             count(*) FILTER (WHERE dob_known AND NOT in_window)::int AS age_ineligible,
             count(*) FILTER (WHERE NOT has_dest)::int AS missing_dest,
             count(*) FILTER (WHERE suppressed)::int AS suppressed,
             count(*) FILTER (WHERE NOT granted)::int AS not_consented,
             count(*) FILTER (WHERE granted AND NOT verified)::int AS not_verified
        FROM gated`, { replacements });
    return {
      total: agg.total,
      reachable: agg.reachable,
      excluded: agg.total - agg.reachable,
      byReason: {
        age_unknown: agg.age_unknown,
        age_conflict: agg.age_conflict,
        age_ineligible: agg.age_ineligible,
        missing_email: ch === 'email' ? agg.missing_dest : 0,
        missing_phone: ch === 'all' || ch === 'email' ? 0 : agg.missing_dest,
        suppressed: agg.suppressed,
        not_consented: agg.not_consented,
        not_verified: agg.not_verified,
      },
      gate: {
        channel: ch,
        campaignId: def.marketingContext.campaignId,
        minAge: def.ageGate.minAge,
        maxAge: def.ageGate.maxAge,
      },
      definition: def,
    };
  }

  /**
   * Paged membership with per-person exclusion reasons (the "why is this
   * person excluded" surface). status: all | reachable | excluded.
   */
  async function listCohortMembers(definition, {
    channel, status = 'all', limit = 50, offset = 0,
  } = {}) {
    const def = normalizeDefinition(definition);
    const ch = normalizeChannel(channel);
    if (!['all', 'reachable', 'excluded'].includes(status)) {
      throw new AppError('status must be all, reachable or excluded', 422);
    }
    await assertGateCampaignExists(d, def);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const off = Math.max(parseInt(offset, 10) || 0, 0);
    const statusCond = status === 'reachable' ? `WHERE ${REACHABLE_SQL}`
      : status === 'excluded' ? `WHERE NOT ${REACHABLE_SQL}` : '';

    const { withSql, replacements } = await buildResolution(d, def, ch);
    const [[{ count }]] = await d.sequelize.query(
      `${withSql} SELECT count(*)::int AS count FROM gated ${statusCond}`,
      { replacements },
    );
    const [rows] = await d.sequelize.query(`${withSql}
      SELECT *, ${REACHABLE_SQL} AS reachable FROM gated ${statusCond}
       ORDER BY "lastSeenAt" DESC, id
       LIMIT :limit OFFSET :offset`,
      { replacements: { ...replacements, limit: lim, offset: off } });

    return {
      total: count,
      limit: lim,
      offset: off,
      members: rows.map((r) => ({
        consumerId: r.id,
        firstName: r.firstName,
        lastName: r.lastName,
        phone: r.phone,
        email: r.email,
        verifiedSignupCount: r.verifiedSignupCount,
        lastSeenAt: r.lastSeenAt,
        reachable: r.reachable === true,
        reasons: r.reachable === true ? [] : reasonsForRow(r, ch),
      })),
    };
  }

  /**
   * Batch canMarketTo over explicit consumer ids — the reusable CONSENT gate
   * for the Phase-3 push senders. Domain: consumer ids only (no phone
   * fallback — callers resolving people by phone use the per-person
   * canMarketTo, which has one). No destination or age logic here, exactly
   * like canMarketTo. Senders MUST pass the campaign the message is actually
   * about, re-check per recipient at send time, and DNC-scrub voice/SMS/
   * WhatsApp sends regardless of consent (§9.5-2).
   *
   * Returns Map<consumerId, {ok, reasons[]}>. Fail-closed: unknown ids
   * report not_found, erased report erased, and any SQL error THROWS —
   * never act on a partial verdict. Ids are processed in chunks (bounded
   * statement size); the verdict set is still atomic-in-effect because any
   * chunk failure aborts the whole call.
   */
  async function canMarketToBatch(consumerIds, { channel = 'all', campaignId = null } = {}) {
    const ch = normalizeChannel(channel);
    const gateCampaignId = campaignId === null || campaignId === undefined ? null : String(campaignId);
    if (gateCampaignId !== null && !UUID_RE.test(gateCampaignId)) {
      throw new AppError('campaignId must be a UUID or null', 422);
    }
    const ids = [...new Set((consumerIds || []).map(String))];
    for (const id of ids) {
      if (!UUID_RE.test(id)) throw new AppError(`invalid consumer id ${id.slice(0, 40)}`, 422);
    }
    const out = new Map();
    if (!ids.length) return out;

    const scopeCond = gateCampaignId
      ? `(ce."campaignId" = :gateCampaignId OR ce."campaignId" IS NULL)`
      : `ce."campaignId" IS NULL`;

    const CHUNK = 5000;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const replacements = { ids: chunk, channel: ch };
      if (gateCampaignId) replacements.gateCampaignId = gateCampaignId;
      const [rows] = await d.sequelize.query(`
        SELECT c.id,
               (c."erasedAt" IS NOT NULL) AS erased,
               EXISTS (
                 SELECT 1 FROM consumer_suppressions s
                  WHERE s."consumerId" = c.id AND s.channel IN ('all', :channel)
               ) AS suppressed,
               COALESCE(l.granted, false) AS granted,
               COALESCE(l.verified, false) AS verified
          FROM consumers c
          LEFT JOIN LATERAL (
            SELECT ce.granted, ce.verified
              FROM consent_events ce
             WHERE ce."consumerId" = c.id AND ce.kind = 'contact'
               AND ${scopeCond}
             ORDER BY ce."occurredAt" DESC, ce."createdAt" DESC, ce.id DESC
             LIMIT 1
          ) l ON true
         WHERE c.id IN (:ids)`, { replacements });
      for (const r of rows) {
        const reasons = [];
        if (r.erased) reasons.push('erased');
        if (r.suppressed) reasons.push('suppressed');
        if (!r.granted) reasons.push('not_consented');
        else if (!r.verified) reasons.push('not_verified');
        out.set(r.id, { ok: reasons.length === 0, reasons });
      }
    }
    for (const id of ids) {
      if (!out.has(id)) out.set(id, { ok: false, reasons: ['not_found'] });
    }
    return out;
  }

  /**
   * Live filter vocabulary for the cohort UI: the attribute values, campaign
   * tags and draws that actually exist. Without this, exact-match filters
   * against display strings ("Degree", "$3,000 - $3,999") silently match
   * nothing. Spine-linked prospects only — unlinked rows can never join a
   * cohort anyway.
   */
  async function getCohortFacets() {
    const distinctVals = async (field) => {
      const [rows] = await d.sequelize.query(`
        SELECT DISTINCT (p.demographics->>'${field}') AS v
          FROM prospects p
         WHERE p."consumerId" IS NOT NULL
           AND COALESCE(p.demographics->>'${field}', '') <> ''
         ORDER BY 1 LIMIT 100`);
      return rows.map((r) => r.v);
    };
    const [incomes, educations, genders] = await Promise.all([
      distinctVals('income'), distinctVals('education'), distinctVals('gender'),
    ]);

    const campaigns = await d.Campaign.findAll({ attributes: ['id', 'name', 'tags', 'status'], raw: true });
    const tagSet = new Set();
    for (const r of campaigns) {
      if (typeof r.tags !== 'string' || !r.tags) continue;
      try {
        const parsed = JSON.parse(r.tags);
        if (Array.isArray(parsed)) parsed.forEach((t) => { if (typeof t === 'string' && t) tagSet.add(t); });
      } catch { /* malformed rows contribute nothing */ }
    }

    const [draws] = await d.sequelize.query(`
      SELECT dr.id, dr."campaignId", dr.status, dr."closesAt", ca.name AS "campaignName"
        FROM draws dr LEFT JOIN campaigns ca ON ca.id = dr."campaignId"
       ORDER BY dr."closesAt" DESC LIMIT 100`);

    return {
      attributes: { incomes, educations, genders },
      campaignTags: [...tagSet].sort(),
      campaigns: campaigns.map((r) => ({ id: r.id, name: r.name, status: r.status })),
      draws,
    };
  }

  /**
   * Refresh a saved cohort's advisory snapshot columns from a fresh preview.
   * Best-effort persist (the preview result is returned regardless — the
   * counts shown are always the freshly computed ones).
   */
  async function snapshotCohort(cohort, { channel } = {}) {
    const preview = await previewCohort(cohort.definition, { channel });
    try {
      await cohort.update(snapshotFields(preview));
    } catch (err) {
      d.logger.warn('[cohort] snapshot persist failed (non-blocking)', {
        cohortId: cohort.id, error: err?.message || String(err),
      });
    }
    return preview;
  }

  return {
    normalizeDefinition,
    previewCohort,
    listCohortMembers,
    canMarketToBatch,
    getCohortFacets,
    snapshotCohort,
  };
}

/** Snapshot column values for a preview result (create/update persist these
 * in the same write as the definition — no half-created rows). */
export function snapshotFields(preview) {
  return {
    lastTotalCount: preview.total,
    lastReachableCount: preview.reachable,
    lastPreviewBreakdown: preview.byReason,
    lastPreviewAt: new Date(),
  };
}

const _default = makeCohortService();
export const previewCohort = _default.previewCohort;
export const listCohortMembers = _default.listCohortMembers;
export const canMarketToBatch = _default.canMarketToBatch;
export const getCohortFacets = _default.getCohortFacets;
export const snapshotCohort = _default.snapshotCohort;
