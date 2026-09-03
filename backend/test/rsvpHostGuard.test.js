/**
 * Pure unit tests for the rsvp.redeem.sg host policy (docs/plans/rsvp-pages.md
 * §7.7-7.8) — no DB required:
 *   - rsvp.redeem.sg is STRICT-allowlist: only /api/rsvp-public answers; the
 *     RSVP ADMIN namespace and everything else 403 at the host layer
 *   - consumer redeem.sg is blocked from /api/rsvp (admin) but not /api/rsvp-public
 *   - no cookie domain is ever derived for the rsvp host
 */
import { blockRedeemForInternalRoutes } from '../src/middleware/internalRouteHostGuard.js';
import { publicHostFromRequest, cookieDomainForPublicHost, isRsvpHost, isRedeemHost, isAllowedPublicHost } from '../src/utils/publicHost.js';

function run(originalUrl, originHost) {
  const req = { originalUrl, get: (h) => (originHost && h.toLowerCase() === 'origin' ? `https://${originHost}` : undefined) };
  let statusCode = null;
  let nextCalled = false;
  const res = { status(code) { statusCode = code; return this; }, json() { return this; } };
  blockRedeemForInternalRoutes(req, res, () => { nextCalled = true; });
  return { statusCode, nextCalled };
}

describe('publicHost — rsvp.redeem.sg', () => {
  test('is an allowed public host, recognised from Origin, and never a redeem-consumer host', () => {
    expect(isAllowedPublicHost('rsvp.redeem.sg')).toBe(true);
    expect(isRsvpHost('RSVP.redeem.sg')).toBe(true);
    expect(isRsvpHost('redeem.sg')).toBe(false);
    expect(isRedeemHost('rsvp.redeem.sg')).toBe(false);
    const req = { get: (h) => (h === 'origin' ? 'https://rsvp.redeem.sg' : undefined) };
    expect(publicHostFromRequest(req)).toBe('rsvp.redeem.sg');
  });

  test('no cookie domain: the surface is anonymous by construction', () => {
    expect(cookieDomainForPublicHost('rsvp.redeem.sg')).toBeUndefined();
  });
});

describe('internalRouteHostGuard — rsvp host policy', () => {
  test('rsvp.redeem.sg reaches only the public RSVP namespace', () => {
    expect(run('/api/rsvp-public/launch-night', 'rsvp.redeem.sg').nextCalled).toBe(true);
    expect(run('/api/rsvp-public/launch-night/respond', 'rsvp.redeem.sg').nextCalled).toBe(true);
  });

  test('rsvp.redeem.sg is STRICT-allowlist: the admin API and every other namespace 403', () => {
    for (const path of ['/api/rsvp', '/api/rsvp/abc/responses.csv', '/api/auth/login', '/api/campaigns', '/api/prospects', '/api/uploads/single', '/api/previews/public/x', '/api/redeem-ops/team', '/api/rsvp-publicx']) {
      expect(run(path, 'rsvp.redeem.sg')).toEqual({ statusCode: 403, nextCalled: false });
    }
  });

  test('consumer redeem.sg is blocked from the RSVP ADMIN namespace but not the public one', () => {
    expect(run('/api/rsvp', 'redeem.sg').statusCode).toBe(403);
    expect(run('/api/rsvp/abc', 'www.redeem.sg').statusCode).toBe(403);
    expect(run('/api/rsvp-public/launch-night', 'redeem.sg').nextCalled).toBe(true);
  });

  test('mktr.sg and host-less traffic reach the admin namespace', () => {
    expect(run('/api/rsvp', 'mktr.sg').nextCalled).toBe(true);
    expect(run('/api/rsvp', undefined).nextCalled).toBe(true);
  });
});
