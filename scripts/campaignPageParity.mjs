/**
 * Campaign Studio v2 renderer — screenshot capture + parity-diff harness.
 *
 * Dependency-free beyond Playwright (system Chrome). No backend: serves a redeem
 * build made with VITE_API_URL=/api so the /p/:slug preview fetch is same-origin
 * and interceptable, then feeds a fixture snapshot into /api/previews/slug/**.
 *
 * Default (fixture) mode — captures, at 390 + 1280 with reduced-motion +
 * fonts.ready: Editorial+WarmCream v1 vs v2 (the migration parity baseline)
 * and each of the 6 v2 templates. Visual evidence, not a gate.
 *
 * REAL-CAMPAIGN mode (PR 5 — the per-campaign migration check):
 *   node scripts/campaignPageParity.mjs 4319 /tmp/parity \
 *     --v1-doc /path/to/design_config.json [--name label]
 *   Renders the campaign's STORED v1 doc through the old components AND the
 *   exact PROSPECTIVE server-clamped v2 doc (clampDesignConfigV2 over the
 *   in-memory upgrade — byte-what-the-first-Studio-save-persists; the write
 *   gate lives in the dispatch layer, so calling the clamp directly is the
 *   correct offline preview).
 *
 *   HARD GATE (nonzero exit): the v2 side must reach
 *   [data-campaign-page-ready] — a campaign whose v2 render breaks must never
 *   migrate. The v1-vs-v2 pixel numbers are REPORTED but not gated: the
 *   signed-off PR 2 canonicalizations (edu/salary render-but-discard fields
 *   hidden, required-label truth) legitimately shorten the page, so the pair
 *   is a HUMAN review artifact — expect the form-section delta, stop on
 *   anything else (hero/story/chrome should match closely).
 *
 * Usage (repo root):
 *   VITE_BRAND=redeem VITE_API_URL=/api npx vite build --outDir dist-parity
 *   npx vite preview --outDir dist-parity --port 4319 --strictPort &
 *   node scripts/campaignPageParity.mjs 4319 /tmp/campaign-parity
 */
import { writeFileSync, readFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
// Resolve playwright from this checkout OR the parent checkout (git worktrees
// under .claude/worktrees/<name> lack their own node_modules) — same walk as
// scripts/studioSmoke.mjs.
const PW_CANDIDATES = [
  new URL('../node_modules/playwright/index.mjs', import.meta.url),
  new URL('../../../../node_modules/playwright/index.mjs', import.meta.url),
];
const pwUrl = PW_CANDIDATES.find((u) => existsSync(u));
if (!pwUrl) {
  console.error('playwright not found — npm i playwright (or run from the main checkout)');
  process.exit(1);
}
const { chromium } = await import(pwUrl.href);
import { upgradeDesignConfig } from '../src/lib/designConfigV2.js';
// Backend twin — model-free util graph, safe to import from a script. This is
// the SERVER's clamp, so the v2 side of the diff is exactly what a Studio
// save would persist.
import { clampDesignConfigV2 } from '../backend/src/utils/designConfigV2Clamp.js';

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) {
    flags[argv[i].slice(2)] = argv[i + 1];
    i += 1;
  } else positional.push(argv[i]);
}
const PORT = positional[0] || '4319';
const OUT = positional[1] || '/tmp/campaign-parity';
const V1_DOC_PATH = flags['v1-doc'] || null;
const DOC_NAME = flags.name || 'real-campaign';
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

async function shoot(browser, snapshot, width, file, { requireReady = false } = {}) {
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
    if (requireReady) {
      // The migration hard gate: the (v2) renderer must actually mount.
      await page.waitForSelector('[data-campaign-page-ready="true"]', { timeout: 15000 });
    }
    await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: file, fullPage: true });
    return statSync(file).size;
  } finally {
    await page.close();
  }
}

/** In-browser pixel diff (canvas ImageData) — dependency-free. Returns
 * {width,height,diffPixels,totalPixels,diffPct} or {dimensionMismatch}. */
