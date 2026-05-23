// Public-host detection for the MKTR / Redeem dual-frontend setup.
//
// Two Render Static Sites (mktr.sg, redeem.sg) proxy /api/* to the single
// Express backend (api.mktr.sg). When that proxy forwards a request, the
// Express app needs to know which public host the end user actually loaded
// — to set the correct cookie domain, generate the right email link, and
// align the Meta CAPI event_source_url with the URL where the Pixel fired.
//
// Trusting the raw `Host` / `X-Forwarded-Host` header is unsafe because an
// attacker can spoof it. Always validate against an explicit allowlist.

const ALLOWED_PUBLIC_HOSTS = new Set([
  'mktr.sg',
  'www.mktr.sg',
  'redeem.sg',
  'www.redeem.sg',
]);

/**
 * Best-effort resolution of which allowlisted public host this request is
 * being served from. Returns undefined if none match — callers should treat
 * that as "use the conservative default" (mktr.sg for now).
 *
 * The order is deliberate:
 *   1. `Origin` — set by browsers on CORS-eligible requests; closest match to
 *      "the URL the user actually loaded".
 *   2. `X-Forwarded-Host` — Render's proxy header for the original host.
 *   3. `Host` — direct request host (when not behind a proxy).
 */
export function publicHostFromRequest(req) {
  let originHost;
  try {
    const origin = req.get && req.get('origin');
    originHost = origin ? new URL(origin).host : undefined;
  } catch {
    originHost = undefined;
  }

  const candidates = [
    originHost,
    req.get && req.get('x-forwarded-host'),
    req.get && req.get('host'),
  ].filter(Boolean);

  for (const value of candidates) {
    const h = String(value).split(',')[0].trim().toLowerCase();
    if (ALLOWED_PUBLIC_HOSTS.has(h)) return h;
  }

  return undefined;
}

/**
 * Cookie-domain branching: only return a `.redeem.sg` or `.mktr.sg` domain
 * when we know the request came from one of those public hosts. Otherwise
 * return undefined so callers fall back to host-only cookies (safest).
 */
export function cookieDomainForPublicHost(host) {
  if (host === 'redeem.sg' || host === 'www.redeem.sg') return '.redeem.sg';
  if (host === 'mktr.sg' || host === 'www.mktr.sg') return '.mktr.sg';
  return undefined;
}

export function isAllowedPublicHost(host) {
  if (!host) return false;
  return ALLOWED_PUBLIC_HOSTS.has(String(host).toLowerCase());
}

export function isRedeemHost(host) {
  if (!host) return false;
  const h = String(host).toLowerCase();
  return h === 'redeem.sg' || h === 'www.redeem.sg';
}

export function isMktrHost(host) {
  if (!host) return false;
  const h = String(host).toLowerCase();
  return h === 'mktr.sg' || h === 'www.mktr.sg';
}

export const ALLOWED_PUBLIC_HOSTS_LIST = Array.from(ALLOWED_PUBLIC_HOSTS);
