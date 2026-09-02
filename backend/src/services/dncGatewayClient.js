import nodeFetch from 'node-fetch';
import crypto from 'crypto';
import { logger as defaultLogger } from '../utils/logger.js';
import { deployEnv } from '../utils/deployEnv.js';

/**
 * Client for the shared DNC queue (`mktr-dnc-gateway`).
 *
 * Both production and sandbox submit here; neither holds the PDPC credential
 * once the gateway is live. The gateway owns the ordered timestamp, the
 * signature, the egress path and the per-source policy — see
 * docs/plans/mktr-production-sandbox.md §6.6 and src/dncGateway/.
 *
 * The call stays SYNCHRONOUS from the caller's point of view: the gateway holds
 * the HTTP request open until its worker has the answer, up to `waitMs`. Anything
 * else — timeout, 5xx, 202-still-queued, auth failure — is reported as
 * `gatewayUnavailable`, which dncService turns into a HELD lead. Fail closed.
 */

const DEFAULT_WAIT_MS = 12_000;
const DEFAULT_TIMEOUT_MS = 15_000;

function config() {
  return {
    url: (process.env.DNC_GATEWAY_URL || '').replace(/\/+$/, ''),
    token: process.env.DNC_GATEWAY_TOKEN || '',
    waitMs: Number(process.env.DNC_GATEWAY_WAIT_MS) || DEFAULT_WAIT_MS,
    timeoutMs: Number(process.env.DNC_GATEWAY_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  };
}

const unavailable = (reason, extra = {}) => ({
  gatewayUnavailable: true,
  gatewayReason: reason,
  statusCode: null,
  results: [],
  validUntil: null,
  transactionId: null,
  createdTime: null,
  rawMsg: null,
  ...extra,
});

/**
 * Submit one batch to the shared queue and wait for its result.
 * @param {{numbers: string[], checkOnBehalf: string, cfg?: object}} request
 * @returns {Promise<object>} the same shape dncService.checkNumbers returns
 */
export async function submitToGateway({ numbers, checkOnBehalf }, deps = {}) {
  const log = deps.logger || defaultLogger;
  const cfg = deps.gatewayConfig || config();
  const fetchImpl = deps.fetch || nodeFetch;

  if (!cfg.url || !cfg.token) return unavailable('not_configured');

  // Idempotency: a retry of the same batch within the gateway's window returns
  // the first answer instead of spending a second prepaid credit.
  const idempotencyKey = crypto
    .createHash('sha256')
    .update(JSON.stringify({ numbers, checkOnBehalf, minute: Math.floor(Date.now() / 60_000) }))
    .digest('hex')
    .slice(0, 32);

  let res;
  try {
    res = await fetchImpl(`${cfg.url}/v1/check`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ numbers, checkOnBehalf, waitMs: cfg.waitMs }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (err) {
    log.error({ err: err?.message, deploy_env: deployEnv() }, 'dnc.gateway.transport_error');
    return unavailable('transport_error');
  }

  if (res.status === 202) {
    // Accepted and durably queued, but not answered inside the wait window. The
    // lead stays held; the backfill re-asks later and the idempotency key makes
    // that a free lookup rather than a second credit.
    log.warn({ deploy_env: deployEnv() }, 'dnc.gateway.still_queued');
    return unavailable('still_queued');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log.error(
      { status: res.status, body: body.slice(0, 300), deploy_env: deployEnv() },
      'dnc.gateway.rejected',
    );
    return unavailable(res.status === 401 || res.status === 403 ? 'unauthorized' : `http_${res.status}`);
  }

  const json = await res.json().catch(() => null);
  if (!json || typeof json !== 'object' || !json.result) return unavailable('bad_response');
  if (json.result.blocked) {
    return { blocked: true, blockedReason: json.result.blockedReason || 'gateway_policy', statusCode: null, results: [], validUntil: null, transactionId: null, createdTime: null, rawMsg: null };
  }

  return {
    httpStatus: json.result.httpStatus ?? null,
    statusCode: json.result.statusCode ?? null,
    results: Array.isArray(json.result.results) ? json.result.results : [],
    validUntil: json.result.validUntil ? new Date(json.result.validUntil) : null,
    transactionId: json.result.transactionId ?? null,
    createdTime: json.result.createdTime ?? null,
    rawMsg: json.result.rawMsg ?? null,
    gatewayQueueId: json.id || null,
  };
}

/** Non-secret view of the gateway wiring, for /health/sandbox. */
export function gatewaySnapshot() {
  const cfg = config();
  return {
    configured: Boolean(cfg.url && cfg.token),
    url: cfg.url || null,
    waitMs: cfg.waitMs,
    timeoutMs: cfg.timeoutMs,
  };
}

export default { submitToGateway, gatewaySnapshot };
