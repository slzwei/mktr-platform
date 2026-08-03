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
  const m = typeof ymd === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd) : null;
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
  const s = cleanYmd(ymd);
  if (!s) return null;
  const start = Date.parse(`${s}T00:00:00+08:00`);
  return Number.isNaN(start) ? null : start + DAY_MS;
}

/**
 * THE strict calendar YYYY-MM-DD validator (P4-1) — trims, shape-checks, and
 * rejects impossible dates instead of letting Date.parse roll them over
 * (2026-02-31 must fail, not become March 3). Returns the trimmed string or
 * undefined. Former copies: utils/luckyDraw.js, campaignDetailsAiService.js.
 */
export function cleanYmd(v) {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!YMD_RE.test(s)) return undefined;
  const [y, m, day] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) return undefined;
  return s;
}

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Singapore calendar date for counters/snapshots, independent of server TZ.
 * (Moved from redeemOps/taskService — P4-7: calendar maths is not a tasks-
 * domain concern.) */
export function sgDateKey(now = new Date()) {
  return new Date(now.getTime() + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

/** "Today" in Singapore time regardless of server TZ. */
export function sgtDayWindow(now = new Date()) {
  const sgt = new Date(now.getTime() + SGT_OFFSET_MS);
  const startUtcMs = Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate()) - SGT_OFFSET_MS;
  return { start: new Date(startUtcMs), end: new Date(startUtcMs + 24 * 60 * 60 * 1000) };
}

/**
 * Completed years between a YYYY-MM-DD birth date and "today" on the
 * SINGAPORE calendar (M8). The old age gate compared server-LOCAL
 * getFullYear/getMonth/getDate — on the UTC prod host an applicant whose
 * birthday began at 00:00 SGT stayed "yesterday" until 08:00 SGT and was
 * rejected as underage by the Singapore-facing form. Returns null for
 * anything cleanYmd rejects.
 */
export function sgtAgeFromDob(ymd, now = new Date()) {
  const s = cleanYmd(ymd);
  if (!s) return null;
  const [by, bm, bd] = s.split('-').map(Number);
  const [ty, tm, td] = sgDateKey(now).split('-').map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age;
}
