import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js'

let app, adminToken, agentUser, agentToken

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminToken = admin.token
  const agent = await createTestUser({ role: 'agent' })
  agentUser = agent.user; agentToken = agent.token

  // Seed some data for dashboard
  const campaign = await createTestCampaign(admin.user.id)
  await createTestProspect(campaign.id, { assignedAgentId: agentUser.id })
  await createTestProspect(campaign.id, { assignedAgentId: agentUser.id, leadStatus: 'contacted' })
}, 15000)

afterAll(async () => {
  await closeDb()
})

describe('Dashboard overview', () => {
  it('GET /api/dashboard/overview — admin gets full stats', async () => {
    const res = await request(app)
      .get('/api/dashboard/overview?period=30d')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.stats).toBeDefined()
    expect(res.body.data.stats.users).toBeDefined()
    expect(res.body.data.stats.campaigns).toBeDefined()
    expect(res.body.data.stats.prospects).toBeDefined()
    expect(res.body.data.stats.commissions).toBeDefined()
    expect(res.body.data.stats.qrCodes).toBeDefined()
    expect(res.body.data.stats.fleet).toBeDefined()
    expect(res.body.data.stats.users.total).toBeGreaterThanOrEqual(1)
  })

  it('GET /api/dashboard/overview — agent gets agent-specific stats', async () => {
    const res = await request(app)
      .get('/api/dashboard/overview?period=30d')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.stats.prospects).toBeDefined()
    expect(res.body.data.stats.prospects.assigned).toBeGreaterThanOrEqual(0)
    expect(res.body.data.stats.commissions).toBeDefined()
    expect(res.body.data.stats.campaigns).toBeDefined()
  })

  it('supports different period params (7d, 30d, 90d)', async () => {
    for (const period of ['7d', '30d', '90d']) {
      const res = await request(app)
        .get(`/api/dashboard/overview?period=${period}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data.period).toBe(period)
    }
  })

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/dashboard/overview')
    expect([401, 403]).toContain(res.status)
  })
})

describe('Dashboard analytics', () => {
  it('GET /api/dashboard/analytics?type=prospects — returns prospect analytics', async () => {
    const res = await request(app)
      .get('/api/dashboard/analytics?type=prospects&period=30d')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.type).toBe('prospects')
    expect(res.body.data.analytics).toBeDefined()
  })

  it('GET /api/dashboard/analytics?type=commissions — returns commission analytics', async () => {
    const res = await request(app)
      .get('/api/dashboard/analytics?type=commissions&period=30d')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.type).toBe('commissions')
  })

  it('GET /api/dashboard/analytics?type=campaigns — returns campaign analytics', async () => {
    const res = await request(app)
      .get('/api/dashboard/analytics?type=campaigns&period=30d')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.type).toBe('campaigns')
  })

  it('returns 400 for missing type', async () => {
    const res = await request(app)
      .get('/api/dashboard/analytics?period=30d')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(400)
  })
})
