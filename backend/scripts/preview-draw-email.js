#!/usr/bin/env node
/**
 * Renders the Onyx draw confirmation email to HTML files (one per colourway)
 * so it can be opened in a browser or pasted into a client-preview tool.
 * Goes through the real renderLeadConfirmation path, so what you see here is
 * byte-identical to what sendLeadConfirmationEmail puts on the wire.
 *
 *   node scripts/preview-draw-email.js [outDir]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderLeadConfirmation } from '../src/services/email-templates/leadConfirmation.js';
import { PASS_THEMES } from '../src/utils/drawTheme.js';

const outDir = path.resolve(process.argv[2] || 'tmp/draw-email-preview');

const SAMPLE = {
  titanium: { name: 'iPhone 17 Pro Lucky Draw', prize: 'iPhone 17 Pro 256GB', multiplier: 10, drawOn: '2026-10-22', firstName: 'Shawn' },
  gold: { name: '$5,000 Cash Lucky Draw', prize: '$5,000 cash', multiplier: 10, drawOn: '2026-11-30', firstName: 'Priya' },
  emerald: { name: 'Bali Escape Lucky Draw', prize: 'a Bali escape for two', multiplier: 5, drawOn: '2026-12-15', firstName: 'Marcus' },
  // No drawOn — proves the standing stat falls back to the entry close date.
  sapphire: { name: 'PS5 Pro Bundle Lucky Draw', prize: 'the PS5 Pro bundle', multiplier: 7, closesAt: '2027-01-05', firstName: 'Aisha' },
};

// The merged pass block (2026-07-25): titanium previews the full card slot,
// emerald previews the no-image degrade (link only), the rest preview the
// fallback confirmation an entitlement-less signup gets (no pass block).
const PASS_SAMPLE = {
  titanium: { link: 'https://redeem.sg/r/previewtoken', deadlineLong: '30 September 2026', hasImage: true },
  emerald: { link: 'https://redeem.sg/r/previewtoken', deadlineLong: '15 December 2026', hasImage: false },
};

// Browsers cannot resolve cid: attachments — swap in a neutral stand-in so the
// preview shows the slot. The wire HTML (and the placeholder check) is untouched.
const CARD_STUB = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">'
  + '<rect width="100%" height="100%" fill="#15161a"/>'
  + '<text x="50%" y="50%" fill="#8a7748" font-family="monospace" font-size="52" text-anchor="middle">VAULT CARD PREVIEW</text>'
  + '</svg>'
).toString('base64');

await mkdir(outDir, { recursive: true });

for (const theme of PASS_THEMES) {
  const s = SAMPLE[theme];
  const { html, text } = renderLeadConfirmation({
    firstName: s.firstName,
    campaignName: s.name,
    isMktrHost: false,
    shareUrl: 'https://redeem.sg/share/niyooei0',
    unsubscribeUrl: 'https://api.mktr.sg/api/unsubscribe?t=demo',
    unsubscribeTextLine: 'Unsubscribe from marketing messages: https://api.mktr.sg/api/unsubscribe?t=demo',
    luckyDraw: {
      enabled: true, passTheme: theme, prize: s.prize, multiplier: s.multiplier,
      drawOn: s.drawOn, closesAt: s.closesAt,
    },
    drawPass: PASS_SAMPLE[theme] || null,
  });
  const left = html.match(/\{\{\w+\}\}/g);
  if (left) console.warn(`  ! ${theme}: unsubstituted placeholders ${[...new Set(left)].join(', ')}`);
  await writeFile(
    path.join(outDir, `${theme}.html`),
    html.replace('src="cid:draw-pass"', `src="data:image/svg+xml;base64,${CARD_STUB}"`)
  );
  await writeFile(path.join(outDir, `${theme}.txt`), text);
  console.log(`${path.join(outDir, `${theme}.html`)}  ${(html.length / 1024).toFixed(1)}kB`);
}
