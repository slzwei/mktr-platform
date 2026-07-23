import { CircuitBreaker } from '../utils/circuitBreaker.js';
import { logger } from '../utils/logger.js';

/**
 * retellClient — typed Retell API client for the screening-call gate
 * (docs/plans/retell-screening-calls.md §7.0).
 *
 * Exists because the private recording breaker in retellService has no request
 * timeout and collapses every failure to "not found" — unusable for a sweep
 * that must distinguish "call definitely unknown" (clear the attempt) from
 * "transient" (leave it for the next pass). Every error carries `status`
 * (HTTP code, or null for network/timeout) and `transient` (true = retryable).
 */

const RETELL_BASE = 'https://api.retellai.com';
const REQUEST_TIMEOUT_MS = 10_000;

export class RetellApiError extends Error {
  constructor(message, { status = null, transient = false } = {}) {
    super(message);
    this.name = 'RetellApiError';
    this.status = status;
    this.transient = transient;
  }
}

/** 408/429/5xx and network/timeout failures are transient; other 4xx are definite. */
function classifyStatus(status) {
  if (status === 408 || status === 429) return true;
  return status >= 500;
}

async function request(path, { method = 'GET', body = undefined } = {}) {
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) {
    throw new RetellApiError('RETELL_API_KEY not configured', { status: null, transient: false });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${RETELL_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    // AbortError (timeout) and network failures: Retell MAY have received the
    // request — callers must treat this as dispatch-unknown, never definite.
    throw new RetellApiError(`Retell request failed: ${err?.message || String(err)}`, {
      status: null,
      transient: true,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new RetellApiError(`Retell API ${response.status}: ${text.slice(0, 300)}`, {
      status: response.status,
      transient: classifyStatus(response.status),
    });
  }
  return response.json();
}

// One breaker for the screening call paths (dial + sweep poll). The breaker
// throwing "is OPEN" is transient by definition.
const screeningBreaker = new CircuitBreaker(request, {
  name: 'retell-screening',
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
});

async function fireBreaker(path, opts) {
  try {
    return await screeningBreaker.fire(path, opts);
  } catch (err) {
    if (err instanceof RetellApiError) throw err;
    // Breaker-open (or unexpected) errors are transient.
    throw new RetellApiError(err?.message || String(err), { status: null, transient: true });
  }
}

/**
 * Create an outbound phone call. Body per Retell v2:
 * { from_number, to_number, override_agent_id, metadata, retell_llm_dynamic_variables }.
 * Returns the call object (incl. call_id). Throws RetellApiError; callers MUST
 * branch on `.transient` — transient after send = dispatch-unknown (§7.2.3).
 */
export async function createPhoneCall(body) {
  return fireBreaker('/v2/create-phone-call', { method: 'POST', body });
}

/**
 * Fetch a call by id. 404 → returns null (call definitely unknown — safe to
 * clear the attempt). Transient errors throw (leave the attempt for later).
 */
export async function getCall(callId) {
  try {
    return await fireBreaker(`/v2/get-call/${callId}`);
  } catch (err) {
    if (err instanceof RetellApiError && err.status === 404) {
      logger.info('[Screening] getCall 404 — call unknown to Retell', { callId });
      return null;
    }
    throw err;
  }
}

export default { createPhoneCall, getCall, RetellApiError };
