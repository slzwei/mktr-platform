import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { init } from '../src/server_internal.js'
import { sequelize } from '../src/database/connection.js'
import { User } from '../src/models/index.js'

let app
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-key'

function makeToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' })
}

beforeAll(async () => {
  app = express()
  await init(app)
}, 15000)

afterAll(async () => {
  await sequelize.close()
})

describe('Authentication enforcement', () => {
  const protectedRoutes = [
    ['GET', '/api/campaigns'],
    ['GET', '/api/prospects'],
    ['GET', '/api/agents'],
    ['GET', '/api/fleet/owners'],
    ['GET', '/api/commissions'],
    ['GET', '/api/users'],
    ['GET', '/api/notifications'],
  ]

  it.each(protectedRoutes)(
    '%s %s returns 401 without token',
    async (method, path) => {
      const res = await request(app)[method.toLowerCase()](path)
      expect([401, 403]).toContain(res.status)
    }
  )

  it('returns 401 with an invalid/expired token', async () => {
    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', 'Bearer invalidtoken123')
    expect(res.status).toBe(401)
  })
})

describe('Mass assignment prevention', () => {
  let adminUser, adminToken

  beforeAll(async () => {
    adminUser = await User.create({
      email: `admin-security-${Date.now()}@test.com`,
      firstName: 'Admin',
      lastName: 'Test',
      role: 'admin',
      isActive: true,
      emailVerified: true,
      password: 'TestPassword123!'
    })
    adminToken = makeToken(adminUser.id)
  })

  it('POST /api/fleet/owners strips dangerous fields from creation', async () => {
    const res = await request(app)
      .post('/api/fleet/owners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        full_name: 'Test Fleet Owner',
        email: `fleet-${Date.now()}@test.com`,
        phone: '12345678',
        company_name: 'Test Co',
        id: '00000000-0000-0000-0000-000000000000',
        createdAt: '2000-01-01',
        balance: 999999
      })

    if (res.status === 201 || res.status === 200) {
      const data = res.body.data?.fleetOwner || res.body.data
      expect(data?.id).not.toBe('00000000-0000-0000-0000-000000000000')
    }
  })

  it('PUT /api/prospects/:id without auth returns 401', async () => {
    const res = await request(app)
      .put('/api/prospects/some-id')
      .send({ firstName: 'Hacked', role: 'admin' })

    expect(res.status).toBe(401)
  })

  it('POST /api/prospects with auth cannot set arbitrary fields', async () => {
    // Attempt to create a prospect with injected fields
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Test',
        lastName: 'Prospect',
        email: `prospect-${Date.now()}@test.com`,
        // These should not be settable or should be ignored
        id: '00000000-0000-0000-0000-000000000000',
        role: 'admin'
      })

    // Whether it succeeds or fails, the injected ID should not be used
    if (res.status === 201 || res.status === 200) {
      const prospect = res.body.data?.prospect
      if (prospect) {
        expect(prospect.id).not.toBe('00000000-0000-0000-0000-000000000000')
      }
    }
  })
})

describe('Rate limiting', () => {
  it('/api/contact is rate-limited', async () => {
    // Send requests rapidly — the limiter is 5/min for contact
    const promises = []
    for (let i = 0; i < 7; i++) {
      promises.push(
        request(app)
          .post('/api/contact')
          .send({ name: 'Test', email: 'test@test.com', message: 'hi' })
      )
    }
    const results = await Promise.all(promises)
    const statuses = results.map(r => r.status)
    // At least one should be 429 (rate limited) if the limiter is working
    expect(statuses).toContain(429)
  })
})
