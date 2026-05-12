import './setup.js'
import request from 'supertest'
import { getApp, closeDb, createTestUser } from './helpers.js'

let app

beforeAll(async () => {
  app = await getApp()
}, 15000)

afterAll(async () => {
  await closeDb()
})

describe('Auth Routes', () => {
  // ---- POST /api/auth/register ----
  describe('POST /api/auth/register', () => {
    it('creates a new user and sets the auth cookie (no body token — audit 2.9)', async () => {
      const email = `register-${Date.now()}@test.com`
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email,
          password: 'Password123!',
          firstName: 'New',
          lastName: 'User'
        })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data.user).toBeDefined()
      expect(res.body.data.user.email).toBe(email)
      // Password must not be returned
      expect(res.body.data.user.password).toBeUndefined()
      // Token is now cookie-only (audit 2.9). Body must NOT contain it.
      expect(res.body.data.token).toBeUndefined()
      const setCookie = res.headers['set-cookie'] || []
      expect(setCookie.some((c) => /^mktr_token=/.test(c))).toBe(true)
      expect(setCookie.some((c) => /HttpOnly/i.test(c))).toBe(true)
    })

    it('returns 400 for duplicate email', async () => {
      const email = `dup-${Date.now()}@test.com`
      // First registration should succeed
      await request(app)
        .post('/api/auth/register')
        .send({
          email,
          password: 'Password123!',
          firstName: 'First',
          lastName: 'User'
        })

      // Second registration with same email should fail
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email,
          password: 'Password456!',
          firstName: 'Second',
          lastName: 'User'
        })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toMatch(/already exists/i)
    })

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: `missing-${Date.now()}@test.com`
          // no password, no name
        })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })

    it('returns 400 when password is too short', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: `short-pw-${Date.now()}@test.com`,
          password: '12345',
          firstName: 'Short',
          lastName: 'Pass'
        })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })
  })

  // ---- POST /api/auth/login ----
  describe('POST /api/auth/login', () => {
    const loginEmail = `login-${Date.now()}@test.com`
    const loginPassword = 'LoginPass123!'

    beforeAll(async () => {
      // Register user to login with
      await request(app)
        .post('/api/auth/register')
        .send({
          email: loginEmail,
          password: loginPassword,
          firstName: 'Login',
          lastName: 'Tester'
        })
    })

    it('sets the auth cookie on valid credentials (no body token — audit 2.9)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: loginEmail, password: loginPassword })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.user).toBeDefined()
      expect(res.body.data.user.email).toBe(loginEmail)
      // Token is now cookie-only (audit 2.9). Body must NOT contain it.
      expect(res.body.data.token).toBeUndefined()
      const setCookie = res.headers['set-cookie'] || []
      expect(setCookie.some((c) => /^mktr_token=/.test(c))).toBe(true)
      expect(setCookie.some((c) => /HttpOnly/i.test(c))).toBe(true)
    })

    it('returns 401 for wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: loginEmail, password: 'WrongPassword!' })

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toMatch(/invalid/i)
    })

    it('returns 401 for non-existent email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: `no-such-user-${Date.now()}@test.com`, password: 'SomePass123!' })

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toMatch(/invalid/i)
    })
  })

  // ---- GET /api/auth/profile ----
  describe('GET /api/auth/profile', () => {
    it('returns user profile with valid token', async () => {
      const { user, token } = await createTestUser({ role: 'customer' })

      const res = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.user).toBeDefined()
      expect(res.body.data.user.id).toBe(user.id)
    })

    it('returns 401 without token', async () => {
      const res = await request(app)
        .get('/api/auth/profile')

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
    })

    it('returns 401 with invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', 'Bearer totally-invalid-jwt')

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
    })
  })
})
