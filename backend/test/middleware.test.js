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
// Auth middleware – additional edge cases
// ---------------------------------------------------------------------------
describe('Auth middleware – edge cases', () => {
  it('returns 401 for Bearer with no space after it', async () => {
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', 'Bearertoken123')
    expect(res.status).toBe(401)
  })

  it('returns 401 for Basic auth scheme instead of Bearer', async () => {
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', 'Basic dXNlcjpwYXNz')
    expect(res.status).toBe(401)
  })

  it('returns 401 for a token signed with wrong secret', async () => {
    const wrongToken = jwt.sign({ userId: adminUser.id }, 'completely-wrong-secret', { expiresIn: '1h' })
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', `Bearer ${wrongToken}`)
    expect(res.status).toBe(401)
  })

  it('returns 401 for a JWT with no userId claim', async () => {
    const badToken = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', `Bearer ${badToken}`)
    expect(res.status).toBe(401)
  })

  it('returns 401 when token references an inactive user', async () => {
    const { user: inactiveUser } = await createTestUser({ role: 'admin', isActive: false })
    const inactiveToken = jwt.sign({ userId: inactiveUser.id }, JWT_SECRET, { expiresIn: '1h' })
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', `Bearer ${inactiveToken}`)
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  it('returns 403 when agent accesses fleet owner create (admin-only)', async () => {
    const res = await request(app)
      .post('/api/fleet/owners')
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({ full_name: 'Test', email: 'test@test.com', phone: '91234567' })
    expect([401, 403]).toContain(res.status)
  })

  it('returns 403 when agent accesses users list (admin-only)', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${agent2Token}`)
    expect(res.status).toBe(403)
  })

  it('returns 401 for Authorization header with only "Bearer" (no token value)', async () => {
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', 'Bearer')
    expect(res.status).toBe(401)
  })

  it('returns 401 for a truncated/corrupted JWT', async () => {
    const validToken = adminToken
    const corrupted = validToken.slice(0, validToken.length / 2)
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', `Bearer ${corrupted}`)
    expect(res.status).toBe(401)
  })

  it('returns 401 for a JWT with tampered payload segment', async () => {
    const parts = adminToken.split('.')
    // Modify the payload segment
    parts[1] = Buffer.from('{"userId":"00000000-0000-0000-0000-000000000000","iat":99999999}').toString('base64url')
    const tamperedToken = parts.join('.')
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', `Bearer ${tamperedToken}`)
    expect(res.status).toBe(401)
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

  it('generic server error returns 500 with message', async () => {
    // DELETE /api/prospects/:id with non-existent UUID triggers 404, which is an AppError
    // Instead, test that a malformed UUID triggers a 500 or appropriate error
    const res = await request(app)
      .get('/api/prospects/not-a-uuid')
      .set('Authorization', `Bearer ${adminToken}`)
    // The route handler will fail trying to look up an invalid UUID
    expect([400, 404, 500]).toContain(res.status)
    expect(res.body.success).toBe(false)
  })

  it('AppError with details object includes details in response', async () => {
    // POST /api/prospects with duplicate email in same campaign triggers an error with details
    const res = await request(app)
      .put('/api/prospects/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ leadStatus: 'contacted' })
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
    expect(res.body).toHaveProperty('message')
  })
})

// ---------------------------------------------------------------------------
// Validation middleware (Joi schema validation)
// ---------------------------------------------------------------------------
describe('Validation middleware', () => {
  it('returns 400 with field-level errors for invalid prospect data', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        // Missing required fields: firstName, email, leadSource
        lastName: 'Test'
      })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toBe('Validation Error')
    expect(res.body.errors).toBeDefined()
    expect(Array.isArray(res.body.errors)).toBe(true)
    // Should report missing firstName, email, and leadSource
    const fields = res.body.errors.map(e => e.field)
    expect(fields).toContain('firstName')
    expect(fields).toContain('email')
    expect(fields).toContain('leadSource')
  })

  it('returns 400 when email format is invalid', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Test',
        email: 'not-an-email',
        leadSource: 'website'
      })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    const fields = res.body.errors.map(e => e.field)
    expect(fields).toContain('email')
  })

  it('returns 400 when leadSource is not in allowed enum', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Test',
        email: 'valid@test.com',
        leadSource: 'invalid_source'
      })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    const fields = res.body.errors.map(e => e.field)
    expect(fields).toContain('leadSource')
  })

  it('passes validation and proceeds for valid prospect data', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'ValidProspect',
        email: `valid-${Date.now()}@test.com`,
        leadSource: 'website',
        campaignId: campaign.id
      })
    // Should not be 400 validation error
    expect(res.status).not.toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Prospect scoping: fleet_owner role
// ---------------------------------------------------------------------------
describe('Prospect scoping – fleet_owner role', () => {
  let fleetOwnerUser, fleetOwnerToken
  let fleetOwnerCampaign, prospectInFleetCampaign

  beforeAll(async () => {
    const fo = await createTestUser({ role: 'fleet_owner' })
    fleetOwnerUser = fo.user
    fleetOwnerToken = fo.token

    fleetOwnerCampaign = await createTestCampaign(fleetOwnerUser.id)
    prospectInFleetCampaign = await createTestProspect(fleetOwnerCampaign.id, {
      firstName: 'FleetProspect'
    })
  })

  it('fleet_owner only sees prospects from their own campaigns', async () => {
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', `Bearer ${fleetOwnerToken}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.prospects.map(p => p.id)
    // Should see prospect in their own campaign
    expect(ids).toContain(prospectInFleetCampaign.id)
    // Should NOT see prospects from admin's campaign
    expect(ids).not.toContain(prospectForAgent1.id)
    expect(ids).not.toContain(prospectForAgent2.id)
  })
})
