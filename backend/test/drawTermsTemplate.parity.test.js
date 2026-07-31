/**
 * Twin parity — backend/src/utils/drawTermsTemplate.js is a port of
 * src/components/campaigns/workspace/drawTermsTemplate.js (the workspace
 * create-flow template). The port exists so server-side paths (duplicating an
 * open draw) can mint terms without a browser payload; if the two ever drift,
 * a duplicated draw would pin different terms than the same facts minted at
 * create. Both files are pure ESM whose ONLY import is the shared
 * dependency-free caps module (utils/luckyDrawCaps.js — the same constants the
 * server normalizer clamps with), so the frontend original imports directly
 * here and every case asserts byte-identical output.
 */
import { buildDrawTermsHtml as backendBuild, formatLongDate as backendLongDate, numberWords as backendNumberWords } from '../src/utils/drawTermsTemplate.js';
import { buildDrawTermsHtml as frontendBuild, formatLongDate as frontendLongDate, numberWords as frontendNumberWords } from '../../src/components/campaigns/workspace/drawTermsTemplate.js';
import { normalizeLuckyDraw } from '../src/utils/luckyDraw.js';

const CASES = [
  ['single prize, defaults', {
    campaignName: 'iPhone 17 Pro Lucky Draw (Copy)',
    prizes: [{ qty: 1, name: 'iPhone 17 Pro 256GB' }],
    closesAt: '2026-09-30',
  }],
  ['multi-prize, both age bounds, whatsapp', {
    campaignName: 'Tokyo Getaway — relaunch',
    prizes: [{ qty: 1, name: 'Tokyo trip for two' }, { qty: 3, name: '$100 FairPrice Voucher' }],
    closesAt: '2026-10-30',
    boostClosesAt: '2026-10-15',
    multiplier: 12,
    minAge: 21,
    maxAge: 60,
    verification: 'whatsapp',
  }],
  ['legacy free-text prize, no structured rows', {
    campaignName: 'Legacy Draw',
    prize: 'A mystery hamper',
    closesAt: '2027-01-02',
    multiplier: 10,
  }],
  ['name needing HTML escaping', {
    campaignName: 'Draw <b>& Co</b> "quoted"',
    prizes: [{ qty: 2, name: 'AirPods <Pro>' }],
    closesAt: '2026-12-31',
    maxAge: 55,
  }],
  ['over-cap facts (qty > 99, 120-char name, 11 rows) clamp identically', {
    campaignName: 'Cap Stress Draw',
    prizes: [
      { qty: 150, name: `${'A'.repeat(120)} deluxe` },
      ...Array.from({ length: 10 }, (_, i) => ({ qty: 2, name: `Consolation prize ${i + 1}` })),
    ],
    closesAt: '2026-11-30',
  }],
];

describe('drawTermsTemplate backend twin parity', () => {
  for (const [label, facts] of CASES) {
    it(`byte-identical output — ${label}`, () => {
      expect(backendBuild(facts)).toBe(frontendBuild(facts));
    });
  }

  it('over-cap facts render the same terms as the server-normalized rows (no terms-vs-facts drift)', () => {
    const raw = [
      { qty: 150, name: 'X'.repeat(120) },
      ...Array.from({ length: 10 }, (_, i) => ({ qty: 2, name: `Prize ${i + 1}` })),
    ];
    const base = { campaignName: 'Clamp Draw', closesAt: '2026-11-30' };
    const fromRaw = backendBuild({ ...base, prizes: raw });
    // The exact rows the save-time clamp would store must produce the exact
    // same terms — this is the mismatch the promise-consistency gate blocks.
    expect(fromRaw).toBe(backendBuild({ ...base, prizes: normalizeLuckyDraw({ prizes: raw }).prizes }));
    expect(fromRaw).not.toContain('150'); // over-cap qty coerces to 1, never stated
    expect(fromRaw).toContain(`One (1) &times; ${'X'.repeat(80)}`); // name cut at 80
    expect(fromRaw).not.toContain('Prize 8'); // rows beyond the first 8 valid never stated
  });

  it('helper parity — formatLongDate and numberWords', () => {
    for (const d of ['2026-09-30', '2026-02-31', 'not-a-date', '']) {
      expect(backendLongDate(d)).toBe(frontendLongDate(d));
    }
    for (const n of [1, 14, 20, 25, 99, 100, 0]) {
      expect(backendNumberWords(n)).toBe(frontendNumberWords(n));
    }
  });
});
