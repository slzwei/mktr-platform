/**
 * Compose the needs-attention queue from GET /api/dashboard/attention facts.
 * The server returns aggregates only; copy + severity ordering live here
 * (pure function, vitest-covered). Severity: incident → held → warning → watch.
 * Every row deep-links pre-filtered — whole-row links, per the design.
 */
import { HELD_REASON_LABELS } from './constants.js';
import { fmtSGD, fmtNumber, daysUntil } from './format.js';

export const SEVERITY_ORDER = { incident: 0, held: 1, warning: 2, watch: 3 };

// Glyph + tone per severity (▲ incident/warning, ◆ held, ● watch — DS §4).
export const SEVERITY_GLYPH = { incident: '▲', held: '◆', warning: '▲', watch: '●' };

export function composeAttentionRows(data) {
  if (!data) return [];
  const rows = [];

  const wh = data.webhooks || {};
  if (wh.failedLast24h > 0 || wh.subscriberDisabled) {
    rows.push({
      id: 'att-webhooks',
      severity: 'incident',
      title: wh.subscriberDisabled
        ? 'A Lyfe webhook subscriber is disabled'
        : `${wh.failedLast24h} Lyfe deliveries failed in 24h`,
      detail: `${wh.failedLast24h} failed · ${wh.pending || 0} pending in queue${wh.subscriberDisabled ? ' · subscriber disabled' : ''}`,
      href: '/AdminProspects',
      cta: 'Investigate',
    });
  }

  for (const c of data.zeroCommitCampaigns || []) {
    rows.push({
      id: `att-zc-${c.id}`,
      severity: 'incident',
      title: `“${c.name || 'Campaign'}” has 0 open commitments`,
      detail: 'New leads will quarantine (no funded agent)',
      href: `/AdminCampaigns`,
      cta: 'Review',
    });
  }

  const held = data.held || { total: 0, byReason: {} };
  if (held.total > 0) {
    const parts = Object.entries(held.byReason || {})
      .filter(([, n]) => n > 0)
      .map(([reason, n]) => `${n} ${(HELD_REASON_LABELS[reason] || reason).toLowerCase()}`);
    rows.push({
      id: 'att-held',
      severity: 'held',
      title: `${held.total} lead${held.total === 1 ? '' : 's'} held`,
      detail: parts.join(' · '),
      href: '/AdminProspects?assignment=held',
      cta: 'Triage',
    });
  }

  if (data.unassigned > 0) {
    rows.push({
      id: 'att-unassigned',
      severity: 'warning',
      title: `${data.unassigned} lead${data.unassigned === 1 ? '' : 's'} unassigned`,
      detail: 'Captured but not delivered · check commitments',
      href: '/AdminProspects?assignment=unassigned',
      cta: 'Review',
    });
  }

  const w = data.wallets || {};
  const zeroN = (w.zero || []).length;
  const lowN = (w.low || []).length;
  if (zeroN > 0 || lowN > 0) {
    // Names can be null (raw queries skip the fullName virtual; synced external
    // agents may have no email) — a null here crashed the whole dashboard chunk.
    const names = [...(w.zero || []), ...(w.low || [])].map((a) => (a.name || 'Agent').split(' ')[0]).slice(0, 4);
    rows.push({
      id: 'att-wallets',
      severity: 'warning',
      title: `${zeroN} wallet${zeroN === 1 ? '' : 's'} at S$0${lowN ? ` · ${lowN} below S$50` : ''}`,
      detail: `${names.join(', ')}${names.length < zeroN + lowN ? '…' : ''} · can’t take new commitments`,
      href: '/AdminWallets',
      cta: 'View wallets',
    });
  }

  for (const c of data.drawsClosing || []) {
    const dd = daysUntil(c.closesAt);
    rows.push({
      id: `att-draw-${c.id}`,
      severity: 'watch',
      title: `${(c.name || 'Draw').replace(' Lucky Draw', '')} draw closes in ${dd}d`,
      detail: `${c.multiplier ? `×${c.multiplier} boost` : 'Draw'} · ${c.winners || 1} winner${(c.winners || 1) > 1 ? 's' : ''}`,
      href: `/AdminCampaigns`,
      cta: 'View draw',
    });
  }

  for (const c of data.endingCampaigns || []) {
    const dd = daysUntil(c.endsAt);
    rows.push({
      id: `att-end-${c.id}`,
      severity: 'watch',
      title: `“${c.name || 'Campaign'}” ends in ${dd}d`,
      detail: 'Extend, archive, or let it lapse',
      href: `/AdminCampaigns`,
      cta: 'Review',
    });
  }

  rows.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return rows;
}

