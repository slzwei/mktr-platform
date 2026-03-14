import './setup.js'
import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js'

let app, adminUser, adminToken, agentUser, agentToken

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminUser = admin.user
  adminToken = admin.token
  const agent = await createTestUser({ role: 'agent' })
  agentUser = agent.user
  agentToken = agent.token
}, 15000)

afterAll(async () => {
  await closeDb()
})

describe('Campaign previews — create and resolve', () => {
  let campaign, previewSlug

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id, {
      name: 'Preview Test Campaign',
      design_config: { theme: 'dark', headerText: 'Hello' }
    })
  })

  it('POST /api/campaigns/:id/preview — creates a preview snapshot', async () => {
    const res = await request(app)
      .post(`/api/campaigns/${campaign.id}/preview`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.slug).toBeDefined()
    expect(res.body.data.url).toMatch(/^\/p\//)
    expect(res.body.data.previewId).toBeDefined()

    previewSlug = res.body.data.slug
  })

  it('GET /api/previews/slug/:slug — resolves preview by slug', async () => {
    // Ensure slug was created in previous test
    expect(previewSlug).toBeDefined()

    const res = await request(app)
      .get(`/api/previews/slug/${previewSlug}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.snapshot).toBeDefined()
    expect(res.body.data.campaignId).toBe(campaign.id)
    expect(res.body.data.snapshot.name).toBe('Preview Test Campaign')
  })

  it('POST /api/campaigns/:id/preview — refreshing preview generates new slug', async () => {
    const res = await request(app)
      .post(`/api/campaigns/${campaign.id}/preview`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(201)
    expect(res.body.data.slug).toBeDefined()
    // New slug should differ from the old one
    expect(res.body.data.slug).not.toBe(previewSlug)

    // Old slug should no longer resolve (it was replaced)
    const oldRes = await request(app)
      .get(`/api/previews/slug/${previewSlug}`)
    expect(oldRes.status).toBe(404)

    previewSlug = res.body.data.slug
  })

  it('GET /api/previews/slug/:slug — returns 404 for non-existent slug', async () => {
    const res = await request(app)
      .get('/api/previews/slug/nonexistent000000000000000000000000')

    expect(res.status).toBe(404)
  })

  it('GET /api/previews/slug/:slug — sets X-Robots-Tag noindex header', async () => {
    expect(previewSlug).toBeDefined()

    const res = await request(app)
      .get(`/api/previews/slug/${previewSlug}`)

    expect(res.status).toBe(200)
    expect(res.headers['x-robots-tag']).toMatch(/noindex/)
  })
})

describe('Campaign previews — access control', () => {
  let agentCampaign

  beforeAll(async () => {
    agentCampaign = await createTestCampaign(agentUser.id, { name: 'Agent Preview Campaign' })
  })

  it('agent can create preview for own campaign', async () => {
    const res = await request(app)
      .post(`/api/campaigns/${agentCampaign.id}/preview`)
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(201)
    expect(res.body.data.slug).toBeDefined()
  })

  it('agent cannot create preview for another user campaign', async () => {
    const otherCampaign = await createTestCampaign(adminUser.id, { name: 'Admin Only Campaign' })

    const res = await request(app)
      .post(`/api/campaigns/${otherCampaign.id}/preview`)
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(404)
  })

  it('admin can create preview for any campaign', async () => {
    const res = await request(app)
      .post(`/api/campaigns/${agentCampaign.id}/preview`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(201)
  })

  it('returns 401 without auth token', async () => {
    const res = await request(app)
      .post(`/api/campaigns/${agentCampaign.id}/preview`)

    expect([401, 403]).toContain(res.status)
  })

  it('returns 404 for non-existent campaign id', async () => {
    const res = await request(app)
      .post('/api/campaigns/00000000-0000-0000-0000-000000000000/preview')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })
})

describe('Campaign previews — public campaign endpoint', () => {
  let campaign

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id, {
      name: 'Public Lookup Campaign',
      design_config: { color: 'blue' }
    })
  })

  it('GET /api/previews/public/:id — returns campaign data without auth', async () => {
    const res = await request(app)
      .get(`/api/previews/public/${campaign.id}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.campaign).toBeDefined()
    expect(res.body.data.campaign.id).toBe(campaign.id)
    expect(res.body.data.campaign.name).toBe('Public Lookup Campaign')
  })

  it('GET /api/previews/public/:id — returns 404 for non-existent id', async () => {
    const res = await request(app)
      .get('/api/previews/public/00000000-0000-0000-0000-000000000000')

    expect(res.status).toBe(404)
  })
})
