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
  // No drawOn — proves the third stat falls back to the entry close date.
  sapphire: { name: 'PS5 Pro Bundle Lucky Draw', prize: 'the PS5 Pro bundle', multiplier: 7, closesAt: '2027-01-05', firstName: 'Aisha' },
};

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
  });
  const left = html.match(/\{\{\w+\}\}/g);
  if (left) console.warn(`  ! ${theme}: unsubstituted placeholders ${[...new Set(left)].join(', ')}`);
  await writeFile(path.join(outDir, `${theme}.html`), html);
  await writeFile(path.join(outDir, `${theme}.txt`), text);
  console.log(`${path.join(outDir, `${theme}.html`)}  ${(html.length / 1024).toFixed(1)}kB`);
}
