/**
 * Redeem Ops capability model — FRONTEND MIRROR for nav/UI gating only.
 *
 * The backend copy (backend/src/services/redeemOps/permissions.js) is the source
 * of truth and the only enforcement point; this mirror exists so the SPA can hide
 * controls the API would reject. A vitest drift test
 * (src/lib/__tests__/redeemOpsPermissionsDrift.test.js) imports BOTH files and
 * fails if they diverge — edit them together.
 */

export const REDEEM_OPS_SUB_ROLES = [
  'super_admin',
  'ops_admin',
  'bdm',
  'outreach_exec',
  'campaign_ops',
  'redemption_ops',
  'analyst',
];

export const CAPABILITIES = [
  'partners.view',
  'partners.create',
  'partners.edit',
  'partners.claim',
  'partners.release',
  'partners.reassign',
  'partners.restrict_disqualify',
  'partners.merge',
  'partners.delete',
  'partners.import',
  'contacts.manage',
  'locations.manage',
  'activities.log',
  'activities.edit',
  'pipeline.move',
  'pipeline.view_team',
  'tasks.manage',
  'pools.manage',
  'pools.claim_next',
  'onboarding.manage',
  'rewards.view',
  'rewards.manage',
  'inventory.adjust',
  'activations.view',
  'activations.manage',
  'activations.link_campaign',
  'activations.allocate_inventory',
  'campaigns.read_reference',
  'entitlements.view',
  'entitlements.issue_manual',
  'redemptions.verify',
  'redemptions.override',
  'analytics.view_own',
  'analytics.view_team',
  'exports.run',
  'audit.view',
  'team.manage_access',
  'settings.manage',
  'discovery.search',
  'discovery.enrich',
];

const ALL = [...CAPABILITIES];

export const ROLE_CAPABILITIES = {
  super_admin: ALL,
  ops_admin: ALL.filter((c) => c !== 'team.manage_access'),
  bdm: [
    'partners.view',
    'partners.create',
    'partners.edit',
    'partners.claim',
    'partners.release',
    'partners.reassign',
    'partners.restrict_disqualify',
    'partners.import',
    'contacts.manage',
    'locations.manage',
    'activities.log',
    'activities.edit',
    'pipeline.move',
    'pipeline.view_team',
    'tasks.manage',
    'pools.manage',
    'pools.claim_next',
    'onboarding.manage',
    'rewards.view',
    'activations.view',
    'campaigns.read_reference',
    'analytics.view_own',
    'analytics.view_team',
    'exports.run',
    'discovery.search',
    'discovery.enrich',
  ],
  outreach_exec: [
    'partners.view',
    'partners.create',
    'partners.edit',
    'partners.claim',
    'partners.release',
    'contacts.manage',
    'locations.manage',
    'activities.log',
    'activities.edit',
    'pipeline.move',
    'tasks.manage',
    'pools.claim_next',
    'onboarding.manage',
    'rewards.view',
    'analytics.view_own',
    'discovery.search',
    'discovery.enrich',
  ],
  campaign_ops: [
    'partners.view',
    'pipeline.view_team',
    'rewards.view',
    'activations.view',
    'activations.manage',
    'activations.link_campaign',
    'activations.allocate_inventory',
    'campaigns.read_reference',
    'entitlements.view',
    'analytics.view_own',
    'analytics.view_team',
  ],
  redemption_ops: [
    'partners.view',
    'activities.log',
    'rewards.view',
    'activations.view',
    'entitlements.view',
    'entitlements.issue_manual',
    'redemptions.verify',
    'redemptions.override',
    'analytics.view_own',
    'analytics.view_team',
  ],
  analyst: [
    'partners.view',
    'pipeline.view_team',
    'rewards.view',
    'activations.view',
    'campaigns.read_reference',
    'entitlements.view',
    'analytics.view_own',
    'analytics.view_team',
    'exports.run',
  ],
};

export function hasCapability(user, capability) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const caps = ROLE_CAPABILITIES[user.redeemOpsRole];
  return Array.isArray(caps) && caps.includes(capability);
}

export function isRedeemOpsUser(user) {
  return !!user && (user.role === 'admin' || user.role === 'redeem_ops' || !!user.redeemOpsRole);
}

/** The tier that may act on a business it doesn't own. BDM is deliberately NOT here. */
export const ROW_OVERRIDE_SUB_ROLES = ['super_admin', 'ops_admin'];

/**
 * Row-level gate: may this user write to THIS business? Covers stage moves,
 * detail edits, contacts, locations and snooze — the actions that belong to
 * whoever is working the deal.
 *
 * A business is worked by exactly one person, so only its owner may act on it;
 * BDMs get no blanket override over a colleague's row (they keep their
 * capability-gated powers — reassign, claim, tasks, pools — and may still log
 * activity on any row via the `partners.reassign` escape hatch in the service).
 * Admin tier overrides everything. An UNOWNED row is nobody's: it must be
 * claimed first, which is why a null owner never matches.
 */
export function canActOnPartnerRow(user, partner) {
  if (!user || !partner) return false;
  if (user.role === 'admin') return true;
  if (ROW_OVERRIDE_SUB_ROLES.includes(user.redeemOpsRole)) return true;
  return !!partner.ownerUserId && partner.ownerUserId === user.id;
}
