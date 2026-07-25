/**
 * The Onyx draw confirmation email — the inbox twin of the Vault WhatsApp pass.
 *
 * The render is pure substitution over a hand-authored, email-client-safe
 * template, so what's worth asserting is exactly what substitution can get
 * wrong: an unresolved placeholder shipping to a customer, a palette that
 * doesn't follow the campaign, an unescaped prize name, and the honest-date
 * rule for the third stat.
 */
import { renderLeadConfirmation } from '../../src/services/email-templates/leadConfirmation.js';
import { emailPalette, PASS_THEMES } from '../../src/utils/drawTheme.js';

const drawOf = (over = {}) => ({
  enabled: true, prize: 'iPhone 17 Pro 256GB', multiplier: 10,
  drawOn: '2026-10-22', closesAt: '2026-10-20', passTheme: 'titanium', ...over,
});

const render = (over = {}) => renderLeadConfirmation({
  firstName: 'Shawn',
  campaignName: 'iPhone 17 Pro Lucky Draw',
  isMktrHost: false,
  shareUrl: 'https://redeem.sg/share/abc123',
  unsubscribeUrl: 'https://api.mktr.sg/api/unsubscribe?t=tok',
  unsubscribeTextLine: 'Unsubscribe: https://api.mktr.sg/api/unsubscribe?t=tok',
  luckyDraw: drawOf(),
  ...over,
});

describe('substitution', () => {
  test.each(PASS_THEMES)('%s leaves no placeholder behind', (passTheme) => {
    const { html, text } = render({ luckyDraw: drawOf({ passTheme }) });
    expect(html).not.toMatch(/\{\{\w+\}\}/);
    expect(text).not.toMatch(/\{\{\w+\}\}/);
  });

  test('the trial-reward email is untouched by the draw redesign', () => {
    const { html } = render({ luckyDraw: undefined });
    expect(html).not.toMatch(/\{\{\w+\}\}/);
    expect(html).toContain('RedeemSG');        // the Editorial letterhead
    expect(html).not.toContain('YOU&rsquo;RE IN THE DRAW');
  });
});

describe('colourway', () => {
  test.each(PASS_THEMES)('%s paints the frame', (passTheme) => {
    const { html } = render({ luckyDraw: drawOf({ passTheme }) });
    const p = emailPalette(passTheme);
    expect(html).toContain(p.c_panelSolid);
    expect(html).toContain(p.c_metalSolid);
    // Solid bgcolor attribute alongside the gradient — Outlook ignores the latter.
    expect(html).toContain(`bgcolor="${p.c_panelSolid}"`);
  });

  test('two campaigns on different colourways do not render the same frame', () => {
    expect(render({ luckyDraw: drawOf({ passTheme: 'gold' }) }).html)
      .not.toEqual(render({ luckyDraw: drawOf({ passTheme: 'emerald' }) }).html);
  });

  test('an off-enum colourway still renders, in the default palette', () => {
    const { html } = render({ luckyDraw: drawOf({ passTheme: 'chartreuse' }) });
    expect(html).not.toMatch(/\{\{\w+\}\}/);
    expect(html).toContain(emailPalette('titanium').c_panelSolid);
  });
});

describe('the multiplier is the TOTAL, not the extra', () => {
  test('the meter reads 1x now against Nx after the review', () => {
    const { html } = render({ luckyDraw: drawOf({ multiplier: 10 }) });
    expect(html).toContain('>1&times;<');
    expect(html).toContain('10&times;');
    expect(html).toContain('chances to win');
    // "more chances" would promise 11 total on a x10 draw.
    expect(html).not.toContain('more chances');
  });

  test('a campaign multiplier drives every mention', () => {
    const { html, text } = render({ luckyDraw: drawOf({ multiplier: 5 }) });
    expect(html).toContain('Want 5&times; the chances?');
    expect(text).toContain('5x chances to win');
  });
});