/**
 * Health strip — the five joined segments across the top of the dashboard
 * (MKTR Admin.dc.html): webhooks · held · committed demand · wallet float ·
 * draws closing. Each is a whole-segment deep link; `shape` is the SVG glyph
 * key (tri/dia/cir/sq) so state is never color alone.
 */
export function composeHealthStrip(data) {
  if (!data) return [];
  const wh = data.webhooks || {};
  const held = data.held || { total: 0, byReason: {} };
  const committed = data.committed || {};
  const wallets = data.wallets || {};
  const draws = data.drawsClosing || [];

  // A disabled subscriber outranks failure counts — deliveries are OFF.
  const webBad = (wh.failedLast24h || 0) > 0 || wh.subscriberDisabled;
  const heldParts = Object.entries(held.byReason || {})
    .filter(([, n]) => n > 0)
    .map(([reason, n]) => `${n} ${(HELD_REASON_LABELS[reason] || reason).toLowerCase()}`);
  const zeroN = (wallets.zero || []).length;
  const lowN = (wallets.low || []).length;
  const firstDraw = draws[0];
  const firstDrawDays = firstDraw ? daysUntil(firstDraw.closesAt) : null;

  return [
    {
      id: 'webhooks',
      href: '/AdminProspects',
      shape: webBad ? 'tri' : 'cir',
      tone: webBad ? 'bad' : 'ok',
      value: wh.subscriberDisabled ? 'Disabled' : webBad ? `${wh.failedLast24h} failed` : 'Healthy',
      valueTone: webBad ? 'bad' : null,
      label: 'Lyfe webhooks · 24h',
      detail: `${wh.pending || 0} pending in queue${wh.subscriberDisabled ? ' · subscriber disabled' : ''}`,
    },
    {
      id: 'held',
      href: '/AdminProspects?assignment=held',
      shape: held.total > 0 ? 'dia' : 'cir',
      tone: held.total > 0 ? 'hold' : 'ok',
      value: String(held.total || 0),
      valueTone: held.total > 0 ? 'hold' : null,
      label: 'Leads held',
      detail: held.total > 0 ? `${heldParts.join(' · ') || 'quarantined'} — triage` : 'nothing quarantined',
    },
    {
      id: 'committed',
      href: '/AdminWallets',
      shape: 'sq',
      tone: 'accent',
      value: fmtSGD(committed.valueCents || 0),
      valueTone: null,
      label: 'Committed demand',
      detail: `${fmtNumber(committed.leads || 0)} leads pre-sold · ${committed.campaigns || 0} campaign${committed.campaigns === 1 ? '' : 's'}`,
    },
    {
      id: 'float',
      href: '/AdminWallets',
      shape: zeroN > 0 ? 'tri' : 'cir',
      tone: zeroN > 0 ? 'warn' : 'ok',
      value: fmtSGD(wallets.floatCents || 0),
      valueTone: zeroN > 0 ? 'warn' : null,
      label: 'Wallet float',
      detail: zeroN > 0 || lowN > 0 ? `${zeroN} at S$0 · ${lowN} low` : 'all wallets funded',
    },
    {
      id: 'draws',
      href: '/AdminCampaigns',
      shape: 'cir',
      tone: draws.length > 0 ? 'accent' : 'neutral',
      value: String(draws.length),
      valueTone: draws.length > 0 ? 'accent-text' : null,
      label: 'Draws closing ≤7d',
      detail: firstDraw
        ? `${(firstDraw.name || 'Draw').replace(' Lucky Draw', '')} · ${firstDrawDays}d`
        : 'none inside 7 days',
    },
  ];
}
