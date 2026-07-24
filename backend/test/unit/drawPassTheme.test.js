/**
 * The colourway contract, end to end: what an operator may store
 * (utils/luckyDraw normalizer) → what the email palette resolves to
 * (utils/drawTheme) → what drawLink hands the renderers.
 *
 * One enum drives the WhatsApp pass AND the confirmation email, so the campaign
 * can never be titanium in the chat and gold in the inbox. The clamp matters
 * for more than tidiness: `passTheme` reaches a palette lookup and a style
 * attribute, so anything but the enum must be dropped at the door.
 */
import { normalizeLuckyDraw, applyLuckyDrawPolicy } from '../../src/utils/luckyDraw.js';
import { emailPalette, resolvePassTheme, PASS_THEMES, DEFAULT_PASS_THEME } from '../../src/utils/drawTheme.js';
import { makeDrawLink } from '../../src/services/redeemOps/drawLink.js';

describe('normalizer', () => {
  test.each(PASS_THEMES)('keeps the %s colourway', (theme) => {
    expect(normalizeLuckyDraw({ enabled: true, passTheme: theme }).passTheme).toBe(theme);
  });

  test('is case-insensitive about what the operator typed', () => {
    expect(normalizeLuckyDraw({ enabled: true, passTheme: '  Gold ' }).passTheme).toBe('gold');
  });

  test.each([
    ['off-enum', 'chartreuse'],
    ['style injection', 'red;background:url(http://evil)'],
    ['non-string', 42],
    ['empty', ''],
  ])('drops a %s value entirely', (_label, value) => {
    expect(normalizeLuckyDraw({ enabled: true, passTheme: value })).not.toHaveProperty('passTheme');
  });

  // Legacy rows must round-trip byte-identical: absent stays absent and the
  // renderers apply the default, rather than the normalizer stamping one in.
  test('never invents a colourway for a campaign that has none', () => {
    expect(normalizeLuckyDraw({ enabled: true, prize: 'x' })).not.toHaveProperty('passTheme');
  });

  test('is admin-only like the rest of luckyDraw', () => {
    const stored = { enabled: true, passTheme: 'gold' };
    const incoming = { enabled: true, passTheme: 'emerald' };
    expect(applyLuckyDrawPolicy({ incoming, stored, role: 'admin' }).passTheme).toBe('emerald');
    expect(applyLuckyDrawPolicy({ incoming, stored, role: 'agent' }).passTheme).toBe('gold');
  });
});

describe('palette', () => {
  test.each(PASS_THEMES)('%s resolves a full set of solid tokens', (theme) => {
    const p = emailPalette(theme);
    expect(Object.keys(p).length).toBeGreaterThan(20);
    // Outlook drops rgba() and gradients; every token must already be blended.
    for (const [key, value] of Object.entries(p)) {
      expect(`${key}=${value}`).toMatch(/=#[0-9a-f]{6}$/i);
    }
  });

  test('colourways are actually different', () => {
    const grounds = new Set(PASS_THEMES.map((t) => emailPalette(t).c_panelSolid));
    expect(grounds.size).toBe(PASS_THEMES.length);
  });

  test.each([undefined, null, '', 'chartreuse', 42])('%p falls back to the default', (bad) => {
    expect(resolvePassTheme(bad)).toBe(DEFAULT_PASS_THEME);
    expect(emailPalette(bad)).toEqual(emailPalette(DEFAULT_PASS_THEME));
  });
});

describe('drawLink carries the card facts', () => {
  const campaignOf = (luckyDraw) => ({ id: 'c1', name: 'iPhone 17 Pro Lucky Draw', design_config: { luckyDraw } });
  const link = makeDrawLink({ Activation: null, Campaign: null });

  test('prize, draw day and colourway reach the renderers', () => {
    const ctx = link.drawContextForCampaign(campaignOf({
      enabled: true, prize: 'iPhone 17 Pro 256GB', multiplier: 10,
      drawOn: '2026-10-22', boostClosesAt: '2026-09-30', passTheme: 'sapphire',
    }));
    expect(ctx).toMatchObject({
      multiplier: 10, prize: 'iPhone 17 Pro 256GB', drawOn: '2026-10-22', passTheme: 'sapphire',
    });
  });

  // The boost deadline is a promise about the SESSION, not about draw day —
  // borrowing it for a "draw date" would invent a date we never committed to.
  test('a draw with no drawOn reports none rather than borrowing the boost deadline', () => {
    const ctx = link.drawContextForCampaign(campaignOf({
      enabled: true, prize: 'x', multiplier: 10, boostClosesAt: '2026-09-30',
    }));
    expect(ctx.drawOn).toBeNull();
    expect(ctx.boostClosesAt).toBe('2026-09-30');
  });

  test('a campaign with no colourway reports none (renderers default it)', () => {
    const ctx = link.drawContextForCampaign(campaignOf({ enabled: true, prize: 'x', multiplier: 10 }));
    expect(ctx.passTheme).toBeNull();
  });
});
