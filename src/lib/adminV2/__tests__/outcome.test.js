/**
 * The shared campaign-outcome voice (list STATUS column + profile campaign
 * rows) and its CSV projection. Draw windows display the last INCLUDED
 * instant (stored instants are SGT end-of-day exclusive).
 */
import { describe, it, expect } from 'vitest';
import { rowChipFor, drawWindowDay } from '../outcome';
import { prospectsToCsv } from '../csv';

describe('rowChipFor', () => {
  it('speaks the draw voice, boost included', () => {
    expect(rowChipFor({ state: 'provisional_in', boosted: false, closesAt: '2026-09-30T16:00:00Z' }, []))
      .toEqual({ label: 'open · closes 30 Sept', tone: '' });
    expect(rowChipFor({ state: 'provisional_in', boosted: true, multiplier: 10, closesAt: '2026-09-30T16:00:00Z' }, []))
      .toEqual({ label: '×10 · closes 30 Sept', tone: 'ok' });
    expect(rowChipFor({ state: 'sealed', chances: 10, outcome: { status: 'selected_claimed' } }, []))
      .toEqual({ label: '🏆 winner', tone: 'ok' });
    expect(rowChipFor({ state: 'provisional_out' }, [])).toEqual({ label: 'not counted', tone: 'warn' });
  });

  it('speaks the reward voice when there is no draw', () => {
    expect(rowChipFor(null, [{ state: 'redeemed' }])).toEqual({ label: '✓ redeemed', tone: 'ok' });
    expect(rowChipFor(null, [{ state: 'reserved' }])).toEqual({ label: 'reserved', tone: 'accent' });
    expect(rowChipFor(null, [{ state: 'unlocked' }])).toEqual({ label: 'unlocked', tone: 'ok' });
  });

  it('is silent when there is nothing to say', () => {
    expect(rowChipFor(null, [])).toBeNull();
    expect(rowChipFor(null, undefined)).toBeNull();
  });
});

describe('drawWindowDay', () => {
  it('shows the last included SGT day of an exclusive end-of-day instant', () => {
    // 2026-09-30T16:00:00Z == 1 Oct 00:00 SGT (exclusive) → the window's day is
    // 30 Sep — rendered '30 Sept' (en-SG abbreviates September to four letters,
    // matching the house fmtDate/fmtDateTime).
    expect(drawWindowDay('2026-09-30T16:00:00Z')).toBe('30 Sept');
  });
});

describe('prospectsToCsv outcome column', () => {
  it('exports the chip label', () => {
    const csv = prospectsToCsv([{
      id: 'p1', firstName: 'A', lastName: 'B', email: 'a@b.c', phone: '+65',
      leadStatus: 'new', leadSource: 'website', campaign: { name: 'NTUC' },
      assignedAgent: null, quarantinedAt: null, createdAt: 'x',
      draw: null, reward: { state: 'redeemed' },
    }]);
    expect(csv.split('\r\n')[0]).toContain('outcome');
    expect(csv).toContain('✓ redeemed');
  });
});
