import { logger } from './logger.js';

/**
 * Data Manager API client — the Google counterpart of the bare-fetch style in
 * metaCapiService/redeemedAudienceService. Deliberately NOT the classic Google
 * Ads API: since April/June 2026 its upload surfaces (OfflineUserDataJob,
 * UploadClickConversions) REJECT developer tokens that never used them before,
 * and this account has no token to grandfather. Data Manager needs no
 * developer token and no MCC — just OAuth on the datamanager scope
 * (docs/plans/google-ads-signal-levers.md §0/§2).
 *
 * Auth: refresh-token grant, minted once by scripts/google-dm-oauth-bootstrap.mjs
 * (INTERNAL OAuth app on the mktr.sg Workspace org — Testing-mode refresh
 * tokens die after 7 days, Internal ones are durable). Access tokens are
 * cached until shortly before expiry.
 *
 * Every call runs through a timeout + bounded-retry wrapper whose abort
 * window covers HEADERS AND BODY (a server that returns headers then stalls
 * the body must never wedge the scheduler's single-flight lock), with
 * bounded backoff+jitter on network/429/5xx/body-stream failures only.
 * Terminal 4xx never retries.
 *
 * Error hygiene: provider error text is REDACTED before it reaches
 * exceptions/logs/Sentry — Google can echo rejected identifier values (hex
 * hashes are still personal data), so free-text messages are stripped of
 * long hex/token runs and truncated. Request bodies are never attached.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const EXPIRY_SLACK_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ATTEMPTS = 3;

function apiVersion() {
  return process.env.GOOGLE_DM_API_VERSION || 'v1';
}

function baseUrl() {
  return `https://datamanager.googleapis.com/${apiVersion()}`;
}

function timeoutMs() {
  return Number(process.env.GOOGLE_DM_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cachedToken = null; // { accessToken, expiresAt }

/** Test seam — clears the module-level access-token cache. */
export function __resetTokenCacheForTests() {
  cachedToken = null;
}

/**
 * Redact provider free-text before it can reach any observable surface:
 * long hex runs (hashed identifiers) and long opaque tokens become
 * placeholders, and the result is truncated. Exported for testing.
 */
export function redactProviderText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/[a-f0-9]{32,}/gi, '[hash]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[token]')
    .replace(/[^\s@"']+@[^\s@"']+\.[^\s@"']+/g, '[email]')
    .replace(/\+?\d[\d\s-]{6,}\d/g, '[phone]')
    .slice(0, 200);
}

/**
 * fetch + JSON-parse under ONE abort window, with bounded exponential
 * backoff + jitter on transient failures (network error, body-stream error,
 * 429, 5xx). Returns { status, ok, body } — non-2xx responses are RETURNED
 * for the caller to classify; only transport-level transients retry.
 * Exported for testing.
 */
export async function fetchJsonWithRetry(url, init, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const sleep = deps.sleep || realSleep;
  const attempts = deps.attempts || DEFAULT_ATTEMPTS;
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs());
    try {
      const res = await fetchFn(url, { ...init, signal: controller.signal });
      if ((res.status === 429 || res.status >= 500) && attempt < attempts - 1) {
        await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 250));
        continue;
      }
      // Body consumption stays INSIDE the abort window — a stalled body is a
      // timeout, not a hang. A malformed/failed body on a 2xx is transient.
      const body = await res.json().catch((err) => {
        if (res.ok) throw err;
        return {};
      });
      return { status: res.status, ok: res.ok, body };
    } catch (err) {
      lastErr = err;
      if (attempt < attempts - 1) {
        await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 250));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(
    `google dm fetch failed after ${attempts} attempts: ${redactProviderText(lastErr?.message) || 'network error'}`
  );
}

/**
 * Mint (or reuse) an access token from the stored refresh token. Throws a
 * sanitized Error on failure — callers treat that as "run aborts, retry next
 * schedule" (fail closed, never upload blind).
 */
export async function getAccessToken(deps = {}) {
  const now = deps.now ? deps.now() : Date.now();
  if (cachedToken && cachedToken.expiresAt - EXPIRY_SLACK_MS > now) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.GOOGLE_DM_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DM_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DM_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('google dm client: OAuth env incomplete');
  }

  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const { status, ok, body } = await fetchJsonWithRetry(
    TOKEN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    },
    deps
  );
  if (!ok || !body.access_token) {
    throw new Error(
      `google dm token refresh failed: HTTP ${status} ${redactProviderText(body?.error_description || body?.error)}`.trim()
    );
  }
  cachedToken = {
    accessToken: body.access_token,
    expiresAt: now + (Number(body.expires_in) || 3600) * 1000,
  };
  return cachedToken.accessToken;
}

async function authedRequest(method, path, payload, deps) {
  const accessToken = await getAccessToken(deps);
  const { status, ok, body } = await fetchJsonWithRetry(
    `${baseUrl()}/${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    },
    deps
  );
  if (!ok) {
    // error.status/code are structured enums (safe); error.message is
    // free-text Google can stuff identifier echoes into — redacted.
    const parts = [
      `google dm ${path} failed:`,
      `HTTP ${status}`,
      body?.error?.status || body?.error?.code || '',
      redactProviderText(body?.error?.message),
    ].filter(Boolean);
    throw Object.assign(new Error(parts.join(' ')), { status });
  }
  logger.debug({ path, requestId: body?.requestId }, 'google_dm.request.ok');
  return body;
}

/**
 * POST a Data Manager method (e.g. 'audienceMembers:ingest'). Returns the
 * parsed JSON body on 2xx; throws a sanitized Error (with .status) otherwise.
 * The request body is NEVER attached to errors or logs.
 */
export async function dmRequest(method, payload, deps = {}) {
  return authedRequest('POST', method, payload, deps);
}

/**
 * GET a Data Manager path (e.g. 'requestStatus:retrieve?requestId=…') — the
 * diagnostics retrieval surface. Same auth/retry/sanitization contract.
 */
export async function dmRequestGet(pathWithQuery, deps = {}) {
  return authedRequest('GET', pathWithQuery, undefined, deps);
}
