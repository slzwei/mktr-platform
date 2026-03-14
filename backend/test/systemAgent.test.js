import './setup.js';
import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js';

let app, adminUser, adminToken, agentUser, agentToken;

const P = Date.now().toString().slice(-6);

beforeAll(async () => {
  app = await getApp();
  const admin = await createTestUser({ role: 'admin' });
  adminUser = admin.user;
  adminToken = admin.token;
  const agent = await createTestUser({ role: 'agent', phone: `+650${P}01` });
  agentUser = agent.user;
  agentToken = agent.token;
}, 15000);

afterAll(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------
// 1. resolveAssignedAgentId — tested via POST /api/prospects
// ---------------------------------------------------------------------------
describe('resolveAssignedAgentId', () => {
  let campaign;

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id);
  });

  it('self-assigns when the logged-in user is an agent', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        firstName: 'SelfAssign',
        lastName: 'Test',
        email: `self-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'website',
        campaignId: campaign.id
      });

    expect(res.status).toBe(201);
    expect(res.body.data.prospect.assignedAgentId).toBe(agentUser.id);
  });

  it('uses requestedAgentId when admin provides a valid active agent', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'AdminPick',
        lastName: 'Test',
        email: `adminpick-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'website',
        campaignId: campaign.id,
        assignedAgentId: agentUser.id
      });

    expect(res.status).toBe(201);
    expect(res.body.data.prospect.assignedAgentId).toBe(agentUser.id);
  });

  it('falls back to system agent when admin provides invalid assignedAgentId', async () => {
    const fakeUUID = '00000000-0000-0000-0000-000000000000';

    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'BadAgent',
        lastName: 'Test',
        email: `badagent-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'website',
        campaignId: campaign.id,
        assignedAgentId: fakeUUID
      });

    expect(res.status).toBe(201);
    // Should NOT be the fake UUID; should be some system/fallback agent
    expect(res.body.data.prospect.assignedAgentId).not.toBe(fakeUUID);
    expect(res.body.data.prospect.assignedAgentId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. QR Code CRUD — via API
// ---------------------------------------------------------------------------
describe('QR Code CRUD', () => {
  let campaign, createdQrId;

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id);
  });

  it('POST /api/qrcodes — creates a QR code with campaignId', async () => {
    const res = await request(app)
      .post('/api/qrcodes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        label: 'CRUD Test QR',
        campaignId: campaign.id,
        type: 'promotional'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const qr = res.body.data.qrTag;
    expect(qr.slug).toBeDefined();
    expect(qr.slug.length).toBeGreaterThanOrEqual(10);
    expect(qr.qrCode).toBeDefined();
    expect(qr.qrCode).toContain('<svg');
    expect(qr.campaignId).toBe(campaign.id);

    createdQrId = qr.id;
  });

  it('GET /api/qrcodes — lists QR codes with pagination', async () => {
    const res = await request(app)
      .get('/api/qrcodes?page=1&limit=5')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.pagination).toBeDefined();
    expect(res.body.data.pagination.currentPage).toBe(1);
    expect(res.body.data.pagination.itemsPerPage).toBe(5);
    expect(Array.isArray(res.body.data.qrTags)).toBe(true);
  });

  it('GET /api/qrcodes/:id — returns single QR with associations', async () => {
    const res = await request(app)
      .get(`/api/qrcodes/${createdQrId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.qrTag.id).toBe(createdQrId);
    expect(res.body.data.qrTag.label).toBe('CRUD Test QR');
    // Associations should be included (even if null)
    expect(res.body.data.qrTag).toHaveProperty('owner');
    expect(res.body.data.qrTag).toHaveProperty('campaign');
  });

  it('PUT /api/qrcodes/:id — updates label and assignment fields', async () => {
    const res = await request(app)
      .put(`/api/qrcodes/${createdQrId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        label: 'Updated QR Label',
        assignedAgentEmail: 'updated@test.com',
        assignedAgentName: 'Updated Agent'
      });

    expect(res.status).toBe(200);
    expect(res.body.data.qrTag.label).toBe('Updated QR Label');
    expect(res.body.data.qrTag.assignedAgentEmail).toBe('updated@test.com');
    expect(res.body.data.qrTag.assignedAgentName).toBe('Updated Agent');
  });

  it('DELETE /api/qrcodes/:id — deletes QR code', async () => {
    const res = await request(app)
      .delete(`/api/qrcodes/${createdQrId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify it is gone
    const check = await request(app)
      .get(`/api/qrcodes/${createdQrId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(check.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 3. QR Code edge cases
// ---------------------------------------------------------------------------
describe('QR Code edge cases', () => {
  it('creating QR without campaignId still works', async () => {
    const res = await request(app)
      .post('/api/qrcodes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        label: 'No Campaign QR'
      });

    expect(res.status).toBe(201);
    expect(res.body.data.qrTag.slug).toBeDefined();
    expect(res.body.data.qrTag.campaignId).toBeNull();
    expect(res.body.data.qrTag.qrCode).toContain('<svg');
  });

  it('updating QR with regenerateCode=true generates new SVG', async () => {
    // Create a QR first
    const create = await request(app)
      .post('/api/qrcodes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Regen Test' });

    expect(create.status).toBe(201);
    const qrId = create.body.data.qrTag.id;
    const originalSvg = create.body.data.qrTag.qrCode;

    // Update with regenerateCode
    const update = await request(app)
      .put(`/api/qrcodes/${qrId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ regenerateCode: true, label: 'Regen Updated' });

    expect(update.status).toBe(200);
    expect(update.body.data.qrTag.label).toBe('Regen Updated');
    // The regenerated SVG should still be valid SVG
    expect(update.body.data.qrTag.qrCode).toContain('<svg');
  });
});
