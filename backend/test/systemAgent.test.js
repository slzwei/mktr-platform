import './setup.js';
import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign, createTestFleetOwner, createTestCar, createTestProspect } from './helpers.js';

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

// ---------------------------------------------------------------------------
// 4. QR Code — car type idempotent create/update (lines 120-138)
// ---------------------------------------------------------------------------
describe('QR Code car type idempotent create', () => {
  let campaign, fleetOwner, car;

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id);
    fleetOwner = await createTestFleetOwner();
    car = await createTestCar(fleetOwner.id);
  });

  it('creates a QR with type=car and carId', async () => {
    const res = await request(app)
      .post('/api/qrcodes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        label: 'Car QR First',
        type: 'car',
        carId: car.id,
        campaignId: campaign.id
      });

    expect(res.status).toBe(201);
    expect(res.body.data.qrTag.type).toBe('car');
    expect(res.body.data.qrTag.carId).toBe(car.id);
  });

  it('creating same car QR again returns existing (idempotent update)', async () => {
    const res = await request(app)
      .post('/api/qrcodes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        label: 'Car QR Second',
        type: 'car',
        carId: car.id,
        campaignId: campaign.id
      });

    // Should return 200 (updated) not 201 (created)
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('updated');
    expect(res.body.data.qrTag.carId).toBe(car.id);
  });
});

