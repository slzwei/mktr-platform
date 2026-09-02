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

import { isSandbox } from './deployEnv.js';

const PRODUCTION_PUBLIC_HOSTS = [
  'mktr.sg',
  'www.mktr.sg',
  'redeem.sg',
  'www.redeem.sg',
  // Internal Redeem Ops staff surface (docs/redeem-ops/RECOMMENDED_ARCHITECTURE.md §5).
  // NOT a redeem-consumer host: isRedeemHost() deliberately excludes it, and the host
  // guard gives it a narrow internal allowlist instead of the consumer block. Auth
  // cookies stay host-only here (cookieDomainForPublicHost returns undefined).
  'ops.redeem.sg',
];

// Sandbox hosts (docs/plans/mktr-production-sandbox.md §6.3). They are ADDITIVE and
// only in a DEPLOY_ENV=sandbox process: production never learns a sandbox host, so a
// forged `Host: sandbox.mktr.sg` against api.mktr.sg still falls through to the
// conservative default. `SANDBOX_PUBLIC_HOSTS` lets one deployment carry both the
// vanity host and the platform host (…onrender.com) before DNS is cut over.
const DEFAULT_SANDBOX_HOSTS = ['sandbox.mktr.sg', 'api.sandbox.mktr.sg'];

let sandboxCache = { raw: null, hosts: [] };

function sandboxHosts() {
  if (!isSandbox()) return [];
  const raw = process.env.SANDBOX_PUBLIC_HOSTS || '';
  if (sandboxCache.raw !== raw) {
    const configured = raw
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    sandboxCache = { raw, hosts: [...new Set([...DEFAULT_SANDBOX_HOSTS, ...configured])] };
  }
  return sandboxCache.hosts;
}

function allowedHosts() {
  return new Set([...PRODUCTION_PUBLIC_HOSTS, ...sandboxHosts()]);
}

/** True when `host` is one of THIS deployment's sandbox hosts. */
export function isSandboxHost(host) {
  if (!host) return false;
  return sandboxHosts().includes(String(host).toLowerCase());
}

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

  const allowed = allowedHosts();
  for (const value of candidates) {
    const h = String(value).split(',')[0].trim().toLowerCase();
    if (allowed.has(h)) return h;
  }

  return undefined;
}

/**
 * Cookie-domain branching: only return a `.redeem.sg` or `.mktr.sg` domain
 * when we know the request came from one of those public hosts. Otherwise
 * return undefined so callers fall back to host-only cookies (safest).
 */
export function cookieDomainForPublicHost(host) {
  // A sandbox host lives UNDER mktr.sg, so it must never widen a cookie to the
  // parent domain: that would let sandbox state be read on mktr.sg (and vice
  // versa). Host-only, always — checked before the mktr.sg branch below.
  if (isSandboxHost(host)) return undefined;
  if (host === 'redeem.sg' || host === 'www.redeem.sg') return '.redeem.sg';
  if (host === 'mktr.sg' || host === 'www.mktr.sg') return '.mktr.sg';
  return undefined;
}

export function isAllowedPublicHost(host) {
  if (!host) return false;
  return allowedHosts().has(String(host).toLowerCase());
}

export function isRedeemHost(host) {
  if (!host) return false;
  const h = String(host).toLowerCase();
  return h === 'redeem.sg' || h === 'www.redeem.sg';
}

/** The internal Redeem Ops staff surface — never a consumer redeem host. */
export function isOpsHost(host) {
  if (!host) return false;
  return String(host).toLowerCase() === 'ops.redeem.sg';
}

export function isMktrHost(host) {
  if (!host) return false;
  const h = String(host).toLowerCase();
  // The sandbox serves the MKTR-brand SPA, so it takes the MKTR branch for
  // brand/chrome decisions — but never the `.mktr.sg` cookie domain above.
  if (isSandboxHost(h)) return true;
  return h === 'mktr.sg' || h === 'www.mktr.sg';
}

export const ALLOWED_PUBLIC_HOSTS_LIST = PRODUCTION_PUBLIC_HOSTS.slice();

/** Live view including this deployment's sandbox hosts. */
export function allowedPublicHostsList() {
  return Array.from(allowedHosts());
}
