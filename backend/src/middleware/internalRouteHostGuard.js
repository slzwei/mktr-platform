import { publicHostFromRequest, isRedeemHost } from '../utils/publicHost.js';
import { logger } from '../utils/logger.js';

// D13: auth / admin / agent / driver flows must not be reachable from the
// public redeem.sg static site. Render route rules redirect those at the
// edge; this middleware is the backend belt-and-braces — if the redirect
// is bypassed or misconfigured, the API call is rejected here.
//
// We compare against the *validated* public host (allowlist-checked),
// never raw `req.hostname` or unfiltered headers. Requests that don't
// carry a recognisable public host (server-to-server, CRON, etc.) pass
// through unchanged.
const BLOCKED_PATH_PREFIXES = [
  '/api/auth',
  '/api/admin',
  '/api/agents',
  '/api/fleet',
  '/api/devices',
  '/api/users',
  '/api/lyfe',
  '/api/mktr-leads',
  '/api/webhooks',
  '/api/integrations',
];

function isBlockedPath(pathname) {
  if (!pathname) return false;
  for (const prefix of BLOCKED_PATH_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

export function blockRedeemForInternalRoutes(req, res, next) {
  // Only check API requests (this middleware mounts on /api in server_internal).
  const pathname = req.originalUrl ? req.originalUrl.split('?')[0] : req.path;
  if (!isBlockedPath(pathname)) return next();

  const publicHost = publicHostFromRequest(req);
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
