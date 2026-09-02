import nodeFetch from 'node-fetch';
import {
  buildBaseString,
  signRequest,
  buildAuthHeader,
  parseResponse,
  normalizePem,
  DNC_CHECK_ENDPOINT,
} from '../services/dncProtocol.js';
import * as queue from './queue.js';
import { admit, releaseSandboxBudget } from './policy.js';

/**
 * The single sender. One item at a time, production first, under the global send
 * lock, with a persisted monotonic timestamp.
 *
 * The gateway is the ONLY holder of the PDPC credential and the only process
 * permitted to reach https://www.dnc.gov.sg/realtime.
 */

export function gatewayConfig() {
  return {
    baseUrl: (process.env.DNC_BASE_URL || '').replace(/\/+$/, ''),
    orgCode: process.env.DNC_ORG_CODE || '',
    eServiceId: process.env.DNC_ESERVICE_ID || '',
    privateKey: normalizePem(process.env.DNC_PRIVATE_KEY || ''),
    proxy: process.env.DNC_HTTPS_PROXY || null,
    timeoutMs: Number(process.env.DNC_TIMEOUT_MS) || 8000,
  };
}

export function credentialed(cfg = gatewayConfig()) {
  return Boolean(cfg.baseUrl && cfg.orgCode && cfg.eServiceId && cfg.privateKey);
}

async function buildProxyAgent(proxyUrl) {
  if (!proxyUrl) return undefined;
  const mod = await import('https-proxy-agent');
  const HttpsProxyAgent = mod.HttpsProxyAgent || mod.default || mod;
  return new HttpsProxyAgent(proxyUrl);
}

/** Sign and send one batch. Throws on transport failure. */
export async function sendToPdpc({ numbers, checkOnBehalf }, deps = {}) {
  const cfg = deps.cfg || gatewayConfig();
  const fetchImpl = deps.fetch || nodeFetch;

  return queue.withSendLock(async () => {
    const timestamp = await (deps.nextPdpcTimestamp || queue.nextPdpcTimestamp)();
    const baseString = buildBaseString({ orgCode: cfg.orgCode, eServiceId: cfg.eServiceId, timestamp });
    const appSignature = signRequest(baseString, cfg.privateKey);
    const authHeader = buildAuthHeader({ orgCode: cfg.orgCode, eServiceId: cfg.eServiceId, timestamp, appSignature });
    const agent = await buildProxyAgent(cfg.proxy);

    const res = await fetchImpl(`${cfg.baseUrl}/${DNC_CHECK_ENDPOINT}`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ numbers, total: numbers.length, checkOnBehalf }),
      agent,
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    const json = await res.json().catch(() => ({}));
    return { httpStatus: res.status, timestamp, ...parseResponse(json) };
  });
}

/**
 * Drain one item. Returns the item id when work was done, null when idle.
 * Never throws — a failure is recorded on the row and retried under its lease.
 */
export async function drainOnce(deps = {}) {
  const log = deps.logger || console;
  // Queue writers are injectable so the negative paths can be proven without a
  // database (ESM exports cannot be spied on).
  const failItem = deps.fail || queue.fail;
  const blockItem = deps.block || queue.block;
  const completeItem = deps.complete || queue.complete;
  const item = await (deps.leaseNext || queue.leaseNext)();
  if (!item) return null;

  const numbers = Array.isArray(item.numbers) ? item.numbers : JSON.parse(item.numbers);

  // Second, independent policy enforcement (plan §6.6). A sandbox item that the
  // sandbox API mistakenly admitted still dies here.
  let admission;
  try {
    admission = await (deps.admit || admit)({ source: item.source, numbers });
  } catch (err) {
    await failItem(item.id, `policy_error: ${err.message}`);
    return item.id;
  }
  if (!admission.allowed) {
    log.warn?.({ id: item.id, source: item.source, reason: admission.reason }, 'dnc_gateway.blocked');
    await blockItem(item.id, admission.reason);
    return item.id;
  }

  const cfg = deps.cfg || gatewayConfig();
  if (!credentialed(cfg)) {
    await (deps.releaseSandboxBudget || releaseSandboxBudget)(admission.keys);
    await failItem(item.id, 'gateway_not_credentialed', { terminal: true });
    return item.id;
  }

  try {
    const result = await (deps.sendToPdpc || sendToPdpc)(
      { numbers, checkOnBehalf: item.check_on_behalf },
      { ...deps, cfg },
    );
    await completeItem(item.id, {
      httpStatus: result.httpStatus,
      pdpcTimestamp: result.timestamp,
      result: {
        httpStatus: result.httpStatus,
        statusCode: result.statusCode,
        results: result.results,
        validUntil: result.validUntil ? new Date(result.validUntil).toISOString() : null,
        transactionId: result.transactionId,
        createdTime: result.createdTime,
        rawMsg: result.rawMsg,
      },
    });
    log.info?.(
      { id: item.id, source: item.source, status_code: result.statusCode, txn: result.transactionId },
      'dnc_gateway.sent',
    );
  } catch (err) {
    // The credit was not spent (nothing reached PDPC) — hand the sandbox
    // allowance back so our own outage cannot eat the day's tiny budget.
    await (deps.releaseSandboxBudget || releaseSandboxBudget)(admission.keys);
    log.error?.({ id: item.id, source: item.source, err: err.message }, 'dnc_gateway.send_failed');
    await failItem(item.id, err.message);
  }
  return item.id;
}

/** Continuous drain loop with a short idle sleep. */
export function startWorker(deps = {}) {
  const idleMs = Number(process.env.DNC_GATEWAY_IDLE_MS) || 250;
  let stopped = false;
  (async function loop() {
    while (!stopped) {
      try {
        const did = await drainOnce(deps);
        if (!did) await new Promise((r) => setTimeout(r, idleMs));
      } catch (err) {
        (deps.logger || console).error?.({ err: err.message }, 'dnc_gateway.worker_error');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  })();
  return () => { stopped = true; };
}

export default { sendToPdpc, drainOnce, startWorker, gatewayConfig, credentialed };
