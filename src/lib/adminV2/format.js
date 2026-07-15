/**
 * Switchboard formatters — SGT timestamps, S$ amounts, mono-friendly numbers.
 * Pure functions (vitest-covered); every numeral on screen flows through here.
 */

const SGT = 'Asia/Singapore';

/** Cents → "S$1,234" (whole dollars — the UI rounds, the ledger stays exact). */
export function fmtSGD(cents) {
  if (cents === null || cents === undefined || Number.isNaN(Number(cents))) return '—';
  const dollars = Math.round(Number(cents) / 100);
  return `S$${dollars.toLocaleString('en-SG')}`;
}

/** Cents → "S$12.50" (exact, for ledger rows). */
export function fmtSGDExact(cents) {
  if (cents === null || cents === undefined || Number.isNaN(Number(cents))) return '—';
  return `S$${(Number(cents) / 100).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtNumber(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-SG');
}

/** ISO/date → "15 Jul 09:41" in SGT. */
export function fmtDateTime(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: SGT });
  const time = d.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: SGT });
  return `${date} ${time}`;
}

/** ISO/date → "15 Jul 2026" in SGT. */
export function fmtDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: SGT });
}

/** Rough relative time for stream rows ("4m ago", "2h ago", "3d ago"). */
export function fmtRelative(value, now = Date.now()) {
  if (!value) return '—';
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** "days until" for deadlines (SGT end-of-day strings or ISO dates). */
export function daysUntil(value, now = Date.now()) {
  if (!value) return null;
  const t = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? Date.parse(`${value}T23:59:59+08:00`)
    : new Date(value).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now) / 86400000);
}
