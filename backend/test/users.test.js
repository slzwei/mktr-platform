import './setup.js'
import request from 'supertest'
import { getApp, closeDb, createTestUser } from './helpers.js'

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

describe('User Management Routes', () => {
  // ---- GET /api/users (list) ----
  describe('GET /api/users', () => {
    it('admin lists all users', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.users).toBeDefined()
      expect(Array.isArray(res.body.data.users)).toBe(true)
      expect(res.body.data.pagination).toBeDefined()
      expect(res.body.data.pagination.totalItems).toBeGreaterThanOrEqual(2) // admin + agent at minimum
    })

    it('agent gets 403', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${agentToken}`)

      expect(res.status).toBe(403)
      expect(res.body.success).toBe(false)
    })

    it('unauthenticated request returns 401', async () => {
      const res = await request(app)
        .get('/api/users')

      expect(res.status).toBe(401)
    })

    it('admin filters users by role', async () => {
      const res = await request(app)
        .get('/api/users?role=agent')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      const users = res.body.data.users
      expect(users.length).toBeGreaterThanOrEqual(1)
      // Every returned user must have the 'agent' role
      users.forEach(u => {
        expect(u.role).toBe('agent')
      })
    })
  })

  // ---- GET /api/users/:id ----
  describe('GET /api/users/:id', () => {
    it('admin gets specific user by ID', async () => {
      const res = await request(app)
        .get(`/api/users/${agentUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.user).toBeDefined()
      expect(res.body.data.user.id).toBe(agentUser.id)
    })

    it('returns 404 for non-existent user', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'
      const res = await request(app)
        .get(`/api/users/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
    })

    it('agent can view their own profile', async () => {
      const res = await request(app)
        .get(`/api/users/${agentUser.id}`)
        .set('Authorization', `Bearer ${agentToken}`)

      expect(res.status).toBe(200)
      expect(res.body.data.user.id).toBe(agentUser.id)
    })
  })

  // ---- PUT /api/users/:id ----
  describe('PUT /api/users/:id', () => {
    it('admin updates user role', async () => {
      // Create a disposable user for this test
      const { user: target } = await createTestUser({ role: 'customer' })

      const res = await request(app)
        .put(`/api/users/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'agent' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.user.role).toBe('agent')
    })

    it('admin deactivates user', async () => {
      const { user: target } = await createTestUser({ role: 'customer' })

      const res = await request(app)
        .put(`/api/users/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.user.isActive).toBe(false)
    })

    it('non-admin cannot update another user role', async () => {
      const { user: target } = await createTestUser({ role: 'customer' })

      const res = await request(app)
        .put(`/api/users/${target.id}`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ role: 'admin' })

      expect(res.status).toBe(403)
      expect(res.body.success).toBe(false)
    })

    it('returns 404 when updating non-existent user', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'
      const res = await request(app)
        .put(`/api/users/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'Ghost' })

      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
    })
  })
})
