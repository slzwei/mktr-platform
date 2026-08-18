#!/usr/bin/env node
/**
 * Render the completed DNC Registry UAT document as a signed PDF.
 * Usage: node scripts/dnc-uat-pdf.mjs <sig.png> <chop.png> <out.pdf> --tc1 <png...> --tc2 <png...>
 * Tall screenshots are passed pre-sliced into page-sized parts, in order.
 */
import fs from 'fs';
import { chromium } from 'playwright';

const [sig, chop, out, ...rest] = process.argv.slice(2);
const tc1 = [];
const tc2 = [];
let bucket = null;
for (const a of rest) {
  if (a === '--tc1') bucket = tc1;
  else if (a === '--tc2') bucket = tc2;
  else bucket.push(a);
}
const uri = (p) => `data:image/png;base64,${fs.readFileSync(p, 'base64')}`;
const shots = (parts) => parts.map((p) => `<img class="shot" src="${uri(p)}">`).join('\n');

// Env-only, mirroring dncService.js — the org code identifies MKTR to PDPC and
// this repo is public. Export both before rendering the submission document.
const ORG_CODE = process.env.DNC_ORG_CODE;
const ESERVICE_ID = process.env.DNC_ESERVICE_ID || 'checkregistry';
if (!ORG_CODE) {
  console.error('Missing required env DNC_ORG_CODE — export it before running.');
  process.exit(1);
}

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font: 11pt/1.5 Helvetica, Arial, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 15pt; margin: 0 0 2pt; }
  .sub { color: #444; margin-bottom: 14pt; font-size: 10.5pt; }
  h2 { font-size: 12pt; margin: 16pt 0 8pt; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #666; padding: 6pt 8pt; vertical-align: top; text-align: left; }
  th { background: #e8e8e8; font-size: 10pt; }
  td.c { text-align: center; font-weight: bold; }
  .shot { width: 100%; border: 1px solid #999; margin: 6pt 0 14pt; }
  .brk { page-break-before: always; }
  .kv td { border: 1px solid #666; }
  .kv td:first-child { width: 38%; background: #f3f3f3; }
  .signbox { border: 1px solid #666; height: 110pt; position: relative; padding: 6pt; }
  .signbox img.s { position: absolute; left: 24pt; top: 8pt; height: 62pt; }
  .signbox img.k { position: absolute; left: 90pt; top: 40pt; height: 52pt; opacity: .92; }
  .signbox .cap { position: absolute; bottom: 4pt; left: 6pt; font-size: 9pt; color: #444; }
  .foot { margin-top: 18pt; font-size: 9pt; color: #666; }
</style></head><body>

<h1>DNC Registry API &ndash; UAT Test Cases</h1>
<div class="sub">Organisation: MKTR PTE. LTD. (UEN: 202507548M) &middot; orgCode ${ORG_CODE} &middot; eServiceId ${ESERVICE_ID}</div>

<table>
  <tr><th style="width:5%">S/N</th><th style="width:45%">Test Scenario</th><th style="width:10%">Pass/Fail? (P/F)</th><th>Remarks</th></tr>
  <tr>
    <td class="c">1</td>
    <td>Submit any 8-digit telephone numbers that starts with &quot;3&quot;, &quot;6&quot;, &quot;8&quot; or &quot;9&quot;. You may also use the telephone numbers provided in the test data.</td>
    <td class="c">P</td>
    <td>All 24 test-data numbers returned S000; voice/text/fax registry flags match the provided test data (transaction 1992072, results valid until 02-Sep-2026).</td>
  </tr>
  <tr>
    <td class="c">2</td>
    <td>Submit invalid telephone numbers (i.e. telephone numbers that do not start with &quot;3&quot;, &quot;6&quot;, &quot;8&quot; and &quot;9&quot;). This will return an error.</td>
    <td class="c">P</td>
    <td>Invalid numbers rejected with an error (HTTP 500, code S501). Highlighted to DNC Ops in our reply for awareness.</td>
  </tr>
</table>

<div class="brk"></div>
${shots(tc1)}

<div class="brk"></div>
${shots(tc2)}

<div class="brk"></div>
<h1>DNC Registry API &ndash; UAT Completion Acknowledgement</h1>
<h2>Organisation Details</h2>
<table class="kv">
  <tr><td>Organisation Name</td><td>MKTR PTE. LTD. (UEN: 202507548M)</td></tr>
</table>
<h2>User Acceptance Test (UAT) Details</h2>
<table class="kv">
  <tr><td>UAT Completed By (Name)</td><td>Shawn Lee Yi Heng</td></tr>
  <tr><td>Title</td><td>Product Engineer</td></tr>
  <tr><td>Telephone Number(s)</td><td>+65 9698 9089</td></tr>
  <tr><td>Email</td><td>admin@mktr.sg</td></tr>
  <tr><td>UAT Completion Date</td><td>12 Aug 2026</td></tr>
  <tr><td>Remarks (if any)</td><td>Both test scenarios passed on 12 Aug 2026. Requests signed with the registered X.509 key from whitelisted IP 159.89.201.126.</td></tr>
</table>

<h2>UAT Sign-off</h2>
<p>I acknowledge and accept that the UAT has been completed successfully.</p>
<table class="kv">
  <tr><td>Name</td><td>Shawn Lee Yi Heng</td></tr>
  <tr><td>Title</td><td>Product Engineer</td></tr>
  <tr><td>Telephone Number(s)</td><td>+65 9698 9089</td></tr>
  <tr><td>Email Address</td><td>admin@mktr.sg</td></tr>
  <tr><td>Signature</td><td style="padding:0"><div class="signbox">
    <img class="s" src="${uri(sig)}">
    <img class="k" src="${uri(chop)}">
    <div class="cap">Signed: 12 Aug 2026</div>
  </div></td></tr>
</table>

<div class="foot">MKTR PTE. LTD. &middot; DNC Registry API UAT (Log No.: 00668352) &middot; completed 12 Aug 2026</div>
</body></html>`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle' });
await page.pdf({ path: out, format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '13mm', right: '13mm' } });
await browser.close();
console.log('wrote', out);
