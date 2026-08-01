/**
 * Shared prospect-domain constants and parsers (P4-3). Extracted from the
 * prospectService monolith so the read/held/assignment sub-services and the
 * capture core import them without cycles.
 */
import { literal as sqlLiteral } from 'sequelize';
import { SCREENING_REASONS } from './screeningConstants.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mirrors the Prospect.leadStatus ENUM. A filter value outside this set would
// otherwise reach Postgres and throw ("invalid input value for enum"), so the
// list endpoint validates against it and returns no matches for unknown values.
export const VALID_LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiating', 'won', 'lost', 'nurturing'];

// Assignment-state filter values for the admin list (D6). Unknown values degrade to
// an empty page (same pattern as VALID_LEAD_STATUSES).
export const VALID_ASSIGNMENT_FILTERS = ['assigned', 'unassigned', 'held'];

// Mirrors the Prospect.leadSource ENUM (same enum-cast protection as statuses).
export const VALID_LEAD_SOURCES = ['qr_code', 'website', 'referral', 'social_media', 'advertisement', 'direct', 'call_bot', 'other'];

// List-endpoint sort whitelist (admin rebuild Phase B). `-` prefix = DESC.
// Anything outside the map falls back to the default — never a 500, never an
// unindexed free-form ORDER BY.
export const PROSPECT_SORT_FIELDS = ['firstName', 'leadStatus', 'createdAt', 'score'];
export const DEFAULT_PROSPECT_SORT = '-createdAt';

/**
 * Sorts where NULL means "not scored yet" rather than "lowest". Postgres
 * orders NULLs FIRST on DESC, so `-score` would lead every page with the
 * unscored leads — the exact opposite of what "sort by best lead" means. Both
 * directions get NULLS LAST, the same rule and the same reasoning as the
 * People list's score sorts (consumerService.js:561-571).
 */
export const NULLS_LAST_SORT_FIELDS = new Set(['score']);

/**
 * Comma-list enum filter: split, trim, dedupe, whitelist. Returns
 *  { skip: true }               when the param is absent (no filter),
 *  { values: [...] }            when ≥1 token is valid (Op.in / Op.eq),
 *  { empty: true }              when a value was given but NO token is valid —
 * the caller degrades to an empty page, matching the long-standing single-value
 * behavior (a bad filter never errors AND never silently shows everything).
 */
export function parseEnumFilter(value, allowed) {
  if (value === undefined || value === null || value === '') return { skip: true };
  const tokens = [...new Set(String(value).split(',').map((s) => s.trim()).filter(Boolean))];
  const valid = tokens.filter((t) => allowed.includes(t));
  if (valid.length === 0) return { empty: true };
  return { values: valid };
}

/** Sort param → Sequelize order tuple, whitelisted with default fallback. */
export function parseProspectSort(sort) {
  const raw = typeof sort === 'string' && sort.trim() ? sort.trim() : DEFAULT_PROSPECT_SORT;
  const desc = raw.startsWith('-');
  const field = desc ? raw.slice(1) : raw;
  if (!PROSPECT_SORT_FIELDS.includes(field)) return [['createdAt', 'DESC']];
  const dir = desc ? 'DESC' : 'ASC';
  if (NULLS_LAST_SORT_FIELDS.has(field)) {
    // Column name comes from the whitelist above, never from the request.
    return [[sqlLiteral(`"Prospect"."${field}" ${dir} NULLS LAST`)]];
  }
  return [[field, dir]];
}

// Hold reasons a MANUAL admin (re)assign may release. Everything else is fenced:
// 'no_funded_external_buyer' (external buyer pool), 'dnc_pending'/'dnc_registered'
// (DNC gate). 'returned_by_admin' is the web-admin return flavor — deliberately
// distinct from 'no_funded_agent' so returned leads never surface in the EXTERNAL
// held queue (listDispatchableOrphans) or its release path (releaseHeldProspect),
// both of which filter on 'no_funded_agent'.
// Screening holds are admin-releasable as a DELIBERATE override (skip / undo the
// AI verdict — same trust level as the self/admin quota exemption). The deduct
// double-charge guard for capture-charged screening leads lives at both release
// call sites (single assign + bulk). DNC/external stay fenced.
export const RELEASABLE_HOLD_REASONS = ['no_funded_agent', 'returned_by_admin', ...SCREENING_REASONS];

export const PROSPECT_UPDATE_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'company',
  'jobTitle',
  'leadStatus',
  'priority',
  'leadSource',
  'notes',
  'nextFollowUpDate',
  'lastContactDate',
  // assignedAgentId is intentionally NOT updatable via PUT. Reassignment must go through
  // assignProspect (PATCH /:id/assign), which charges, fires the correct webhook, and
  // releases held leads. A raw PUT could otherwise silently reassign with no charge or
  // webhook — and bypass the lead-quota gate.
  'demographics',
  'location',
  'tags',
];
