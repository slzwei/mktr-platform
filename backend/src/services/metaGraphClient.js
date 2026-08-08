import crypto from 'crypto';
import { logger } from '../utils/logger.js';

/**
 * Minimal Graph API client for the Connect-Facebook flow
 * (docs/plans/facebook-connect-self-serve.md §0/§2.3).
 *
 * One place owns: the API version (env `META_GRAPH_API_VERSION`, single
 * source), strict timeouts, `appsecret_proof` on user/page-token calls, a
 * retryable-vs-permanent error taxonomy, full pagination, and token
 * redaction in every error that can be persisted or logged.
 */

const FETCH_TIMEOUT_MS = 10_000;

export function graphVersion() {
  return process.env.META_GRAPH_API_VERSION || 'v23.0';
}

export function redactGraphError(message) {
  return String(message || '')
    .replace(/access_token=[^&\s]+/gi, 'access_token=REDACTED')
    .replace(/appsecret_proof=[^&\s]+/gi, 'appsecret_proof=REDACTED')
    .replace(/code=[^&\s]+/gi, 'code=REDACTED')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer REDACTED')
    .slice(0, 500);
}

export class GraphError extends Error {
  constructor(message, { retryable = true, status = null, code = null, subcode = null } = {}) {
    super(redactGraphError(message));
    this.retryable = retryable;
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }
}

/** HMAC-SHA256(token, app secret) — Meta's server-to-server proof-of-secret. */
export function appsecretProof(token, secret = process.env.META_APP_SECRET) {
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

export function makeMetaGraphClient(overrides = {}) {
  const d = {
    fetch: (...args) => globalThis.fetch(...args),
    logger,
    ...overrides,
  };

  async function call(path, { method = 'GET', token = null, params = {}, proof = true } = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    if (token) {
      qs.set('access_token', token);
      const p = proof ? appsecretProof(token) : null;
      if (p) qs.set('appsecret_proof', p);
    }
    const url = `https://graph.facebook.com/${graphVersion()}/${path}${qs.size ? `?${qs}` : ''}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      let response;
      try {
        response = await d.fetch(url, { method, signal: controller.signal });
      } catch (err) {
        throw new GraphError(`Graph fetch failed: ${err.message}`, { retryable: true });
      }
      // Body consumed inside the abort window (the leadgen-inbox lesson).
      let body;
      try {
        body = await response.json();
      } catch (err) {
        if (response.ok) throw new GraphError(`Graph body read failed: ${err.message}`, { retryable: true });
        body = null;
      }
      if (response.ok) return body;

      const fbError = body?.error || {};
      // Permanent (fix requires a HUMAN act, retrying cannot help): OAuth
      // errors where the user/permission/token is the problem. Everything
      // else (rate limits, 5xx, transient code 2) retries with backoff.
      const permanent =
        response.status === 404
        || (fbError.type === 'OAuthException' && [100, 190, 102, 10].includes(fbError.code));
      throw new GraphError(
        `Graph ${response.status} code=${fbError.code ?? '?'} sub=${fbError.error_subcode ?? '?'}: ${fbError.message || 'unknown'}`,
        { retryable: !permanent, status: response.status, code: fbError.code ?? null, subcode: fbError.error_subcode ?? null }
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Follow `paging.next` to exhaustion (bounded — Meta pages are small). */
  async function callAllPages(path, opts = {}, { maxPages = 20 } = {}) {
    const out = [];
    let body = await call(path, opts);
    for (let i = 0; i < maxPages; i += 1) {
      out.push(...(body?.data || []));
      const next = body?.paging?.next;
      if (!next) break;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        let response;
        try {
          response = await d.fetch(next, { signal: controller.signal });
        } catch (err) {
          throw new GraphError(`Graph pagination failed: ${err.message}`, { retryable: true });
        }
        body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new GraphError(`Graph pagination ${response.status}`, { retryable: response.status >= 500 || response.status === 429 });
        }
      } finally {
        clearTimeout(timer);
      }
    }
    return out;
  }

  /** OAuth code → short-lived user token → long-lived user token. */
  async function exchangeCodeForLongLivedToken(code, redirectUri) {
    const appId = process.env.META_APP_ID;
    const secret = process.env.META_APP_SECRET;
    if (!appId || !secret) throw new GraphError('META_APP_ID/META_APP_SECRET not configured', { retryable: true });
    const short = await call('oauth/access_token', {
      params: { client_id: appId, client_secret: secret, redirect_uri: redirectUri, code },
      proof: false,
    });
    if (!short?.access_token) throw new GraphError('code exchange returned no token', { retryable: false });
    const long = await call('oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: secret,
        fb_exchange_token: short.access_token,
      },
      proof: false,
    });
    if (!long?.access_token) throw new GraphError('long-lived exchange returned no token', { retryable: true });
    return { token: long.access_token, expiresIn: long.expires_in ?? null };
  }

  return { call, callAllPages, exchangeCodeForLongLivedToken };
}

const _default = makeMetaGraphClient();
export const graphCall = _default.call;
export const graphCallAllPages = _default.callAllPages;
export const exchangeCodeForLongLivedToken = _default.exchangeCodeForLongLivedToken;
