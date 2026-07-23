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
 *
 * prizes[] (docs/plans/lucky-draw-multi-prize-plan.md) is the structured
 * prize list — [{qty, name}], array order = award order. When valid rows
 * exist they are CANONICAL: `prize` (display summary) and `winners` (Σqty)
 * are derived here, overwriting whatever the client sent, so no save path
 * can make them disagree. Without prizes, `prize`/`winners` stay manual
 * (legacy campaigns are byte-identical).
 */

import { AppError } from '../middleware/appError.js';

const MAX_PRIZE = 80; // legacy manual `prize` cap — unchanged so stored rows never drift
const MAX_PRIZE_NAME = 80;
const MAX_PRIZE_ROWS = 8;
const MAX_PRIZE_QTY = 99;
// Derived summaries are bounded by construction (8 × (4 + 80) + 7 × 3 = 693);
// this slice is a belt that should never cut.
const MAX_PRIZE_SUMMARY = 700;
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

/** Valid structured rows only: plain objects with a non-empty name; qty coerced to 1..MAX_PRIZE_QTY. */
function cleanPrizes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw) {
    if (out.length >= MAX_PRIZE_ROWS) break;
    if (!isPlainObject(row)) continue;
    const name = cleanString(row.name, MAX_PRIZE_NAME);
    if (!name) continue;
    const qty = Number(row.qty);
    out.push({ qty: Number.isInteger(qty) && qty >= 1 && qty <= MAX_PRIZE_QTY ? qty : 1, name });
  }
  return out;
}

/** Compact display summary: "iPhone 17 Pro + 3× $100 FairPrice Voucher". */
export function derivePrizeSummary(prizes) {
  return prizes
    .map((p) => (p.qty === 1 ? p.name : `${p.qty}× ${p.name}`))
    .join(' + ')
    .slice(0, MAX_PRIZE_SUMMARY);
}

/**
 * Σqty of a NORMALIZED luckyDraw's prizes — the number of winners this draw
 * promises. Legacy docs carry no `prizes[]` but CAN carry a hand-set
 * `winners` (normalizeLuckyDraw accepts 1..1000 in that branch), and the
 * consumer page renders it verbatim ("3 winners, drawn in a witnessed
 * process"). Returning 0 there let a legacy multi-winner draw walk straight
 * past both multi-prize guards — assertDrawActivatable and createDraw — and
 * activate, even though the engine is terminal after ONE claimed winner. The
 * identical config expressed as prizes:[{qty:3}] was correctly refused.
 */
export function totalPrizeQuantity(ld) {
  if (!ld) return 0;
  if (!Array.isArray(ld.prizes)) return Number.isInteger(ld.winners) ? ld.winners : 0;
  return ld.prizes.reduce((sum, p) => sum + (Number.isInteger(p?.qty) ? p.qty : 0), 0);
}

/**
 * Normalize a raw luckyDraw value into the canonical shape, or undefined when
 * the input isn't a plain object (caller should drop the key entirely).
 */
export function normalizeLuckyDraw(raw) {
  if (!isPlainObject(raw)) return undefined;
  const out = { enabled: raw.enabled === true };

  const prizes = cleanPrizes(raw.prizes);
  if (prizes.length > 0) {
    out.prizes = prizes;
    out.prize = derivePrizeSummary(prizes);
    out.winners = Math.min(prizes.reduce((s, p) => s + p.qty, 0), 1000);
  } else {
    const prize = cleanString(raw.prize, MAX_PRIZE);
    if (prize) out.prize = prize;
    // Display-only winners count for marketplace copy ("5 winners drawn") —
    // manual only in legacy mode; derived from prizes when they exist.
    const winners = Number(raw.winners);
    if (Number.isInteger(winners) && winners >= 1 && winners <= 1000) out.winners = winners;
  }

  for (const key of ['closesAt', 'boostClosesAt', 'drawOn']) {
    const ymd = cleanYmd(raw[key]);
    if (ymd) out[key] = ymd;
  }

  const multiplier = Number(raw.multiplier);
  out.multiplier =
    Number.isInteger(multiplier) && multiplier >= MIN_MULTIPLIER && multiplier <= MAX_MULTIPLIER
      ? multiplier
      : DEFAULT_MULTIPLIER;

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
    if (incoming === undefined) return normalizeLuckyDraw(stored);
    // Write-path guard: an explicit `prizes` key that normalizes to zero valid
    // rows would silently downgrade a structured campaign to manual mode —
    // reject the save instead. Stored-side garbage never throws (this policy
    // and normalizeLuckyDraw also run on read paths).
    if (isPlainObject(incoming) && incoming.prizes !== undefined && cleanPrizes(incoming.prizes).length === 0) {
      const err = new AppError(
        'luckyDraw.prizes was provided but contains no valid rows — omit it to use a manual prize string, or fix the rows.',
        422
      );
      err.data = { code: 'DRAW_PRIZES_INVALID' };
      throw err;
    }
    return normalizeLuckyDraw(incoming);
  }
  return normalizeLuckyDraw(stored);
}
