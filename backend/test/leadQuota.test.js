/**
 * Lead-quota INTEGRATION tests — exercise the real SQL (chargeLeadCredit CTE, the
 * auto-release claim UPDATE, the held-leads query) end-to-end against a real Postgres.
 *
 * Runs as part of `npm test` (CI provides a throwaway Postgres; bootstrap force-syncs
 * the schema then runs migrations). State is re-fetched from the DB for each assertion
 * rather than trusting HTTP serialization. Each test uses its OWN campaign, so the
 * shared test DB needs no per-test cleanup.
 */
import './setup.js';
import request from 'supertest';
import {
  getApp, closeDb, createTestUser, createTestCampaign,
  createTestLeadPackage, createTestLeadPackageAssignment,
} from './helpers.js';
import { sequelize, Prospect, Campaign } from '../src/models/index.js';
import { sweepCampaign } from '../src/services/releaseSweep.js';

let app, admin, adminToken;
let seq = 0;
const nextPhone = () => `+6590${String(++seq).padStart(6, '0')}`; // globally unique, valid E.164

function postLead(campaignId, extra = {}) {
  return request(app).post('/api/prospects').send({
    firstName: 'Lead',
    email: `lead-${++seq}-${Date.now()}@test.com`,
    phone: nextPhone(),
    leadSource: 'website',
    campaignId,
    ...extra,
  });
}

// A quota campaign + an agent funded with `credits` for it.
async function fundedAgent(campaignId, credits = 1) {
  const { user: agent } = await createTestUser({ role: 'agent' });
  const pkg = await createTestLeadPackage(campaignId, admin.id, { leadCount: credits });
  const assignment = await createTestLeadPackageAssignment(agent.id, pkg.id, {
    leadsRemaining: credits, leadsTotal: credits,
  });
  return { agent, pkg, assignment };
}

const quotaCampaign = (over = {}) => createTestCampaign(admin.id, { enforceLeadQuota: true, ...over });
const prospectFromRes = (res) => {
  if (!res.body?.data?.prospect) throw new Error(`POST not 201: status=${res.status} body=${JSON.stringify(res.body).slice(0, 300)}`);
  return Prospect.findByPk(res.body.data.prospect.id);
};

beforeAll(async () => {
  app = await getApp();
  const a = await createTestUser({ role: 'admin' });
  admin = a.user;
  adminToken = a.token;
}, 30000);

afterAll(async () => {
  await closeDb();
});

