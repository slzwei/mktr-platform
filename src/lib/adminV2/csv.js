/**
 * Client-side CSV export for the Prospects table (selection or current page).
 * RFC-4180 quoting; formula-injection guarded (a leading =+-@ gets a ' prefix
 * so a hostile lead name can never execute in Excel/Sheets).
 */

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

const COLUMNS = [
  ['id', (p) => p.id],
  ['first_name', (p) => p.firstName],
  ['last_name', (p) => p.lastName],
  ['email', (p) => p.email],
  ['phone', (p) => p.phone],
  ['status', (p) => p.leadStatus],
  ['source', (p) => p.leadSource],
  ['campaign', (p) => p.campaign?.name ?? ''],
  ['agent', (p) => (p.assignedAgent ? `${p.assignedAgent.firstName || ''} ${p.assignedAgent.lastName || ''}`.trim() : '')],
  ['held_reason', (p) => (p.quarantinedAt ? (p.quarantineReason || 'held') : '')],
  ['created_at', (p) => p.createdAt],
];

export function prospectsToCsv(prospects) {
  const header = COLUMNS.map(([name]) => name).join(',');
  const lines = (prospects || []).map((p) => COLUMNS.map(([, get]) => csvCell(get(p))).join(','));
  return [header, ...lines].join('\r\n');
}

export function downloadCsv(filename, csvText) {
  // \uFEFF BOM so Excel opens the UTF-8 file with names intact.
  const blob = new Blob(['\uFEFF', csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
