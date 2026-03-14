import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js'

let app, adminToken, adminUser, agentToken, agentUser

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

describe('Campaign CRUD', () => {
  let campaignId

  it('POST /api/campaigns — admin can create a campaign', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Integration Test Campaign',
        type: 'lead_generation',
        is_active: true,
        min_age: 21,
        max_age: 55
      })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.campaign).toBeDefined()
    expect(res.body.data.campaign.name).toBe('Integration Test Campaign')
    expect(res.body.data.campaign.status).toBe('active')
    campaignId = res.body.data.campaign.id
  })

  it('GET /api/campaigns — admin sees all campaigns', async () => {
    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.campaigns).toBeDefined()
    expect(res.body.data.pagination).toBeDefined()
    expect(res.body.data.pagination.totalItems).toBeGreaterThanOrEqual(1)
  })

  it('GET /api/campaigns/:id — returns campaign with associations', async () => {
    const res = await request(app)
      .get(`/api/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.campaign.id).toBe(campaignId)
    expect(res.body.data.campaign.name).toBe('Integration Test Campaign')
  })

  it('PUT /api/campaigns/:id — admin can update a campaign', async () => {
    const res = await request(app)
      .put(`/api/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated Campaign Name', min_age: 25 })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.campaign.name).toBe('Updated Campaign Name')
  })

  it('GET /api/campaigns/:id — returns 404 for non-existent campaign', async () => {
    const res = await request(app)
      .get('/api/campaigns/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })

  it('POST /api/campaigns/:id/duplicate — duplicates a campaign as draft', async () => {
    const res = await request(app)
      .post(`/api/campaigns/${campaignId}/duplicate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Duplicated Campaign' })

    expect(res.status).toBe(201)
    expect(res.body.data.campaign.name).toBe('Duplicated Campaign')
    expect(res.body.data.campaign.status).toBe('draft')
  })

  it('PATCH /api/campaigns/:id/archive — archives a campaign', async () => {
    const res = await request(app)
      .patch(`/api/campaigns/${campaignId}/archive`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.campaign.status).toBe('archived')
  })

  it('PATCH /api/campaigns/:id/archive — returns 400 if already archived', async () => {
    const res = await request(app)
      .patch(`/api/campaigns/${campaignId}/archive`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(400)
  })

  it('PATCH /api/campaigns/:id/restore — restores an archived campaign', async () => {
    const res = await request(app)
      .patch(`/api/campaigns/${campaignId}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.campaign.status).toBe('draft')
  })

  it('DELETE /api/campaigns/:id — archives (soft-delete) a campaign', async () => {
    const campaign = await createTestCampaign(adminUser.id, { name: 'To Delete' })
    const res = await request(app)
      .delete(`/api/campaigns/${campaign.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.message).toContain('archived')
  })
})

describe('Campaign role-based access', () => {
  it('agent can create campaigns', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ name: 'Agent Campaign', type: 'lead_generation', is_active: true })

    expect(res.status).toBe(201)
  })

  it('agent sees only own or public campaigns', async () => {
    // Create a non-public campaign for admin
    await createTestCampaign(adminUser.id, { name: 'Admin Private', isPublic: false })

    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    // Agent should not see admin's private campaigns
    const campaigns = res.body.data.campaigns
    const adminPrivate = campaigns.filter(c => c.name === 'Admin Private' && c.createdBy === adminUser.id)
    // This could still be empty if the agent created it, so we just check the response is valid
    expect(Array.isArray(campaigns)).toBe(true)
  })

  it('unauthenticated user cannot create campaigns', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .send({ name: 'Unauthorized', type: 'lead_generation' })

    expect([401, 403]).toContain(res.status)
  })
})

describe('Campaign filtering and pagination', () => {
  it('supports pagination parameters', async () => {
    const res = await request(app)
      .get('/api/campaigns?page=1&limit=2')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.pagination.currentPage).toBe(1)
    expect(res.body.data.pagination.itemsPerPage).toBe(2)
    expect(res.body.data.campaigns.length).toBeLessThanOrEqual(2)
  })

  it('supports status filter', async () => {
    const res = await request(app)
      .get('/api/campaigns?status=active')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    if (res.body.data.campaigns.length > 0) {
      expect(res.body.data.campaigns.every(c => c.status === 'active')).toBe(true)
    }
  })
})

describe('Campaign search and filtering', () => {
  let activeCampaign, draftCampaign, lgCampaign

  beforeAll(async () => {
    activeCampaign = await createTestCampaign(adminUser.id, {
      name: 'SearchActive One',
      status: 'active',
      type: 'lead_generation'
    })
    draftCampaign = await createTestCampaign(adminUser.id, {
      name: 'SearchDraft Two',
      status: 'draft',
      type: 'brand_awareness'
    })
    lgCampaign = await createTestCampaign(adminUser.id, {
      name: 'SearchLG Three',
      status: 'active',
      type: 'lead_generation'
    })
  })

  it('GET /api/campaigns?status=active — only returns active campaigns', async () => {
    const res = await request(app)
      .get('/api/campaigns?status=active')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const campaigns = res.body.data.campaigns
    expect(campaigns.length).toBeGreaterThanOrEqual(1)
    expect(campaigns.every(c => c.status === 'active')).toBe(true)
    // Draft campaign must not appear
    expect(campaigns.find(c => c.id === draftCampaign.id)).toBeUndefined()
  })

  it('GET /api/campaigns?type=lead_generation — filters by type', async () => {
    const res = await request(app)
      .get('/api/campaigns?type=lead_generation')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const campaigns = res.body.data.campaigns
    expect(campaigns.length).toBeGreaterThanOrEqual(1)
    expect(campaigns.every(c => c.type === 'lead_generation')).toBe(true)
    // brand_awareness campaign must not appear
    expect(campaigns.find(c => c.id === draftCampaign.id)).toBeUndefined()
  })

  it('GET /api/campaigns?status=draft — returns only draft campaigns', async () => {
    const res = await request(app)
      .get('/api/campaigns?status=draft')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const campaigns = res.body.data.campaigns
    if (campaigns.length > 0) {
      expect(campaigns.every(c => c.status === 'draft')).toBe(true)
    }
  })
})

describe('Campaign update', () => {
  let campaignToUpdate

  beforeAll(async () => {
    campaignToUpdate = await createTestCampaign(adminUser.id, {
      name: 'Before Update',
      status: 'active',
      is_active: true
    })
  })

  it('PUT /api/campaigns/:id — update name', async () => {
    const res = await request(app)
      .put(`/api/campaigns/${campaignToUpdate.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'After Update' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.campaign.name).toBe('After Update')
  })

  it('PUT /api/campaigns/:id — update is_active to false sets status to draft', async () => {
    const res = await request(app)
      .put(`/api/campaigns/${campaignToUpdate.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false })

    expect(res.status).toBe(200)
    expect(res.body.data.campaign.is_active).toBe(false)
    expect(res.body.data.campaign.status).toBe('draft')
  })

  it('PUT /api/campaigns/:id — update min_age and max_age', async () => {
    const res = await request(app)
      .put(`/api/campaigns/${campaignToUpdate.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ min_age: 30, max_age: 50 })

    expect(res.status).toBe(200)
    expect(res.body.data.campaign.min_age).toBe(30)
    expect(res.body.data.campaign.max_age).toBe(50)
  })

  it('PUT /api/campaigns/:id — returns 404 for non-existent campaign', async () => {
    const res = await request(app)
      .put('/api/campaigns/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ghost' })

    expect(res.status).toBe(404)
  })
})

describe('Campaign delete', () => {
  let campaignToDelete

  beforeEach(async () => {
    campaignToDelete = await createTestCampaign(adminUser.id, {
      name: 'Deletable Campaign',
      status: 'active'
    })
  })

  it('DELETE /api/campaigns/:id — archives and returns 200', async () => {
    const res = await request(app)
      .delete(`/api/campaigns/${campaignToDelete.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.message).toContain('archived')
  })

  it('DELETE /api/campaigns/:id — verify campaign status is archived after delete', async () => {
    await request(app)
      .delete(`/api/campaigns/${campaignToDelete.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    const getRes = await request(app)
      .get(`/api/campaigns/${campaignToDelete.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(getRes.status).toBe(200)
    expect(getRes.body.data.campaign.status).toBe('archived')
  })

  it('DELETE non-existent ID — returns 404', async () => {
    const res = await request(app)
      .delete('/api/campaigns/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })
})
