/**
 * Twin parity — backend/src/utils/drawTermsTemplate.js is a port of
 * src/components/campaigns/workspace/drawTermsTemplate.js (the workspace
 * create-flow template). The port exists so server-side paths (duplicating an
 * open draw) can mint terms without a browser payload; if the two ever drift,
 * a duplicated draw would pin different terms than the same facts minted at
 * create. Both files are dependency-free pure ESM, so the frontend original
 * imports directly here and every case asserts byte-identical output.
 */
import { buildDrawTermsHtml as backendBuild, formatLongDate as backendLongDate, numberWords as backendNumberWords } from '../src/utils/drawTermsTemplate.js';
import { buildDrawTermsHtml as frontendBuild, formatLongDate as frontendLongDate, numberWords as frontendNumberWords } from '../../src/components/campaigns/workspace/drawTermsTemplate.js';

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
];

describe('drawTermsTemplate backend twin parity', () => {
  for (const [label, facts] of CASES) {
    it(`byte-identical output — ${label}`, () => {
      expect(backendBuild(facts)).toBe(frontendBuild(facts));
    });
  }

  it('helper parity — formatLongDate and numberWords', () => {
    for (const d of ['2026-09-30', '2026-02-31', 'not-a-date', '']) {
      expect(backendLongDate(d)).toBe(frontendLongDate(d));
    }
    for (const n of [1, 14, 20, 25, 99, 100, 0]) {
      expect(backendNumberWords(n)).toBe(frontendNumberWords(n));
    }
  });
});
