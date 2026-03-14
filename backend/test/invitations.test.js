import './setup.js'
import request from 'supertest'
import { getApp, closeDb, createTestUser } from './helpers.js'

let app, adminUser, adminToken, agentToken

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminUser = admin.user; adminToken = admin.token
  const agent = await createTestUser({ role: 'agent' })
  agentToken = agent.token
}, 15000)

afterAll(async () => {
  await closeDb()
})

// ---- POST /api/users/invite (Admin only) ----
describe('POST /api/users/invite', () => {
  it('admin invites an agent by email', async () => {
    const email = `invite-agent-${Date.now()}@test.com`
    const res = await request(app)
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, full_name: 'Invited Agent', role: 'agent' })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.user).toBeDefined()
    expect(res.body.data.user.email).toBe(email)
    expect(res.body.data.user.firstName).toBe('Invited')
    expect(res.body.data.user.lastName).toBe('Agent')
    expect(res.body.data.user.role).toBe('agent')
    expect(res.body.data.inviteLink).toBeDefined()
    expect(res.body.data.inviteLink).toContain('token=')
  })

  it('admin invites a fleet owner', async () => {
    const email = `invite-fleet-${Date.now()}@test.com`
    const res = await request(app)
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, full_name: 'Fleet Manager', role: 'fleet_owner' })

    expect(res.status).toBe(201)
    expect(res.body.data.user.role).toBe('fleet_owner')
    expect(res.body.message).toMatch(/Fleet Owner invited/i)
  })

  it('admin invites a driver partner', async () => {
    const email = `invite-driver-${Date.now()}@test.com`
    const res = await request(app)
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, full_name: 'Driver One', role: 'driver_partner' })

    expect(res.status).toBe(201)
    expect(res.body.data.user.role).toBe('driver_partner')
    expect(res.body.message).toMatch(/Driver Partner invited/i)
  })

  // ---- Validation ----
  it('missing email returns 400', async () => {
    const res = await request(app)
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ full_name: 'No Email', role: 'agent' })

    expect(res.status).toBe(400)
  })

  it('missing full_name returns 400', async () => {
    const res = await request(app)
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: `missing-name-${Date.now()}@test.com`, role: 'agent' })

    expect(res.status).toBe(400)
  })

  it('missing role returns 400', async () => {
    const res = await request(app)
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: `no-role-${Date.now()}@test.com`, full_name: 'No Role' })

    expect(res.status).toBe(400)
  })

  it('invalid role returns 400', async () => {
    const res = await request(app)
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: `bad-role-${Date.now()}@test.com`, full_name: 'Bad Role', role: 'superadmin' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Invalid role/i)
  })

  // ---- Duplicate invitation handling ----
  it('duplicate email returns 400', async () => {
    const email = `dup-invite-${Date.now()}@test.com`

    // First invite succeeds
    const first = await request(app)
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, full_name: 'First Invite', role: 'agent' })
    expect(first.status).toBe(201)

    // Second invite with same email fails
    const second = await request(app)
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, full_name: 'Second Invite', role: 'agent' })

    expect(second.status).toBe(400)
    expect(second.body.message).toMatch(/already exists/i)
  })

  // ---- Self-invite prevention ----
  it('admin cannot invite their own email', async () => {
    const res = await request(app)
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: adminUser.email, full_name: 'Self Invite', role: 'agent' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/own email/i)
  })

  // ---- Authorization ----
  it('non-admin cannot invite (agent gets 403)', async () => {
    const res = await request(app)
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ email: `agent-invite-${Date.now()}@test.com`, full_name: 'Blocked', role: 'agent' })

    expect(res.status).toBe(403)
  })

  it('unauthenticated request returns 401', async () => {
    const res = await request(app)
      .post('/api/users/invite')
      .send({ email: `noauth-${Date.now()}@test.com`, full_name: 'Unauthed', role: 'agent' })

    expect(res.status).toBe(401)
  })
})
