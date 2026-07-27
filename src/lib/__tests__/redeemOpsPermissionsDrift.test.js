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
    expect(mirror.ROW_OVERRIDE_SUB_ROLES).toEqual(backend.ROW_OVERRIDE_SUB_ROLES);
  });

  it('row-level partner gate agrees, and keeps BDM out of other people’s businesses', () => {
    const bdm = { id: 'u-bdm', role: 'redeem_ops', redeemOpsRole: 'bdm' };
    const rows = [
      [{ role: 'admin', id: 'u-admin' }, { ownerUserId: 'someone-else' }, true],
      [{ id: 'u-sa', redeemOpsRole: 'super_admin' }, { ownerUserId: 'someone-else' }, true],
      [{ id: 'u-oa', redeemOpsRole: 'ops_admin' }, { ownerUserId: 'someone-else' }, true],
      // A BDM manages the board but does not work a colleague's business.
      [bdm, { ownerUserId: 'someone-else' }, false],
      [bdm, { ownerUserId: 'u-bdm' }, true],
      // Unowned is nobody's — it has to be claimed first.
      [bdm, { ownerUserId: null }, false],
      [{ id: 'u-oe', redeemOpsRole: 'outreach_exec' }, { ownerUserId: 'u-oe' }, true],
      [{ id: 'u-oe', redeemOpsRole: 'outreach_exec' }, { ownerUserId: 'other' }, false],
      [null, { ownerUserId: null }, false],
    ];
    for (const [user, partner, expected] of rows) {
      expect(backend.canActOnPartnerRow(user, partner)).toBe(expected);
      expect(mirror.canActOnPartnerRow(user, partner)).toBe(expected);
    }
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