// ---------------------------------------------------------------------------
// 5. QR Code list filters (lines 65-74, 70 search iLike)
// ---------------------------------------------------------------------------
describe('QR Code list filters', () => {
  let campaign, promoQrId;

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id);
    // Create a promotional QR for filtering tests
    const res = await request(app)
      .post('/api/qrcodes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        label: 'FilterPromoQR',
        type: 'promotional',
        campaignId: campaign.id
      });
    promoQrId = res.body.data.qrTag.id;
  });

  it('GET /api/qrcodes?search= — search endpoint responds', async () => {
    const res = await request(app)
      .get('/api/qrcodes?search=FilterPromo')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.qrTags)).toBe(true);
  });

  it('GET /api/qrcodes?type=promotional — filters by type', async () => {
    const res = await request(app)
      .get('/api/qrcodes?type=promotional')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const qrTags = res.body.data.qrTags;
    expect(Array.isArray(qrTags)).toBe(true);
    // All returned tags should be promotional type
    for (const qr of qrTags) {
      expect(qr.type).toBe('promotional');
    }
  });

  it('GET /api/qrcodes?campaignId= — filters by campaignId', async () => {
    const res = await request(app)
      .get(`/api/qrcodes?campaignId=${campaign.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const qrTags = res.body.data.qrTags;
    expect(Array.isArray(qrTags)).toBe(true);
    expect(qrTags.length).toBeGreaterThanOrEqual(1);
    for (const qr of qrTags) {
      expect(qr.campaignId).toBe(campaign.id);
    }
  });

  it('GET /api/qrcodes?status=active — filters by active status', async () => {
    const res = await request(app)
      .get('/api/qrcodes?status=active')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const qrTags = res.body.data.qrTags;
    expect(Array.isArray(qrTags)).toBe(true);
    // All returned should have active=true
    for (const qr of qrTags) {
      expect(qr.active).toBe(true);
    }
  });

  it('GET /api/qrcodes?page=1&limit=2 — pagination params work', async () => {
    const res = await request(app)
      .get('/api/qrcodes?page=1&limit=2')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.pagination.currentPage).toBe(1);
    expect(res.body.data.pagination.itemsPerPage).toBe(2);
    expect(res.body.data.qrTags.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 6. QR Code analytics (lines 264-292)
// ---------------------------------------------------------------------------
describe('QR Code analytics', () => {
  let qrId;

  beforeAll(async () => {
    const campaign = await createTestCampaign(adminUser.id);
    const res = await request(app)
      .post('/api/qrcodes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Analytics QR', campaignId: campaign.id });
    qrId = res.body.data.qrTag.id;
  });

  it('GET /api/qrcodes/:id/analytics — returns summary structure', async () => {
    const res = await request(app)
      .get(`/api/qrcodes/${qrId}/analytics`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.analytics).toBeDefined();
    expect(res.body.data.analytics.summary).toBeDefined();
    expect(typeof res.body.data.analytics.summary.totalScans).toBe('number');
    expect(typeof res.body.data.analytics.summary.landings).toBe('number');
    expect(typeof res.body.data.analytics.summary.leads).toBe('number');
  });

  it('GET /api/qrcodes/:id/analytics — 404 for non-existent QR', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000099';
    const res = await request(app)
      .get(`/api/qrcodes/${fakeId}/analytics`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 7. QR Code image download (lines 294-305)
// ---------------------------------------------------------------------------
describe('QR Code image download', () => {
  let qrId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/qrcodes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Download QR' });
    qrId = res.body.data.qrTag.id;
  });

  it('GET /api/qrcodes/:id/download — returns image with content-disposition', async () => {
    const res = await request(app)
      .get(`/api/qrcodes/${qrId}/download`)
      .set('Authorization', `Bearer ${adminToken}`);

    // Should be 200 with PNG or attachment header
    expect(res.status).toBe(200);
    const disposition = res.headers['content-disposition'];
    expect(disposition).toBeDefined();
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('.png');
  });

  it('GET /api/qrcodes/:id/download — 404 for non-existent QR', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000098';
    const res = await request(app)
      .get(`/api/qrcodes/${fakeId}/download`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 8. QR Code bulk operations (lines 307-348)
// ---------------------------------------------------------------------------
describe('QR Code bulk operations', () => {
  let qrIds = [];

  beforeAll(async () => {
    const campaign = await createTestCampaign(adminUser.id);
    // Create 3 QR codes for bulk ops
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/qrcodes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ label: `Bulk QR ${i}`, campaignId: campaign.id });
      qrIds.push(res.body.data.qrTag.id);
    }
  });

  it('POST /api/qrcodes/bulk — activate operation', async () => {
    const res = await request(app)
      .post('/api/qrcodes/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ operation: 'activate', qrTagIds: qrIds });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.affectedCount).toBe(3);
    expect(res.body.message).toContain('activated');
  });

  it('POST /api/qrcodes/bulk — deactivate operation', async () => {
    const res = await request(app)
      .post('/api/qrcodes/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ operation: 'deactivate', qrTagIds: qrIds });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.affectedCount).toBe(3);
    expect(res.body.message).toContain('deactivated');
  });

  it('POST /api/qrcodes/bulk — archive operation', async () => {
    const res = await request(app)
      .post('/api/qrcodes/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ operation: 'archive', qrTagIds: qrIds });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.affectedCount).toBe(3);
    expect(res.body.message).toContain('archived');
  });

  it('POST /api/qrcodes/bulk — invalid operation returns 400', async () => {
    const res = await request(app)
      .post('/api/qrcodes/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ operation: 'nope', qrTagIds: qrIds });

    expect(res.status).toBe(400);
  });

  it('POST /api/qrcodes/bulk — missing qrTagIds returns 400', async () => {
    const res = await request(app)
      .post('/api/qrcodes/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ operation: 'activate' });

    expect(res.status).toBe(400);
  });

  it('POST /api/qrcodes/bulk — non-admin cannot bulk operate', async () => {
    const res = await request(app)
      .post('/api/qrcodes/bulk')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ operation: 'activate', qrTagIds: qrIds });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 9. QR Code delete cascade (lines 237-243)
// ---------------------------------------------------------------------------
describe('QR Code delete cascade — prospects.qrTagId nullified', () => {
  it('deleting QR nullifies prospect.qrTagId', async () => {
    const campaign = await createTestCampaign(adminUser.id);

    // Create a QR code via API
    const qrRes = await request(app)
      .post('/api/qrcodes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Cascade QR', campaignId: campaign.id });
    expect(qrRes.status).toBe(201);
    const qrId = qrRes.body.data.qrTag.id;

    // Create a prospect linked to this QR tag
    const prospect = await createTestProspect(campaign.id, { qrTagId: qrId });
    expect(prospect.qrTagId).toBe(qrId);

    // Delete the QR code
    const delRes = await request(app)
      .delete(`/api/qrcodes/${qrId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delRes.status).toBe(200);

    // Reload prospect and verify qrTagId is nullified
    await prospect.reload();
    expect(prospect.qrTagId).toBeNull();
  });
});
