/**
 * Campaign Studio v2 renderer — screenshot capture harness (visual evidence).
 *
 * Dependency-free beyond Playwright (system Chrome). No backend: serves a redeem
 * build made with VITE_API_URL=/api so the /p/:slug preview fetch is same-origin
 * and interceptable, then feeds a fixture snapshot into /api/previews/slug/**.
 *
 * Captures, at 390 + 1280 with reduced-motion + fonts.ready:
 *   - Editorial + Warm Cream, v1 (old components) AND v2 (new renderer) — the
 *     migration parity baseline (compare the two PNGs by eye / external diff).
 *   - Each of the 6 v2 templates (no-media, deterministic).
 *
 * Behavioral parity is guaranteed by construction (the v2 renderer REUSES the
 * production funnel) and covered by the vitest suites — these PNGs are visual
 * evidence for the PR, not a hard pass/fail gate (remote Google fonts make a
 * strict pixel threshold noisy; Codex review §8).
 *
 * Usage (repo root):
 *   VITE_BRAND=redeem VITE_API_URL=/api npx vite build --outDir dist-parity
 *   npx vite preview --outDir dist-parity --port 4319 --strictPort &
 *   node scripts/campaignPageParity.mjs 4319 /tmp/campaign-parity
 */
import { chromium } from '../node_modules/playwright/index.mjs';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { upgradeDesignConfig } from '../src/lib/designConfigV2.js';

const PORT = process.argv[2] || '4319';
const OUT = process.argv[3] || '/tmp/campaign-parity';
mkdirSync(OUT, { recursive: true });
const BASE = `http://localhost:${PORT}`;

const V1_EDITORIAL = {
  formHeadline: 'Get your $10 voucher',
  formSubheadline: 'Your voucher code arrives by SMS after verification.',
  brandWordmark: 'redeem.sg',
  storyText: 'We are giving away 2,000 vouchers to Singapore households.\n\nSign up and verify your number.',
  storyEmphasis: 'S$10, yours in under a minute.',
  ctaText: 'Redeem Now',
  themeColor: '#D17029',
  heroFont: 'fraunces',
  customerHost: 'redeem',
  otpChannel: 'sms',
  visibleFields: { dob: true, postal_code: true },
  requiredFields: { dob: true },
};

const WIDTHS = { mobile: 390, desktop: 1280 };
const snapshotFor = (design_config, name) => ({ id: 'parity-1', name, type: 'lead_generation', is_active: true, min_age: 18, max_age: 65, design_config });

async function shoot(browser, snapshot, width, file) {
  const page = await browser.newPage();
  try {
    await page.route('**/api/**', (route) => {
      const url = route.request().url();
      if (url.includes('/previews/slug/')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { snapshot } }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false }) });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${BASE}/p/parity-slug`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: file, fullPage: true });
    return statSync(file).size;
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const captured = [];
  try {
    const v2Editorial = upgradeDesignConfig(V1_EDITORIAL);
    for (const [label, width] of Object.entries(WIDTHS)) {
      captured.push(['editorial-v1-' + label, await shoot(browser, snapshotFor(V1_EDITORIAL, 'Editorial v1'), width, path.join(OUT, `editorial-v1-${label}.png`))]);
      captured.push(['editorial-v2-' + label, await shoot(browser, snapshotFor(v2Editorial, 'Editorial v2'), width, path.join(OUT, `editorial-v2-${label}.png`))]);
    }
    for (const tpl of ['editorial', 'poster', 'split', 'spotlight', 'express', 'journey']) {
      const doc = upgradeDesignConfig(V1_EDITORIAL);
      doc.template.id = tpl;
      for (const [label, width] of Object.entries(WIDTHS)) {
        captured.push([`smoke-${tpl}-${label}`, await shoot(browser, snapshotFor(doc, `${tpl} smoke`), width, path.join(OUT, `smoke-${tpl}-${label}.png`))]);
      }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(path.join(OUT, 'captured.json'), JSON.stringify(captured, null, 2));
  console.log('CAPTURED', captured.length, 'screenshots →', OUT);
  for (const [name, size] of captured) console.log(`  ${name}: ${size} bytes`);
})().catch((e) => { console.error(e); process.exit(1); });
