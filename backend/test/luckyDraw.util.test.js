/**
 * Unit tests for design_config.luckyDraw normalization + admin-only policy
 * (utils/luckyDraw.js) and the shared SGT day-boundary helper (utils/sgtTime.js).
 * Mirrors featuredDrop.util.test.js — these values gate PUBLIC signup
 * enforcement, so the clamp is the security boundary.
 */
import { normalizeLuckyDraw, applyLuckyDrawPolicy } from '../src/utils/luckyDraw.js';
import { sgtDayEndExclusiveMs } from '../src/utils/sgtTime.js';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const HASH = 'a'.repeat(64);

describe('normalizeLuckyDraw', () => {
  it('returns undefined for non-objects (caller drops the key)', () => {
    for (const v of [undefined, null, 'x', 42, [], true]) {
      expect(normalizeLuckyDraw(v)).toBeUndefined();
    }
  });

  it('coerces enabled to a strict boolean', () => {
    expect(normalizeLuckyDraw({ enabled: true }).enabled).toBe(true);
    expect(normalizeLuckyDraw({ enabled: 'yes' }).enabled).toBe(false);
    expect(normalizeLuckyDraw({}).enabled).toBe(false);
  });

  it('keeps valid YMD dates and drops invalid ones', () => {
    const out = normalizeLuckyDraw({
      enabled: true,
      closesAt: '2026-08-31',
      boostClosesAt: '31/08/2026',
      drawOn: '2026-13-99',
    });
    expect(out.closesAt).toBe('2026-08-31');
    expect(out.boostClosesAt).toBeUndefined();
    expect(out.drawOn).toBeUndefined();
  });

  it('rejects impossible calendar dates that Date.parse would roll over', () => {
    expect(normalizeLuckyDraw({ enabled: true, closesAt: '2026-02-31' }).closesAt).toBeUndefined();
    expect(normalizeLuckyDraw({ enabled: true, closesAt: '2026-04-31' }).closesAt).toBeUndefined();
    expect(normalizeLuckyDraw({ enabled: true, closesAt: '2028-02-29' }).closesAt).toBe('2028-02-29'); // leap year
  });

  it('defaults multiplier to 10 and clamps out-of-range values back to 10', () => {
    expect(normalizeLuckyDraw({}).multiplier).toBe(10);
    expect(normalizeLuckyDraw({ multiplier: 50 }).multiplier).toBe(50);
    expect(normalizeLuckyDraw({ multiplier: 1 }).multiplier).toBe(10);
    expect(normalizeLuckyDraw({ multiplier: 101 }).multiplier).toBe(10);
    expect(normalizeLuckyDraw({ multiplier: 'ten' }).multiplier).toBe(10);
  });

  it('keeps well-formed uuids/hashes and drops junk', () => {
    const out = normalizeLuckyDraw({
      enabled: true,
      activationId: UUID.toUpperCase(),
      termsVersionId: 'not-a-uuid',
      termsHash: HASH.toUpperCase(),
    });
    expect(out.activationId).toBe(UUID);
    expect(out.termsVersionId).toBeUndefined();
    expect(out.termsHash).toBe(HASH);
  });

  it('trims + caps the prize and strips unknown keys', () => {
    const out = normalizeLuckyDraw({ enabled: true, prize: '  Cabin luggage  ', evil: 'x' });
    expect(out.prize).toBe('Cabin luggage');
    expect(out.evil).toBeUndefined();
  });
});

describe('normalizeLuckyDraw — bookingUrl (draw success CTA)', () => {
  it('keeps http(s) urls, capped, and drops everything else', () => {
    expect(normalizeLuckyDraw({ enabled: true, bookingUrl: 'https://redeem.sg/book' }).bookingUrl).toBe('https://redeem.sg/book');
    expect(normalizeLuckyDraw({ enabled: true, bookingUrl: 'http://redeem.sg/book' }).bookingUrl).toBe('http://redeem.sg/book');
    expect(normalizeLuckyDraw({ enabled: true, bookingUrl: 'javascript:alert(1)' }).bookingUrl).toBeUndefined();
    expect(normalizeLuckyDraw({ enabled: true, bookingUrl: 'ftp://x' }).bookingUrl).toBeUndefined();
    expect(normalizeLuckyDraw({ enabled: true, bookingUrl: 'redeem.sg/book' }).bookingUrl).toBeUndefined();
    expect(normalizeLuckyDraw({ enabled: true, bookingUrl: 42 }).bookingUrl).toBeUndefined();
    // The 300-char cap truncates into an invalid URL with whitespace-free tail — still http ok:
    const long = `https://redeem.sg/${'a'.repeat(400)}`;
    expect(normalizeLuckyDraw({ enabled: true, bookingUrl: long }).bookingUrl.length).toBeLessThanOrEqual(300);
  });
});

describe('applyLuckyDrawPolicy', () => {
  const stored = { enabled: true, prize: 'Luggage', multiplier: 10 };

  it('admin: incoming wins; omitting the key preserves stored', () => {
    const incoming = { enabled: false };
    expect(applyLuckyDrawPolicy({ incoming, stored, role: 'admin' }).enabled).toBe(false);
    expect(applyLuckyDrawPolicy({ incoming: undefined, stored, role: 'admin' }).prize).toBe('Luggage');
  });

  it('non-admin: stored preserved, incoming ignored', () => {
    const incoming = { enabled: false, prize: 'Hijacked' };
    const out = applyLuckyDrawPolicy({ incoming, stored, role: 'agent' });
    expect(out.enabled).toBe(true);
    expect(out.prize).toBe('Luggage');
  });

  it('returns undefined when neither side has a usable value', () => {
    expect(applyLuckyDrawPolicy({ incoming: undefined, stored: undefined, role: 'admin' })).toBeUndefined();
    expect(applyLuckyDrawPolicy({ incoming: { enabled: true }, stored: undefined, role: 'agent' })).toBeUndefined();
  });
});

describe('sgtDayEndExclusiveMs', () => {
  it('returns the first ms of the NEXT SGT day (exclusive boundary)', () => {
    const end = sgtDayEndExclusiveMs('2026-07-12');
    expect(end).toBe(Date.parse('2026-07-13T00:00:00+08:00'));
    // 23:59:59.999 SGT is still within the day; midnight is not.
    expect(Date.parse('2026-07-12T23:59:59.999+08:00')).toBeLessThan(end);
    expect(Date.parse('2026-07-13T00:00:00.000+08:00')).toBe(end);
  });

  it('returns null for invalid input', () => {
    for (const v of [null, undefined, 42, '2026-13-99', '12/07/2026', '2026-07-12T00:00:00Z', '2026-02-31']) {
      expect(sgtDayEndExclusiveMs(v)).toBeNull();
    }
  });
});
