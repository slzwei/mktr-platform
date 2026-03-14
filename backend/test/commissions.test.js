import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestCommission } from './helpers.js'

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

describe('Commission CRUD', () => {
  let campaign, commissionId

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
  })

  it('POST /api/commissions — admin can create a commission', async () => {
    const res = await request(app)
      .post('/api/commissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        agentId: agentUser.id,
        amount: 75.00,
        type: 'conversion',
        description: 'Test conversion commission',
        campaignId: campaign.id
      })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.commission.amount).toBe(75)
    expect(res.body.data.commission.status).toBe('pending')
    commissionId = res.body.data.commission.id
  })

  it('POST /api/commissions — returns 400 for missing required fields', async () => {
    const res = await request(app)
      .post('/api/commissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agentUser.id })

    expect(res.status).toBe(400)
  })

  it('POST /api/commissions — returns 400 for invalid agent', async () => {
    const res = await request(app)
      .post('/api/commissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        agentId: '00000000-0000-0000-0000-000000000000',
        amount: 50,
        type: 'conversion'
      })

    expect(res.status).toBe(400)
  })

  it('GET /api/commissions — admin sees all commissions', async () => {
    const res = await request(app)
      .get('/api/commissions')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.commissions).toBeDefined()
    expect(res.body.data.pagination).toBeDefined()
  })

  it('GET /api/commissions — agent sees only own commissions', async () => {
    const res = await request(app)
      .get('/api/commissions')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    const commissions = res.body.data.commissions
    if (commissions.length > 0) {
      expect(commissions.every(c => c.agentId === agentUser.id)).toBe(true)
    }
  })

  it('GET /api/commissions/:id — returns commission details', async () => {
    const res = await request(app)
      .get(`/api/commissions/${commissionId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.commission.id).toBe(commissionId)
  })

  it('agent cannot create commissions (admin-only)', async () => {
    const res = await request(app)
      .post('/api/commissions')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        agentId: agentUser.id,
        amount: 50,
        type: 'conversion'
      })

    expect([401, 403]).toContain(res.status)
  })
})

describe('Commission lifecycle', () => {
  let campaign, commissionId

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
  })

  it('approve → pay lifecycle works', async () => {
    // Create
    const createRes = await request(app)
      .post('/api/commissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        agentId: agentUser.id,
        amount: 100,
        type: 'conversion',
        campaignId: campaign.id
      })
    commissionId = createRes.body.data.commission.id

    // Approve
    const approveRes = await request(app)
      .patch(`/api/commissions/${commissionId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'Approved for payment' })

    expect(approveRes.status).toBe(200)
    expect(approveRes.body.data.commission.status).toBe('approved')

    // Pay
    const payRes = await request(app)
      .patch(`/api/commissions/${commissionId}/pay`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        paymentMethod: 'bank_transfer',
        transactionId: 'TXN-001',
        processingFee: 2.50
      })

    expect(payRes.status).toBe(200)
    expect(payRes.body.data.commission.status).toBe('paid')
  })

  it('cannot approve non-pending commission', async () => {
    // commissionId is now 'paid' from above
    const res = await request(app)
      .patch(`/api/commissions/${commissionId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(400)
  })

  it('cannot pay non-approved commission', async () => {
    const c = await createTestCommission(agentUser.id, campaign.id, { status: 'pending' })

    const res = await request(app)
      .patch(`/api/commissions/${c.id}/pay`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ paymentMethod: 'cash' })

    expect(res.status).toBe(400)
  })

  it('cannot update paid commission', async () => {
    // commissionId is paid
    const res = await request(app)
      .put(`/api/commissions/${commissionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 999 })

    expect(res.status).toBe(400)
  })
})

describe('Commission statistics', () => {
  it('GET /api/commissions/stats/overview — returns stats', async () => {
    const res = await request(app)
      .get('/api/commissions/stats/overview?period=year')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.summary).toBeDefined()
    expect(res.body.data.monthlyTrend).toBeDefined()
    expect(res.body.data.summary.totalAmount).toBeGreaterThanOrEqual(0)
  })

  it('agent can view own stats', async () => {
    const res = await request(app)
      .get('/api/commissions/stats/overview?period=month')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.summary).toBeDefined()
  })
})

