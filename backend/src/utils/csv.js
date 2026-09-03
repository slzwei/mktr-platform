/**
 * Server-side CSV — RFC-4180 quoting with the formula-injection guard mirrored
 * from src/lib/adminV2/csv.js: a leading equals, plus, minus or at-sign (even
 * behind whitespace or control characters) gets a `'` prefix so a hostile attendee name can never
 * execute when an admin opens the export in Excel/Sheets. Applied to header
 * names as well — RSVP field labels are admin-authored copy.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // eslint-disable-next-line no-control-regex
  if (/^[\s\u0000-\u001F]*[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** columns: [{ name, get(row) }] → CSV text with CRLF line ends and a trailing newline. */
export function toCsv(columns, rows) {
  const header = columns.map((c) => csvCell(c.name)).join(',');
  const lines = rows.map((row) => columns.map((c) => csvCell(c.get(row))).join(','));
  return `${[header, ...lines].join('\r\n')}\r\n`;
}
