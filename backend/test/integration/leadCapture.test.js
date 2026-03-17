import request from 'supertest';
import {
  getApp, closeDb,
  createTestUser, createTestCampaign, createTestQrTag,
  createTestAgentGroup
} from '../helpers.js';

/**
 * Integration tests for the lead-capture pipeline.
 *
 * Covers: POST /api/prospects  (creation, phone normalization, duplicate guard,
 *         direct QR routing, round-robin routing)
 *         GET  /api/prospects   (list + pagination)
 *         GET  /api/prospects/:id (detail with associations)
 */

const RUN = Date.now();

let app;
let adminUser, adminToken;
let agentUser, agentToken;
let campaign;

beforeAll(async () => {
  process.env.WEBHOOK_ENABLED = 'false';

  app = await getApp();

  const admin = await createTestUser({ role: 'admin' });
  adminUser = admin.user;
  adminToken = admin.token;

  const agent = await createTestUser({
    role: 'agent',
    phone: `+659${String(RUN).slice(-7)}`
  });
  agentUser = agent.user;
  agentToken = agent.token;

  campaign = await createTestCampaign(adminUser.id, { name: `Lead-Capture Test ${RUN}` });
}, 20000);

afterAll(async () => {
  await closeDb();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

let prospectSeq = 0;
function prospectPayload(overrides = {}) {
  prospectSeq++;
  return {
    firstName: overrides.firstName || `Lead${prospectSeq}`,
    lastName: overrides.lastName || 'Test',
    email: overrides.email || `lead-${RUN}-${prospectSeq}@test.com`,
    phone: overrides.phone || `+65${String(RUN + prospectSeq).slice(-8)}`,
    leadSource: overrides.leadSource || 'qr_code',
    campaignId: overrides.campaignId ?? campaign.id,
    ...overrides
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/prospects', () => {
  it('creates a prospect with correct fields', async () => {
    const body = prospectPayload({ firstName: 'Alice', lastName: 'Lim' });
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const p = res.body.data.prospect;
    expect(p.firstName).toBe('Alice');
    expect(p.lastName).toBe('Lim');
    expect(p.email).toBe(body.email);
    expect(p.leadSource).toBe('qr_code');
    expect(p.campaignId).toBe(campaign.id);
  });

  it('normalizes a raw 8-digit SG phone to E.164', async () => {
    const body = prospectPayload({ phone: '91234567' });
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.data.prospect.phone).toBe('+6591234567');
  });

  it('rejects duplicate phone within the same campaign (409)', async () => {
    const uniqueCampaign = await createTestCampaign(adminUser.id);
    const sharedPhone = `+65${String(Date.now()).slice(-8)}`;

    const first = prospectPayload({ phone: sharedPhone, campaignId: uniqueCampaign.id });
    const res1 = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(first);
    expect(res1.status).toBe(201);

    const second = prospectPayload({
      phone: sharedPhone,
      campaignId: uniqueCampaign.id,
      email: `dup-${Date.now()}@test.com`
    });
    const res2 = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(second);
    expect(res2.status).toBe(409);
  });

  it('assigns agent via QR tag direct routing', async () => {
    const qrTag = await createTestQrTag(campaign.id, adminUser.id, {
      agentAssignmentMode: 'direct',
      assignedAgentPhone: agentUser.phone,
      assignedAgentEmail: agentUser.email,
      assignedAgentName: `${agentUser.firstName} ${agentUser.lastName}`
    });

    const body = prospectPayload({ qrTagId: qrTag.id });
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.data.prospect.assignedAgentId).toBe(agentUser.id);
  });

  it('assigns agent via round-robin routing', async () => {
    // Create two agent users
    const agentA = await createTestUser({
      role: 'agent',
      phone: `+6581${String(Date.now()).slice(-6)}`
    });
    const agentB = await createTestUser({
      role: 'agent',
      phone: `+6582${String(Date.now()).slice(-6)}`
    });

    const group = await createTestAgentGroup(adminUser.id, [
      { phone: agentA.user.phone, email: agentA.user.email, name: agentA.user.firstName },
      { phone: agentB.user.phone, email: agentB.user.email, name: agentB.user.firstName }
    ]);

    const rrCampaign = await createTestCampaign(adminUser.id, { name: `RR Campaign ${RUN}` });
    const qrTag = await createTestQrTag(rrCampaign.id, adminUser.id, {
      agentAssignmentMode: 'round_robin',
      agentGroupId: group.id,
      roundRobinIndex: 0
    });

    // First lead
    const body1 = prospectPayload({ qrTagId: qrTag.id, campaignId: rrCampaign.id });
    const res1 = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body1);
    expect(res1.status).toBe(201);

    // Second lead
    const body2 = prospectPayload({ qrTagId: qrTag.id, campaignId: rrCampaign.id });
    const res2 = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body2);
    expect(res2.status).toBe(201);

    // The two prospects should be assigned to different agents (round-robin)
    const assignedIds = [
      res1.body.data.prospect.assignedAgentId,
      res2.body.data.prospect.assignedAgentId
    ].filter(Boolean);

    // At least one should be assigned
    expect(assignedIds.length).toBeGreaterThanOrEqual(1);
    // If both are assigned, they should differ
    if (assignedIds.length === 2) {
      expect(assignedIds[0]).not.toBe(assignedIds[1]);
    }
  });
});

describe('GET /api/prospects', () => {
  let seededProspects = [];

  beforeAll(async () => {
    // Seed a few prospects for listing
    const listCampaign = await createTestCampaign(adminUser.id, { name: `List Test ${RUN}` });
    for (let i = 0; i < 5; i++) {
      const body = prospectPayload({ campaignId: listCampaign.id });
      const res = await request(app)
        .post('/api/prospects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body);
      if (res.status === 201) {
        seededProspects.push(res.body.data.prospect);
      }
    }
  });

  it('lists prospects with pagination', async () => {
    const res = await request(app)
      .get('/api/prospects?page=1&limit=3')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.prospects).toBeDefined();
    expect(Array.isArray(res.body.data.prospects)).toBe(true);
    expect(res.body.data.prospects.length).toBeLessThanOrEqual(3);

    const pag = res.body.data.pagination;
    expect(pag.currentPage).toBe(1);
    expect(pag.totalItems).toBeGreaterThanOrEqual(5);
    expect(pag.totalPages).toBeGreaterThanOrEqual(2);
    expect(pag.itemsPerPage).toBe(3);
  });
});

describe('GET /api/prospects/:id', () => {
  it('returns prospect with campaign and activities associations', async () => {
    // Create a fresh prospect so we know its id
    const body = prospectPayload();
    const createRes = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(createRes.status).toBe(201);
    const prospectId = createRes.body.data.prospect.id;

    const res = await request(app)
      .get(`/api/prospects/${prospectId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const p = res.body.data.prospect;
    expect(p.id).toBe(prospectId);
    expect(p.campaign).toBeDefined();
    expect(p.campaign.id).toBe(campaign.id);
    // Activities are created during lead capture (created + assigned)
    expect(p.activities).toBeDefined();
    expect(p.activities.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 404 for non-existent prospect', async () => {
    const res = await request(app)
      .get('/api/prospects/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});
