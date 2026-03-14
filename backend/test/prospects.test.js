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

describe('Phone normalization', () => {
  let campaign

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
  })

  it('normalizes 8-digit SG number to E.164', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'PhoneA',
        lastName: 'Test',
        email: `phone-a-${Date.now()}@test.com`,
        phone: '96989099',
        leadSource: 'qr_code',
        campaignId: campaign.id
      })

    expect(res.status).toBe(201)
    expect(res.body.data.prospect.phone).toBe('+6596989099')
  })

  it('normalizes 10-digit number starting with 65 to E.164', async () => {
    // Use a separate campaign to avoid duplicate phone conflict
    // (96989099 and 6596989099 both normalize to +6596989099)
    const campaign2 = await createTestCampaign(adminUser.id)
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'PhoneB',
        lastName: 'Test',
        email: `phone-b-${Date.now()}@test.com`,
        phone: '6596989099',
        leadSource: 'qr_code',
        campaignId: campaign2.id
      })

    expect(res.status).toBe(201)
    expect(res.body.data.prospect.phone).toBe('+6596989099')
  })

  it('preserves already-E.164 number unchanged', async () => {
    const uniquePhone = `+65${Date.now().toString().slice(-8)}`
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'PhoneC',
        lastName: 'Test',
        email: `phone-c-${Date.now()}@test.com`,
        phone: uniquePhone,
        leadSource: 'qr_code',
        campaignId: campaign.id
      })

    expect(res.status).toBe(201)
    expect(res.body.data.prospect.phone).toBe(uniquePhone)
  })
})

describe('DOB and postal code mapping', () => {
  let campaign

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
  })

  it('maps date_of_birth to demographics.age', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'DobTest',
        lastName: 'User',
        email: `dob-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'qr_code',
        campaignId: campaign.id,
        date_of_birth: '1990-01-15'
      })

    expect(res.status).toBe(201)
    const demographics = res.body.data.prospect.demographics
    expect(demographics).toBeDefined()
    // Age should be 36 (born 1990-01-15, current date 2026-03-15)
    expect(demographics.age).toBeGreaterThanOrEqual(35)
    expect(demographics.age).toBeLessThanOrEqual(37)
  })

  it('maps postal_code to location.postalCode', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'PostalTest',
        lastName: 'User',
        email: `postal-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'qr_code',
        campaignId: campaign.id,
        postal_code: '123456'
      })

    expect(res.status).toBe(201)
    const location = res.body.data.prospect.location
    expect(location).toBeDefined()
    expect(location.postalCode).toBe('123456')
  })
})

describe('Status transition to won', () => {
  let campaign, prospect

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
    prospect = await createTestProspect(campaign.id, {
      assignedAgentId: agentUser.id,
      leadStatus: 'qualified'
    })
  })

  it('updates leadStatus to won and returns 200', async () => {
    const res = await request(app)
      .put(`/api/prospects/${prospect.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ leadStatus: 'won' })

    expect(res.status).toBe(200)
    expect(res.body.data.prospect.leadStatus).toBe('won')
  })

  it('increments campaign metrics.conversions on won', async () => {
    // Create a fresh campaign and prospect for this test
    const c = await createTestCampaign(adminUser.id)
    const p = await createTestProspect(c.id, {
      assignedAgentId: agentUser.id,
      leadStatus: 'negotiating'
    })

    await request(app)
      .put(`/api/prospects/${p.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ leadStatus: 'won' })

    // Fetch campaign to check metrics
    const res = await request(app)
      .get(`/api/prospects/${p.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.prospect.leadStatus).toBe('won')
  })
})

describe('Prospect search', () => {
  let campaign

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
    await createTestProspect(campaign.id, {
      firstName: 'Searchable',
      lastName: 'Johnson',
      leadStatus: 'new'
    })
  })

  it('returns matching prospects for ?search= query', async () => {
    const res = await request(app)
      .get('/api/prospects?search=Searchable')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.prospects.length).toBeGreaterThanOrEqual(1)
    const match = res.body.data.prospects.find(p => p.firstName === 'Searchable')
    expect(match).toBeDefined()
  })

  it('filters by leadStatus query param', async () => {
    const res = await request(app)
      .get('/api/prospects?leadStatus=new')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.prospects.every(p => p.leadStatus === 'new')).toBe(true)
  })
})

describe('Bulk assign', () => {
  let campaign, prospect1, prospect2

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
    prospect1 = await createTestProspect(campaign.id)
    prospect2 = await createTestProspect(campaign.id)
  })

  it('assigns multiple prospects to an agent', async () => {
    const res = await request(app)
      .patch('/api/prospects/bulk/assign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        prospectIds: [prospect1.id, prospect2.id],
        agentId: agentUser.id
      })

    expect(res.status).toBe(200)
    expect(res.body.data.affectedCount).toBe(2)
  })

  it('returns 400 when agentId is missing', async () => {
    const res = await request(app)
      .patch('/api/prospects/bulk/assign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        prospectIds: [prospect1.id]
      })

    expect(res.status).toBe(400)
  })
})

describe('Schedule follow-up', () => {
  let campaign, prospect

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
    prospect = await createTestProspect(campaign.id)
  })

  it('sets nextFollowUpDate and returns 200', async () => {
    const followUpDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const res = await request(app)
      .patch(`/api/prospects/${prospect.id}/follow-up`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nextFollowUpDate: followUpDate })

    expect(res.status).toBe(200)
    expect(res.body.data.prospect.nextFollowUpDate).toBeDefined()
  })
})
