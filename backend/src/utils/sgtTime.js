/**
 * Singapore-time day boundaries. SGT (+08:00) observes no DST, so a calendar
 * day is exactly 24h and boundaries are computable with a fixed offset.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  const start = Date.parse(`${s}T00:00:00+08:00`);
  return Number.isNaN(start) ? null : start + DAY_MS;
}