describe('Commission filtering', () => {
  let campaign

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
    // Create commissions with different statuses and types
    await createTestCommission(agentUser.id, campaign.id, {
      status: 'pending',
      type: 'conversion',
      amount: 40,
      description: `filter-test-pending-${Date.now()}`
    })
    await createTestCommission(agentUser.id, campaign.id, {
      status: 'approved',
      type: 'referral',
      amount: 60,
      description: `filter-test-approved-${Date.now()}`
    })
    await createTestCommission(agentUser.id, campaign.id, {
      status: 'pending',
      type: 'bonus',
      amount: 25,
      description: `filter-test-bonus-${Date.now()}`
    })
  })

  it('GET /api/commissions?status=pending — filters by status', async () => {
    const res = await request(app)
      .get('/api/commissions?status=pending')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const commissions = res.body.data.commissions
    expect(commissions.length).toBeGreaterThanOrEqual(1)
    expect(commissions.every(c => c.status === 'pending')).toBe(true)
  })

  it('GET /api/commissions?status=approved — filters by approved status', async () => {
    const res = await request(app)
      .get('/api/commissions?status=approved')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const commissions = res.body.data.commissions
    expect(commissions.length).toBeGreaterThanOrEqual(1)
    expect(commissions.every(c => c.status === 'approved')).toBe(true)
  })

  it('GET /api/commissions?type=conversion — filters by type', async () => {
    const res = await request(app)
      .get('/api/commissions?type=conversion')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const commissions = res.body.data.commissions
    expect(commissions.length).toBeGreaterThanOrEqual(1)
    expect(commissions.every(c => c.type === 'conversion')).toBe(true)
  })

  it('GET /api/commissions?type=referral — filters by referral type', async () => {
    const res = await request(app)
      .get('/api/commissions?type=referral')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const commissions = res.body.data.commissions
    expect(commissions.length).toBeGreaterThanOrEqual(1)
    expect(commissions.every(c => c.type === 'referral')).toBe(true)
  })

  it('GET /api/commissions?status=pending&type=bonus — combined filters', async () => {
    const res = await request(app)
      .get('/api/commissions?status=pending&type=bonus')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const commissions = res.body.data.commissions
    expect(commissions.length).toBeGreaterThanOrEqual(1)
    expect(commissions.every(c => c.status === 'pending' && c.type === 'bonus')).toBe(true)
  })

  it('GET /api/commissions?campaignId=... — filters by campaign', async () => {
    const res = await request(app)
      .get(`/api/commissions?campaignId=${campaign.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const commissions = res.body.data.commissions
    expect(commissions.length).toBeGreaterThanOrEqual(1)
    expect(commissions.every(c => c.campaignId === campaign.id)).toBe(true)
  })
})

describe('Commission stats detail', () => {
  it('GET /api/commissions/stats/overview — returns full stats structure', async () => {
    const res = await request(app)
      .get('/api/commissions/stats/overview?period=year')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const data = res.body.data

    // summary
    expect(data.summary).toBeDefined()
    expect(typeof data.summary.totalAmount).toBe('number')
    expect(typeof data.summary.totalCount).toBe('number')
    expect(data.summary.averageCommission).toBeDefined()

    // breakdowns
    expect(Array.isArray(data.byStatus)).toBe(true)
    expect(Array.isArray(data.byType)).toBe(true)
    expect(Array.isArray(data.topCampaigns)).toBe(true)

    // monthly trend
    expect(Array.isArray(data.monthlyTrend)).toBe(true)
    expect(data.monthlyTrend.length).toBe(12)
    data.monthlyTrend.forEach(m => {
      expect(m).toHaveProperty('month')
      expect(m).toHaveProperty('total')
    })
  })

  it('GET /api/commissions/stats/overview?period=today — scoped to today', async () => {
    const res = await request(app)
      .get('/api/commissions/stats/overview?period=today')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.summary.totalAmount).toBeGreaterThanOrEqual(0)
  })

  it('GET /api/commissions/agents/:agentId/summary — returns agent summary', async () => {
    const res = await request(app)
      .get(`/api/commissions/agents/${agentUser.id}/summary`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const data = res.body.data

    expect(data.agent).toBeDefined()
    expect(data.agent.id).toBe(agentUser.id)
    expect(data.summary).toBeDefined()
    expect(typeof data.summary.totalEarnings).toBe('number')
    expect(typeof data.summary.paidAmount).toBe('number')
    expect(typeof data.summary.pendingAmount).toBe('number')
    expect(typeof data.summary.totalCommissions).toBe('number')
    expect(Array.isArray(data.monthlyBreakdown)).toBe(true)
    expect(data.monthlyBreakdown.length).toBe(12)
  })

  it('GET /api/commissions/agents/:agentId/summary — returns 404 for non-existent agent', async () => {
    const res = await request(app)
      .get('/api/commissions/agents/00000000-0000-0000-0000-000000000000/summary')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })
})

describe('Commission status updates', () => {
  let campaign, pendingCommissionId

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
  })

  beforeEach(async () => {
    const c = await createTestCommission(agentUser.id, campaign.id, {
      status: 'pending',
      amount: 55,
      type: 'conversion'
    })
    pendingCommissionId = c.id
  })

  it('PATCH /api/commissions/:id/approve — updates status to approved', async () => {
    const res = await request(app)
      .patch(`/api/commissions/${pendingCommissionId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'Looks good' })

    expect(res.status).toBe(200)
    expect(res.body.data.commission.status).toBe('approved')
  })

  it('PATCH /api/commissions/:id/approve — agent cannot approve', async () => {
    const res = await request(app)
      .patch(`/api/commissions/${pendingCommissionId}/approve`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ notes: 'Self-approve' })

    expect([401, 403]).toContain(res.status)
  })

  it('PATCH /api/commissions/:id/pay — approved commission can be paid', async () => {
    // First approve
    await request(app)
      .patch(`/api/commissions/${pendingCommissionId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)

    // Then pay
    const res = await request(app)
      .patch(`/api/commissions/${pendingCommissionId}/pay`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        paymentMethod: 'bank_transfer',
        transactionId: `TXN-${Date.now()}`,
        processingFee: 1.50
      })

    expect(res.status).toBe(200)
    expect(res.body.data.commission.status).toBe('paid')
  })

  it('PUT /api/commissions/:id — admin can update pending commission amount', async () => {
    const res = await request(app)
      .put(`/api/commissions/${pendingCommissionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 120 })

    expect(res.status).toBe(200)
    expect(res.body.data.commission.amount).toBe(120)
  })
})