// ──────────────────────────────────────────────────────────────────────────────
describe('schema', () => {
  it('has the lead-quota columns (migration 034 / model definitions)', async () => {
    const qi = sequelize.getQueryInterface();
    const campaigns = await qi.describeTable('campaigns');
    const prospects = await qi.describeTable('prospects');
    expect(campaigns.enforce_lead_quota).toBeDefined();
    expect(prospects.quarantinedAt).toBeDefined();
    expect(prospects.quarantineReason).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('enforceLeadQuota enablement via the campaign API', () => {
  it('POST /api/campaigns persists enforceLeadQuota; PUT toggles it', async () => {
    const name = `QuotaEnable-${++seq}`;
    const created = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, enforceLeadQuota: true });
    expect(created.status).toBe(201);

    const c = await Campaign.findOne({ where: { name } });
    expect(c.enforceLeadQuota).toBe(true);

    const updated = await request(app)
      .put(`/api/campaigns/${c.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enforceLeadQuota: false });
    expect(updated.status).toBe(200);
    await c.reload();
    expect(c.enforceLeadQuota).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('createProspect under quota (web capture)', () => {
  it('funded gated route → assigns + charges (leadsRemaining→0, status completed)', async () => {
    const c = await quotaCampaign();
    const { agent, assignment } = await fundedAgent(c.id, 1);

    const res = await postLead(c.id);
    expect(res.status).toBe(201);

    const p = await prospectFromRes(res);
    expect(p.assignedAgentId).toBe(agent.id);
    expect(p.quarantinedAt).toBeNull();

    await assignment.reload();
    expect(assignment.leadsRemaining).toBe(0);
    expect(assignment.status).toBe('completed');
  });

  it('unfunded (no package) → quarantined: no agent, quarantinedAt + reason set', async () => {
    const c = await quotaCampaign();
    const res = await postLead(c.id);
    expect(res.status).toBe(201);

    const p = await prospectFromRes(res);
    expect(p.assignedAgentId).toBeNull();
    expect(p.quarantinedAt).not.toBeNull();
    expect(p.quarantineReason).toBe('no_funded_agent');
  });

  it('exhaustion: 1 credit + 2 leads → first delivered, second held', async () => {
    const c = await quotaCampaign();
    const { agent, assignment } = await fundedAgent(c.id, 1);

    const p1 = await prospectFromRes(await postLead(c.id));
    const p2 = await prospectFromRes(await postLead(c.id));

    expect(p1.assignedAgentId).toBe(agent.id);
    expect(p1.quarantinedAt).toBeNull();
    expect(p2.assignedAgentId).toBeNull();
    expect(p2.quarantinedAt).not.toBeNull();

    await assignment.reload();
    expect(assignment.leadsRemaining).toBe(0);
  });

  it('soft campaign (enforceLeadQuota=false) → assigned, NEVER quarantined (regression)', async () => {
    const c = await createTestCampaign(admin.id, { enforceLeadQuota: false });
    const p = await prospectFromRes(await postLead(c.id));
    expect(p.quarantinedAt).toBeNull();
    expect(p.assignedAgentId).not.toBeNull(); // System-Agent fallback, as before
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('atomic charge under real concurrency', () => {
  it('1 credit + 2 SIMULTANEOUS leads → exactly one delivered, one held (no double-spend)', async () => {
    const c = await quotaCampaign();
    const { agent, assignment } = await fundedAgent(c.id, 1);

    const [r1, r2] = await Promise.all([postLead(c.id), postLead(c.id)]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    const ps = await Promise.all([prospectFromRes(r1), prospectFromRes(r2)]);
    const delivered = ps.filter((p) => p.assignedAgentId === agent.id && p.quarantinedAt === null);
    const held = ps.filter((p) => p.assignedAgentId === null && p.quarantinedAt !== null);

    expect(delivered).toHaveLength(1); // exactly one charged + delivered
    expect(held).toHaveLength(1);      // exactly one held

    await assignment.reload();
    expect(assignment.leadsRemaining).toBe(0); // charged exactly once — the SKIP LOCKED guarantee
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('campaign-scoped charging', () => {
  it('a lead for campaign A does not draw the agent’s campaign B package', async () => {
    const cA = await quotaCampaign();
    const cB = await quotaCampaign();
    const { user: agent } = await createTestUser({ role: 'agent' });
    const pkgA = await createTestLeadPackage(cA.id, admin.id, { leadCount: 1 });
    const pkgB = await createTestLeadPackage(cB.id, admin.id, { leadCount: 1 });
    const asgA = await createTestLeadPackageAssignment(agent.id, pkgA.id, { leadsRemaining: 1, leadsTotal: 1 });
    const asgB = await createTestLeadPackageAssignment(agent.id, pkgB.id, { leadsRemaining: 1, leadsTotal: 1 });

    const p = await prospectFromRes(await postLead(cA.id));
    expect(p.assignedAgentId).toBe(agent.id);

    await asgA.reload();
    await asgB.reload();
    expect(asgA.leadsRemaining).toBe(0); // campaign A charged
    expect(asgB.leadsRemaining).toBe(1); // campaign B untouched
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('held-leads queue endpoint', () => {
  it('GET /api/prospects/held lists the campaign’s held leads with campaignName + reason', async () => {
    const c = await quotaCampaign({ name: `HeldCamp-${++seq}` });
    await postLead(c.id); // unfunded → held

    const res = await request(app)
      .get(`/api/prospects/held?campaignId=${c.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.held[0].campaignId).toBe(c.id);
    expect(res.body.data.held[0].quarantineReason).toBe('no_funded_agent');
    expect(res.body.data.held[0].campaignName).toContain('HeldCamp');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('manual release (PATCH /:id/assign)', () => {
  it('assigning an agent to a HELD lead clears the hold (exempt admin override)', async () => {
    const c = await quotaCampaign();
    const held = await prospectFromRes(await postLead(c.id)); // held
    expect(held.quarantinedAt).not.toBeNull();

    const { user: agent } = await createTestUser({ role: 'agent' });
    const res = await request(app)
      .patch(`/api/prospects/${held.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agent.id });

    expect(res.status).toBe(200);
    await held.reload();
    expect(held.assignedAgentId).toBe(agent.id);
    expect(held.quarantinedAt).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('updateProspect reassign leak (closed)', () => {
  it('PUT /api/prospects/:id cannot reassign via assignedAgentId, but still updates safe fields', async () => {
    const c = await quotaCampaign();
    const { agent } = await fundedAgent(c.id, 1);
    const p = await prospectFromRes(await postLead(c.id)); // delivered to `agent`
    const original = p.assignedAgentId;
    expect(original).toBe(agent.id);

    const { user: other } = await createTestUser({ role: 'agent' });
    const res = await request(app)
      .put(`/api/prospects/${p.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assignedAgentId: other.id, leadStatus: 'contacted' });
    expect(res.status).toBe(200);

    await p.reload();
    expect(p.assignedAgentId).toBe(original);  // reassignment via PUT is ignored
    expect(p.leadStatus).toBe('contacted');    // other safe fields still update
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('auto-release sweep', () => {
  it('drains held leads to a newly-funded agent, credit-bounded (partial top-up)', async () => {
    const c = await quotaCampaign();
    const r1 = await postLead(c.id);
    const r2 = await postLead(c.id);
    const r3 = await postLead(c.id); // 3 held (unfunded)

    const { agent } = await fundedAgent(c.id, 2); // only 2 credits

    const released = await sweepCampaign(c.id);
    expect(released).toBe(2);

    const ps = await Promise.all([r1, r2, r3].map(prospectFromRes));
    expect(ps.filter((p) => p.quarantinedAt === null && p.assignedAgentId === agent.id)).toHaveLength(2);
    expect(ps.filter((p) => p.quarantinedAt !== null)).toHaveLength(1); // 1 stays held (credits exhausted)
  });

  it('releases nothing for a campaign with no funded agent', async () => {
    const c = await quotaCampaign();
    await postLead(c.id); // held
    expect(await sweepCampaign(c.id)).toBe(0);
  });

  it('is a no-op for soft (non-quota) campaigns', async () => {
    const c = await createTestCampaign(admin.id, { enforceLeadQuota: false });
    expect(await sweepCampaign(c.id)).toBe(0);
  });

  it('a credit top-up via PATCH /assignments/:id auto-triggers a release (end-to-end)', async () => {
    const c = await quotaCampaign();
    const r = await postLead(c.id); // held (no funded agent yet)
    const heldId = r.body.data.prospect.id;

    const { user: agent } = await createTestUser({ role: 'agent' });
    const pkg = await createTestLeadPackage(c.id, admin.id, { leadCount: 5 });
    const asg = await createTestLeadPackageAssignment(agent.id, pkg.id, { leadsRemaining: 0, leadsTotal: 5 });

    const up = await request(app)
      .patch(`/api/lead-packages/assignments/${asg.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ leadsRemaining: 3 });
    expect(up.status).toBe(200);

    // The sweep is fire-and-forget; poll briefly (≤3s) for the auto-release.
    let p;
    for (let i = 0; i < 30; i++) {
      p = await Prospect.findByPk(heldId);
      if (p.quarantinedAt === null) break;
      await new Promise((res) => setTimeout(res, 100));
    }
    expect(p.quarantinedAt).toBeNull();
    expect(p.assignedAgentId).toBe(agent.id);
  }, 15000);
});
