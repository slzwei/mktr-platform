/**
 * Pure unit tests for the Redeem Ops capability map — no DB required.
 * Pins docs/redeem-ops/PERMISSION_MATRIX.md §2 invariants.
 */
import {
  CAPABILITIES,
  ROLE_CAPABILITIES,
  REDEEM_OPS_SUB_ROLES,
  hasCapability,
  isRedeemOpsUser,
} from '../src/services/redeemOps/permissions.js';

describe('redeemOps permissions map', () => {
  test('every sub-role in the map is a declared sub-role and vice versa', () => {
    expect(Object.keys(ROLE_CAPABILITIES).sort()).toEqual([...REDEEM_OPS_SUB_ROLES].sort());
  });

  test('every granted capability is a declared capability, with no duplicates', () => {
    for (const [role, caps] of Object.entries(ROLE_CAPABILITIES)) {
      const unknown = caps.filter((c) => !CAPABILITIES.includes(c));
      expect({ role, unknown }).toEqual({ role, unknown: [] });
      expect(new Set(caps).size).toBe(caps.length);
    }
  });

  test('super_admin holds everything; ops_admin holds everything except team.manage_access', () => {
    expect([...ROLE_CAPABILITIES.super_admin].sort()).toEqual([...CAPABILITIES].sort());
    expect(ROLE_CAPABILITIES.ops_admin).not.toContain('team.manage_access');
    expect([...ROLE_CAPABILITIES.ops_admin].sort()).toEqual(
      CAPABILITIES.filter((c) => c !== 'team.manage_access').sort()
    );
  });

  test('outreach_exec can claim/log but cannot reassign, merge, manage rewards, or view audit', () => {
    const caps = ROLE_CAPABILITIES.outreach_exec;
    expect(caps).toEqual(expect.arrayContaining(['partners.claim', 'partners.create', 'activities.log', 'pools.claim_next']));
    for (const denied of ['partners.reassign', 'partners.merge', 'rewards.manage', 'inventory.adjust', 'audit.view', 'team.manage_access', 'analytics.view_team']) {
      expect(caps).not.toContain(denied);
    }
  });

  test('analyst is read/export only — no mutating capabilities', () => {
    const mutating = CAPABILITIES.filter((c) =>
      /\.(create|edit|claim|release|reassign|restrict_disqualify|merge|import|manage|log|move|adjust|link_campaign|allocate_inventory|issue_manual|verify|override|manage_access)$/.test(c)
    );
    for (const cap of ROLE_CAPABILITIES.analyst) {
      expect(mutating).not.toContain(cap);
    }
  });

  test('campaign_ops manages activations + campaign references but never campaign building or partner CRM writes', () => {
    const caps = ROLE_CAPABILITIES.campaign_ops;
    expect(caps).toEqual(
      expect.arrayContaining(['activations.manage', 'activations.link_campaign', 'campaigns.read_reference'])
    );
    for (const denied of ['partners.create', 'partners.claim', 'rewards.manage', 'redemptions.override']) {
      expect(caps).not.toContain(denied);
    }
  });

  test('hasCapability: admin is implicit super_admin; sub-roles resolve; null-sub-role users hold nothing', () => {
    expect(hasCapability({ role: 'admin' }, 'team.manage_access')).toBe(true);
    expect(hasCapability({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' }, 'partners.claim')).toBe(true);
    expect(hasCapability({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' }, 'partners.merge')).toBe(false);
    expect(hasCapability({ role: 'redeem_ops', redeemOpsRole: null }, 'partners.view')).toBe(false);
    expect(hasCapability(null, 'partners.view')).toBe(false);
    expect(hasCapability({ role: 'agent' }, 'partners.view')).toBe(false);
  });

  test('isRedeemOpsUser: admin, redeem_ops role, or granted sub-role — nothing else', () => {
    expect(isRedeemOpsUser({ role: 'admin' })).toBe(true);
    expect(isRedeemOpsUser({ role: 'redeem_ops' })).toBe(true);
    expect(isRedeemOpsUser({ role: 'admin', redeemOpsRole: 'analyst' })).toBe(true);
    expect(isRedeemOpsUser({ role: 'agent' })).toBe(false);
    expect(isRedeemOpsUser({ role: 'customer' })).toBe(false);
    expect(isRedeemOpsUser(null)).toBe(false);
  });
});
