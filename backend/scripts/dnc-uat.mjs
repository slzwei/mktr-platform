#!/usr/bin/env node
/**
 * DNC Registry UAT runner — drives the REAL production dncService code path
 * (signing, auth header, body shape, proxy, response parsing) against PDPC's
 * UAT environment, per "DNC Registry API - UAT Test Cases_v1.xlsx".
 *
 * Usage:
 *   node scripts/dnc-uat.mjs selfcheck        # offline: sign + verify vs mycert.cer
 *   node scripts/dnc-uat.mjs tc1              # live: 24 seeded numbers vs expected flags
 *   node scripts/dnc-uat.mjs tc2              # live: invalid numbers -> expect error
 *   node scripts/dnc-uat.mjs all              # selfcheck + tc1 + tc2 (+ JSON evidence)
 *
 * Reads ~/dnc-keys/privatekey.key and ~/dnc-keys/proxy-credentials.txt unless
 * DNC_PRIVATE_KEY / DNC_HTTPS_PROXY are set. Never prints the private key.
 * Requires dummy DB env for the models import chain (never connects): set by run-uat.sh.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import nodeFetch from 'node-fetch';

const svc = await import('../src/services/dncService.js');
const { buildBaseString, signRequest, buildAuthHeader, checkNumbers, formatDncNumber, nextTimestamp } = svc;

// ── Expected UAT seed data (from "DNC Registry API UAT Test Data" sheet) ──────
// number: [no_voice_call, no_text_message, no_fax]
const EXPECTED = {
  88880005: ['R', 'NR', 'NR'], 88880011: ['NR', 'R', 'NR'], 88880026: ['NR', 'R', 'R'],
  88880027: ['R', 'R', 'R'],   88880031: ['R', 'NR', 'NR'], 88880036: ['NR', 'R', 'NR'],
  88880038: ['R', 'R', 'NR'],  88880040: ['R', 'R', 'NR'],  88880050: ['NR', 'NR', 'R'],
  88880051: ['NR', 'R', 'NR'], 88880052: ['NR', 'R', 'NR'], 88880053: ['R', 'R', 'R'],
  88880054: ['NR', 'R', 'NR'], 88880057: ['R', 'NR', 'NR'], 88880058: ['R', 'R', 'R'],
  88880059: ['R', 'R', 'R'],   88880060: ['R', 'R', 'R'],   88880081: ['R', 'R', 'R'],
  88880082: ['R', 'R', 'R'],   88880083: ['R', 'R', 'R'],   88880084: ['R', 'R', 'R'],
  88880089: ['R', 'R', 'R'],   88880091: ['R', 'R', 'R'],   88880095: ['R', 'R', 'R'],
};
const TC1_NUMBERS = Object.keys(EXPECTED);
const TC2_NUMBERS = ['12345678', '00000000']; // do not start with 3/6/8/9 -> API must reject

// ── Config (env-first, ~/dnc-keys fallbacks) ──────────────────────────────────
function mustEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env ${name} — export it before running.`);
    process.exit(1);
  }
  return v;
}
function loadPrivateKey() {
  if (process.env.DNC_PRIVATE_KEY) return process.env.DNC_PRIVATE_KEY.replace(/\\n/g, '\n');
  return fs.readFileSync(path.join(os.homedir(), 'dnc-keys', 'privatekey.key'), 'utf8');
}
function loadProxy() {
  if (process.env.DNC_HTTPS_PROXY) return process.env.DNC_HTTPS_PROXY;
  try {
    const txt = fs.readFileSync(path.join(os.homedir(), 'dnc-keys', 'proxy-credentials.txt'), 'utf8');
    const m = txt.match(/DNC_HTTPS_PROXY=(\S+)/);
    return m ? m[1] : null;
  } catch { return null; }
}
function uatConfig() {
  return {
    enabled: true,
    baseUrl: (process.env.DNC_BASE_URL || 'https://uat.dnc.gov.sg/realtime').replace(/\/+$/, ''),
    // Env-only, mirroring dncService.js — the org code identifies MKTR to PDPC
    // and this repo is public.
    orgCode: mustEnv('DNC_ORG_CODE'),
    eServiceId: process.env.DNC_ESERVICE_ID || 'checkregistry',
    privateKey: loadPrivateKey(),
    checkOnBehalf: 'N',
    proxy: loadProxy(),
    timeoutMs: Number(process.env.DNC_TIMEOUT_MS) || 20000,
  };
}

// ── Wire capture: tee fetch so evidence shows the exact request/response ──────
const captures = [];
function teeFetch(url, init) {
  return nodeFetch(url, init).then(async (res) => {
    const text = await res.text();
    captures.push({
      at: new Date().toISOString(),
      url,
      method: init.method,
      requestHeaders: { ...init.headers },
      requestBody: init.body,
      httpStatus: res.status,
      httpStatusText: res.statusText,
      responseBody: text,
    });
    return { status: res.status, json: async () => JSON.parse(text) };
  });
}

const hr = (t) => console.log(`\n━━━ ${t} ${'━'.repeat(Math.max(0, 66 - t.length))}`);

function printCapture(c) {
  console.log(`POST ${c.url}`);
  console.log(`Authorization: ${c.requestHeaders.Authorization}`);
  console.log(`Content-Type: ${c.requestHeaders['Content-Type']}`);
  console.log(`Payload: ${c.requestBody}`);
  console.log(`\nHTTP ${c.httpStatus} ${c.httpStatusText}  (${c.at})`);
  try {
    console.log(JSON.stringify(JSON.parse(c.responseBody), null, 2));
  } catch {
    console.log(c.responseBody);
  }
}

// ── Steps ─────────────────────────────────────────────────────────────────────
function selfcheck(cfg) {
  hr('SELFCHECK (offline)');
  const timestamp = nextTimestamp();
  const baseString = buildBaseString({ orgCode: cfg.orgCode, eServiceId: cfg.eServiceId, timestamp });
  const appSignature = signRequest(baseString, cfg.privateKey);
  const header = buildAuthHeader({ orgCode: cfg.orgCode, eServiceId: cfg.eServiceId, timestamp, appSignature });
  console.log(`Base string      : ${baseString}`);
  console.log(`Auth header      : ${header.slice(0, 96)}…`);
  console.log(`Signature 1-line : ${!/[\r\n]/.test(appSignature)}`);

  const cert = new crypto.X509Certificate(fs.readFileSync(path.join(os.homedir(), 'dnc-keys', 'mycert.cer')));
  const ok = crypto.createVerify('RSA-SHA256').update(baseString, 'utf8').verify(cert.publicKey, appSignature, 'base64');
  console.log(`Signature verifies against mycert.cer (the key PDPC holds): ${ok ? 'PASS' : 'FAIL'}`);

  const allFormatted = TC1_NUMBERS.every((n) => formatDncNumber(n) === n);
  console.log(`All 24 seed numbers valid DNC wire format: ${allFormatted ? 'PASS' : 'FAIL'}`);
  if (!ok || !allFormatted) process.exitCode = 1;
  return ok && allFormatted;
}

async function runTc1(cfg) {
  hr('TC1 — valid numbers (24 seeded UAT test numbers)');
  const result = await checkNumbers(TC1_NUMBERS, { cfg }, { skipLock: true, skipBudget: true, fetch: teeFetch });
  printCapture(captures[captures.length - 1]);

  const pass = result.statusCode === 'S000' && result.results.length === TC1_NUMBERS.length;
  console.log(`\nstatus_code=${result.statusCode} results=${result.results.length}/${TC1_NUMBERS.length} txn=${result.transactionId}`);

  let mismatches = 0;
  for (const r of result.results) {
    const exp = EXPECTED[r.number];
    if (!exp) continue;
    const got = [r.noVoiceCall ? 'R' : 'NR', r.noTextMessage ? 'R' : 'NR', r.noFax ? 'R' : 'NR'];
    const match = got.join() === exp.join();
    if (!match) {
      mismatches += 1;
      console.log(`  MISMATCH ${r.number}: expected voice/text/fax=${exp.join('/')} got ${got.join('/')}`);
    }
  }
  console.log(`Seed-data comparison: ${mismatches === 0 ? 'all 24 match expected flags' : `${mismatches} mismatches (see above)`}`);
  console.log(`TC1 ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) process.exitCode = 1;
  return { pass, mismatches, result };
}

async function runTc2(cfg) {
  hr('TC2 — invalid numbers (must be rejected)');
  const result = await checkNumbers(TC2_NUMBERS, { cfg }, { skipLock: true, skipBudget: true, fetch: teeFetch });
  const cap = captures[captures.length - 1];
  printCapture(cap);

  // Any error signal counts: non-S000 status_code or an HTTP error status.
  const isError = result.statusCode !== 'S000' || cap.httpStatus >= 400;
  console.log(`\nstatus_code=${result.statusCode ?? '(none)'} http=${cap.httpStatus}`);
  console.log(`TC2 ${isError ? 'PASS (rejected as expected)' : 'FAIL (accepted invalid numbers)'}`);
  if (!isError) process.exitCode = 1;
  return { pass: isError, result };
}

// ── Main ──────────────────────────────────────────────────────────────────────
const mode = process.argv[2] || 'all';
const cfg = uatConfig();
console.log(`DNC UAT runner — ${cfg.baseUrl}  orgCode=${cfg.orgCode}  eServiceId=${cfg.eServiceId}  proxy=${cfg.proxy ? 'droplet' : 'DIRECT'}`);

try {
  if (mode === 'selfcheck' || mode === 'all') selfcheck(cfg);
  if (mode === 'tc1' || mode === 'all') await runTc1(cfg);
  if (mode === 'tc2' || mode === 'all') await runTc2(cfg);
} catch (err) {
  console.error(`\nTRANSPORT ERROR: ${err.message}`);
  process.exitCode = 1;
}

if (captures.length) {
  const out = process.env.DNC_UAT_EVIDENCE || path.join(process.cwd(), `dnc-uat-evidence-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(captures, null, 2));
  console.log(`\nWire evidence written: ${out}`);
}
