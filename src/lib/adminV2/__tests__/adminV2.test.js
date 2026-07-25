import { describe, it, expect } from 'vitest';
import { composeAttentionRows, composeHealthStrip, SEVERITY_ORDER } from '../attention.js';
import { prospectsToCsv } from '../csv.js';
import { fmtSGD, fmtSGDExact, fmtDateTime, fmtRelative, daysUntil, fmtNumber, fmtDay } from '../format.js';
import { HELD_REASON_LABELS, STATUS_LABELS, STATUS_CHIP_CLASS, SOURCE_LABELS, LEAD_STATUSES, LEAD_SOURCES, heldLabel } from '../constants.js';

describe('constants — vocabulary completeness', () => {
  it('every real lead status has a label and a chip mapping', () => {
    for (const s of LEAD_STATUSES) {
      expect(STATUS_LABELS[s]).toBeTruthy();
      expect(STATUS_CHIP_CLASS[s]).not.toBeUndefined();
    }
  });

  it('every real lead source has a label', () => {
    for (const s of LEAD_SOURCES) expect(SOURCE_LABELS[s]).toBeTruthy();
  });

  it('all five real quarantine reasons + other have operator copy', () => {
    for (const r of ['no_funded_agent', 'no_funded_external_buyer', 'dnc_pending', 'dnc_registered', 'returned_by_admin', 'other']) {
      expect(HELD_REASON_LABELS[r]).toBeTruthy();
    }
  });
});

describe('heldLabel — a decided verdict outranks the hold reason', () => {
  it('a qualified lead awaiting delivery never reads as "still calling"', () => {
    const label = heldLabel({ quarantineReason: 'screening_pending', screeningVerdict: 'qualified' });
    expect(label.short).toBe('Qualified');
    expect(label.full).toMatch(/qualified/i);
    expect(label.full).not.toMatch(/call/i);
  });

  it('an undecided screening hold still reads as a call in progress', () => {
    expect(heldLabel({ quarantineReason: 'screening_pending', screeningVerdict: null }).short).toBe('Screening call');
  });

  it('short forms never truncate mid-phrase into nonsense', () => {
    expect(heldLabel({ quarantineReason: 'screening_failed' }).short).toBe('Not qualified');
    expect(heldLabel({ quarantineReason: 'screening_unreachable' }).short).toBe('Unreachable');
  });

  it('every reason yields a non-empty short and full, unknowns included', () => {
    for (const r of [...Object.keys(HELD_REASON_LABELS), 'some_future_reason', null]) {
      const { short, full } = heldLabel({ quarantineReason: r });
      expect(short).toBeTruthy();
      expect(full).toBeTruthy();
    }
  });
});

