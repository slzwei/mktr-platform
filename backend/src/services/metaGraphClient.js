import crypto from 'crypto';
import { logger } from '../utils/logger.js';

/**
 * Minimal Graph API client for the Connect-Facebook flow
 * (docs/plans/facebook-connect-self-serve.md §0/§2.3 + review round 1).
 *
 * Transport security (F6): access tokens travel as `Authorization: Bearer`
 * headers, OAuth exchanges as POST form bodies — credentials NEVER ride the
 * URL, so pino/Sentry URL logging can't capture them (only appsecret_proof —
 * a non-reusable HMAC — remains a query param, and redactTokens masks it).
 * Pagination (F15): `paging.next` is host-validated and re-issued through
 * this client (token + proof re-applied); overflowing the page cap THROWS —
 * never a silent partial result.
 */

const FETCH_TIMEOUT_MS = 10_000;
const GRAPH_HOST = 'graph.facebook.com';

export function graphVersion() {
  return process.env.META_GRAPH_API_VERSION || 'v23.0';
}

export function redactGraphError(message) {
  return String(message || '')
    .replace(/access_token=[^&\s]+/gi, 'access_token=REDACTED')
    .replace(/appsecret_proof=[^&\s]+/gi, 'appsecret_proof=REDACTED')
    .replace(/fb_exchange_token=[^&\s]+/gi, 'fb_exchange_token=REDACTED')
    .replace(/client_secret=[^&\s]+/gi, 'client_secret=REDACTED')
    .replace(/code=[^&\s]+/gi, 'code=REDACTED')
    .replace(/input_token=[^&\s]+/gi, 'input_token=REDACTED')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer REDACTED')
    .slice(0, 500);
}

export class GraphError extends Error {
  constructor(message, { retryable = true, status = null, code = null, subcode = null, kind = null } = {}) {
    super(redactGraphError(message));
    this.retryable = retryable;
    this.status = status;
    this.code = code;
    this.subcode = subcode;
    this.kind = kind; // e.g. 'pagination_overflow' — stable taxonomy handles
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

  async function rawFetch(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      let response;
      try {
        response = await d.fetch(url, { ...init, signal: controller.signal });
      } catch (err) {
        throw new GraphError(`Graph fetch failed: ${err.message}`, { retryable: true });
      }
      // Body consumed inside the abort window (the leadgen-inbox lesson).
      let body = null;
      try {
        body = await response.json();
      } catch (err) {
        if (response.ok) throw new GraphError(`Graph body read failed: ${err.message}`, { retryable: true });
      }
      return { response, body };
    } finally {
      clearTimeout(timer);
    }
  }

  function throwGraphError(response, body) {
    const fbError = body?.error || {};
    // Permanent = a HUMAN act is needed (re-auth, permission, TOS). 190 =
    // token dead; 10/102 = permission; 100 = bad request/param — permanent
    // for WRITE/OAuth ops. Callers with softer semantics (e.g. reads that an
    // operator can fix) override via their own catch on `.code`.
    const permanent =
      response.status === 404
      || (fbError.type === 'OAuthException' && [100, 190, 102, 10].includes(fbError.code));
    throw new GraphError(
      `Graph ${response.status} code=${fbError.code ?? '?'} sub=${fbError.error_subcode ?? '?'}: ${fbError.message || 'unknown'}`,
      { retryable: !permanent, status: response.status, code: fbError.code ?? null, subcode: fbError.error_subcode ?? null }
    );
  }

  /**
   * options: { method, token, params (query), formBody (POST form — for
   * OAuth exchanges), proof }. Tokens go to the Authorization header; only
   * proof (non-reusable) is a query param.
   */
  async function call(path, { method = 'GET', token = null, params = {}, formBody = null, proof = true } = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const headers = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      const p = proof ? appsecretProof(token) : null;
      if (p) qs.set('appsecret_proof', p);
    }
    let bodyInit;
    if (formBody) {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(formBody)) {
        if (v !== undefined && v !== null) form.set(k, String(v));
      }
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      bodyInit = form.toString();
    }
    const url = `https://${GRAPH_HOST}/${graphVersion()}/${path}${qs.size ? `?${qs}` : ''}`;
    const { response, body } = await rawFetch(url, { method, headers, body: bodyInit });
    if (response.ok) return body;
    return throwGraphError(response, body);
  }

  /**
   * Follow cursor pagination to exhaustion. `paging.next` is only TRUSTED as
   * a signal — the actual continuation is re-issued through call() with the
   * extracted `after` cursor (token + proof re-applied, host never followed
   * blindly). Cap overflow THROWS (`kind: 'pagination_overflow'`).
   */
  async function callAllPages(path, opts = {}, { maxPages = 25 } = {}) {
    const out = [];
    let after = null;
    for (let i = 0; i < maxPages; i += 1) {
      const params = { ...(opts.params || {}), ...(after ? { after } : {}) };
      const body = await call(path, { ...opts, params });
      out.push(...(body?.data || []));
      const next = body?.paging?.next;
      const cursor = body?.paging?.cursors?.after;
      if (!next) return out;
      let nextUrl;
      try { nextUrl = new URL(next); } catch { return out; }
      if (nextUrl.protocol !== 'https:' || nextUrl.hostname !== GRAPH_HOST) {
        throw new GraphError(`pagination next host rejected: ${nextUrl.hostname}`, { retryable: false, kind: 'pagination_host' });
      }
      after = cursor || nextUrl.searchParams.get('after');
      if (!after) return out;
    }
    throw new GraphError(`pagination exceeded ${maxPages} pages for ${path}`, { retryable: false, kind: 'pagination_overflow' });
  }

  /**
   * OAuth code → short-lived user token → long-lived user token.
   * POST form bodies (credentials never in URLs). NOTE (review F2): the code
   * is single-use at Meta — the CALLER must persist the result immediately;
   * any ambiguous failure here means "get a fresh code", never re-exchange.
   */
  async function exchangeCodeForLongLivedToken(code, redirectUri) {
    const appId = process.env.META_APP_ID;
    const secret = process.env.META_APP_SECRET;
    if (!appId || !secret) throw new GraphError('META_APP_ID/META_APP_SECRET not configured', { retryable: true });
    const short = await call('oauth/access_token', {
      method: 'POST',
      formBody: { client_id: appId, client_secret: secret, redirect_uri: redirectUri, code },
      proof: false,
    });
    if (!short?.access_token) throw new GraphError('code exchange returned no token', { retryable: false });
    const long = await call('oauth/access_token', {
      method: 'POST',
      formBody: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: secret,
        fb_exchange_token: short.access_token,
      },
      proof: false,
    });
    if (!long?.access_token) throw new GraphError('long-lived exchange returned no token', { retryable: false });
    return { token: long.access_token, expiresIn: long.expires_in ?? null };
  }

  return { call, callAllPages, exchangeCodeForLongLivedToken };
}

const _default = makeMetaGraphClient();
export const graphCall = _default.call;
export const graphCallAllPages = _default.callAllPages;
export const exchangeCodeForLongLivedToken = _default.exchangeCodeForLongLivedToken;
