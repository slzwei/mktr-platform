import { isInternalStaff } from '../../src/middleware/rateLimiters.js';

/**
 * The global /api limiter skips authenticated internal staff (admin +
 * redeem_ops) — the ops console's Discover polling burned the 200/15min
 * public budget and 429'd the operator (2026-08-05). Everyone else,
 * including other authenticated roles, stays on the public budget.
 */
describe('isInternalStaff (global /api limiter exemption)', () => {
  test('admin and redeem_ops are exempt', () => {
    expect(isInternalStaff({ user: { role: 'admin' } })).toBe(true);
    expect(isInternalStaff({ user: { role: 'redeem_ops' } })).toBe(true);
  });

  test('unauthenticated and non-staff roles are not exempt', () => {
    expect(isInternalStaff({})).toBe(false);
    expect(isInternalStaff({ user: null })).toBe(false);
    expect(isInternalStaff({ user: { role: 'agent' } })).toBe(false);
    expect(isInternalStaff({ user: { role: 'customer' } })).toBe(false);
    expect(isInternalStaff({ user: { role: 'driver_partner' } })).toBe(false);
  });
});
