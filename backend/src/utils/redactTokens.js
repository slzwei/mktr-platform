/**
 * Several routes authenticate SOLELY by a secret riding in the URL, so any
 * layer that logs a request URL is logging a live credential. Every
 * logging/telemetry sink masks URLs through this ONE helper: pino-http request
 * logs (server_internal.js), errorHandler, Sentry scrubbing. The frontend
 * carries its own copy in src/lib/sentryScrub.js (it cannot import backend
 * code) — keep the two regexes IDENTICAL and mirror any change there.
 *
 * URL-credential shapes (each asserted by test/unit/redactTokens.test.js —
 * when adding a new URL-authenticated route, extend the regex AND that test,
 * or the secret lands verbatim in pino + Sentry):
 *   /api/reward-claim/:token                     reward bearer link
 *   /r/:token                                    consumer reward link (redeem.sg)
 *   /api/screening-callback/:token               WA ring-back opt-in (GET+POST)
 *   /api/redeem-ops/discovery/webhook/:secret    Apify callback (static secret)
 *   /api/auth/verify-email/:token                single-use email verification
 *   /api/auth/reset-password/:token              account takeover if leaked
 *   /api/auth/invite-info/:token                 same token later accepts the invite
 *   /api/provision/check/:code                   poll returns deviceKey when fulfilled
 *   ?t= / &t=                                    redeem.sg/callback?t=<screening token>
 */
const TOKEN_PATH_RE = /(\/(?:api\/reward-claim|r|api\/screening-callback|api\/redeem-ops\/discovery\/webhook|api\/auth\/(?:verify-email|reset-password|invite-info)|api\/provision\/check)\/)[^/?#\s]+/gi;
const TOKEN_QUERY_RE = /([?&]t=)[^&#\s]+/gi;

export function maskTokenUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return url;
  return url.replace(TOKEN_PATH_RE, '$1[token]').replace(TOKEN_QUERY_RE, '$1[token]');
}

/** `shawn@gmail.com` → `s•••@gmail.com` — log-safe recipient display. */
export function maskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at <= 0) return s ? '•••' : '';
  return `${s[0]}•••${s.slice(at)}`;
}
