import crypto from 'crypto';
import nodeFetch from 'node-fetch';
import * as Sentry from '@sentry/node';
import { Prospect, ProspectActivity, sequelize } from '../models/index.js';
import { logger } from '../utils/logger.js';

/**
 * dncService — checks Singapore numbers against PDPC's DNC Registry realtime API.
 * Design + threat model: docs/plans/dnc-scrubbing.md. Egress proxy: docs/dnc/egress-proxy-runbook.md.
 *
 * Transport: plain HTTPS (1-way TLS) + an RSA-SHA256 `appSignature` header PDPC verifies
 * against our submitted X.509 cert. Never throws to callers (mirrors metaCapiService); all
 * failures land in Sentry + structured logs and degrade fail-safe (lead stays unchecked → held).
 */

const ENDPOINT = 'check/registry';
const DEFAULT_BASE_URL = 'https://uat.dnc.gov.sg/realtime';
const DNC_CALL_LOCK_KEY = 'dnc_call'; // shared by request-path + backfill so all calls serialize
const DEFAULT_TIMEOUT_MS = 5000;

// Process-local monotonic clock. The advisory lock (below) guarantees one call at a
// time; this guarantees the epoch-ms timestamp never repeats or regresses WITHIN a
// process. Single-instance backend (verified) → sufficient. For a multi-instance future,
// persist lastTs in the lock tx (the lock already serialises the read-modify-write).
let lastTs = 0;

export function nextTimestamp(now = Date.now()) {
  lastTs = Math.max(now, lastTs + 1);
  return lastTs;
}

// ── Config ────────────────────────────────────────────────────────────────────

/** PEM private keys are often stored with literal "\n"; restore real newlines. */
function normalizePem(pem) {
  if (!pem) return pem;
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
}

