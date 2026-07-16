/**
 * Reward-claim bearer tokens ride in URLs (`/api/reward-claim/:token`, consumer
 * `/r/:token`), so any layer that logs a request URL is logging a live
 * credential. Every logging/telemetry sink masks URLs through this ONE helper:
 * pino-http request logs, errorHandler, Sentry scrubbing. The frontend api
 * client carries its own copy (it cannot import backend code).
 */
const TOKEN_PATH_RE = /(\/(?:api\/reward-claim|r)\/)[^/?#\s]+/gi;

export function maskTokenUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return url;
  return url.replace(TOKEN_PATH_RE, '$1[token]');
}

/** `shawn@gmail.com` → `s•••@gmail.com` — log-safe recipient display. */
export function maskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at <= 0) return s ? '•••' : '';
  return `${s[0]}•••${s.slice(at)}`;
}
