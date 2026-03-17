import request from 'supertest';
import {
  getApp, closeDb,
  createTestUser, createTestCampaign, createTestProspect
} from '../helpers.js';
import { ProspectActivity } from '../../src/models/index.js';

/**
 * Integration tests for the prospect-to-agent assignment pipeline.
 *
 * Covers: PATCH /api/prospects/:id/assign  (assign, unassign, audit trail,
 *         inactive-agent guard)
 */

const RUN = Date.now();

let app;
let adminUser, adminToken;
let activeAgent;
let inactiveAgent;
let campaign;

beforeAll(async () => {
  process.env.WEBHOOK_ENABLED = 'false';

  app = await getApp();

  const admin = await createTestUser({ role: 'admin' });
  adminUser = admin.user;
  adminToken = admin.token;

  const agentResult = await createTestUser({
    role: 'agent',
    firstName: 'Active',
    lastName: 'Agent',
    phone: `+6590${String(RUN).slice(-6)}`
  });
  activeAgent = agentResult.user;

  const inactiveResult = await createTestUser({
    role: 'agent',
    firstName: 'Inactive',
    lastName: 'Agent',
    isActive: false
  });
  inactiveAgent = inactiveResult.user;

  campaign = await createTestCampaign(adminUser.id, { name: `Assignment Test ${RUN}` });
}, 20000);

afterAll(async () => {
  await closeDb();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PATCH /api/prospects/:id/assign', () => {
  it('assigns an active agent to a prospect', async () => {
    const prospect = await createTestProspect(campaign.id);

    const res = await request(app)
      .patch(`/api/prospects/${prospect.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: activeAgent.id });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.prospect.assignedAgentId).toBe(activeAgent.id);
  });

  it('unassigns an agent when agentId is null', async () => {
    const prospect = await createTestProspect(campaign.id, {
      assignedAgentId: activeAgent.id
    });

    const res = await request(app)
      .patch(`/api/prospects/${prospect.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: null });

    expect(res.status).toBe(200);
    expect(res.body.data.prospect.assignedAgentId).toBeNull();
  });

  it('creates ProspectActivity records for assignment', async () => {
    const prospect = await createTestProspect(campaign.id);

    await request(app)
      .patch(`/api/prospects/${prospect.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: activeAgent.id });

    const activities = await ProspectActivity.findAll({
      where: { prospectId: prospect.id, type: 'assigned' },
      order: [['createdAt', 'DESC']]
    });

    expect(activities.length).toBeGreaterThanOrEqual(1);
    const latest = activities[0];
    expect(latest.metadata.assignedAgentId).toBe(activeAgent.id);
    expect(latest.description).toContain(activeAgent.firstName);
  });

  it('creates ProspectActivity record for unassignment', async () => {
    const prospect = await createTestProspect(campaign.id, {
      assignedAgentId: activeAgent.id
    });

    await request(app)
      .patch(`/api/prospects/${prospect.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: null });

    const activities = await ProspectActivity.findAll({
      where: { prospectId: prospect.id, type: 'assigned' },
      order: [['createdAt', 'DESC']]
    });

    const unassignActivity = activities.find(a =>
      a.description.toLowerCase().includes('unassign')
    );
    expect(unassignActivity).toBeDefined();
    expect(unassignActivity.metadata.previousAgentId).toBe(activeAgent.id);
  });

  it('rejects assignment to an inactive agent (400)', async () => {
    const prospect = await createTestProspect(campaign.id);

    const res = await request(app)
      .patch(`/api/prospects/${prospect.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: inactiveAgent.id });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/invalid|inactive/i);
  });

  it('rejects assignment to a non-existent agent (400)', async () => {
    const prospect = await createTestProspect(campaign.id);

    const res = await request(app)
      .patch(`/api/prospects/${prospect.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: '00000000-0000-0000-0000-000000000000' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 404 when prospect does not exist', async () => {
    const res = await request(app)
      .patch('/api/prospects/00000000-0000-0000-0000-000000000000/assign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: activeAgent.id });

    expect(res.status).toBe(404);
  });
});