export function dncConfig() {
  return {
    enabled: process.env.DNC_API_ENABLED === 'true',
    baseUrl: (process.env.DNC_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    orgCode: process.env.DNC_ORG_CODE || '',
    eServiceId: process.env.DNC_ESERVICE_ID || '',
    privateKey: normalizePem(process.env.DNC_PRIVATE_KEY || ''),
    checkOnBehalf: (process.env.DNC_CHECK_ON_BEHALF || 'N').toUpperCase() === 'Y' ? 'Y' : 'N',
    proxy: process.env.DNC_HTTPS_PROXY || null,
    timeoutMs: Number(process.env.DNC_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  };
}

/** True when the API is enabled AND fully credentialed — gates every outbound call. */
export function dncReady(cfg = dncConfig()) {
  return !!(cfg.enabled && cfg.orgCode && cfg.eServiceId && cfg.privateKey);
}

/**
 * Effective enforcement mode for the create path:
 *   'off'   — scrubbing disabled/unconfigured → existing pipeline behaviour, untouched
 *   'block' — born-held-pending; DNC-registered (voice) leads are withheld
 *   'flag'  — delivered with the DNC result attached to the payload
 */
export function dncEnforcement(cfg = dncConfig()) {
  if (!dncReady(cfg)) return 'off';
  return (process.env.DNC_ENFORCEMENT || 'block').toLowerCase() === 'flag' ? 'flag' : 'block';
}

// ── Pure helpers (exported for tests) ───────────────────────────────────────────

/**
 * Normalise a phone to the DNC wire format: 8 local digits starting 3/6/8/9.
 * Returns null for non-SG / malformed numbers (DNC only covers Singapore) → caller
 * marks the lead `skipped`.
 */
export function formatDncNumber(phone) {
  if (!phone) return null;
  let d = String(phone).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('65')) d = d.slice(2); // 65XXXXXXXX
  else if (d.length === 10 && d.startsWith('65')) d = d.slice(2);
  if (d.length !== 8) return null;
  if (!/^[3689]\d{7}$/.test(d)) return null;
  return d;
}

/** Signature base string — order is fixed and must match the header timestamp exactly. */
export function buildBaseString({ orgCode, eServiceId, timestamp }) {
  return `orgCode=${orgCode}&eServiceId=${eServiceId}&timestamp=${timestamp}`;
}

/** RSA-SHA256 over the base string, strict base64 (no line breaks). */
export function signRequest(baseString, privateKeyPem) {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(baseString, 'utf8');
  signer.end();
  return signer.sign(normalizePem(privateKeyPem), 'base64');
}

/** Authorization header value — field order is critical (orgCode, eServiceId, timestamp, appSignature). */
export function buildAuthHeader({ orgCode, eServiceId, timestamp, appSignature }) {
  return `orgCode=${orgCode}&eServiceId=${eServiceId}&timestamp=${timestamp}&appSignature=${appSignature}`;
}

/** Map an Annex-A status code → handling. */
export function mapStatusCode(code) {
  switch (code) {
    case 'S000': return { ok: true };
    // No credits: keep the lead retriable (→ pending) so the backfill recovers it after top-up,
    // and alert so a human tops up. Held leads stay fail-safe meanwhile.
    case 'S301': return { ok: false, retriable: true, alert: true, reason: 'insufficient_credits' };
    case 'S401':
    case 'S402':
    case 'S404': return { ok: false, retriable: false, alert: true, reason: 'auth' };
    case 'S403': return { ok: false, retriable: false, alert: true, reason: 'bad_timestamp' };
    case 'S101':
    case 'S102':
    case 'S405': return { ok: false, retriable: false, alert: true, reason: 'bad_request' };
    case 'S501': return { ok: false, retriable: true, reason: 'dnc_internal' };
    default: return { ok: false, retriable: true, reason: 'unknown' };
  }
}

/** Pull the validity end date out of the human-readable `msg` ("…valid until 06-Nov-2020"). */
export function parseValidUntil(msg) {
  if (!msg) return null;
  const m = String(msg).match(/(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/);
  if (!m) return null;
  const d = new Date(`${m[1]} ${m[2]} ${m[3]} 23:59:59 GMT+0800`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Normalise the DNC response JSON → typed result. Exported for tests. */
export function parseResponse(json) {
  const statusCode = json?.status_code || null;
  const results = Array.isArray(json?.numbers)
    ? json.numbers.map((n) => ({
        number: n.number,
        noVoiceCall: n.no_voice_call === 'R',
        noTextMessage: n.no_text_message === 'R',
        noFax: n.no_fax === 'R',
      }))
    : [];
  return {
    statusCode,
    results,
    validUntil: parseValidUntil(json?.msg),
    transactionId: json?.transactionid || null,
    createdTime: json?.created_time || null,
    rawMsg: json?.msg || null,
  };
}

// ── Proxy + call lock ───────────────────────────────────────────────────────────

/** Lazily build a CONNECT proxy agent only when DNC_HTTPS_PROXY is set. */
async function buildProxyAgent(proxyUrl) {
  if (!proxyUrl) return undefined;
  const mod = await import('https-proxy-agent');
  const HttpsProxyAgent = mod.HttpsProxyAgent || mod.default || mod;
  return new HttpsProxyAgent(proxyUrl);
}

/**
 * Serialise ALL outbound DNC calls (request-path + backfill) through one transaction-scoped
 * advisory lock — NOT a session lock (those leaked under Sequelize's pool, see
 * agentSyncService.js:216). The lock + connection are held only for the single sign+send, so
 * fresh request-path checks never queue behind a large backfill batch. Blocking acquire
 * (bounded by lock_timeout) so a queued call waits its turn rather than being dropped.
 */
async function runWithDncCallLock(fn, deps = {}) {
  const seq = deps.sequelize || sequelize;
  return seq.transaction(async (lockTx) => {
    await seq.query(`SET LOCAL lock_timeout = '30s'`, { transaction: lockTx });
    await seq.query(`SELECT pg_advisory_xact_lock(hashtext(:key))`, {
      replacements: { key: DNC_CALL_LOCK_KEY },
      transaction: lockTx,
    });
    return fn();
  });
}

// ── API call ────────────────────────────────────────────────────────────────────

/**
 * Check up to 100 SG numbers against the DNC Registry. Serialised via the call lock.
 * Returns the parsed response. Throws only on transport/timeout (caller catches).
 * @param {string[]} numbers  8-digit local numbers (caller pre-validates with formatDncNumber)
 */
export async function checkNumbers(numbers, opts = {}, deps = {}) {
  const cfg = opts.cfg || dncConfig();
  const fetchImpl = deps.fetch || nodeFetch;
  const checkOnBehalf = opts.checkOnBehalf || cfg.checkOnBehalf;

  const doCall = async () => {
    const timestamp = (deps.nextTimestamp || nextTimestamp)();
    const baseString = buildBaseString({ orgCode: cfg.orgCode, eServiceId: cfg.eServiceId, timestamp });
    const appSignature = signRequest(baseString, cfg.privateKey);
    const authHeader = buildAuthHeader({ orgCode: cfg.orgCode, eServiceId: cfg.eServiceId, timestamp, appSignature });
    const body = JSON.stringify({ numbers, total: numbers.length, checkOnBehalf });
    const agent = await buildProxyAgent(cfg.proxy);

    const res = await fetchImpl(`${cfg.baseUrl}/${ENDPOINT}`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body,
      agent,
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    const json = await res.json().catch(() => ({}));
    return { httpStatus: res.status, ...parseResponse(json) };
  };

  // Tests inject deps.skipLock to bypass the DB transaction.
  return deps.skipLock ? doCall() : runWithDncCallLock(doCall, deps);
}

// ── Check + persist + audit (single lead) ─────────────────────────────────────────

function dncFieldsFromResult(result, number, checkOnBehalf) {
  const r = result.results[0] || {};
  const registered = r.noVoiceCall || r.noTextMessage || r.noFax;
  return {
    dncStatus: registered ? 'registered' : 'clear',
    dncNoVoiceCall: !!r.noVoiceCall,
    dncNoTextMessage: !!r.noTextMessage,
    dncNoFax: !!r.noFax,
    dncCheckedAt: new Date(),
    dncValidUntil: result.validUntil || null,
    dncMetadata: {
      transactionId: result.transactionId,
      createdTime: result.createdTime,
      rawMsg: result.rawMsg,
      statusCode: result.statusCode,
      checkOnBehalf,
      numberChecked: number,
    },
  };
}

async function persistDnc(prospect, fields, deps) {
  const Model = deps.Prospect || Prospect;
  if (typeof prospect.update === 'function') return prospect.update(fields);
  return Model.update(fields, { where: { id: prospect.id } });
}

async function auditDnc(prospect, fields, deps) {
  const Activity = deps.ProspectActivity || ProspectActivity;
  const f = (b) => (b ? 'R' : 'NR');
  const valid = fields.dncValidUntil ? ` · valid until ${new Date(fields.dncValidUntil).toISOString().slice(0, 10)}` : '';
  const txn = fields.dncMetadata?.transactionId ? ` · txn ${fields.dncMetadata.transactionId}` : '';
  await Activity.create({
    prospectId: prospect.id,
    type: 'updated',
    actorUserId: null,
    description: `DNC check: voice=${f(fields.dncNoVoiceCall)} text=${f(fields.dncNoTextMessage)} fax=${f(fields.dncNoFax)}${valid}${txn}`,
    metadata: {
      dnc: {
        status: fields.dncStatus,
        noVoiceCall: fields.dncNoVoiceCall,
        noTextMessage: fields.dncNoTextMessage,
        noFax: fields.dncNoFax,
        validUntil: fields.dncValidUntil,
        statusCode: fields.dncMetadata?.statusCode,
        transactionId: fields.dncMetadata?.transactionId,
      },
    },
  }).catch((err) => deps.logger?.warn?.('[DNC] audit activity failed', { error: err?.message }) ?? logger.warn('[DNC] audit activity failed', { error: err?.message }));
}

/** True when this prospect still has a valid cached result (skip the paid re-check). */
export function hasFreshDnc(prospect, now = new Date()) {
  return (
    (prospect?.dncStatus === 'clear' || prospect?.dncStatus === 'registered') &&
    prospect?.dncValidUntil != null &&
    new Date(prospect.dncValidUntil) > now
  );
}

/**
 * Check ONE lead and record the result on its row (+ a ProspectActivity audit line).
 * Does NOT make the release/hold decision — that's the integration layer (born-held-pending).
 * Never throws. Returns { status, noVoiceCall?, noTextMessage?, noFax?, cached? }.
 */
export async function checkAndRecord(prospect, deps = {}) {
  const log = deps.logger || logger;
  const cfg = deps.cfg || dncConfig();

  if (!dncReady(cfg)) return { status: 'disabled' };

  const number = formatDncNumber(prospect.phone);
  if (!number) {
    // Non-SG / malformed → out of DNC scope; record skipped so it isn't re-tried.
    await persistDnc(prospect, { dncStatus: 'skipped', dncCheckedAt: new Date() }, deps).catch(() => {});
    return { status: 'skipped' };
  }

  if (hasFreshDnc(prospect)) {
    return { status: prospect.dncStatus, cached: true };
  }

  let result;
  try {
    result = await checkNumbers([number], { cfg, checkOnBehalf: cfg.checkOnBehalf }, deps);
  } catch (err) {
    Sentry.captureException(err, { tags: { source: 'dnc' }, extra: { prospect_id: prospect.id } });
    log.error({ err: err.message, prospect_id: prospect.id }, 'dnc.check.error');
    await persistDnc(prospect, { dncStatus: 'pending' }, deps).catch(() => {});
    return { status: 'pending', error: err.message };
  }

  const mapped = mapStatusCode(result.statusCode);
  if (!mapped.ok) {
    if (mapped.alert) {
      Sentry.captureMessage(`DNC ${result.statusCode} (${mapped.reason})`, {
        level: 'error',
        tags: { source: 'dnc', status_code: result.statusCode },
        extra: { prospect_id: prospect.id },
      });
    }
    const status = mapped.retriable ? 'pending' : 'error';
    log.warn({ status_code: result.statusCode, reason: mapped.reason, prospect_id: prospect.id }, 'dnc.check.rejected');
    await persistDnc(prospect, { dncStatus: status }, deps).catch(() => {});
    return { status, statusCode: result.statusCode, reason: mapped.reason };
  }

  const fields = dncFieldsFromResult(result, number, cfg.checkOnBehalf);
  await persistDnc(prospect, fields, deps);
  await auditDnc(prospect, fields, deps);
  log.info({ prospect_id: prospect.id, dnc_status: fields.dncStatus, txn: fields.dncMetadata.transactionId }, 'dnc.check.recorded');

  return {
    status: fields.dncStatus,
    noVoiceCall: fields.dncNoVoiceCall,
    noTextMessage: fields.dncNoTextMessage,
    noFax: fields.dncNoFax,
    validUntil: fields.dncValidUntil,
  };
}

export default {
  nextTimestamp,
  dncConfig,
  dncReady,
  formatDncNumber,
  buildBaseString,
  signRequest,
  buildAuthHeader,
  mapStatusCode,
  parseValidUntil,
  parseResponse,
  checkNumbers,
  checkAndRecord,
  hasFreshDnc,
};
