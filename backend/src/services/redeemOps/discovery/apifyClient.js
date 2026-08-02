import { logger } from '../../../utils/logger.js';
import { retryingFetch, DEFAULT_TIMEOUT_MS } from '../../../utils/externalFetch.js';

/**
 * Thin Apify API v2 wrapper for the Discover tool. Start an actor run, re-fetch
 * its authoritative state, pull dataset items. `fetchImpl` is injectable so tests
 * never hit the network.
 *
 * Webhook auth note: Apify does NOT HMAC-sign webhook payloads. We register the
 * webhook with a secret in the URL path and, on receipt, IGNORE the payload's
 * claims and re-fetch the run via getRun() using our own token — so a spoofed
 * webhook can't drive state. (See spec §2.2.)
 */
const APIFY_BASE = 'https://api.apify.com/v2';

// Apify run.status → our discovery_runs.status terminal mapping.
export const TERMINAL_STATUS = {
  SUCCEEDED: 'completed',
  FAILED: 'failed',
  ABORTED: 'aborted',
  'TIMED-OUT': 'timed_out',
};
export const WEBHOOK_EVENT_TYPES = [
  'ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.ABORTED', 'ACTOR.RUN.TIMED_OUT',
];

export function makeApifyClient(overrides = {}) {
  const d = {
    token: process.env.APIFY_TOKEN,
    baseUrl: APIFY_BASE,
    fetchImpl: (...args) => globalThis.fetch(...args),
    logger,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    attempts: 3,
    ...overrides,
  };

  function assertConfigured() {
    if (!d.token) throw new Error('APIFY_TOKEN is not set');
  }

  async function call(method, path, { body, query } = {}) {
    assertConfigured();
    const url = new URL(`${d.baseUrl}${path}`);
    url.searchParams.set('token', d.token);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    // Bounded + retried on transient failures, same policy as waGraphClient
    // (P2-1). startRun is awaited INLINE on the operator's request, so an
    // unbounded fetch here hung the request until the platform killed it — and
    // this dependency, the one that costs money per run, had zero retries
    // while WhatsApp had three.
    const res = await retryingFetch(d.fetchImpl, url.toString(), {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }, {
      label: `apify ${method} ${path}`,
      attempts: d.attempts,
      timeoutMs: d.timeoutMs,
      logger: d.logger,
      logPrefix: 'apify',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Apify ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
  }

  /**
   * Start an actor run with an ad-hoc terminal webhook.
   * @returns {{ runId, datasetId, status }}
   */
  async function startRun(actorId, input, { webhookUrl } = {}) {
    const query = {};
    if (webhookUrl) {
      // Ad-hoc webhooks: base64 of a JSON array, passed on the run-start request.
      const webhooks = [{ eventTypes: WEBHOOK_EVENT_TYPES, requestUrl: webhookUrl }];
      query.webhooks = Buffer.from(JSON.stringify(webhooks)).toString('base64');
    }
    const json = await call('POST', `/acts/${encodeURIComponent(actorId)}/runs`, { body: input, query });
    const data = json?.data || {};
    return { runId: data.id, datasetId: data.defaultDatasetId, status: data.status };
  }

  /** Authoritative run state (status + dataset + real cost). */
  async function getRun(runId) {
    const json = await call('GET', `/actor-runs/${encodeURIComponent(runId)}`);
    const data = json?.data || {};
    return {
      runId: data.id,
      status: data.status,
      datasetId: data.defaultDatasetId,
      usageTotalUsd: data.usageTotalUsd ?? null,
      terminalStatus: TERMINAL_STATUS[data.status] || null,
    };
  }

  /** Pull cleaned dataset items (the businesses / profiles). */
  async function getDatasetItems(datasetId, { limit } = {}) {
    const items = await call('GET', `/datasets/${encodeURIComponent(datasetId)}/items`, {
      query: { clean: 'true', format: 'json', ...(limit ? { limit } : {}) },
    });
    return Array.isArray(items) ? items : [];
  }

  return { startRun, getRun, getDatasetItems };
}

export default makeApifyClient;
