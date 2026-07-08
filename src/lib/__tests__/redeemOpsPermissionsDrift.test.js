import { describe, it, expect } from 'vitest';
// The backend module is deliberately dependency-free so this cross-package import
// works — see the header comment in backend/src/services/redeemOps/permissions.js.
import * as backend from '../../../backend/src/services/redeemOps/permissions.js';
import * as mirror from '../redeemOpsPermissions.js';

describe('redeem-ops permissions drift guard', () => {
  it('frontend mirror matches the backend source of truth exactly', () => {
    expect(mirror.REDEEM_OPS_SUB_ROLES).toEqual(backend.REDEEM_OPS_SUB_ROLES);
    expect(mirror.CAPABILITIES).toEqual(backend.CAPABILITIES);
    expect(mirror.ROLE_CAPABILITIES).toEqual(backend.ROLE_CAPABILITIES);
  });

  it('helper semantics agree on representative users', () => {
    const cases = [
      [{ role: 'admin' }, 'team.manage_access'],
      [{ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' }, 'partners.claim'],
      [{ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' }, 'partners.merge'],
      [{ role: 'redeem_ops', redeemOpsRole: null }, 'partners.view'],
      [{ role: 'agent' }, 'partners.view'],
      [null, 'partners.view'],
    ];
    for (const [user, cap] of cases) {
      expect(mirror.hasCapability(user, cap)).toBe(backend.hasCapability(user, cap));
      expect(mirror.isRedeemOpsUser(user)).toBe(backend.isRedeemOpsUser(user));
    }
  });
});
