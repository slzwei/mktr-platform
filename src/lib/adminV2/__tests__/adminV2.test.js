import { describe, it, expect } from 'vitest';
import { composeAttentionRows, composeHealthCells, SEVERITY_ORDER } from '../attention.js';
import { prospectsToCsv } from '../csv.js';
import { fmtSGD, fmtSGDExact, fmtDateTime, fmtRelative, daysUntil, fmtNumber } from '../format.js';
import { HELD_REASON_LABELS, STATUS_LABELS, STATUS_CHIP_CLASS, SOURCE_LABELS, LEAD_STATUSES, LEAD_SOURCES } from '../constants.js';

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

describe('composeHealthCells', () => {
  it('webhook cell turns bad on failures; float warns on zero wallets', () => {
    const cells = composeHealthCells({
      webhooks: { failedLast24h: 2, pending: 1, subscriberDisabled: false },
      committed: { leads: 189, valueCents: 207000 },
      wallets: { total: 5, zero: [{ id: 'a1' }], low: [], floatCents: 12400 },
      held: { total: 3 },
    });
    expect(cells.find((c) => c.id === 'webhooks')).toMatchObject({ value: '2 failed', tone: 'bad' });
    expect(cells.find((c) => c.id === 'committed').value).toBe('S$2,070');
    expect(cells.find((c) => c.id === 'float')).toMatchObject({ value: 'S$124', tone: 'warn' });
    expect(cells.find((c) => c.id === 'held')).toMatchObject({ value: '3', tone: 'hold' });
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
    expect(header).toBe('id,first_name,last_name,email,phone,status,source,campaign,agent,held_reason,created_at');
    expect(row).toContain('"Tokyo, ""Getaway"""');
    expect(row).toContain('Melvin Tan');
  });

  it('neutralizes formula injection in hostile names', () => {
    const csv = prospectsToCsv([{ ...lead, firstName: '=HYPERLINK("http://evil")' }]);
    expect(csv).toContain("\"'=HYPERLINK(\"\"http://evil\"\")\"");
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
});
