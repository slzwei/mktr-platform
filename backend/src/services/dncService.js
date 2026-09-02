import nodeFetch from 'node-fetch';
import * as Sentry from '@sentry/node';
import { Prospect, ProspectActivity, sequelize } from '../models/index.js';
import { logger } from '../utils/logger.js';
import { isSandbox } from '../utils/deployEnv.js';
import { guardPhoneRail, releasePhoneRail } from './outboundPolicy.js';
import { submitToGateway } from './dncGatewayClient.js';
import {
  normalizePem,
  formatDncNumber,
  buildBaseString,
  signRequest,
  buildAuthHeader,
  mapStatusCode,
  parseValidUntil,
  parseResponse,
  DNC_CHECK_ENDPOINT,
} from './dncProtocol.js';

/**
 * dncService — checks Singapore numbers against PDPC's DNC Registry realtime API.
 * Design + threat model: docs/plans/dnc-scrubbing.md. Egress proxy: docs/dnc/egress-proxy-runbook.md.
 *
 * Transport: plain HTTPS (1-way TLS) + an RSA-SHA256 `appSignature` header PDPC verifies
 * against our submitted X.509 cert. Never throws to callers (mirrors metaCapiService); all
 * failures land in Sentry + structured logs and degrade fail-safe (lead stays unchecked → held).
 */

const ENDPOINT = DNC_CHECK_ENDPOINT;
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

// In-process hourly credit budget — a safety cap that sits BELOW every paid DNC call
// (create, Retell, backfill, and the form /dnc/check) so no single caller can drain
// prepaid credits. Resets hourly; single-instance backend → in-memory is sufficient.
let budgetWindowStart = Date.now();
let budgetSpent = 0;

function withinBudget(count) {
  const now = Date.now();
  if (now - budgetWindowStart > 3_600_000) {
    budgetWindowStart = now;
    budgetSpent = 0;
  }
  const cap = Number(process.env.DNC_HOURLY_BUDGET) || 1000;
  if (budgetSpent + count > cap) return false;
  budgetSpent += count;
  return true;
}

/** Test helper — reset the hourly budget window. */
export function _resetDncBudget() {
  budgetWindowStart = Date.now();
  budgetSpent = 0;
}

// ── Config ────────────────────────────────────────────────────────────────────

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
    // Shared DNC queue (docs/plans/mktr-production-sandbox.md §6.6). When set,
    // this process NEVER signs or calls PDPC itself — it submits through the one
    // gateway that owns the credential and the ordered timestamp. Unsetting
    // DNC_GATEWAY_URL is the instant, deploy-free rollback to direct calls.
    gatewayUrl: (process.env.DNC_GATEWAY_URL || '').replace(/\/+$/, ''),
    gatewayToken: process.env.DNC_GATEWAY_TOKEN || '',
  };
}

/** True when this deployment submits through the shared DNC queue. */
export function usesGateway(cfg = dncConfig()) {
  return Boolean(cfg.gatewayUrl && cfg.gatewayToken);
}

/**
 * True when the API is enabled AND fully credentialed — gates every outbound call.
 * Gateway mode needs the gateway pair instead of the PDPC credential: the
 * credential lives only in the gateway.
 */
export function dncReady(cfg = dncConfig()) {
  if (!cfg.enabled) return false;
  if (usesGateway(cfg)) return true;
  return !!(cfg.orgCode && cfg.eServiceId && cfg.privateKey);
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

// ── Pure protocol helpers ───────────────────────────────────────────────────────
// Re-exported from dncProtocol.js so the shared DNC queue can speak the identical
// wire format without importing this module's Sequelize/Sentry dependencies.
export {
  normalizePem,
  formatDncNumber,
  buildBaseString,
  signRequest,
  buildAuthHeader,
  mapStatusCode,
  parseValidUntil,
  parseResponse,
};

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

  // Budget guard — refuse (fail-open) rather than bill beyond the hourly cap.
  if (!deps.skipBudget && !(deps.withinBudget || withinBudget)(numbers.length)) {
    return { budgetExceeded: true, statusCode: null, results: [], validUntil: null, transactionId: null, createdTime: null, rawMsg: null };
  }

  // Sandbox outbound gate (plan §6.2). Sits HERE — inside the one shared DNC
  // service — so the form check, the create-time check, Retell and the backfill
  // all inherit it, and a future caller cannot route around it. Every number in
  // the batch must be allowlisted; one that is not fails the whole batch closed,
  // before any request is built. The shared gateway re-checks independently.
  const guard = deps.guardPhoneRail || guardPhoneRail;
  const release = deps.releasePhoneRail || releasePhoneRail;
  const guards = [];
  if (isSandbox()) {
    for (const number of numbers) {
      const decision = await guard('dnc', number, deps);
      if (!decision.allowed) {
        for (const taken of guards) await release(taken, deps);
        (deps.logger || logger).warn(
          { reason: decision.reason, batch: numbers.length },
          'dnc.check.sandbox_blocked',
        );
        return {
          blocked: true,
          blockedReason: decision.reason,
          statusCode: null,
          results: [],
          validUntil: null,
          transactionId: null,
          createdTime: null,
          rawMsg: null,
        };
      }
      guards.push(decision);
    }
  }

  const releaseGuards = async () => {
    for (const taken of guards) await release(taken, deps);
  };

  // Shared DNC queue: this process holds no PDPC credential and never signs.
  // The gateway owns the ordered timestamp, the credential and the egress path.
  if (usesGateway(cfg)) {
    try {
      const result = await (deps.submitToGateway || submitToGateway)(
        { numbers, checkOnBehalf, cfg },
        deps,
      );
      if (result.gatewayUnavailable) await releaseGuards();
      return result;
    } catch (err) {
      await releaseGuards();
      throw err;
    }
  }

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
  try {
    return await (deps.skipLock ? doCall() : runWithDncCallLock(doCall, deps));
  } catch (err) {
    await releaseGuards();
    throw err;
  }
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
    return {
      status: prospect.dncStatus,
      noVoiceCall: prospect.dncNoVoiceCall === true,
      noTextMessage: prospect.dncNoTextMessage === true,
      noFax: prospect.dncNoFax === true,
      cached: true,
    };
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

  if (result.budgetExceeded) {
    log.warn({ prospect_id: prospect.id }, 'dnc.check.budget_exceeded');
    await persistDnc(prospect, { dncStatus: 'pending' }, deps).catch(() => {});
    return { status: 'pending', reason: 'budget_exceeded' };
  }

  // Sandbox policy refusal, or the shared queue being unavailable: fail CLOSED.
  // `pending` keeps the lead held and retriable — never delivered unchecked.
  if (result.blocked || result.gatewayUnavailable) {
    const reason = result.blockedReason || result.gatewayReason || 'blocked';
    log.warn({ prospect_id: prospect.id, reason }, 'dnc.check.blocked');
    await persistDnc(prospect, { dncStatus: 'pending' }, deps).catch(() => {});
    return { status: 'pending', reason };
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
  usesGateway,
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