describe('composeAttentionRows — severity ordering + deep links', () => {
  const fullPayload = {
    webhooks: { pending: 3, failedLast24h: 2, subscriberDisabled: false },
    held: { total: 3, byReason: { no_funded_agent: 2, dnc_pending: 1 } },
    unassigned: 4,
    zeroCommitCampaigns: [{ id: 'c9', name: 'Priced but empty', endsAt: null }],
    wallets: { total: 5, zero: [{ id: 'a1', name: 'Melvin Tan' }], low: [{ id: 'a2', name: 'Siti Nur', balanceCents: 2500 }], floatCents: 2500 },
    committed: { leads: 10, valueCents: 8000, campaigns: 2 },
    drawsClosing: [{ id: 'c1', name: 'Tokyo Getaway Lucky Draw', closesAt: '2099-01-01', multiplier: 10, winners: 1 }],
    endingCampaigns: [{ id: 'c2', name: 'Voucher Blitz', endsAt: new Date(Date.now() + 3 * 86400000).toISOString() }],
  };

  it('orders incident → held → warning → watch, always', () => {
    const rows = composeAttentionRows(fullPayload);
    const severities = rows.map((r) => SEVERITY_ORDER[r.severity]);
    expect([...severities].sort((a, b) => a - b)).toEqual(severities);
    expect(rows[0].severity).toBe('incident');
    expect(rows[rows.length - 1].severity).toBe('watch');
  });

  it('held row aggregates reason copy and deep-links pre-filtered', () => {
    const rows = composeAttentionRows(fullPayload);
    const held = rows.find((r) => r.id === 'att-held');
    expect(held.title).toBe('3 leads held');
    expect(held.detail).toContain('2 no funded agent');
    expect(held.detail).toContain('1 dnc check pending');
    expect(held.href).toBe('/AdminProspects?assignment=held');
  });

  it('disabled subscriber is an incident even with zero failures', () => {
    const rows = composeAttentionRows({ webhooks: { pending: 0, failedLast24h: 0, subscriberDisabled: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('incident');
    expect(rows[0].title).toContain('disabled');
  });

  it('null names in wallet/draw/campaign entries never crash (live prod shape)', () => {
    const rows = composeAttentionRows({
      webhooks: { pending: 0, failedLast24h: 0, subscriberDisabled: false },
      held: { total: 0, byReason: {} },
      unassigned: 0,
      zeroCommitCampaigns: [{ id: 'c1', name: null }],
      wallets: { total: 2, zero: [{ id: 'a1', name: null }], low: [], floatCents: 0 },
      committed: {},
      drawsClosing: [{ id: 'c2', name: null, closesAt: '2099-01-01', multiplier: 5, winners: 1 }],
      endingCampaigns: [{ id: 'c3', name: null, endsAt: new Date(Date.now() + 2 * 86400000).toISOString() }],
    });
    expect(rows.length).toBe(4);
    for (const r of rows) expect(typeof r.title).toBe('string');
    expect(rows.find((r) => r.id === 'att-wallets').detail).toContain('Agent');
  });

  it('a quiet day composes to an empty rail (never fake rows)', () => {
    expect(composeAttentionRows({
      webhooks: { pending: 0, failedLast24h: 0, subscriberDisabled: false },
      held: { total: 0, byReason: {} }, unassigned: 0,
      zeroCommitCampaigns: [], wallets: { zero: [], low: [], floatCents: 0 },
      committed: {}, drawsClosing: [], endingCampaigns: [],
    })).toEqual([]);
    expect(composeAttentionRows(null)).toEqual([]);
  });
});

describe('composeHealthStrip', () => {
  it('always returns the five segments with deep links, tones and glyph shapes', () => {
    const strip = composeHealthStrip({
      webhooks: { failedLast24h: 2, pending: 3, subscriberDisabled: false },
      held: { total: 2, byReason: { no_funded_agent: 1, dnc_pending: 1 } },
      committed: { leads: 189, valueCents: 207000, campaigns: 6 },
      wallets: { total: 7, zero: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }], low: [{ id: 'a4' }], floatCents: 200400 },
      drawsClosing: [{ id: 'c1', name: 'Tokyo Getaway Lucky Draw', closesAt: new Date(Date.now() + 3 * 86400000).toISOString() }],
    });
    expect(strip.map((s) => s.id)).toEqual(['webhooks', 'held', 'committed', 'float', 'draws']);
    expect(strip[0]).toMatchObject({ value: '2 failed', tone: 'bad', shape: 'tri', href: '/AdminProspects' });
    expect(strip[0].detail).toBe('3 pending in queue');
    expect(strip[1]).toMatchObject({ value: '2', tone: 'hold', shape: 'dia', href: '/AdminProspects?assignment=held' });
    expect(strip[1].detail).toContain('1 no funded agent');
    expect(strip[2]).toMatchObject({ value: 'S$2,070', tone: 'accent', shape: 'sq' });
    expect(strip[2].detail).toBe('189 leads pre-sold · 6 campaigns');
    expect(strip[3]).toMatchObject({ value: 'S$2,004', tone: 'warn', shape: 'tri' });
    expect(strip[3].detail).toBe('3 at S$0 · 1 low');
    expect(strip[4]).toMatchObject({ value: '1', tone: 'accent' });
    expect(strip[4].detail).toBe('Tokyo Getaway · 3d');
  });

  it('healthy payload reads calm: ok tones, circles, no warnings', () => {
    const strip = composeHealthStrip({
      webhooks: { failedLast24h: 0, pending: 0, subscriberDisabled: false },
      held: { total: 0, byReason: {} },
      committed: { leads: 0, valueCents: 0, campaigns: 0 },
      wallets: { total: 5, zero: [], low: [], floatCents: 50000 },
      drawsClosing: [],
    });
    expect(strip[0]).toMatchObject({ value: 'Healthy', tone: 'ok', shape: 'cir', valueTone: null });
    expect(strip[1].detail).toBe('nothing quarantined');
    expect(strip[3]).toMatchObject({ tone: 'ok', detail: 'all wallets funded' });
    expect(strip[4]).toMatchObject({ value: '0', tone: 'neutral', detail: 'none inside 7 days' });
    expect(composeHealthStrip(null)).toEqual([]);
  });

  const baseAttention = {
    webhooks: { failedLast24h: 0, pending: 0, subscriberDisabled: false },
    held: { total: 0, byReason: {} },
    committed: { leads: 0, valueCents: 0, campaigns: 0 },
    wallets: { total: 5, zero: [], low: [], floatCents: 50000 },
    drawsClosing: [],
  };

  it('adds a screening cost/qualified segment only once screening is in use', () => {
    const off = composeHealthStrip(baseAttention);
    expect(off.map((s) => s.id)).not.toContain('screening');

    const zeroUse = composeHealthStrip({ ...baseAttention, screening: { spendCents: 0, qualified: 0, costPerQualifiedCents: null } });
    expect(zeroUse.map((s) => s.id)).not.toContain('screening');

    const on = composeHealthStrip({ ...baseAttention, screening: { spendCents: 39, qualified: 3, costPerQualifiedCents: 13 } });
    const seg = on.find((s) => s.id === 'screening');
    expect(seg).toMatchObject({ value: 'S$0.13', href: '/AdminProspects' });
    expect(seg.detail).toBe('3 qualified · S$0.39 spent');
  });
});

describe('prospectsToCsv', () => {
  const lead = {
    id: 'p-1', firstName: 'Xin Yi', lastName: 'Tan', email: 'x@t.co', phone: '+65 9231 8804',
    leadStatus: 'new', leadSource: 'qr_code', createdAt: '2026-07-15T01:41:00Z',
    campaign: { name: 'Tokyo, "Getaway"' }, assignedAgent: { firstName: 'Melvin', lastName: 'Tan' },
    quarantinedAt: null, quarantineReason: null,
  };

  it('quotes RFC-4180 style and joins with CRLF', () => {
    const csv = prospectsToCsv([lead]);
    const [header, row] = csv.split('\r\n');
    expect(header).toBe('id,first_name,last_name,email,phone,status,outcome,source,campaign,agent,held_reason,created_at');
    expect(row).toContain('"Tokyo, ""Getaway"""');
    expect(row).toContain('Melvin Tan');
  });

  it('neutralizes formula injection in hostile names', () => {
    const csv = prospectsToCsv([{ ...lead, firstName: '=HYPERLINK("http://evil")' }]);
    expect(csv).toContain("\"'=HYPERLINK(\"\"http://evil\"\")\"");
  });

  it('neutralizes formula markers hidden behind leading whitespace/control chars', () => {
    for (const hostile of ['  =2+5', '\t+cmd', '\r@SUM(A1)']) {
      const csv = prospectsToCsv([{ ...lead, firstName: hostile }]);
      const cell = csv.split('\r\n')[1].split(',')[1];
      // The stored cell must begin with the neutralizing apostrophe (possibly
      // inside RFC-4180 quotes when the payload carries commas/CRs).
      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
    }
  });

  it('held rows carry the reason; assigned-held never both', () => {
    const csv = prospectsToCsv([{ ...lead, quarantinedAt: '2026-07-15T02:00:00Z', quarantineReason: 'dnc_pending', assignedAgent: null }]);
    expect(csv.split('\r\n')[1]).toContain('dnc_pending');
  });
});

describe('formatters', () => {
  it('fmtSGD rounds to whole dollars; exact keeps cents', () => {
    expect(fmtSGD(207000)).toBe('S$2,070');
    expect(fmtSGD(0)).toBe('S$0');
    expect(fmtSGD(null)).toBe('—');
    expect(fmtSGDExact(1250)).toBe('S$12.50');
  });

  it('fmtDateTime renders SGT regardless of host timezone', () => {
    // 2026-07-15T01:41Z = 09:41 SGT
    expect(fmtDateTime('2026-07-15T01:41:00Z')).toBe('15 Jul 09:41');
  });

  it('fmtRelative buckets sanely', () => {
    const now = Date.parse('2026-07-15T10:00:00Z');
    expect(fmtRelative('2026-07-15T09:59:40Z', now)).toBe('just now');
    expect(fmtRelative('2026-07-15T09:41:00Z', now)).toBe('19m ago');
    expect(fmtRelative('2026-07-14T10:00:00Z', now)).toBe('1d ago');
  });

  it('daysUntil parses YYYY-MM-DD as SGT end-of-day', () => {
    const now = Date.parse('2026-07-15T00:00:00+08:00');
    expect(daysUntil('2026-07-15', now)).toBe(1); // ends tonight SGT
    expect(daysUntil('2026-07-18', now)).toBe(4);
    expect(daysUntil('not-a-date', now)).toBeNull();
  });

  it('fmtNumber handles nullish', () => {
    expect(fmtNumber(1024)).toBe('1,024');
    expect(fmtNumber(undefined)).toBe('—');
  });

  it('fmtDay formats ISO day buckets without tz drift', () => {
    expect(fmtDay('2026-07-17')).toBe('Fri 17 Jul');
    expect(fmtDay('2026-01-01')).toBe('Thu 1 Jan');
    expect(fmtDay('')).toBe('');
    expect(fmtDay(undefined)).toBe('');
  });
});
