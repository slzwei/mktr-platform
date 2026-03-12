import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js'

let app, adminUser, adminToken, agentUser, agentToken

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminUser = admin.user; adminToken = admin.token
  const agent = await createTestUser({ role: 'agent' })
  agentUser = agent.user; agentToken = agent.token
}, 15000)

afterAll(async () => {
  await closeDb()
})

describe('Prospect CRUD', () => {
  let campaign, prospectId

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
  })

  it('POST /api/prospects — creates a prospect', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'John',
        lastName: 'Doe',
        email: `prospect-crud-${Date.now()}@test.com`,
        phone: `65${Date.now().toString().slice(-8)}`,
        leadSource: 'qr_code',
        campaignId: campaign.id
      })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.prospect).toBeDefined()
    expect(res.body.data.prospect.firstName).toBe('John')
    prospectId = res.body.data.prospect.id
  })

  it('GET /api/prospects — admin sees all prospects', async () => {
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.prospects).toBeDefined()
    expect(res.body.data.pagination).toBeDefined()
  })

  it('GET /api/prospects/:id — returns prospect with associations', async () => {
    const res = await request(app)
      .get(`/api/prospects/${prospectId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.prospect.id).toBe(prospectId)
    expect(res.body.data.prospect.campaign).toBeDefined()
  })

  it('PUT /api/prospects/:id — updates a prospect', async () => {
    const res = await request(app)
      .put(`/api/prospects/${prospectId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ leadStatus: 'contacted', notes: 'Called back' })

    expect(res.status).toBe(200)
    expect(res.body.data.prospect.leadStatus).toBe('contacted')
  })

  it('DELETE /api/prospects/:id — deletes a prospect', async () => {
    const prospect = await createTestProspect(campaign.id)
    const res = await request(app)
      .delete(`/api/prospects/${prospect.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
  })

  it('GET /api/prospects/:id — returns 404 for non-existent', async () => {
    const res = await request(app)
      .get('/api/prospects/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })
})

describe('Prospect assignment', () => {
  let campaign, prospect

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
    prospect = await createTestProspect(campaign.id)
  })

  it('PATCH /api/prospects/:id/assign — assigns an agent', async () => {
    const res = await request(app)
      .patch(`/api/prospects/${prospect.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agentUser.id })

    expect(res.status).toBe(200)
    expect(res.body.data.prospect.assignedAgentId).toBe(agentUser.id)
  })

  it('PATCH /api/prospects/:id/assign — returns 400 for invalid agent', async () => {
    const res = await request(app)
      .patch(`/api/prospects/${prospect.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: '00000000-0000-0000-0000-000000000000' })

    expect(res.status).toBe(400)
  })
})

describe('Prospect filtering', () => {
  it('supports campaignId filter', async () => {
    const campaign = await createTestCampaign(adminUser.id)
    await createTestProspect(campaign.id)

    const res = await request(app)
      .get(`/api/prospects?campaignId=${campaign.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    if (res.body.data.prospects.length > 0) {
      expect(res.body.data.prospects.every(p => p.campaignId === campaign.id)).toBe(true)
    }
  })

  it('supports pagination', async () => {
    const res = await request(app)
      .get('/api/prospects?page=1&limit=3')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.pagination.currentPage).toBe(1)
    expect(res.body.data.prospects.length).toBeLessThanOrEqual(3)
  })
})

describe('Prospect statistics', () => {
  it('GET /api/prospects/stats/overview — returns stats', async () => {
    const res = await request(app)
      .get('/api/prospects/stats/overview')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.totalProspects).toBeGreaterThanOrEqual(0)
    expect(res.body.data.conversionRate).toBeDefined()
  })
})

describe('Duplicate phone prevention', () => {
  it('rejects duplicate phone within same campaign', async () => {
    const campaign = await createTestCampaign(adminUser.id)
    const phone = `65${Date.now().toString().slice(-8)}`

    // First create should succeed
    const res1 = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'First',
        lastName: 'Prospect',
        email: `dup1-${Date.now()}@test.com`,
        phone,
        leadSource: 'qr_code',
        campaignId: campaign.id
      })
    expect(res1.status).toBe(201)

    // Second create with same phone + campaign should fail
    const res2 = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Second',
        lastName: 'Prospect',
        email: `dup2-${Date.now()}@test.com`,
        phone,
        leadSource: 'qr_code',
        campaignId: campaign.id
      })
    expect(res2.status).toBe(409)
  })
})
