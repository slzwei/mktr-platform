/**
 * The transport rules for calling somebody else's server (P2-1).
 *
 * Two problems this exists for:
 *
 *  1. NO TIMEOUT. `fetch` has none by default, so a hung TCP connection hangs
 *     the caller until the platform kills it. Apify's startRun is awaited
 *     INLINE on the operator's request, so "Apify is slow" read as "Discovery
 *     is broken" with no error to show for it.
 *  2. INCONSISTENT RETRY. WhatsApp retried three times; Apify — the more
 *     expensive dependency, and the one whose runs cost money — retried zero.
 *
 * The retry policy is the one waGraphClient already used and is worth keeping:
 * retry only TRANSIENT failures — a network throw (no response, so the request
 * very likely never landed) or a 5xx. A 4xx is deterministic and comes back
 * as-is for the caller to handle; retrying it just spends quota to be told the
 * same thing.
 */

/** Long enough for a slow-but-alive provider, short enough that a hang is not a hostage. */
export const DEFAULT_TIMEOUT_MS = 12_000;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noopLogger = { warn: () => {}, error: () => {}, info: () => {} };

/** True for the errors that mean "try again" rather than "this request is wrong". */
export function isTransientFetchError(err) {
  return err?.name === 'AbortError' || err?.name === 'TimeoutError' || err instanceof TypeError || !err?.status;
}

/**
 * One fetch, bounded by an AbortController. A timeout surfaces as an Error with
 * `name: 'AbortError'` and `timeout: true`, which the retry layer treats as
 * transient — the request may never have reached the provider.
 */
export async function fetchWithTimeout(fetchImpl, url, opts = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, label } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...opts, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      const timeoutErr = new Error(`${label || 'external request'} timed out after ${timeoutMs}ms`);
      timeoutErr.name = 'AbortError';
      timeoutErr.timeout = true;
      timeoutErr.cause = err;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `fetchWithTimeout` plus bounded retry on transient failures.
 * Returns the Response — ok or 4xx. Throws the last error when every attempt
 * failed to produce a response at all.
 */
export async function retryingFetch(fetchImpl, url, opts = {}, {
  label,
  attempts = 3,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sleep = defaultSleep,
  logger = noopLogger,
  logPrefix = 'external_fetch',
} = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await fetchWithTimeout(fetchImpl, url, opts, { timeoutMs, label });
      if (res.status >= 500 && i < attempts) {
        logger.warn(`${logPrefix}.retry_5xx`, { label, status: res.status, attempt: i });
        await sleep(300 * i);
        continue;
      }
      return res; // ok or 4xx — caller decides
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        logger.warn(`${logPrefix}.retry_network`, {
          label, error: err?.message, timeout: Boolean(err?.timeout), attempt: i,
        });
        await sleep(300 * i);
        continue;
      }
    }
  }
  throw lastErr;
}