async function pixelDiff(browser, fileA, fileB) {
  const page = await browser.newPage();
  try {
    const toDataUrl = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
    return await page.evaluate(
      async ([a, b]) => {
        const load = (src) =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
          });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        if (ia.width !== ib.width || ia.height !== ib.height) {
          return { dimensionMismatch: true, a: { w: ia.width, h: ia.height }, b: { w: ib.width, h: ib.height } };
        }
        const draw = (img) => {
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          return ctx.getImageData(0, 0, img.width, img.height).data;
        };
        const da = draw(ia);
        const db = draw(ib);
        let diff = 0;
        // per-channel tolerance 8/255 absorbs AA + font rasterization noise
        for (let i = 0; i < da.length; i += 4) {
          if (
            Math.abs(da[i] - db[i]) > 8 ||
            Math.abs(da[i + 1] - db[i + 1]) > 8 ||
            Math.abs(da[i + 2] - db[i + 2]) > 8
          ) diff += 1;
        }
        const total = da.length / 4;
        return { width: ia.width, height: ia.height, diffPixels: diff, totalPixels: total, diffPct: (diff / total) * 100 };
      },
      [toDataUrl(fileA), toDataUrl(fileB)]
    );
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const captured = [];
  const report = { mode: V1_DOC_PATH ? 'real-campaign' : 'fixture', name: DOC_NAME, diffs: {} };
  let failed = false;
  try {
    if (V1_DOC_PATH) {
      // REAL-CAMPAIGN migration check: stored v1 doc vs the prospective
      // server-clamped v2 doc (what the first Studio save persists). The v2
      // captures HARD-require the page-ready marker; the pixel numbers are
      // review evidence (the signed-off form-section canonicalizations make a
      // strict pixel gate meaningless).
      const v1Doc = JSON.parse(readFileSync(V1_DOC_PATH, 'utf8'));
      const v2Doc = clampDesignConfigV2(upgradeDesignConfig(v1Doc), v1Doc, 'admin');
      writeFileSync(path.join(OUT, `${DOC_NAME}-v2-doc.json`), JSON.stringify(v2Doc, null, 2));
      for (const [label, width] of Object.entries(WIDTHS)) {
        const fa = path.join(OUT, `${DOC_NAME}-v1-${label}.png`);
        const fb = path.join(OUT, `${DOC_NAME}-v2-${label}.png`);
        captured.push([`${DOC_NAME}-v1-${label}`, await shoot(browser, snapshotFor(v1Doc, DOC_NAME), width, fa)]);
        try {
          captured.push([`${DOC_NAME}-v2-${label}`, await shoot(browser, snapshotFor(v2Doc, DOC_NAME), width, fb, { requireReady: true })]);
        } catch (e) {
          failed = true;
          report.diffs[label] = { v2RenderFailed: String(e?.message || e) };
          console.error(`  ✗ v2 render FAILED at ${label}: ${e?.message || e}`);
          continue;
        }
        const d = await pixelDiff(browser, fa, fb);
        report.diffs[label] = d;
        console.log(
          `  v1↔v2 ${label}: ${d.dimensionMismatch ? `heights differ ${d.a.h}→${d.b.h}px (expected: signed-off form canonicalizations)` : `${d.diffPct.toFixed(3)}% of ${d.totalPixels}px`} — review the pair`
        );
      }
    } else {
      const v2Editorial = upgradeDesignConfig(V1_EDITORIAL);
      for (const [label, width] of Object.entries(WIDTHS)) {
        const fa = path.join(OUT, `editorial-v1-${label}.png`);
        const fb = path.join(OUT, `editorial-v2-${label}.png`);
        captured.push(['editorial-v1-' + label, await shoot(browser, snapshotFor(V1_EDITORIAL, 'Editorial v1'), width, fa)]);
        captured.push(['editorial-v2-' + label, await shoot(browser, snapshotFor(v2Editorial, 'Editorial v2'), width, fb)]);
        report.diffs[label] = await pixelDiff(browser, fa, fb); // informational in fixture mode
      }
      for (const tpl of ['editorial', 'poster', 'split', 'spotlight', 'express', 'journey']) {
        const doc = upgradeDesignConfig(V1_EDITORIAL);
        doc.template.id = tpl;
        for (const [label, width] of Object.entries(WIDTHS)) {
          captured.push([`smoke-${tpl}-${label}`, await shoot(browser, snapshotFor(doc, `${tpl} smoke`), width, path.join(OUT, `smoke-${tpl}-${label}.png`))]);
        }
      }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(path.join(OUT, 'captured.json'), JSON.stringify(captured, null, 2));
  writeFileSync(path.join(OUT, 'parity-report.json'), JSON.stringify(report, null, 2));
  console.log('CAPTURED', captured.length, 'screenshots →', OUT);
  for (const [name, size] of captured) console.log(`  ${name}: ${size} bytes`);
  if (failed) {
    console.error('MIGRATION GATE FAILED — the v2 render did not mount. Do NOT migrate this campaign.');
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
