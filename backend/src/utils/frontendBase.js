// Per-request resolution of which public frontend host to redirect/link to.
//
// Two frontends share the same backend (mktr-backend-jo6r). Most flows
// belong to one or the other:
//   - Lead capture, tracker, share, public marketing  → public-host derived
//   - Invite emails, admin emails, OAuth callback     → MKTR (internal)
//
// Callers that already know the public host (from publicHostFromRequest)
// pass it in. Anything else gets MKTR by default, which is the safe
// admin-side base.

const REDEEM_BASE = process.env.REDEEM_FRONTEND_URL || 'https://redeem.sg';
const MKTR_BASE =
  process.env.MKTR_FRONTEND_URL || process.env.FRONTEND_BASE_URL || 'https://mktr.sg';

/**
 * Returns the base URL of the SPA to redirect to. `host` is the validated
 * public host from publicHostFromRequest(req) — never the raw `req.hostname`.
 */
export function frontendBaseForHost(host) {
  if (!host) return MKTR_BASE;
  const h = String(host).toLowerCase();
  if (h === 'redeem.sg' || h.endsWith('.redeem.sg')) return REDEEM_BASE;
  return MKTR_BASE;
}

export function mktrFrontendBase() {
  return MKTR_BASE;
}

export function redeemFrontendBase() {
  return REDEEM_BASE;
}
