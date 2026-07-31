import { getApp, closeDb, createTestUser, createTestCampaign, createTestLeadPackage, createTestLeadPackageAssignment } from '../helpers.js';
import { LeadPackageAssignment } from '../../src/models/index.js';
import { chargeLeadCredit } from '../../src/services/leadCredits.js';
import { assignPackage, assignPackageExternal, bulkAssignPackage, topUpAssignment } from '../../src/services/leadPackageService.js';

/**
 * Integration: lead-package money paths under REAL concurrency (real Postgres,
 * Promise.allSettled bursts — same style as leadCreditScoping/agentAssignment).
 *
 * Invariant 1 (P1-4 §1): parallel top-ups and charges CONSERVE credits —
 * leadsRemaining + successful charges === leadsTotal. The old read-modify-write
 * top-up erased concurrent charge decrements (lead delivered, credit back).
 *
 * Invariant 2 (P1-4 §2): every assign path funnels through one locked core —
 * a parallel storm of assigns for the same (agent, package) yields EXACTLY ONE
 * active assignment, across and within paths, and non-active packages are not
 * assignable anywhere.
 */

const MKTR_ID = `mktr-conc-${Date.now()}`;

let admin, agent, campaign, pkg;

beforeAll(async () => {
  process.env.WEBHOOK_ENABLED = 'false';
  await getApp();

  ({ user: admin } = await createTestUser({ role: 'admin' }));
  ({ user: agent } = await createTestUser({ role: 'agent', mktrLeadsId: MKTR_ID }));
  campaign = await createTestCampaign(admin.id, { name: `Conc ${Date.now()}` });
  pkg = await createTestLeadPackage(campaign.id, admin.id, { name: 'Conc Pkg', leadCount: 10 });
}, 30000);

afterAll(async () => {
  await closeDb();
});

const activeCount = (packageId) =>
  LeadPackageAssignment.count({ where: { leadPackageId: packageId, agentId: agent.id, status: 'active' } });

describe('topUpAssignment × chargeLeadCredit — credits are conserved', () => {
  it('parallel top-ups and charges never erase each other', async () => {
    const a = await createTestLeadPackageAssignment(agent.id, pkg.id, { leadsRemaining: 5, leadsTotal: 5 });

    const TOPUPS = 4;   // × 3 credits each
    const CHARGES = 8;  // × 1 credit each
    const burst = [
      ...Array.from({ length: TOPUPS }, () => () => topUpAssignment({ assignmentId: a.id, addLeads: 3 })),
      ...Array.from({ length: CHARGES }, () => () => chargeLeadCredit(agent.id, campaign.id)),
    ];
    // Shuffle-ish interleave: alternate top-ups and charges into one burst.
    const results = await Promise.allSettled(burst.map((fn) => fn()));

    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toEqual([]);

    const charged = results
      .slice(TOPUPS)
      .filter((r) => r.status === 'fulfilled' && r.value === true).length;

    const final = await LeadPackageAssignment.findByPk(a.id);
    // Every top-up landed: total grew by exactly TOPUPS × 3.
    expect(final.leadsTotal).toBe(5 + TOPUPS * 3);
    // CONSERVATION: what remains + what was charged === everything ever funded.
    // The pre-fix read-modify-write top-up violated this (remaining + charged
    // exceeded total — delivered leads whose credits silently came back).
    expect(final.leadsRemaining + charged).toBe(final.leadsTotal);
    // Sanity: the burst really contended and at least one charge landed mid-storm.
    // (chargeLeadCredit is FOR UPDATE SKIP LOCKED by design — under a single-row
    // pile-up, colliding chargers fail fast rather than queue, so the exact count
    // varies run to run. Conservation above is the invariant; this is liveness.)
    expect(charged).toBeGreaterThanOrEqual(1);
    expect(charged).toBeLessThanOrEqual(CHARGES);
  }, 30000);
});

describe('one locked assign core — no duplicate active assignments', () => {
  it('a parallel storm on the internal/admin path yields exactly one active assignment', async () => {
    const stormPkg = await createTestLeadPackage(campaign.id, admin.id, { name: 'Storm Pkg', leadCount: 7 });

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => assignPackage({ agentId: agent.id, packageId: stormPkg.id }))
    );

    // Idempotent contract: every call fulfils; exactly ONE minted the row.
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const minted = results.filter((r) => r.value.alreadyAssigned === false);
    expect(minted).toHaveLength(1);
    expect(await activeCount(stormPkg.id)).toBe(1);

    // Every caller got the SAME assignment id back.
    const ids = new Set(results.map((r) => r.value.assignment.id));
    expect(ids.size).toBe(1);
  }, 30000);

  it('a cross-path storm (admin + external + bulk) still yields exactly one active assignment', async () => {
    const crossPkg = await createTestLeadPackage(campaign.id, admin.id, { name: 'Cross Pkg', leadCount: 9 });

    const results = await Promise.allSettled([
      assignPackage({ agentId: agent.id, packageId: crossPkg.id }),
      assignPackage({ agentId: agent.id, packageId: crossPkg.id }),
      assignPackageExternal({ agentMktrUserId: MKTR_ID, packageId: crossPkg.id }),
      assignPackageExternal({ agentMktrUserId: MKTR_ID, packageId: crossPkg.id }),
      bulkAssignPackage({ campaignId: campaign.id, packageId: crossPkg.id, agentIds: [agent.id] }),
      bulkAssignPackage({ campaignId: campaign.id, packageId: crossPkg.id, agentIds: [agent.id] }),
    ]);

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(await activeCount(crossPkg.id)).toBe(1);

    // Exactly one path minted; the bulk calls report the rest as skipped/exists.
    const mints =
      results.filter((r) => r.value?.alreadyAssigned === false).length +
      results.filter((r) => r.value?.status === 'assigned').length +
      results.filter((r) => Array.isArray(r.value?.assignedAgentIds) && r.value.assignedAgentIds.length === 1).length;
    expect(mints).toBe(1);
  }, 30000);

  it('a non-active package is not assignable on ANY path', async () => {
    const archived = await createTestLeadPackage(campaign.id, admin.id, { name: 'Archived Pkg', status: 'archived' });

    await expect(assignPackage({ agentId: agent.id, packageId: archived.id })).rejects.toThrow('Package is not active');
    await expect(
      bulkAssignPackage({ campaignId: campaign.id, packageId: archived.id, agentIds: [agent.id] })
    ).rejects.toThrow('Package is not active');
    const ext = await assignPackageExternal({ agentMktrUserId: MKTR_ID, packageId: archived.id });
    expect(ext).toEqual({ status: 'package_inactive' });

    expect(await activeCount(archived.id)).toBe(0);
  });
});
