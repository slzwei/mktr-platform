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
 * Error hygiene mirrors the Meta services: messages carry HTTP status +
 * Google's error message only — never request bodies (they contain hashed
 * PII, and hashes are still personal data).
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const EXPIRY_SLACK_MS = 60_000;

function apiVersion() {
  return process.env.GOOGLE_DM_API_VERSION || 'v1';
}

function baseUrl() {
  return `https://datamanager.googleapis.com/${apiVersion()}`;
}

let cachedToken = null; // { accessToken, expiresAt }

/** Test seam — clears the module-level access-token cache. */
export function __resetTokenCacheForTests() {
  cachedToken = null;
}

/**
 * Mint (or reuse) an access token from the stored refresh token. Throws a
 * sanitized Error on failure — callers treat that as "run aborts, retry next
 * schedule" (fail closed, never upload blind).
 */
export async function getAccessToken(deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
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
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(
      `google dm token refresh failed: HTTP ${res.status} ${body?.error_description || body?.error || ''}`.trim()
    );
  }
  cachedToken = {
    accessToken: body.access_token,
    expiresAt: now + (Number(body.expires_in) || 3600) * 1000,
  };
  return cachedToken.accessToken;
}

/**
 * POST a Data Manager method (e.g. 'audienceMembers:ingest'). Returns the
 * parsed JSON body on 2xx; throws a sanitized Error (with .status) otherwise.
 * The request body is NEVER attached to errors or logs.
 */
export async function dmRequest(method, payload, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const accessToken = await getAccessToken(deps);
  const res = await fetchFn(`${baseUrl()}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      `google dm ${method} failed: HTTP ${res.status} ${body?.error?.message || ''}`.trim()
    );
    err.status = res.status;
    throw err;
  }
  logger.debug({ method, requestId: body?.requestId }, 'google_dm.request.ok');
  return body;
}
