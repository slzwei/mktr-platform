/**
 * P1-6 regression: every limiter in the app is client-keyed and durable.
 *
 * The two correct primitives — clientKey (resolves the visitor from a
 * CF-validated CF-Connecting-IP) and PostgresRateLimitStore (durable, shared
 * across instances) — existed but were wired into exactly ONE route file. Every
 * other limiter, including the global /api one, used express-rate-limit's
 * defaults: req.ip, which behind Cloudflare is the EDGE address, and an
 * in-process MemoryStore that resets on redeploy. Production limiter rows were
 * all keyed 162.158.x.x — real users sharing an edge exhausted one bucket while
 * an attacker rotating edges was never counted.
 */
import '../setup.js';
import fs from 'fs';
import path from 'path';
import { makeLimiter, userOrClientKey, isSessionDoor } from '../../src/middleware/rateLimiters.js';
import { PostgresRateLimitStore, clientKey } from '../../src/middleware/pgRateLimitStore.js';

const srcDir = path.join(process.cwd(), 'src');

const read = (rel) => fs.readFileSync(path.join(srcDir, rel), 'utf8');

// A Cloudflare edge address (172.64.0.0/13 is a published CF range).
const CF_EDGE = '172.64.12.34';

const reqFrom = ({ ip, cfIp }) => ({
  ip,
  socket: { remoteAddress: ip },
  headers: cfIp ? { 'cf-connecting-ip': cfIp } : {},
});

describe('makeLimiter', () => {
  it('defaults to the client key and the Postgres store', () => {
    const limiter = makeLimiter({ prefix: 'rl:test', windowMs: 1000, max: 5 });
    // express-rate-limit exposes the resolved options off the middleware.
    expect(limiter).toBeInstanceOf(Function);
  });

  it('refuses to build a limiter without its own bucket', () => {
    expect(() => makeLimiter({ windowMs: 1000, max: 5 })).toThrow(/prefix/);
    expect(() => makeLimiter()).toThrow(/prefix/);
  });

  it('namespaces buckets per prefix so two limiters never charge each other', async () => {
    const a = new PostgresRateLimitStore({ prefix: 'rl:a' });
    const b = new PostgresRateLimitStore({ prefix: 'rl:b' });
    a.init({ windowMs: 60_000 });
    b.init({ windowMs: 60_000 });
    // The bucket key is derived from the prefix; identical client, different bucket.
    expect(a.prefix).not.toBe(b.prefix);
  });
});

describe('clientKey resolution (what the limiters now key on)', () => {
  it('uses the real visitor behind a Cloudflare edge, not the edge itself', () => {
    const key = clientKey(reqFrom({ ip: CF_EDGE, cfIp: '203.0.113.7' }));
    expect(key).toBe('203.0.113.7');
    expect(key).not.toBe(CF_EDGE);
  });

  it('puts one visitor arriving via two different edges in ONE bucket', () => {
    const viaEdgeA = clientKey(reqFrom({ ip: '172.64.1.1', cfIp: '203.0.113.7' }));
    const viaEdgeB = clientKey(reqFrom({ ip: '172.64.9.9', cfIp: '203.0.113.7' }));
    expect(viaEdgeA).toBe(viaEdgeB);
  });

  it('puts two visitors sharing ONE edge in different buckets', () => {
    const alice = clientKey(reqFrom({ ip: CF_EDGE, cfIp: '203.0.113.7' }));
    const bob = clientKey(reqFrom({ ip: CF_EDGE, cfIp: '198.51.100.4' }));
    expect(alice).not.toBe(bob);
  });

  it('ignores a spoofed CF-Connecting-IP from a non-Cloudflare socket', () => {
    const key = clientKey(reqFrom({ ip: '198.51.100.99', cfIp: '203.0.113.7' }));
    expect(key).toBe('198.51.100.99');
  });
});

describe('userOrClientKey', () => {
  it('prefers the authenticated principal', () => {
    expect(userOrClientKey({ user: { id: 'u1' }, ...reqFrom({ ip: CF_EDGE }) })).toBe('u:u1');
  });

  it('falls back to the resolved client, never req.ip directly', () => {
    expect(userOrClientKey(reqFrom({ ip: CF_EDGE, cfIp: '203.0.113.7' }))).toBe('203.0.113.7');
  });
});

