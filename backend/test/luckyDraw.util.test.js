/**
 * Unit tests for design_config.luckyDraw normalization + admin-only policy
 * (utils/luckyDraw.js) and the shared SGT day-boundary helper (utils/sgtTime.js).
 * Mirrors featuredDrop.util.test.js — these values gate PUBLIC signup
 * enforcement, so the clamp is the security boundary.
 */
import { normalizeLuckyDraw, applyLuckyDrawPolicy, derivePrizeSummary, totalPrizeQuantity } from '../src/utils/luckyDraw.js';
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

describe('normalizeLuckyDraw — structured prizes', () => {
  const ROWS = [{ qty: 1, name: 'iPhone 17 Pro' }, { qty: 3, name: '$100 FairPrice Voucher' }];

  it('keeps valid rows and derives prize + winners from them (overwriting client input)', () => {
    const out = normalizeLuckyDraw({ enabled: true, prizes: ROWS, prize: 'LIES', winners: 100 });
    expect(out.prizes).toEqual(ROWS);
    expect(out.prize).toBe('iPhone 17 Pro + 3× $100 FairPrice Voucher');
    expect(out.winners).toBe(4);
  });

  it('drops junk rows, coerces bad qty to 1, trims/caps names, caps at 8 rows', () => {
    const out = normalizeLuckyDraw({
      enabled: true,
      prizes: [
        { qty: 'x', name: '  Prize A  ' },
        { qty: 0, name: 'B' },
        { qty: 2.5, name: 'C' },
        { qty: 100, name: 'D' },
        'not-an-object',
        { qty: 2, name: '   ' },
        { qty: 2 },
        { qty: 2, name: 'E'.repeat(200) },
      ],
    });
    expect(out.prizes).toEqual([
      { qty: 1, name: 'Prize A' },
      { qty: 1, name: 'B' },
      { qty: 1, name: 'C' },
      { qty: 1, name: 'D' },
      { qty: 2, name: 'E'.repeat(80) },
    ]);
    const nine = Array.from({ length: 9 }, (_, i) => ({ qty: 1, name: `P${i}` }));
    expect(normalizeLuckyDraw({ enabled: true, prizes: nine }).prizes).toHaveLength(8);
  });

  it('empty/invalid prizes fall back to legacy manual fields (read-safe)', () => {
    const out = normalizeLuckyDraw({ enabled: true, prizes: [], prize: 'Manual', winners: 5 });
    expect(out.prizes).toBeUndefined();
    expect(out.prize).toBe('Manual');
    expect(out.winners).toBe(5);
  });

  it('legacy manual prize keeps its 80-char cap (no drift for stored rows)', () => {
    const out = normalizeLuckyDraw({ enabled: true, prize: 'Z'.repeat(200) });
    expect(out.prize).toBe('Z'.repeat(80));
  });

  it('long multi-prize summaries are NOT cut at the legacy 80-char cap', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ qty: 99, name: `${'N'.repeat(78)}${i}` }));
    const out = normalizeLuckyDraw({ enabled: true, prizes: rows });
    expect(out.prize.length).toBeGreaterThan(80);
    expect(out.prize.length).toBeLessThanOrEqual(700);
    expect(out.winners).toBe(8 * 99);
  });

  it('is idempotent: normalize(normalize(x)) === normalize(x)', () => {
    const once = normalizeLuckyDraw({ enabled: true, prizes: ROWS, closesAt: '2026-10-30', multiplier: 10 });
    expect(normalizeLuckyDraw(once)).toEqual(once);
  });

  it('derivePrizeSummary / totalPrizeQuantity helpers', () => {
    expect(derivePrizeSummary([{ qty: 1, name: 'A' }])).toBe('A');
    expect(derivePrizeSummary(ROWS)).toBe('iPhone 17 Pro + 3× $100 FairPrice Voucher');
    expect(totalPrizeQuantity(normalizeLuckyDraw({ enabled: true, prizes: ROWS }))).toBe(4);
    // WAS 0 — that was the bug: a legacy hand-set `winners` promised 9 winners
    // on the consumer page and returned 0 to both multi-prize guards, so the
    // draw activated while the engine stays terminal after ONE claimed winner.
    expect(totalPrizeQuantity(normalizeLuckyDraw({ enabled: true, prize: 'Manual', winners: 9 }))).toBe(9);
    expect(totalPrizeQuantity(undefined)).toBe(0);
  });
});

describe('applyLuckyDrawPolicy — structured prizes write guard', () => {
  const storedStructured = { enabled: true, prizes: [{ qty: 1, name: 'A' }, { qty: 3, name: 'B' }] };

  it('admin sending a prizes key that normalizes empty is a 422 (DRAW_PRIZES_INVALID), not a silent downgrade', () => {
    for (const bad of [[], [{ qty: 2 }], [{ name: '   ' }], 'garbage', 42]) {
      let thrown;
      try {
        applyLuckyDrawPolicy({ incoming: { enabled: true, prizes: bad }, stored: storedStructured, role: 'admin' });
      } catch (e) { thrown = e; }
      expect(thrown?.statusCode).toBe(422);
      expect(thrown?.data?.code).toBe('DRAW_PRIZES_INVALID');
    }
  });

  it('admin omitting the prizes key replaces wholesale (documented incoming-wins semantics)', () => {
    const out = applyLuckyDrawPolicy({ incoming: { enabled: true, prize: 'Manual' }, stored: storedStructured, role: 'admin' });
    expect(out.prizes).toBeUndefined();
    expect(out.prize).toBe('Manual');
  });

  it('non-admin incoming garbage prizes never throws and never lands', () => {
    const out = applyLuckyDrawPolicy({ incoming: { enabled: true, prizes: [] }, stored: storedStructured, role: 'agent' });
    expect(out.prizes).toEqual(storedStructured.prizes);
  });

  it('stored-side garbage prizes (direct-DB) reads as legacy, never throws', () => {
    const out = applyLuckyDrawPolicy({ incoming: undefined, stored: { enabled: true, prizes: [], prize: 'Manual' }, role: 'admin' });
    expect(out.prizes).toBeUndefined();
    expect(out.prize).toBe('Manual');
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

describe('totalPrizeQuantity — legacy winners count as promised winners', () => {
  it('a hand-set winners on a legacy (no prizes[]) draw is counted', () => {
    expect(totalPrizeQuantity({ enabled: true, prize: '3 x iPhone 17', winners: 3 })).toBe(3);
  });

  it('structured prizes still win when both are present', () => {
    expect(totalPrizeQuantity({ prizes: [{ qty: 2, name: 'A' }], winners: 99 })).toBe(2);
  });

  it('a legacy single-winner draw is still 1, and a shapeless one still 0', () => {
    expect(totalPrizeQuantity({ prize: 'One trip', winners: 1 })).toBe(1);
    expect(totalPrizeQuantity({ prize: 'One trip' })).toBe(0);
    expect(totalPrizeQuantity(null)).toBe(0);
  });

  it('normalizeLuckyDraw + totalPrizeQuantity now REFUSE the legacy multi-winner shape the guards used to miss', () => {
    const ld = normalizeLuckyDraw({ enabled: true, prize: '3 x iPhone 17', winners: 3, closesAt: '2026-09-02' });
    expect(ld.winners).toBe(3);
    // > 1 is what assertDrawActivatable and createDraw both gate on.
    expect(totalPrizeQuantity(ld)).toBe(3);
  });
});
