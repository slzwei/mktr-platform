import crypto from 'crypto';
import { publicHostFromRequest, cookieDomainForPublicHost } from './publicHost.js';
import { sidCookieName, readSidCookie } from './attributionCookies.js';

/**
 * ONE first-party session id (ads-centralisation §4.2), shared by the QR
 * redirect, /lead-capture bind, the /touch beacon, and the prospect submit.
 *
 * - Format: 32 lowercase hex chars (crypto.randomBytes(16)) — the historical
 *   sid shape. BOTH sources (cookie and the X-Session-Id header the client
 *   sends because it cannot read the httpOnly cookie) are validated against
 *   it; an invalid value is IGNORED, never a 400. A validated cookie always
 *   wins over the header.
 * - Horizon: 90 days everywhere (the old 7d mint sites moved here); /touch
 *   and the submit response re-issue the cookie, so the window is rolling.
 * - The sid is NEVER authorization material — it keys browsing evidence only.
 */
export const SID_RE = /^[a-f0-9]{32}$/;
export const SID_COOKIE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** @param {unknown} value */
export function validSid(value) {
  return typeof value === 'string' && SID_RE.test(value) ? value : null;
}

export function mintSid() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * validated cookie → validated header → null. Invalid values are ignored.
 * @param {{ cookies?: Record<string, string>, headers?: Record<string, unknown> }} req
 */
export function resolveSid(req) {
  return validSid(readSidCookie(req)) || validSid(req.headers?.['x-session-id']) || null;
}

/**
 * The leadCaptureBind cookie recipe, centralized at the 90-day horizon.
 * @param {import('express').Request} req
 */
export function sidCookieOptions(req) {
  const isProd = process.env.NODE_ENV === 'production';
  const domain = isProd ? cookieDomainForPublicHost(publicHostFromRequest(req)) : undefined;
  return {
    httpOnly: true,
    sameSite: /** @type {const} */ ('lax'),
    secure: isProd,
    domain,
    maxAge: SID_COOKIE_MAX_AGE_MS,
    path: '/',
  };
}

/**
 * Adopt (header-only sid) or roll (existing cookie) the sid onto the response.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} sid
 */
export function setSidCookie(req, res, sid) {
  res.cookie(sidCookieName(), sid, sidCookieOptions(req));
}
