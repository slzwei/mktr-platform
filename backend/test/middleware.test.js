import './setup.js'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js'

const JWT_SECRET = process.env.JWT_SECRET

let app
let adminUser, adminToken
let agent1User, agent1Token
let agent2User, agent2Token
let campaign
let prospectForAgent1, prospectForAgent2, unassignedProspect

beforeAll(async () => {
  app = await getApp()

  const admin = await createTestUser({ role: 'admin' })
  adminUser = admin.user; adminToken = admin.token

  const agent1 = await createTestUser({ role: 'agent' })
  agent1User = agent1.user; agent1Token = agent1.token

  const agent2 = await createTestUser({ role: 'agent' })
  agent2User = agent2.user; agent2Token = agent2.token

  campaign = await createTestCampaign(adminUser.id)

  prospectForAgent1 = await createTestProspect(campaign.id, {
    assignedAgentId: agent1User.id,
    firstName: 'AssignedToAgent1'
  })

  prospectForAgent2 = await createTestProspect(campaign.id, {
    assignedAgentId: agent2User.id,
    firstName: 'AssignedToAgent2'
  })

  unassignedProspect = await createTestProspect(campaign.id, {
    firstName: 'Unassigned'
  })
}, 15000)

afterAll(async () => {
  await closeDb()
})

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
describe('Auth middleware', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/api/prospects')
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  it('returns 401 for a malformed / invalid token', async () => {
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', 'Bearer not-a-real-jwt-token')
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  it('returns 401 for an expired token', async () => {
    const expiredToken = jwt.sign({ userId: adminUser.id }, JWT_SECRET, { expiresIn: '0s' })
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', `Bearer ${expiredToken}`)
    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/expired/i)
  })

  it('returns 401 when token references a non-existent user', async () => {
    const fakeToken = jwt.sign({ userId: '00000000-0000-0000-0000-000000000000' }, JWT_SECRET, { expiresIn: '1h' })
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', `Bearer ${fakeToken}`)
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  it('returns 403 when an agent accesses an admin-only route', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${agent1Token}`)
    expect(res.status).toBe(403)
    expect(res.body.success).toBe(false)
  })

  it('returns 200 when an admin accesses an admin-only route', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Prospect scoping (via buildProspectWhere)
// ---------------------------------------------------------------------------
describe('Prospect scoping', () => {
  it('admin sees all prospects', async () => {
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.prospects.map(p => p.id)
    expect(ids).toContain(prospectForAgent1.id)
    expect(ids).toContain(prospectForAgent2.id)
    expect(ids).toContain(unassignedProspect.id)
  })

  it('agent only sees prospects assigned to them', async () => {
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', `Bearer ${agent1Token}`)

    expect(res.status).toBe(200)
    const prospects = res.body.data.prospects
    expect(prospects.some(p => p.id === prospectForAgent1.id)).toBe(true)
    expect(prospects.every(p => p.assignedAgentId === agent1User.id)).toBe(true)
  })

  it('agent cannot see prospects assigned to another agent', async () => {
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', `Bearer ${agent1Token}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.prospects.map(p => p.id)
    expect(ids).not.toContain(prospectForAgent2.id)
    expect(ids).not.toContain(unassignedProspect.id)
  })
})

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------
describe('Error handler', () => {
  it('returns 404 for a non-existent route', async () => {
    const res = await request(app)
      .get('/api/this-route-does-not-exist')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(404)
  })

  it('AppError with custom status code returns that status', async () => {
    // PUT /api/prospects/:id with a non-existent UUID triggers a 404 AppError
    const res = await request(app)
      .put('/api/prospects/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ leadStatus: 'contacted' })
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })
})
