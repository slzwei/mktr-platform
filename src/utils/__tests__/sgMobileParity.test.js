/**
 * P2-14 regression: both public funnels validate SG mobiles the SAME way.
 *
 * CampaignSignupForm accepted a first digit of 3/6/8/9 inline; MarketplaceFlow
 * required /^[89]\d{7}$/. The same design_config therefore accepted a lead on
 * one customer surface and rejected it on the other, and both feed one backend
 * pipeline. A shared isValidSgMobile already existed in src/utils/validation.js
 * — and nothing imported it.
 *
 * The unit behaviour lives in validation.test.js. What this file guards is the
 * property that actually decays: that the funnels keep using the shared rule
 * instead of growing another private copy.
 */
import { describe, it, expect } from 'vitest';
import { isValidSgMobile } from '../validation';
// `?raw` gives Vite's own read of the file — no fs, no path, no node globals,
// and it tracks the module graph rather than a hand-built path.
import campaignSignupFormSource from '../../components/campaigns/CampaignSignupForm.jsx?raw';
import marketplaceFlowSource from '../../pages/marketplace/MarketplaceFlow.jsx?raw';

const FUNNELS = [
  ['CampaignSignupForm', campaignSignupFormSource],
  ['MarketplaceFlow', marketplaceFlowSource],
];

describe('both funnels use the shared validator', () => {
  for (const [name, src] of FUNNELS) {
    it(`${name} imports isValidSgMobile`, () => {
      expect(src).toMatch(/import \{[^}]*isValidSgMobile[^}]*\} from ['"]@\/utils\/validation['"]/);
    });

    it(`${name} carries no private SG-mobile regex or digit list`, () => {
      // The two shapes that diverged: an inline first-digit allowlist and a
      // hand-rolled 8-digit pattern.
      expect(src).not.toMatch(/\[\s*'3'\s*,\s*'6'\s*,\s*'8'\s*,\s*'9'\s*\]/);
      expect(src).not.toMatch(/\/\^\[[3689]+\]\\d\{7\}\$\//);
    });
  }
});

describe('the shared rule is mobile-only', () => {
  it.each(['81234567', '91234567', '80000000', '99999999'])('accepts %s', (n) => {
    expect(isValidSgMobile(n)).toBe(true);
  });

  it.each([
    ['61234567', 'fixed-line — cannot receive the OTP'],
    ['31234567', 'VoIP — cannot receive the OTP'],
    ['11234567', 'not an SG number'],
    ['8123456', 'too short'],
    ['812345678', 'too long'],
    ['+6581234567', 'country code included'],
    ['8123 4567', 'unstripped spaces'],
    ['', 'empty'],
  ])('rejects %s (%s)', (n) => {
    expect(isValidSgMobile(n)).toBe(false);
  });

  it('agrees with the marketplace rule that was already correct', () => {
    for (const n of ['81234567', '91234567', '61234567', '31234567', '11234567']) {
      expect(isValidSgMobile(n)).toBe(/^[89]\d{7}$/.test(n));
    }
  });
});
