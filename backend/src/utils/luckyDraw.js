/**
 * design_config.luckyDraw — lucky-draw campaign settings
 * (docs/plans/lucky-draw-10x.md §4.1).
 *
 * These values gate PUBLIC signup behaviour (prospectService draw gate) and
 * feed the draw pool, so they are normalized on every save exactly like
 * featuredDrop: unknown keys stripped, every field coerced or dropped, and
 * changes are admin-only (campaign PUT is open to agents).
 *
 * termsVersionId/termsHash are SERVER-managed (campaignService appends a
 * draw_terms_versions row and stamps them after the clamp) but are normalized
 * here so stored values survive round-trips and hand-written rows can't
 * smuggle arbitrary content.
 */

const MAX_PRIZE = 80;
const MAX_BOOKING_URL = 300;
const MIN_MULTIPLIER = 2;
const MAX_MULTIPLIER = 100;
const DEFAULT_MULTIPLIER = 10;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

function isPlainObject(v) {
  return Object.prototype.toString.call(v) === '[object Object]';
}

function cleanString(v, max) {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}

function cleanYmd(v) {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!YMD_RE.test(s)) return undefined;
  // Strict calendar check — Date.parse would silently roll 2026-02-31 into
  // March; a draw date must be a real day.
  const [y, m, day] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) return undefined;
  return s;
}

/**
 * Normalize a raw luckyDraw value into the canonical shape, or undefined when
 * the input isn't a plain object (caller should drop the key entirely).
 */
export function normalizeLuckyDraw(raw) {
  if (!isPlainObject(raw)) return undefined;
  const out = { enabled: raw.enabled === true };

  const prize = cleanString(raw.prize, MAX_PRIZE);
  if (prize) out.prize = prize;

  for (const key of ['closesAt', 'boostClosesAt', 'drawOn']) {
    const ymd = cleanYmd(raw[key]);
    if (ymd) out[key] = ymd;
  }

  const multiplier = Number(raw.multiplier);
  out.multiplier =
    Number.isInteger(multiplier) && multiplier >= MIN_MULTIPLIER && multiplier <= MAX_MULTIPLIER
      ? multiplier
      : DEFAULT_MULTIPLIER;

  // Display-only winners count for marketplace copy ("5 winners drawn").
  // No draw mechanics read it.
  const winners = Number(raw.winners);
  if (Number.isInteger(winners) && winners >= 1 && winners <= 1000) out.winners = winners;

  // Session-booking link for the success screen's "Book your 20-min review"
  // CTA (drawTemplates.jsx). Display-only — no draw mechanics read it. Absent
  // or non-http(s) → CTA simply doesn't render.
  const bookingUrl = cleanString(raw.bookingUrl, MAX_BOOKING_URL);
  if (bookingUrl && /^https?:\/\/\S+$/i.test(bookingUrl)) out.bookingUrl = bookingUrl;

  for (const key of ['activationId', 'termsVersionId']) {
    if (typeof raw[key] === 'string' && UUID_RE.test(raw[key].trim())) {
      out[key] = raw[key].trim().toLowerCase();
    }
  }

  if (typeof raw.termsHash === 'string' && SHA256_RE.test(raw.termsHash.trim())) {
    out.termsHash = raw.termsHash.trim().toLowerCase();
  }

  return out;
}

/**
 * Same policy as featuredDrop (utils/featuredDrop.js): only admins may change
 * luckyDraw — it flips public signup enforcement and draw semantics.
 *
 * - admin: incoming value wins (normalized); omitting the key preserves stored.
 * - everyone else: stored value is preserved (normalized), incoming ignored.
 * Returns undefined when the result should not be present at all.
 */
export function applyLuckyDrawPolicy({ incoming, stored, role }) {
  if (role === 'admin') {
    return incoming === undefined ? normalizeLuckyDraw(stored) : normalizeLuckyDraw(incoming);
  }
  return normalizeLuckyDraw(stored);
}
