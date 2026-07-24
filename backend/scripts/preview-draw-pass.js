#!/usr/bin/env node
/**
 * Renders the Vault lucky-draw pass to PNGs so the artwork can be eyeballed
 * without sending a WhatsApp. Both messages, every colorway.
 *
 *   node scripts/preview-draw-pass.js [outDir] [multiplier]
 *
 * Defaults to ./tmp/draw-pass-preview and ×10. Pass a different multiplier to
 * check the hero numeral's auto-fit (2 → "2×" … 100 → "100×").
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderDrawPassPng, PASS_THEMES } from '../src/services/redeemOps/drawPassRenderer.js';

const outDir = path.resolve(process.argv[2] || 'tmp/draw-pass-preview');
const multiplier = Number(process.argv[3]) || 10;

const SAMPLE = {
  titanium: { prize: 'the iPhone 17 Pro', firstName: 'Shawn', drawDateLong: '30 October 2026' },
  gold: { prize: '$5,000 cash', firstName: 'Priya', drawDateLong: '30 November 2026' },
  emerald: { prize: 'a Bali escape for two', firstName: 'Marcus', drawDateLong: '15 December 2026' },
  sapphire: { prize: 'the PS5 Pro bundle', firstName: 'Aisha', drawDateLong: '5 January 2027' },
};

await mkdir(outDir, { recursive: true });

for (const theme of PASS_THEMES) {
  const s = SAMPLE[theme];
  for (const variant of ['pass', 'boost']) {
    const png = await renderDrawPassPng({
      variant,
      theme,
      multiplier,
      qrContent: `https://redeem.sg/r/${'x'.repeat(43)}`,
      deadlineLong: '30 September 2026',
      ...s,
    });
    const file = path.join(outDir, `${theme}-${variant}.png`);
    await writeFile(file, png);
    console.log(`${file}  ${(png.length / 1024).toFixed(0)}kB`);
  }
}