describe('Agent scoping — agent sees own commissions only', () => {
  let campaign, otherAgent, otherToken

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
    const other = await createTestUser({ role: 'agent' })
    otherAgent = other.user
    otherToken = other.token

    // Create commissions for agentUser
    await createTestCommission(agentUser.id, campaign.id, {
      amount: 30, type: 'conversion', description: `scope-agent-${Date.now()}`
    })
    // Create commissions for otherAgent
    await createTestCommission(otherAgent.id, campaign.id, {
      amount: 45, type: 'referral', description: `scope-other-${Date.now()}`
    })
  })

  it('agentUser sees only own commissions', async () => {
    const res = await request(app)
      .get('/api/commissions')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    const commissions = res.body.data.commissions
    expect(commissions.length).toBeGreaterThanOrEqual(1)
    expect(commissions.every(c => c.agentId === agentUser.id)).toBe(true)
  })

  it('otherAgent sees only own commissions', async () => {
    const res = await request(app)
      .get('/api/commissions')
      .set('Authorization', `Bearer ${otherToken}`)

    expect(res.status).toBe(200)
    const commissions = res.body.data.commissions
    expect(commissions.length).toBeGreaterThanOrEqual(1)
    expect(commissions.every(c => c.agentId === otherAgent.id)).toBe(true)
  })

  it('admin sees commissions from all agents', async () => {
    const res = await request(app)
      .get('/api/commissions?limit=100')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const agentIds = [...new Set(res.body.data.commissions.map(c => c.agentId))]
    expect(agentIds.length).toBeGreaterThanOrEqual(2)
  })

  it('agent cannot see another agent commission by ID', async () => {
    // Create a commission for otherAgent
    const c = await createTestCommission(otherAgent.id, campaign.id, {
      amount: 10, type: 'bonus'
    })

    const res = await request(app)
      .get(`/api/commissions/${c.id}`)
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(404)
  })
})

describe('Commission pagination', () => {
  it('GET /api/commissions?page=1&limit=2 — respects pagination', async () => {
    const res = await request(app)
      .get('/api/commissions?page=1&limit=2')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.commissions.length).toBeLessThanOrEqual(2)
    expect(res.body.data.pagination.currentPage).toBe(1)
    expect(res.body.data.pagination.itemsPerPage).toBe(2)
    expect(res.body.data.pagination.totalItems).toBeGreaterThanOrEqual(1)
    expect(res.body.data.pagination.totalPages).toBeGreaterThanOrEqual(1)
  })
})
