import './setup.js'
import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js'

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

describe('LeadPackage CRUD', () => {
  let campaign, packageId

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
  })

  it('POST /api/lead-packages — admin can create a package', async () => {
    const res = await request(app)
      .post('/api/lead-packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Test Package ${Date.now()}`,
        price: 199.99,
        leadCount: 50,
        campaignId: campaign.id,
        type: 'basic'
      })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.package).toBeDefined()
    expect(res.body.data.package.name).toContain('Test Package')
    expect(Number(res.body.data.package.price)).toBe(199.99)
    expect(res.body.data.package.leadCount).toBe(50)
    expect(res.body.data.package.status).toBe('active')
    packageId = res.body.data.package.id
  })

  it('GET /api/lead-packages — admin sees all packages', async () => {
    const res = await request(app)
      .get('/api/lead-packages')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data.packages)).toBe(true)
    expect(res.body.data.packages.length).toBeGreaterThanOrEqual(1)
  })

  it('GET /api/lead-packages?campaignId=... — filters by campaign', async () => {
    const res = await request(app)
      .get(`/api/lead-packages?campaignId=${campaign.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const packages = res.body.data.packages
    expect(packages.length).toBeGreaterThanOrEqual(1)
    expect(packages.every(p => p.campaignId === campaign.id)).toBe(true)
  })

  it('DELETE /api/lead-packages/:id — deletes unused package', async () => {
    // Create a throwaway package
    const createRes = await request(app)
      .post('/api/lead-packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Deletable Pkg ${Date.now()}`,
        price: 10,
        leadCount: 5,
        campaignId: campaign.id,
        type: 'basic'
      })
    const delId = createRes.body.data.package.id

    const res = await request(app)
      .delete(`/api/lead-packages/${delId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.message).toContain('deleted')
  })

  it('DELETE /api/lead-packages/:id — archives package with assignments', async () => {
    // First assign the main package to an agent so it has assignments
    await request(app)
      .post('/api/lead-packages/assign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agentUser.id, packageId })

    const res = await request(app)
      .delete(`/api/lead-packages/${packageId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.message).toContain('archived')
    expect(res.body.data.package.status).toBe('archived')
  })

  it('DELETE /api/lead-packages/:id — returns 404 for non-existent', async () => {
    const res = await request(app)
      .delete('/api/lead-packages/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })
})

describe('LeadPackage validation', () => {
  let campaign

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
  })

  it('POST /api/lead-packages — returns 400 without name', async () => {
    const res = await request(app)
      .post('/api/lead-packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        price: 100,
        leadCount: 10,
        campaignId: campaign.id
      })

    expect(res.status).toBe(400)
  })

  it('POST /api/lead-packages — returns 400 without price', async () => {
    const res = await request(app)
      .post('/api/lead-packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `No Price ${Date.now()}`,
        leadCount: 10,
        campaignId: campaign.id
      })

    expect(res.status).toBe(400)
  })

  it('POST /api/lead-packages — returns 400 without leadCount', async () => {
    const res = await request(app)
      .post('/api/lead-packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `No Count ${Date.now()}`,
        price: 50,
        campaignId: campaign.id
      })

    expect(res.status).toBe(400)
  })

  it('POST /api/lead-packages — returns 400 without campaignId', async () => {
    const res = await request(app)
      .post('/api/lead-packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `No Campaign ${Date.now()}`,
        price: 50,
        leadCount: 10
      })

    expect(res.status).toBe(400)
  })

  it('POST /api/lead-packages — agent cannot create packages', async () => {
    const res = await request(app)
      .post('/api/lead-packages')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        name: `Agent Pkg ${Date.now()}`,
        price: 100,
        leadCount: 10,
        campaignId: campaign.id
      })

    expect(res.status).toBe(403)
  })
})