describe('the standing stat follows the honest-date rule', () => {
  test('a draw day is stated as the draw date', () => {
    const { html, text } = render({ luckyDraw: drawOf({ drawOn: '2026-10-22' }) });
    expect(html).toContain('DRAW DATE');
    expect(html).toContain('22 Oct 2026');
    expect(text).toContain('Draw date: 22 Oct 2026');
  });

  test('without a draw day it falls back to when entries close — never the boost deadline', () => {
    const { html } = render({ luckyDraw: drawOf({ drawOn: undefined, closesAt: '2027-01-05', boostClosesAt: '2026-09-30' }) });
    expect(html).toContain('ENTRIES CLOSE');
    expect(html).toContain('5 Jan 2027');
    expect(html).not.toContain('DRAW DATE');
    expect(html).not.toContain('30 Sep 2026');
  });

  test('with neither date the standing row disappears entirely', () => {
    const { html, text } = render({ luckyDraw: drawOf({ drawOn: undefined, closesAt: undefined }) });
    expect(html).not.toContain('DRAW DATE');
    expect(html).not.toContain('ENTRIES CLOSE');
    expect(text).not.toContain('Draw date:');
    expect(html).not.toMatch(/\{\{\w+\}\}/);
  });
});

describe('the entry pass rides the confirmation (2026-07-25 one-email merge)', () => {
  const pass = { link: 'https://redeem.sg/r/tok123', deadlineLong: '30 September 2026', hasImage: true };

  test('with a pass: cid card, live link and the review deadline — in both parts', () => {
    const { html, text } = render({ drawPass: pass });
    expect(html).toContain('YOUR ENTRY PASS');
    expect(html).toContain('cid:draw-pass');
    expect(html).toContain('https://redeem.sg/r/tok123');
    expect(html).toContain('30 September 2026');
    expect(text).toContain('https://redeem.sg/r/tok123');
    expect(text).toContain('30 September 2026');
    expect(html).not.toMatch(/\{\{\w+\}\}/);
    expect(text).not.toMatch(/\{\{\w+\}\}/);
  });

  test('a failed card render degrades to the link — never a broken image', () => {
    const { html } = render({ drawPass: { ...pass, hasImage: false } });
    expect(html).not.toContain('cid:draw-pass');
    expect(html).toContain('https://redeem.sg/r/tok123');
    expect(html).toContain('YOUR ENTRY PASS');
  });

  test('without a pass the block is absent, with no placeholder residue', () => {
    const { html, text } = render();
    expect(html).not.toContain('YOUR ENTRY PASS');
    expect(html).not.toContain('cid:draw-pass');
    expect(html).not.toMatch(/\{\{\w+\}\}/);
    expect(text).not.toMatch(/\{\{\w+\}\}/);
  });
});

describe('the 2026-07-25 copy cuts stay cut', () => {
  test('one prize mention (the meter), no eyebrow dup, no entrant/status echo, no double sign-off', () => {
    const { html, text } = render({ luckyDraw: drawOf({ prize: 'PRIZE-SENTINEL' }) });
    expect((html.match(/PRIZE-SENTINEL/g) || []).length).toBe(1);
    expect((text.match(/PRIZE-SENTINEL/g) || []).length).toBe(1);
    expect(html).not.toContain('YOU&rsquo;RE IN THE DRAW'); // uppercase eyebrow above the H1
    expect(html).not.toContain('ENTRANT');
    expect(html).not.toContain('STATUS');
    expect(html).not.toContain('TAP A BUTTON TO SHARE');
    expect(html).not.toContain('Warm regards');
    expect(html).not.toContain('Did not request this?');
    expect(text).not.toContain('Did not request this?');
    expect(text).not.toContain('Entrant:');
    expect(text).not.toContain('Status:');
  });
});

describe('escaping', () => {
  test('an operator-authored prize cannot inject markup', () => {
    const { html } = render({ luckyDraw: drawOf({ prize: '<script>alert(1)</script>' }) });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('a campaign name with an apostrophe survives intact', () => {
    const { html } = render({ campaignName: "Shawn's Draw" });
    expect(html).toContain('Shawn&#39;s Draw');
  });
});

test('the mktr.sg host gets its own letterhead', () => {
  const { html } = render({ isMktrHost: true });
  expect(html).toContain('new-mktr-wordmark-light.png');
  expect(html).toContain('MKTR PTE. LTD. (UEN 202507548M)');
});
