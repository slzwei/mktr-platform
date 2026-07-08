/**
 * Pure unit tests for the extended host guard — no DB required.
 * Pins docs/redeem-ops/RECOMMENDED_ARCHITECTURE.md §5:
 *   - consumer redeem.sg is blocked from /api/redeem-ops (and the existing internal list)
 *   - ops.redeem.sg gets a NARROW allowlist (/api/auth, /api/redeem-ops, /api/notifications)
 *     and is blocked from the rest of the internal prefixes
 *   - mktr.sg and host-less (server-to-server) traffic pass through unchanged
 */
import { blockRedeemForInternalRoutes } from '../src/middleware/internalRouteHostGuard.js';

function run(originalUrl, originHost) {
  const req = {
    originalUrl,
    get: (h) => {
      if (originHost && h.toLowerCase() === 'origin') return `https://${originHost}`;
      return undefined;
    },
  };
  let statusCode = null;
  let nextCalled = false;
  const res = {
    status(code) { statusCode = code; return this; },
    json() { return this; },
  };
  blockRedeemForInternalRoutes(req, res, () => { nextCalled = true; });
  return { statusCode, nextCalled };
}

describe('internalRouteHostGuard — redeem-ops + ops-host policy', () => {
  test('consumer redeem.sg is blocked from /api/redeem-ops/*', () => {
    expect(run('/api/redeem-ops/team', 'redeem.sg')).toEqual({ statusCode: 403, nextCalled: false });
    expect(run('/api/redeem-ops', 'www.redeem.sg')).toEqual({ statusCode: 403, nextCalled: false });
  });

  test('consumer redeem.sg keeps its existing blocks (auth/admin)', () => {
    expect(run('/api/auth/login', 'redeem.sg').statusCode).toBe(403);
    expect(run('/api/admin/campaigns', 'redeem.sg').statusCode).toBe(403);
  });

  test('ops.redeem.sg may reach auth, redeem-ops, and notifications', () => {
    expect(run('/api/auth/login', 'ops.redeem.sg').nextCalled).toBe(true);
    expect(run('/api/redeem-ops/team', 'ops.redeem.sg').nextCalled).toBe(true);
    expect(run('/api/notifications', 'ops.redeem.sg').nextCalled).toBe(true);
  });

  test('ops.redeem.sg is STRICT-allowlist: every other /api path 403s, blocklisted or not', () => {
    expect(run('/api/admin/campaigns', 'ops.redeem.sg').statusCode).toBe(403);
    expect(run('/api/users', 'ops.redeem.sg').statusCode).toBe(403);
    expect(run('/api/agents', 'ops.redeem.sg').statusCode).toBe(403);
    expect(run('/api/webhooks/stats', 'ops.redeem.sg').statusCode).toBe(403);
    // Not on the blocklist — still refused on the ops surface (strict allowlist)
    expect(run('/api/campaigns', 'ops.redeem.sg').statusCode).toBe(403);
    expect(run('/api/prospects', 'ops.redeem.sg').statusCode).toBe(403);
    expect(run('/api/verify/send', 'ops.redeem.sg').statusCode).toBe(403);
  });

  test('mktr.sg passes everything at the host layer', () => {
    expect(run('/api/redeem-ops/team', 'mktr.sg').nextCalled).toBe(true);
    expect(run('/api/admin/campaigns', 'mktr.sg').nextCalled).toBe(true);
  });

  test('host-less (server-to-server) requests pass through unchanged', () => {
    expect(run('/api/redeem-ops/team', null).nextCalled).toBe(true);
    expect(run('/api/integrations/lyfe/lead-outcome', null).nextCalled).toBe(true);
  });

  test('public capture paths stay open on the consumer host', () => {
    expect(run('/api/prospects', 'redeem.sg').nextCalled).toBe(true);
    expect(run('/api/verify/send', 'redeem.sg').nextCalled).toBe(true);
  });
});
