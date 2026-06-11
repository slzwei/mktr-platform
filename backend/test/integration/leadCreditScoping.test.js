import { getApp, closeDb, createTestUser, createTestCampaign, createTestLeadPackage, createTestLeadPackageAssignment } from '../helpers.js';
import { LeadPackageAssignment, User } from '../../src/models/index.js';
import { deductLeadCredit } from '../../src/services/leadCredits.js';

/**
 * Integration: campaign-scoped best-effort deduction against real Postgres
 * (exercises the two-step package-id + FOR UPDATE SQL the unit mocks can't).
 *
 * Invariant: campaign A's leads can only consume campaign A's credits — never
 * campaign B's (the production bug), then the manual owed_leads_count bucket.
 */

let admin, agent, campaignA, campaignB, assignA, assignB;

beforeAll(async () => {
  process.env.WEBHOOK_ENABLED = 'false';
  await getApp();

  ({ user: admin } = await createTestUser({ role: 'admin' }));
  ({ user: agent } = await createTestUser({ role: 'agent', owed_leads_count: 2 }));

  campaignA = await createTestCampaign(admin.id, { name: `Scope A ${Date.now()}` });
  campaignB = await createTestCampaign(admin.id, { name: `Scope B ${Date.now()}` });

  const pkgA = await createTestLeadPackage(campaignA.id, admin.id, { name: 'Pkg A' });
  const pkgB = await createTestLeadPackage(campaignB.id, admin.id, { name: 'Pkg B' });

  assignA = await createTestLeadPackageAssignment(agent.id, pkgA.id, { leadsRemaining: 2, leadsTotal: 2 });
  assignB = await createTestLeadPackageAssignment(agent.id, pkgB.id, { leadsRemaining: 3, leadsTotal: 3 });
}, 30000);

afterAll(async () => {
  await closeDb();
});

const remaining = async (id) => (await LeadPackageAssignment.findByPk(id)).leadsRemaining;
const owed = async () => (await User.findByPk(agent.id)).owed_leads_count;

describe('deductLeadCredit — campaign scoping (real SQL)', () => {
  it('a campaign-A deduction decrements ONLY campaign A', async () => {
    const ok = await deductLeadCredit({ agentId: agent.id, campaignId: campaignA.id });
    expect(ok).toBe(true);
    expect(await remaining(assignA.id)).toBe(1);
    expect(await remaining(assignB.id)).toBe(3); // untouched — the old code would have FIFO'd into whichever was older
  });

  it('exhausting campaign A falls back to the MANUAL bucket — never campaign B', async () => {
    const ok = await deductLeadCredit({ agentId: agent.id, campaignId: campaignA.id, amount: 2 });
    expect(ok).toBe(true);
    expect(await remaining(assignA.id)).toBe(0);
    const a = await LeadPackageAssignment.findByPk(assignA.id);
    expect(a.status).toBe('completed');
    expect(await remaining(assignB.id)).toBe(3); // still untouched
    expect(await owed()).toBe(1); // manual bucket paid the overflow (2 -> 1)
  });

  it('a campaignless deduction touches no package at all', async () => {
    const ok = await deductLeadCredit({ agentId: agent.id, campaignId: null });
    expect(ok).toBe(true);
    expect(await remaining(assignB.id)).toBe(3);
    expect(await owed()).toBe(0);
  });

  it('returns false when neither the campaign nor the manual bucket can pay', async () => {
    const ok = await deductLeadCredit({ agentId: agent.id, campaignId: campaignA.id });
    expect(ok).toBe(false);
    expect(await remaining(assignB.id)).toBe(3); // campaign B remains sacrosanct
  });

  it('campaign B still pays out normally when actually targeted', async () => {
    const ok = await deductLeadCredit({ agentId: agent.id, campaignId: campaignB.id });
    expect(ok).toBe(true);
    expect(await remaining(assignB.id)).toBe(2);
  });
});
