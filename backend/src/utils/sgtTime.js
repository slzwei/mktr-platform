/**
 * Singapore-time day boundaries. SGT (+08:00) observes no DST, so a calendar
 * day is exactly 24h and boundaries are computable with a fixed offset.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * '2026-09-30' → '30 September 2026'; '' for anything that isn't a YMD.
 * The one display formatter for draw dates (WhatsApp, email, card artwork) —
 * re-exported by redeemOps/drawLink.js as `boostDeadlineLong` for the callers
 * that grew up with that name. It lives here, next to the other date rules and
 * away from the model imports, so the card renderers can format without
 * pulling Sequelize into a PNG.
 */
export function longDate(ymd) {
  const m = typeof ymd === 'string' ? ymd.match(YMD_RE) && ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : '';
}

/** '2026-10-22' → '22 Oct 2026' — for narrow columns where the long month won't fit. */
export function shortDate(ymd) {
  const long = longDate(ymd);
  if (!long) return '';
  const [day, month, year] = long.split(' ');
  return `${day} ${month.slice(0, 3)} ${year}`;
}

/**
 * EXCLUSIVE end-of-day instant for a YYYY-MM-DD in SGT: the first millisecond
 * of the NEXT day. An instant t falls on or before the day iff
 * `t < sgtDayEndExclusiveMs(ymd)` — no 23:59:59.999 gap (the old private
 * featured-drops helper stopped at 23:59:59.000 and dropped the final 999ms).
 * Returns null for anything that isn't a valid YYYY-MM-DD string.
 */
export function sgtDayEndExclusiveMs(ymd) {
  if (typeof ymd !== 'string') return null;
  const s = ymd.trim();
  if (!YMD_RE.test(s)) return null;
  // Strict calendar check — Date.parse rolls impossible dates (2026-02-31 →
  // March 3) instead of rejecting them.
  const [y, m, day] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) return null;
  const start = Date.parse(`${s}T00:00:00+08:00`);
  return Number.isNaN(start) ? null : start + DAY_MS;
}
