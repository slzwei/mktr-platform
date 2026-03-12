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
