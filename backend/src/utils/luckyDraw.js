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
import { PASS_THEMES } from './drawTheme.js';
import { cleanYmd } from './sgtTime.js';
import { MAX_PRIZE_NAME, MAX_PRIZE_ROWS, MAX_PRIZE_QTY } from './luckyDrawCaps.js';
import { isPlainObject, cleanString } from './objects.js';

const MAX_PRIZE = 80; // legacy manual `prize` cap — unchanged so stored rows never drift
// Derived summaries are bounded by construction (8 × (4 + 80) + 7 × 3 = 693);
// this slice is a belt that should never cut.
const MAX_PRIZE_SUMMARY = 700;
const MAX_BOOKING_URL = 300;
const MIN_MULTIPLIER = 2;
const MAX_MULTIPLIER = 100;
const DEFAULT_MULTIPLIER = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

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

/** Σqty of a NORMALIZED luckyDraw's prizes; 0 when unstructured (legacy). */
export function totalPrizeQuantity(ld) {
  if (!ld || !Array.isArray(ld.prizes)) return 0;
  return ld.prizes.reduce((sum, p) => sum + (Number.isInteger(p?.qty) ? p.qty : 0), 0);
}

/**
 * What the campaign PUBLICLY PROMISES, structured or not (P2-9).
 *
 * totalPrizeQuantity keys only on prizes[], so a LEGACY config carrying
 * `winners: 5` with no prizes[] scored 0 — it passed the activation gate, went
 * live, and published "5 winners" through publicLuckyDraw while the engine
 * resolved exactly ONE. The promise the public reads is max(Σqty, winners), so
 * that is what the guard has to weigh. For structured draws the two agree by
 * construction (normalizeLuckyDraw derives winners from Σqty), so this changes
 * nothing there.
 */
export function promisedWinnerCount(ld) {
  const winners = Number.isInteger(ld?.winners) && ld.winners > 0 ? ld.winners : 0;
  return Math.max(totalPrizeQuantity(ld), winners);
}

/** Hard ceiling on awardable units — mirrors normalizeLuckyDraw's winners clamp. */
export const MAX_PRIZE_UNITS = 1000;

/**
 * Expand `prizes` rows into the ordered list of awardable PRIZE UNITS, one per
 * item (Phase 3 §3.1). Array order is award order — which is exactly what the
 * pinned T&C promises ("each prize awarded its stated number of times before
 * the draw moves to the next"), so this expansion IS the published contract.
 *
 *   [{qty:1,name:"iPhone"},{qty:3,name:"Voucher"}]
 *     → [{index:0,name:"iPhone",rowIndex:0},
 *        {index:1,name:"Voucher",rowIndex:1}, …, {index:3,…}]
 *
 * One source of truth for expansion, unit-testable without a database. Returns
 * [] for legacy/unstructured configs — those draw a single unit via the
 * winnersCount:1 default, never through here.
 */
export function expandPrizeUnits(prizes) {
  if (!Array.isArray(prizes)) return [];
  const units = [];
  prizes.forEach((row, rowIndex) => {
    const qty = Number.isInteger(row?.qty) && row.qty >= 1 ? row.qty : 0;
    const name = typeof row?.name === 'string' ? row.name : '';
    if (!name || qty < 1) return;
    for (let i = 0; i < qty && units.length < MAX_PRIZE_UNITS; i += 1) {
      units.push({ index: units.length, name, rowIndex });
    }
  });
  return units;
}

/**
 * The one fail-closed promise guard left after Phase 3 (blocker #5).
 *
 * The multi-winner engine awards N units derived from `prizes[]`. A LEGACY
 * config carrying `winners: 5` with NO `prizes[]` has no unit list to expand,
 * so the engine would mint a single unit while publicLuckyDraw advertises five
 * winners — the exact promise/delivery split the gates existed to prevent.
 * Structured multi-prize draws are now fully supported and pass freely.
 */
export function assertPromiseIsDeliverable(ld, { suffix = '.' } = {}) {
  const structured = totalPrizeQuantity(ld);
  if (structured > 0) return; // expandable → the engine can deliver it
  const winners = Number.isInteger(ld?.winners) && ld.winners > 0 ? ld.winners : 0;
  if (winners > 1) {
    const err = new AppError(
      `This draw promises ${winners} winners but lists no structured prizes, so the engine cannot tell what to award${suffix}`,
      422
    );
    err.data = { code: 'DRAW_UNSTRUCTURED_MULTI_WINNER' };
    throw err;
  }
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

  // Colourway for the customer-facing draw surfaces — the Vault WhatsApp pass
  // and the Onyx confirmation email (utils/drawTheme.js). Display-only: no draw
  // mechanic reads it. Clamped to the enum HERE so no render path ever
  // interpolates campaign JSON into a palette lookup; absent stays absent so
  // legacy rows round-trip byte-identical and the renderers apply the default.
  const passTheme = cleanString(raw.passTheme, 16)?.toLowerCase();
  if (passTheme && PASS_THEMES.includes(passTheme)) out.passTheme = passTheme;

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
    const normalized = normalizeLuckyDraw(incoming);
    // F5 stamp carry-forward (PR-2, old-plan F5 / Codex R1 CX6): activationId
    // is an OPERATIONAL stamp the editors never render — a Studio tab loaded
    // before provisioning omits the key on its next save, and incoming-wins
    // would silently wipe the rail link. Omitted key ⇒ stored stamp survives;
    // an EXPLICIT `activationId: null` still clears (deliberate unlink).
    if (normalized && isPlainObject(incoming) && !('activationId' in incoming) && !normalized.activationId) {
      const storedStamp = normalizeLuckyDraw(stored)?.activationId;
      if (storedStamp) normalized.activationId = storedStamp;
    }
    return normalized;
  }
  return normalizeLuckyDraw(stored);
}
