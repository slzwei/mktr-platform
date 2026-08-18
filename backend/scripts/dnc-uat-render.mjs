#!/usr/bin/env node
/**
 * Render DNC UAT wire evidence (captures JSON from dnc-uat.mjs) into PNG
 * screenshots, one per test case, via Playwright chromium.
 * Usage: node render-evidence.mjs <evidence.json> <outdir>
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const [evidencePath, outDir, titleOverride] = process.argv.slice(2);
const captures = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

const TITLES = [
  'Test Case 1 — Valid 8-digit numbers (UAT test data, 24 numbers)',
  'Test Case 2 — Invalid numbers (not starting with 3/6/8/9) — expected rejection',
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pretty = (s) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };

function page(cap, title) {
  const sgt = new Date(cap.at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', hour12: false });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body { margin:0; background:#0d1117; color:#e6edf3; font:14px/1.55 "SF Mono", ui-monospace, Menlo, monospace; }
  .wrap { width: 1360px; padding: 28px 36px; box-sizing: border-box; }
  .head { display:flex; justify-content:space-between; align-items:baseline; border-bottom:1px solid #30363d; padding-bottom:14px; margin-bottom:18px; }
  .head h1 { font-size:17px; margin:0; color:#f0f6fc; font-weight:600; }
  .head .meta { color:#8b949e; font-size:12.5px; }
  h2 { font-size:13px; color:#7ee787; text-transform:uppercase; letter-spacing:.08em; margin:20px 0 8px; }
  h2.resp { color:#79c0ff; }
  pre { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:14px 16px; margin:0;
        white-space:pre-wrap; word-break:break-all; font-size:13px; }
  .status { display:inline-block; margin:14px 0 0; padding:4px 12px; border-radius:6px; font-weight:600;
            background:${cap.httpStatus < 400 ? '#1f6feb22; color:#79c0ff' : '#da363322; color:#ffa198'}; }
  .foot { margin-top:20px; color:#8b949e; font-size:12px; border-top:1px solid #30363d; padding-top:12px; }
  </style></head><body><div class="wrap">
  <div class="head"><h1>${esc(title)}</h1><div class="meta">DNC Registry API UAT · MKTR PTE. LTD. (UEN 202507548M)</div></div>
  <h2>Request</h2>
  <pre>POST ${esc(cap.url)}
Authorization: ${esc(cap.requestHeaders.Authorization)}
Content-Type: ${esc(cap.requestHeaders['Content-Type'])}

${esc(pretty(cap.requestBody))}</pre>
  <span class="status">HTTP ${cap.httpStatus} ${esc(cap.httpStatusText || '')}</span>
  <h2 class="resp">Response</h2>
  <pre>${esc(pretty(cap.responseBody))}</pre>
  <div class="foot">Executed ${sgt} SGT · source IP 159.89.201.126 (whitelisted application server) · endpoint ${esc(new URL(cap.url).host)}</div>
  </div></body></html>`;
}

const browser = await chromium.launch({ channel: 'chrome' });
const bp = await browser.newPage({ viewport: { width: 1360, height: 900 } });
for (let i = 0; i < captures.length; i += 1) {
  await bp.setContent(page(captures[i], titleOverride || TITLES[i] || `Capture ${i + 1}`), { waitUntil: 'networkidle' });
  const file = path.join(outDir, `tc${i + 1}.png`);
  await bp.screenshot({ path: file, fullPage: true });
  console.log('wrote', file);
}
await browser.close();
