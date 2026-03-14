import './setup.js';
import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign, createTestQrTag, createTestAgentGroup } from './helpers.js';
import { QrTag } from '../src/models/index.js';

let app, adminUser, adminToken;

// Unique phone prefix per test run to avoid stale SQLite collisions
const P = Date.now().toString().slice(-6);

beforeAll(async () => {
  app = await getApp();
  const admin = await createTestUser({ role: 'admin' });
  adminUser = admin.user;
  adminToken = admin.token;
}, 15000);

afterAll(async () => {
  await closeDb();
});

describe('QR Direct Assignment', () => {
  let campaign, agentA, agentB;

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id);
    const a = await createTestUser({ role: 'agent', phone: `+651${P}01` });
    agentA = a.user;
    const b = await createTestUser({ role: 'agent', phone: `+651${P}02` });
    agentB = b.user;
  });

  it('assigns lead to Agent A when scanning Agent A QR', async () => {
    const qr = await createTestQrTag(campaign.id, adminUser.id, {
      agentAssignmentMode: 'direct',
      assignedAgentPhone: agentA.phone,
      assignedAgentEmail: agentA.email,
      assignedAgentName: agentA.firstName
    });

    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'DirectA',
        lastName: 'Test',
        email: `direct-a-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'qr_code',
        campaignId: campaign.id,
        qrTagId: qr.id
      });

    expect(res.status).toBe(201);
    expect(res.body.data.prospect.assignedAgentId).toBe(agentA.id);
  });

  it('assigns lead to Agent B when scanning Agent B QR (same campaign)', async () => {
    const qr = await createTestQrTag(campaign.id, adminUser.id, {
      agentAssignmentMode: 'direct',
      assignedAgentPhone: agentB.phone,
      assignedAgentEmail: agentB.email,
      assignedAgentName: agentB.firstName
    });

    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'DirectB',
        lastName: 'Test',
        email: `direct-b-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'qr_code',
        campaignId: campaign.id,
        qrTagId: qr.id
      });

    expect(res.status).toBe(201);
    expect(res.body.data.prospect.assignedAgentId).toBe(agentB.id);
  });

  it('falls back when QR phone does not match any user', async () => {
    const qr = await createTestQrTag(campaign.id, adminUser.id, {
      agentAssignmentMode: 'direct',
      assignedAgentPhone: `+659${P}99`,
      assignedAgentEmail: 'nobody@test.com',
      assignedAgentName: 'Ghost Agent'
    });

    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Fallback',
        lastName: 'Test',
        email: `fallback-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'qr_code',
        campaignId: campaign.id,
        qrTagId: qr.id
      });

    expect(res.status).toBe(201);
    expect(res.body.data.prospect.assignedAgentId).not.toBe(agentA.id);
    expect(res.body.data.prospect.assignedAgentId).not.toBe(agentB.id);
    expect(res.body.data.prospect.assignedAgentId).toBeDefined();
  });
});

// Round-robin uses sequelize.literal + returning:true which only works on Postgres
const isSqlite = !process.env.DB_HOST;
const describeRR = isSqlite ? describe.skip : describe;

describeRR('QR Round Robin Assignment', () => {
  let campaign, agentB, agentC, group, qr;

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id);
    const b = await createTestUser({ role: 'agent', phone: `+652${P}01` });
    agentB = b.user;
    const c = await createTestUser({ role: 'agent', phone: `+652${P}02` });
    agentC = c.user;

    group = await createTestAgentGroup(adminUser.id, [
      { phone: agentB.phone, email: agentB.email, name: agentB.firstName },
      { phone: agentC.phone, email: agentC.email, name: agentC.firstName }
    ]);

    qr = await createTestQrTag(campaign.id, adminUser.id, {
      agentAssignmentMode: 'round_robin',
      agentGroupId: group.id,
      agentGroupAgentIds: [agentB.phone, agentC.phone]
    });
  });

  it('assigns first lead to an agent in the group', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'RR1',
        lastName: 'Test',
        email: `rr1-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'qr_code',
        campaignId: campaign.id,
        qrTagId: qr.id
      });

    expect(res.status).toBe(201);
    expect([agentB.id, agentC.id]).toContain(res.body.data.prospect.assignedAgentId);
  });

  it('rotates to the other agent on next lead', async () => {
    const freshQr = await QrTag.findByPk(qr.id);
    const idx = freshQr.roundRobinIndex % 2;
    const expectedAgent = idx === 0 ? agentB : agentC;

    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'RR2',
        lastName: 'Test',
        email: `rr2-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'qr_code',
        campaignId: campaign.id,
        qrTagId: qr.id
      });

    expect(res.status).toBe(201);
    expect(res.body.data.prospect.assignedAgentId).toBe(expectedAgent.id);
  });

  it('wraps around on third lead', async () => {
    const freshQr = await QrTag.findByPk(qr.id);
    const idx = freshQr.roundRobinIndex % 2;
    const expectedAgent = idx === 0 ? agentB : agentC;

    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'RR3',
        lastName: 'Test',
        email: `rr3-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'qr_code',
        campaignId: campaign.id,
        qrTagId: qr.id
      });

    expect(res.status).toBe(201);
    expect(res.body.data.prospect.assignedAgentId).toBe(expectedAgent.id);
  });
});

describe('QR routing does not interfere with non-QR leads', () => {
  it('assigns lead without qrTagId via normal fallback', async () => {
    const campaign = await createTestCampaign(adminUser.id);

    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'NoQR',
        lastName: 'Test',
        email: `noqr-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'website',
        campaignId: campaign.id
      });

    expect(res.status).toBe(201);
    expect(res.body.data.prospect.assignedAgentId).toBeDefined();
  });
});

describeRR('Mixed QR modes on same campaign', () => {
  it('direct and round-robin QRs coexist correctly', async () => {
    const campaign = await createTestCampaign(adminUser.id);
    const a = await createTestUser({ role: 'agent', phone: `+653${P}01` });
    const b = await createTestUser({ role: 'agent', phone: `+653${P}02` });
    const c = await createTestUser({ role: 'agent', phone: `+653${P}03` });

    // Direct QR -> Agent A
    const directQr = await createTestQrTag(campaign.id, adminUser.id, {
      agentAssignmentMode: 'direct',
      assignedAgentPhone: a.user.phone,
      assignedAgentEmail: a.user.email,
      assignedAgentName: a.user.firstName
    });

    // Round-robin QR -> B + C
    const group = await createTestAgentGroup(adminUser.id, [
      { phone: b.user.phone, email: b.user.email, name: b.user.firstName },
      { phone: c.user.phone, email: c.user.email, name: c.user.firstName }
    ]);
    const rrQr = await createTestQrTag(campaign.id, adminUser.id, {
      agentAssignmentMode: 'round_robin',
      agentGroupId: group.id,
      agentGroupAgentIds: [b.user.phone, c.user.phone]
    });

    // Lead via direct QR
    const res1 = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'MixDirect',
        lastName: 'Test',
        email: `mix-d-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'qr_code',
        campaignId: campaign.id,
        qrTagId: directQr.id
      });

    expect(res1.status).toBe(201);
    expect(res1.body.data.prospect.assignedAgentId).toBe(a.user.id);

    // Lead via round-robin QR
    const res2 = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'MixRR',
        lastName: 'Test',
        email: `mix-rr-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'qr_code',
        campaignId: campaign.id,
        qrTagId: rrQr.id
      });

    expect(res2.status).toBe(201);
    expect([b.user.id, c.user.id]).toContain(res2.body.data.prospect.assignedAgentId);
  });
});
