import { publicHostFromRequest, isRedeemHost, isOpsHost, isRsvpHost } from '../utils/publicHost.js';
import { logger } from '../utils/logger.js';

// D13: auth / admin / agent / driver flows must not be reachable from the
// public redeem.sg static site. Render route rules redirect those at the
// edge; this middleware is the backend belt-and-braces — if the redirect
// is bypassed or misconfigured, the API call is rejected here.
//
// ops.redeem.sg (the internal Redeem Ops surface — docs/redeem-ops/
// RECOMMENDED_ARCHITECTURE.md §5) sits on the redeem apex but is NOT a
// consumer host: it gets a NARROW allowlist (staff auth, the redeem-ops
// namespace, notifications) and stays blocked from every other internal
// prefix at the host layer. Host policy is defence-in-depth only — role +
// capability middleware remain the real gates.
//
// We compare against the *validated* public host (allowlist-checked),
// never raw `req.hostname` or unfiltered headers. Requests that don't
// carry a recognisable public host (server-to-server, CRON, etc.) pass
// through unchanged.
const BLOCKED_PATH_PREFIXES = [
  '/api/auth',
  '/api/admin',
  '/api/consumers',
  '/api/cohorts',
  '/api/email-broadcasts',
  '/api/agents',
  '/api/fleet',
  '/api/devices',
  '/api/users',
  '/api/lyfe',
  '/api/mktr-leads',
  '/api/webhooks',
  '/api/integrations',
  '/api/redeem-ops',
  // File administration + staff uploads (P1-5): nothing on a consumer host
  // uploads to or enumerates uploads/ — the only caller is the admin Studio.
  '/api/uploads',
  // RSVP ADMIN namespace (docs/plans/rsvp-pages.md §5.1). /api/rsvp-public is a
  // different prefix (matchesPrefix is segment-exact) and stays reachable.
  '/api/rsvp',
];

// rsvp.redeem.sg answers ONE namespace. Treating it like redeem.sg (a blocklist
// that permits everything unlisted) would have left /api/rsvp — the ADMIN
// API — reachable from the public host (Codex plan review, must-fix #3).
const RSVP_ALLOWED_PREFIXES = [
  '/api/rsvp-public',
  // Mobile verification for the RSVP form reuses the funnel's OTP endpoints
  // (already public, already rate-limited, already under the per-number SSIR
  // daily cap). Both routes are send/check only — they read and write nothing
  // beyond the verification row.
  '/api/verify',
];

const OPS_ALLOWED_PREFIXES = [
  '/api/auth',
  '/api/redeem-ops',
  '/api/notifications',
];

function matchesPrefix(pathname, prefixes) {
  if (!pathname) return false;
  for (const prefix of prefixes) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

function isBlockedPath(pathname) {
  return matchesPrefix(pathname, BLOCKED_PATH_PREFIXES);
}

export function blockRedeemForInternalRoutes(req, res, next) {
  // Only check API requests (this middleware mounts on /api in server_internal).
  const pathname = req.originalUrl ? req.originalUrl.split('?')[0] : req.path;
  const publicHost = publicHostFromRequest(req);

  // ops.redeem.sg is a STRICT-allowlist internal surface: only staff auth, the
  // redeem-ops namespace, and notifications exist there — EVERY other /api path
  // 403s at the host layer, including public capture endpoints and any future
  // namespace not on the blocklist (Codex Phase-1 review, finding 1).
  if (isRsvpHost(publicHost)) {
    if (!matchesPrefix(pathname, RSVP_ALLOWED_PREFIXES)) {
      logger.warn('Blocked API call from rsvp.redeem.sg (outside allowlist)', {
        path: pathname,
        publicHost,
        origin: req.get('origin') || null,
      });
      return res.status(403).json({
        success: false,
        message: 'This API is not available on rsvp.redeem.sg.',
      });
    }
    return next();
  }

  if (isOpsHost(publicHost)) {
    if (!matchesPrefix(pathname, OPS_ALLOWED_PREFIXES)) {
      logger.warn('Blocked API call from ops.redeem.sg (outside allowlist)', {
        path: pathname,
        publicHost,
        origin: req.get('origin') || null,
      });
      return res.status(403).json({
        success: false,
        message: 'This API is not available on ops.redeem.sg.',
      });
    }
    return next();
  }

  if (!isBlockedPath(pathname)) return next();

  if (isRedeemHost(publicHost)) {
    logger.warn('Blocked internal API call from redeem.sg', {
      path: pathname,
      publicHost,
      origin: req.get('origin') || null,
    });
    return res.status(403).json({
      success: false,
      message: 'Internal admin/auth/agent/driver APIs are only available on mktr.sg.',
    });
  }

  return next();
}