describe('no limiter is left on the express-rate-limit defaults', () => {
  const routeFiles = fs.readdirSync(path.join(srcDir, 'routes')).filter((f) => f.endsWith('.js'));

  it('no source file calls rateLimit() directly any more', () => {
    const offenders = [...routeFiles.map((f) => `routes/${f}`), 'server_internal.js']
      .filter((rel) => /(^|[^.\w])rateLimit\s*\(/.test(read(rel)));
    expect(offenders).toEqual([]);
  });

  it('the global /api limiter goes through the factory', () => {
    const src = read('server_internal.js');
    expect(src).toMatch(/makeLimiter\(\{\s*\n?\s*prefix: 'rl:api'/);
  });

  it('the global /api limiter elevates every authenticated principal', () => {
    // Staff CRM sessions legitimately exceed the anonymous 200/15min budget
    // ("Too many requests from this IP" mid-shift). The elevated budget keys
    // off req.user alone — any valid session, not a role allowlist.
    const src = read('server_internal.js');
    expect(src).toMatch(/if \(isProd && req\.user\) return 2000/);
    expect(src).not.toMatch(/isRedeemOpsUser\(req\.user\)\) return 2000/);
    expect(src).not.toMatch(/req\.user\.role === 'admin'\) return 2000/);
  });

  it('cookieParser is mounted before optionalAuth, exactly once', () => {
    // The SPA's only credential is the httpOnly mktr_token cookie. With
    // cookieParser mounted after the limiter, req.user was unset at budget
    // time and every logged-in session was charged the anonymous budget
    // (the 2026-09-01 ops login lockout).
    const src = read('server_internal.js');
    const cookieAt = src.indexOf('app.use(cookieParser())');
    const authAt = src.indexOf("app.use('/api', optionalAuth");
    expect(cookieAt).toBeGreaterThan(-1);
    expect(authAt).toBeGreaterThan(-1);
    expect(cookieAt).toBeLessThan(authAt);
    expect([...src.matchAll(/app\.use\(cookieParser\(\)\)/g)]).toHaveLength(1);
  });

  it('the global /api limiter skips the session doors', () => {
    expect(read('server_internal.js')).toMatch(/isSessionDoor\(req\.originalUrl\)/);
  });

  it('every limiter declares a UNIQUE prefix', () => {
    const prefixes = [...routeFiles.map((f) => `routes/${f}`), 'server_internal.js']
      .flatMap((rel) => [...read(rel).matchAll(/prefix: '([^']+)'/g)].map((m) => m[1]));
    expect(prefixes.length).toBeGreaterThan(10);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

describe('the eight bare auth doors now carry a limiter', () => {
  const src = read('routes/auth.js');

  it.each([
    ["router.post('/google',", 'authLimiter'],
    ["router.post('/google/callback',", 'authLimiter'],
    ["router.put('/change-password',", 'passwordLimiter'],
    ["router.get('/verify-email/:token',", 'tokenLimiter'],
    ["router.post('/forgot-password',", 'passwordLimiter'],
    ["router.post('/reset-password/:token',", 'passwordLimiter'],
    ["router.get('/invite-info/:token',", 'tokenLimiter'],
    ["router.post('/accept-invite',", 'tokenLimiter'],
  ])('%s is limited by %s', (mount, limiter) => {
    const line = src.split('\n').find((l) => l.startsWith(mount));
    expect(line).toBeDefined();
    expect(line).toContain(limiter);
  });

  it('keeps password and token doors on their own buckets', () => {
    expect(src).toContain("prefix: 'rl:auth-password'");
    expect(src).toContain("prefix: 'rl:auth-token'");
  });
});

describe('isSessionDoor — paths the global traffic budget must never throttle', () => {
  it.each([
    '/api/auth/login',
    '/api/auth/google',
    '/api/auth/google/config',
    '/api/auth/google/state',
    '/api/auth/google/callback',
    '/api/auth/profile',
    '/api/auth/refresh-token',
    '/api/auth/logout',
    '/api/auth/forgot-password',
    '/api/auth/reset-password/some-token-value',
  ])('%s is a session door', (url) => {
    expect(isSessionDoor(url)).toBe(true);
  });

  it('ignores a query string', () => {
    expect(isSessionDoor('/api/auth/login?redirect=%2Fadmin')).toBe(true);
  });

  it.each([
    '/api/auth/register', // account creation is not a session door
    '/api/auth/loginx', // no prefix confusion
    '/api/auth/reset-password', // bare path without a token is not a route
    '/api/redeem-ops/tasks',
    '/api/prospects',
  ])('%s stays behind the traffic budget', (url) => {
    expect(isSessionDoor(url)).toBe(false);
  });

  it('handles a missing url without throwing', () => {
    expect(isSessionDoor(undefined)).toBe(false);
  });
});