describe('LeadPackage assignment', () => {
  let campaign, packageId, assignmentId

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
    const createRes = await request(app)
      .post('/api/lead-packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Assignment Pkg ${Date.now()}`,
        price: 299,
        leadCount: 100,
        campaignId: campaign.id,
        type: 'premium'
      })
    packageId = createRes.body.data.package.id
  })

  it('POST /api/lead-packages/assign — admin can assign package to agent', async () => {
    const res = await request(app)
      .post('/api/lead-packages/assign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agentUser.id, packageId })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.assignment).toBeDefined()
    expect(res.body.data.assignment.agentId).toBe(agentUser.id)
    expect(res.body.data.assignment.leadPackageId).toBe(packageId)
    expect(res.body.data.assignment.leadsTotal).toBe(100)
    expect(res.body.data.assignment.leadsRemaining).toBe(100)
    expect(res.body.data.assignment.status).toBe('active')
    expect(Number(res.body.data.assignment.priceSnapshot)).toBe(299)
    assignmentId = res.body.data.assignment.id
  })

  it('POST /api/lead-packages/assign — returns 400 without agentId', async () => {
    const res = await request(app)
      .post('/api/lead-packages/assign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ packageId })

    expect(res.status).toBe(400)
  })

  it('POST /api/lead-packages/assign — returns 400 without packageId', async () => {
    const res = await request(app)
      .post('/api/lead-packages/assign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agentUser.id })

    expect(res.status).toBe(400)
  })

  it('POST /api/lead-packages/assign — returns 404 for non-existent agent', async () => {
    const res = await request(app)
      .post('/api/lead-packages/assign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        agentId: '00000000-0000-0000-0000-000000000000',
        packageId
      })

    expect(res.status).toBe(404)
  })

  it('POST /api/lead-packages/assign — returns 404 for non-existent package', async () => {
    const res = await request(app)
      .post('/api/lead-packages/assign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        agentId: agentUser.id,
        packageId: '00000000-0000-0000-0000-000000000000'
      })

    expect(res.status).toBe(404)
  })

  it('POST /api/lead-packages/assign — agent cannot assign packages', async () => {
    const res = await request(app)
      .post('/api/lead-packages/assign')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ agentId: agentUser.id, packageId })

    expect(res.status).toBe(403)
  })

  it('GET /api/lead-packages/assignments/:agentId — admin can list agent assignments', async () => {
    const res = await request(app)
      .get(`/api/lead-packages/assignments/${agentUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data.assignments)).toBe(true)
    expect(res.body.data.assignments.length).toBeGreaterThanOrEqual(1)
    // Verify association includes package info
    const first = res.body.data.assignments[0]
    expect(first.agentId).toBe(agentUser.id)
    expect(first.package).toBeDefined()
  })

  it('GET /api/lead-packages/assignments/:agentId — agent can see own assignments', async () => {
    const res = await request(app)
      .get(`/api/lead-packages/assignments/${agentUser.id}`)
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.assignments.length).toBeGreaterThanOrEqual(1)
  })

  it('GET /api/lead-packages/assignments/:agentId — agent cannot see other agent assignments', async () => {
    const other = await createTestUser({ role: 'agent' })

    const res = await request(app)
      .get(`/api/lead-packages/assignments/${other.user.id}`)
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(403)
  })

  it('PATCH /api/lead-packages/assignments/:id — admin can update leadsRemaining', async () => {
    const res = await request(app)
      .patch(`/api/lead-packages/assignments/${assignmentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ leadsRemaining: 80 })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.assignment.leadsRemaining).toBe(80)
    expect(res.body.data.assignment.status).toBe('active')
  })

  it('PATCH /api/lead-packages/assignments/:id — setting leadsRemaining to 0 sets status to exhausted', async () => {
    const res = await request(app)
      .patch(`/api/lead-packages/assignments/${assignmentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ leadsRemaining: 0 })

    expect(res.status).toBe(200)
    expect(res.body.data.assignment.leadsRemaining).toBe(0)
    expect(res.body.data.assignment.status).toBe('exhausted')
  })

  it('PATCH /api/lead-packages/assignments/:id — rejects negative leadsRemaining', async () => {
    const res = await request(app)
      .patch(`/api/lead-packages/assignments/${assignmentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ leadsRemaining: -5 })

    expect(res.status).toBe(400)
  })

  it('PATCH /api/lead-packages/assignments/:id — returns 404 for non-existent', async () => {
    const res = await request(app)
      .patch('/api/lead-packages/assignments/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ leadsRemaining: 50 })

    expect(res.status).toBe(404)
  })

  it('DELETE /api/lead-packages/assignments/:id — admin can delete assignment', async () => {
    // Create a new assignment specifically for deletion
    const assignRes = await request(app)
      .post('/api/lead-packages/assign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agentUser.id, packageId })

    const delId = assignRes.body.data.assignment.id

    const res = await request(app)
      .delete(`/api/lead-packages/assignments/${delId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.message).toContain('deleted')
  })

  it('DELETE /api/lead-packages/assignments/:id — returns 404 for non-existent', async () => {
    const res = await request(app)
      .delete('/api/lead-packages/assignments/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })

  it('DELETE /api/lead-packages/assignments/:id — agent cannot delete assignments', async () => {
    const assignRes = await request(app)
      .post('/api/lead-packages/assign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agentUser.id, packageId })

    const delId = assignRes.body.data.assignment.id

    const res = await request(app)
      .delete(`/api/lead-packages/assignments/${delId}`)
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(403)
  })
})

describe('LeadPackage agent visibility', () => {
  let campaign

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
    // Create one public active and one inactive package
    await request(app)
      .post('/api/lead-packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Public Active ${Date.now()}`,
        price: 50,
        leadCount: 20,
        campaignId: campaign.id,
        type: 'basic'
      })
  })

  it('GET /api/lead-packages — agent sees only active public packages', async () => {
    const res = await request(app)
      .get('/api/lead-packages')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(200)
    const packages = res.body.data.packages
    // All returned packages should be active and public
    expect(packages.every(p => p.status === 'active')).toBe(true)
    expect(packages.every(p => p.isPublic === true)).toBe(true)
  })

  it('GET /api/lead-packages — unauthenticated returns 401', async () => {
    const res = await request(app)
      .get('/api/lead-packages')

    expect([401, 403]).toContain(res.status)
  })
})
