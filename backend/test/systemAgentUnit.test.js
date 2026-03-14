import './setup.js';
import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign, createTestQrTag, createTestLeadPackage, createTestLeadPackageAssignment } from './helpers.js';
import { User } from '../src/models/index.js';

let app, adminUser, adminToken;

beforeAll(async () => {
  app = await getApp();
  const admin = await createTestUser({ role: 'admin' });
  adminUser = admin.user;
  adminToken = admin.token;
}, 15000);

afterAll(async () => {
  await closeDb();
});

describe('System agent initialization', () => {
  it('system agent exists after app initialization', async () => {
    const systemEmail = process.env.SYSTEM_AGENT_EMAIL || 'system@mktr.local';
    const systemAgent = await User.findOne({ where: { email: systemEmail } });

    expect(systemAgent).not.toBeNull();
    expect(systemAgent.role).toBe('agent');
    expect(systemAgent.isActive).toBe(true);
  });
});

describe('Agent self-assignment', () => {
  let campaign, agentUser, agentToken;

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id);
    const agent = await createTestUser({ role: 'agent' });
    agentUser = agent.user;
    agentToken = agent.token;
  });

  it('assigns prospect to the requesting agent when agent creates a prospect', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        firstName: 'SelfAssign',
        lastName: 'Test',
        email: `selfassign-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'qr_code',
        campaignId: campaign.id
      });

    expect(res.status).toBe(201);
    expect(res.body.data.prospect.assignedAgentId).toBe(agentUser.id);
  });
});

describe('QR owner fallback assignment', () => {
  let campaign, ownerAgent;

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id);
    const agent = await createTestUser({ role: 'agent' });
    ownerAgent = agent.user;
  });

  it('assigns prospect to QR tag owner when no agent is specified', async () => {
    const qrTag = await createTestQrTag(campaign.id, ownerAgent.id);

    // Admin creates prospect with qrTagId but no explicit assignedAgentId
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'QrOwner',
        lastName: 'Fallback',
        email: `qrowner-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'qr_code',
        campaignId: campaign.id,
        qrTagId: qrTag.id
      });

    expect(res.status).toBe(201);
    expect(res.body.data.prospect.assignedAgentId).toBe(ownerAgent.id);
  });
});

describe('System agent fallback', () => {
  it('assigns prospect to system agent when no QR and no agent specified', async () => {
    const campaign = await createTestCampaign(adminUser.id);

    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'SystemFallback',
        lastName: 'Test',
        email: `sysfallback-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'website',
        campaignId: campaign.id
      });

    expect(res.status).toBe(201);

    // Should be assigned to system agent
    const systemEmail = process.env.SYSTEM_AGENT_EMAIL || 'system@mktr.local';
    const systemAgent = await User.findOne({ where: { email: systemEmail } });
    expect(res.body.data.prospect.assignedAgentId).toBe(systemAgent.id);
  });
});

describe('Admin explicit agent assignment', () => {
  let campaign, targetAgent;

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id);
    const agent = await createTestUser({ role: 'agent' });
    targetAgent = agent.user;
  });

  it('assigns prospect to admin-specified agent when assignedAgentId is provided', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'AdminAssign',
        lastName: 'Test',
        email: `adminassign-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'referral',
        campaignId: campaign.id,
        assignedAgentId: targetAgent.id
      });

    expect(res.status).toBe(201);
    expect(res.body.data.prospect.assignedAgentId).toBe(targetAgent.id);
  });

  it('ignores invalid assignedAgentId and falls back', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'InvalidAssign',
        lastName: 'Test',
        email: `invalidassign-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'website',
        campaignId: campaign.id,
        assignedAgentId: '00000000-0000-0000-0000-000000000000'
      });

    expect(res.status).toBe(201);
    // Should fall through to system agent since there's no QR and no valid agent
    expect(res.body.data.prospect.assignedAgentId).toBeDefined();
    expect(res.body.data.prospect.assignedAgentId).not.toBe('00000000-0000-0000-0000-000000000000');
  });
});

describe('Lead package round-robin assignment', () => {
  let campaign, agentA, agentB;

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id);

    const a = await createTestUser({ role: 'agent' });
    agentA = a.user;
    const b = await createTestUser({ role: 'agent' });
    agentB = b.user;

    // Create a lead package for the campaign and assign both agents
    const pkg = await createTestLeadPackage(campaign.id, adminUser.id);
    await createTestLeadPackageAssignment(agentA.id, pkg.id);
    await createTestLeadPackageAssignment(agentB.id, pkg.id);
  });

  it('assigns prospects to agents with active lead package assignments', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'PkgRR',
        lastName: 'Test',
        email: `pkgrr-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'website',
        campaignId: campaign.id
      });

    expect(res.status).toBe(201);
    // Should be assigned to one of the two agents with lead packages
    expect([agentA.id, agentB.id]).toContain(res.body.data.prospect.assignedAgentId);
  });

  it('rotates assignment between agents on subsequent prospects', async () => {
    const firstRes = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'PkgRR2',
        lastName: 'Test',
        email: `pkgrr2-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'website',
        campaignId: campaign.id
      });

    const secondRes = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'PkgRR3',
        lastName: 'Test',
        email: `pkgrr3-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'website',
        campaignId: campaign.id
      });

    expect(firstRes.status).toBe(201);
    expect(secondRes.status).toBe(201);

    const firstAgent = firstRes.body.data.prospect.assignedAgentId;
    const secondAgent = secondRes.body.data.prospect.assignedAgentId;

    // Both should be valid agents from the pool
    expect([agentA.id, agentB.id]).toContain(firstAgent);
    expect([agentA.id, agentB.id]).toContain(secondAgent);

    // With two agents, round-robin should alternate
    expect(firstAgent).not.toBe(secondAgent);
  });
});
