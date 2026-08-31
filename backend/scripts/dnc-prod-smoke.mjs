#!/usr/bin/env node
/**
 * DNC Registry PRODUCTION connectivity smoke — drives the REAL dncService code path
 * (signing, auth header, body shape, egress proxy, response parsing) against PDPC's
 * PRODUCTION environment, to satisfy "please test the connection and confirm"
 * (DNC Ops, 27 Aug 2026).
 *
 * Usage:
 *   node scripts/dnc-prod-smoke.mjs selfcheck       # offline: sign + verify vs mycert.cer
 *   node scripts/dnc-prod-smoke.mjs check 62773210  # LIVE — spends 1 prepaid credit
 *   node scripts/dnc-prod-smoke.mjs invalid         # LIVE — no valid number, expect S501
 *
 * Reads ~/dnc-keys/privatekey.key and ~/dnc-keys/proxy-credentials.txt unless
 * DNC_PRIVATE_KEY / DNC_HTTPS_PROXY are set. Never prints the private key.
 * DNC_ORG_CODE must be exported (this repo is public — no org code is committed).
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import nodeFetch from 'node-fetch';

const svc = await import('../src/services/dncService.js');
const { buildBaseString, signRequest, buildAuthHeader, checkNumbers, formatDncNumber, nextTimestamp } = svc;

const PROD_BASE_URL = 'https://www.dnc.gov.sg/realtime';

function mustEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing required env ${name} — export it before running.`); process.exit(1); }
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
function prodConfig() {
  return {
    enabled: true,
    baseUrl: (process.env.DNC_BASE_URL || PROD_BASE_URL).replace(/\/+$/, ''),
    orgCode: mustEnv('DNC_ORG_CODE'),
    eServiceId: process.env.DNC_ESERVICE_ID || 'checkregistry',
    privateKey: loadPrivateKey(),
    checkOnBehalf: 'N',
    proxy: loadProxy(),
    timeoutMs: Number(process.env.DNC_TIMEOUT_MS) || 20000,
  };
}

// Wire capture — evidence shows PDPC the exact request/response.
const captures = [];
function teeFetch(url, init) {
  return nodeFetch(url, init).then(async (res) => {
    const text = await res.text();
    captures.push({
      at: new Date().toISOString(), url, method: init.method,
      requestHeaders: { ...init.headers }, requestBody: init.body,
      httpStatus: res.status, httpStatusText: res.statusText, responseBody: text,
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
  try { console.log(JSON.stringify(JSON.parse(c.responseBody), null, 2)); }
  catch { console.log(c.responseBody); }
}

function selfcheck(cfg) {
  hr('SELFCHECK (offline — no network, no credits)');
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
  if (!ok) process.exitCode = 1;
  return ok;
}

async function liveCheck(cfg, numbers, label) {
  hr(label);
  const result = await checkNumbers(numbers, { cfg }, { skipLock: true, skipBudget: true, fetch: teeFetch });
  printCapture(captures[captures.length - 1]);
  console.log(`\nstatus_code=${result.statusCode ?? '(none)'} results=${result.results.length} txn=${result.transactionId ?? '-'}`);
  for (const r of result.results) {
    console.log(`  ${r.number}: no_voice_call=${r.noVoiceCall ? 'R' : 'NR'} no_text=${r.noTextMessage ? 'R' : 'NR'} no_fax=${r.noFax ? 'R' : 'NR'}`);
  }
  if (result.validUntil) console.log(`valid until: ${new Date(result.validUntil).toISOString().slice(0, 10)}`);
  return result;
}

// -- Main --------------------------------------------------------------------
const mode = process.argv[2] || 'selfcheck';
const cfg = prodConfig();
const isProd = cfg.baseUrl.includes('www.dnc.gov.sg');
console.log(`DNC PROD smoke — ${cfg.baseUrl}  orgCode=${cfg.orgCode}  eServiceId=${cfg.eServiceId}  proxy=${cfg.proxy ? 'droplet' : 'DIRECT'}  env=${isProd ? 'PRODUCTION' : 'non-prod'}`);

try {
  if (mode === 'selfcheck') {
    selfcheck(cfg);
  } else if (mode === 'check') {
    const raw = process.argv[3];
    if (!raw) { console.error('Usage: dnc-prod-smoke.mjs check <sg-number>'); process.exit(1); }
    const n = formatDncNumber(raw);
    if (!n) { console.error(`"${raw}" is not a valid SG DNC number (8 digits starting 3/6/8/9).`); process.exit(1); }
    selfcheck(cfg);
    await liveCheck(cfg, [n], `LIVE CHECK — 1 number (${n}) — SPENDS 1 CREDIT`);
  } else if (mode === 'invalid') {
    await liveCheck(cfg, ['12345678'], 'LIVE — no valid telephone number, expect S501 (per DNC Ops 27 Aug 2026)');
  } else {
    console.error(`Unknown mode "${mode}". Use: selfcheck | check <number> | invalid`);
    process.exit(1);
  }
} catch (err) {
  console.error(`\nTRANSPORT ERROR: ${err.message}`);
  process.exitCode = 1;
}

if (captures.length) {
  const out = process.env.DNC_PROD_EVIDENCE || path.join(process.cwd(), `dnc-prod-evidence-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(captures, null, 2));
  console.log(`\nWire evidence written: ${out}`);
}
