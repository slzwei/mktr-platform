/**
 * design_config.featuredDrop — the redeem.sg homepage publication settings.
 *
 * These values are echoed on a PUBLIC page, so they are normalized both when
 * saved (campaignService create/update) and again when building the public
 * DTO (featuredDropsService) — old rows, duplicates, seeds, or future write
 * paths must not be able to smuggle arbitrary content onto the homepage.
 *
 * cap/endsAt are DISPLAY metadata: they change what the homepage shows, they
 * do not stop QR/direct-link signups (see docs/plans/redeem-home-featured-drops.md).
 */

const MAX_TITLE = 40;
const MAX_VALUE_LABEL = 12;
const MAX_EMOJI = 8;
const MAX_CAP = 100000;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(v) {
  return Object.prototype.toString.call(v) === '[object Object]';
}

function cleanString(v, max) {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}

/**
 * Normalize a raw featuredDrop value into the canonical shape, or undefined
 * when the input isn't a plain object (caller should drop the key entirely).
 * Unknown keys are stripped; every field is coerced or dropped.
 */
export function normalizeFeaturedDrop(raw) {
  if (!isPlainObject(raw)) return undefined;
  const out = { enabled: raw.enabled === true };

  const title = cleanString(raw.title, MAX_TITLE);
  if (title) out.title = title;

  const valueLabel = cleanString(raw.valueLabel, MAX_VALUE_LABEL);
  if (valueLabel) out.valueLabel = valueLabel;

  const emoji = cleanString(raw.emoji, MAX_EMOJI);
  if (emoji) out.emoji = emoji;

  const cap = Number(raw.cap);
  if (Number.isInteger(cap) && cap >= 1 && cap <= MAX_CAP) out.cap = cap;

  if (typeof raw.endsAt === 'string') {
    const s = raw.endsAt.trim();
    if (YMD_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))) out.endsAt = s;
  }

  return out;
}

/**
 * Publication policy: only admins may change featuredDrop. Campaign updates
 * are open to agents (routes/campaigns.js PUT /:id is requireAgentOrAdmin),
 * so without this gate an agent could publish their campaign to the public
 * redeem.sg homepage.
 *
 * - admin: incoming value wins (normalized); omitting the key preserves stored.
 * - everyone else: stored value is preserved (normalized), incoming ignored.
 * Returns undefined when the result should not be present at all.
 */
export function applyFeaturedDropPolicy({ incoming, stored, role }) {
  if (role === 'admin') {
    return incoming === undefined ? normalizeFeaturedDrop(stored) : normalizeFeaturedDrop(incoming);
  }
  return normalizeFeaturedDrop(stored);
}
