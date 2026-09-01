import rateLimit from 'express-rate-limit';
import { PostgresRateLimitStore, clientKey } from './pgRateLimitStore.js';

/**
 * The one way to build a rate limiter in this app (P1-6).
 *
 * Both correct primitives already existed but were wired into exactly ONE file
 * (routes/verify.js), so every other limiter inherited two express-rate-limit
 * defaults that are wrong here:
 *
 *   - the default keyGenerator uses `req.ip`, which behind Cloudflare with
 *     `trust proxy = 1` is the EDGE address. Production limiter rows were all
 *     keyed `162.158.x.x`: real users sharing an edge exhausted one bucket
 *     while an attacker rotating edges was never counted. `clientKey` resolves
 *     the visitor from a CF-validated CF-Connecting-IP instead.
 *   - the default MemoryStore counts per process and resets on redeploy, so on
 *     Render "10 per 15 min" really meant "10 per instance, until next deploy".
 *     PostgresRateLimitStore (migration 083) is durable and shared, and fails
 *     OPEN on a database error so a blip degrades the limiter instead of 503ing
 *     the surface behind it.
 *
 * `prefix` is REQUIRED and must be unique per limiter: it namespaces the bucket,
 * so two limiters sharing one would charge each other's traffic.
 */
export function makeLimiter({ prefix, ...options } = /** @type {{prefix?: string} & Record<string, any>} */ ({})) {
  if (!prefix) {
    throw new Error('makeLimiter requires a unique `prefix` — limiters must not share a bucket');
  }
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: clientKey,
    store: new PostgresRateLimitStore({ prefix }),
    ...options,
  });
}

/**
 * Key on the authenticated principal when there is one, else the resolved
 * client. For per-user budgets (AI generation) — an agent behind the same
 * office NAT as a colleague still gets their own allowance.
 */
export function userOrClientKey(req) {
  return req.user?.id ? `u:${req.user.id}` : clientKey(req);
}

/**
 * Session doors the global /api IP limiter must never throttle: a user must
 * always be able to log in, stay logged in, and recover their account, even
 * when their IP's traffic budget is exhausted (an office NAT, a busy ops
 * session — 2026-09-01 a redeem_ops user was locked out of login itself).
 *
 * This is NOT a brute-force hole: every one of these routes keeps its own
 * dedicated gate — authLimiter (10/min) on login/register/google exchanges,
 * passwordLimiter (10/15min) on forgot/reset, and the per-(email × client)
 * lockout inside authService.login. Those stay in force; only the shared
 * traffic budget stops applying.
 */
const SESSION_DOOR_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/google',
  '/api/auth/google/config',
  '/api/auth/google/state',
  '/api/auth/google/callback',
  '/api/auth/profile',
  '/api/auth/refresh-token',
  '/api/auth/logout',
  '/api/auth/forgot-password',
]);

export function isSessionDoor(originalUrl) {
  const pathOnly = String(originalUrl || '').split('?')[0];
  return (
    SESSION_DOOR_PATHS.has(pathOnly) ||
    // Token-carrying recovery door: /api/auth/reset-password/:token
    pathOnly.startsWith('/api/auth/reset-password/')
  );
}
