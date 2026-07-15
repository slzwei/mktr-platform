import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js'
import { resetAdminStatsCache } from '../src/services/dashboardService.js'

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
    expect(res.body.data.stats.qrCodes).toBeDefined()
    // Fleet-era blocks are gone from admin stats (Phase D teardown).
    expect(res.body.data.stats.commissions).toBeUndefined()
    expect(res.body.data.stats.fleet).toBeUndefined()
    expect(res.body.data.stats.impressions).toBeUndefined()
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

describe('Dashboard overview stats structure', () => {
  it('GET /api/dashboard/overview — admin stats include totalCampaigns and totalProspects', async () => {
    const res = await request(app)
      .get('/api/dashboard/overview?period=30d')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const { stats } = res.body.data
    // campaigns
    expect(stats.campaigns).toHaveProperty('total')
    expect(stats.campaigns).toHaveProperty('active')
    expect(typeof stats.campaigns.total).toBe('number')
    expect(stats.campaigns.total).toBeGreaterThanOrEqual(1)

    // prospects
    expect(stats.prospects).toHaveProperty('total')
    expect(stats.prospects).toHaveProperty('new')
    expect(typeof stats.prospects.total).toBe('number')
    expect(stats.prospects.total).toBeGreaterThanOrEqual(0)

    // qrCodes
    expect(stats.qrCodes).toHaveProperty('total')
    expect(stats.qrCodes).toHaveProperty('totalScans')

    // fleet-era keys removed (Phase D teardown)
    expect(stats.commissions).toBeUndefined()
    expect(stats.fleet).toBeUndefined()
  })

  it('GET /api/dashboard/overview — response includes lastUpdated timestamp', async () => {
    const res = await request(app)
      .get('/api/dashboard/overview?period=30d')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.lastUpdated).toBeDefined()
    // Should be a valid date string
    expect(new Date(res.body.data.lastUpdated).toString()).not.toBe('Invalid Date')
  })

  it('GET /api/dashboard/overview — agent stats include assigned prospect count', async () => {
    const res = await request(app)
      .get('/api/dashboard/overview?period=30d')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    const { stats } = res.body.data
    expect(stats.prospects).toHaveProperty('assigned')
    expect(stats.prospects).toHaveProperty('converted')
    expect(stats.prospects).toHaveProperty('conversionRate')
    expect(typeof stats.prospects.assigned).toBe('number')
  })
})

describe('Dashboard with date filters', () => {
  it('GET /api/dashboard/overview?period=7d — returns 200 with 7d period', async () => {
    const res = await request(app)
      .get('/api/dashboard/overview?period=7d')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.period).toBe('7d')
    expect(res.body.data.stats).toBeDefined()
  })

  it('GET /api/dashboard/overview?period=90d — returns 200 with 90d period', async () => {
    const res = await request(app)
      .get('/api/dashboard/overview?period=90d')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.period).toBe('90d')
    expect(res.body.data.stats).toBeDefined()
  })

  it('GET /api/dashboard/overview — defaults to 30d when period omitted', async () => {
    const res = await request(app)
      .get('/api/dashboard/overview')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.period).toBe('30d')
  })
})

describe('Dashboard overview — expanded coverage', () => {
  beforeEach(() => resetAdminStatsCache())

  it('GET /api/dashboard/overview?period=7d — admin stats have recentActivities array', async () => {
    const res = await request(app)
      .get('/api/dashboard/overview?period=7d')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    const { stats } = res.body.data
    expect(stats).toBeDefined()
    expect(Array.isArray(stats.recentActivities)).toBe(true)
  })

  it('GET /api/dashboard/overview?period=90d — admin stats no longer include impressions', async () => {
    const res = await request(app)
      .get('/api/dashboard/overview?period=90d')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const { stats } = res.body.data
    expect(stats.impressions).toBeUndefined()
  })

  it('GET /api/dashboard/overview?period=7d — admin users.growth is an array', async () => {
    const res = await request(app)
      .get('/api/dashboard/overview?period=7d')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const { stats } = res.body.data
    expect(Array.isArray(stats.users.growth)).toBe(true)
    // 7d period should yield ≤ 7 growth entries
    expect(stats.users.growth.length).toBeLessThanOrEqual(8)
    if (stats.users.growth.length > 0) {
      expect(stats.users.growth[0]).toHaveProperty('date')
      expect(stats.users.growth[0]).toHaveProperty('count')
    }
  })

  it('GET /api/dashboard/overview — agent stats include commissions breakdown', async () => {
    const res = await request(app)
      .get('/api/dashboard/overview?period=30d')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    const { stats } = res.body.data
    expect(stats.commissions).toHaveProperty('total')
    expect(stats.commissions).toHaveProperty('pending')
    expect(stats.commissions).toHaveProperty('paid')
    expect(typeof stats.commissions.total).toBe('number')
  })

  it('GET /api/dashboard/overview — agent stats include recentProspects', async () => {
    const res = await request(app)
      .get('/api/dashboard/overview?period=30d')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    const { stats } = res.body.data
    expect(Array.isArray(stats.recentProspects)).toBe(true)
  })

  it('GET /api/dashboard/overview — agent stats include campaigns total/active', async () => {
    const res = await request(app)
      .get('/api/dashboard/overview?period=30d')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    const { stats } = res.body.data
    expect(stats.campaigns).toHaveProperty('total')
    expect(stats.campaigns).toHaveProperty('active')
    expect(typeof stats.campaigns.total).toBe('number')
  })
})

describe('Dashboard analytics — expanded coverage', () => {
  it('GET /api/dashboard/analytics?type=qr_codes — returns QR analytics', async () => {
    const res = await request(app)
      .get('/api/dashboard/analytics?type=qr_codes&period=30d')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.type).toBe('qr_codes')
    expect(res.body.data.analytics).toBeDefined()
  })

  it('GET /api/dashboard/analytics — agent can access prospect analytics', async () => {
    const res = await request(app)
      .get('/api/dashboard/analytics?type=prospects&period=7d')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.type).toBe('prospects')
    expect(res.body.data.period).toBe('7d')
  })

  it('GET /api/dashboard/analytics — agent can access commission analytics', async () => {
    const res = await request(app)
      .get('/api/dashboard/analytics?type=commissions&period=90d')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.type).toBe('commissions')
  })

  it('GET /api/dashboard/analytics — returns 401 without token', async () => {
    const res = await request(app)
      .get('/api/dashboard/analytics?type=prospects')

    expect([401, 403]).toContain(res.status)
  })
})
