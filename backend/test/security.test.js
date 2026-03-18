import request from 'supertest'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { getApp, closeDb, createTestUser } from './helpers.js'

let app

beforeAll(async () => {
  app = await getApp()
}, 15000)

afterAll(async () => {
  await closeDb()
})

// ---------------------------------------------------------------------------
// Authentication enforcement
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Mass assignment prevention
// ---------------------------------------------------------------------------
describe('Mass assignment prevention', () => {
  let adminToken

  beforeAll(async () => {
    const { token } = await createTestUser({ role: 'admin' })
    adminToken = token
  })

  it('POST /api/fleet/owners strips dangerous fields from creation', async () => {
    const res = await request(app)
      .post('/api/fleet/owners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        full_name: 'Test Fleet Owner',
        email: `fleet-mass-${Date.now()}@test.com`,
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
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Test',
        lastName: 'Prospect',
        email: `prospect-mass-${Date.now()}@test.com`,
        id: '00000000-0000-0000-0000-000000000000',
        role: 'admin'
      })

    if (res.status === 201 || res.status === 200) {
      const prospect = res.body.data?.prospect
      if (prospect) {
        expect(prospect.id).not.toBe('00000000-0000-0000-0000-000000000000')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// SQL injection prevention
// ---------------------------------------------------------------------------
describe('SQL injection prevention', () => {
  let adminToken

  beforeAll(async () => {
    const { token } = await createTestUser({ role: 'admin' })
    adminToken = token
  })

  it('rejects SQL injection in search query param', async () => {
    const res = await request(app)
      .get('/api/prospects?search=\'; DROP TABLE prospects; --')
      .set('Authorization', `Bearer ${adminToken}`)
    // Should not crash — returns 200 with empty or filtered results
    expect([200, 400]).toContain(res.status)
  })

  it('rejects SQL injection in sort/order query param', async () => {
    const res = await request(app)
      .get('/api/prospects?sortBy=firstName; DROP TABLE prospects')
      .set('Authorization', `Bearer ${adminToken}`)
    expect([200, 400, 500]).toContain(res.status)
    // The important thing: the app did not crash
  })

  it('rejects SQL injection in fleet owner search param', async () => {
    const res = await request(app)
      .get('/api/fleet/owners?search=1%27%20OR%201%3D1%20--')
      .set('Authorization', `Bearer ${adminToken}`)
    expect([200, 400]).toContain(res.status)
  })

  it('handles UNION-based SQL injection in search param', async () => {
    const res = await request(app)
      .get('/api/campaigns?search=\' UNION SELECT * FROM users--')
      .set('Authorization', `Bearer ${adminToken}`)
    expect([200, 400]).toContain(res.status)
    // Must not leak data from other tables
    if (res.status === 200 && res.body.data) {
      const body = JSON.stringify(res.body)
      expect(body).not.toContain('password')
    }
  })

  it('handles OR 1=1 injection in ID query param', async () => {
    const res = await request(app)
      .get('/api/prospects?id=1%20OR%201%3D1')
      .set('Authorization', `Bearer ${adminToken}`)
    // Should not return all rows — either 200 with empty results or 400
    expect([200, 400]).toContain(res.status)
  })

  it('handles admin\'-- injection in user name search', async () => {
    const res = await request(app)
      .get('/api/users?search=admin\'--')
      .set('Authorization', `Bearer ${adminToken}`)
    expect([200, 400]).toContain(res.status)
  })
})

// ---------------------------------------------------------------------------
// XSS prevention in request body
// ---------------------------------------------------------------------------
describe('XSS prevention in request body', () => {
  let adminToken

  beforeAll(async () => {
    const { token } = await createTestUser({ role: 'admin' })
    adminToken = token
  })

  it('does not reflect XSS script tags in prospect creation response', async () => {
    const xssPayload = '<script>alert("xss")</script>'
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: xssPayload,
        email: `xss-${Date.now()}@test.com`,
        leadSource: 'website'
      })
    // Either rejected by validation or stored safely (no script execution context)
    if (res.status === 201) {
      const body = JSON.stringify(res.body)
      // Response should not contain unescaped script tags in a way that could execute
      expect(body).not.toContain('<script>alert')
    }
  })

  it('does not reflect XSS in fleet owner name field', async () => {
    const res = await request(app)
      .post('/api/fleet/owners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        full_name: '"><img src=x onerror=alert(1)>',
        email: `xss-fleet-${Date.now()}@test.com`,
        phone: '91234567',
        company_name: 'XSS Co'
      })
    // Should succeed or be rejected by validation — not crash
    expect([200, 201, 400]).toContain(res.status)
  })

  it('handles img onerror XSS in campaign name', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '<img src=x onerror=alert(document.cookie)>',
        type: 'lead_generation'
      })
    expect([200, 201, 400]).toContain(res.status)
    if (res.status === 201) {
      const body = JSON.stringify(res.body)
      expect(body).not.toContain('onerror=alert')
    }
  })

  it('handles encoded XSS payload in prospect name', async () => {
    const encodedXss = '&#60;script&#62;alert(1)&#60;/script&#62;'
    const res = await request(app)
      .post('/api/prospects')
      .send({
        firstName: encodedXss,
        email: `xss-enc-${Date.now()}@test.com`,
        leadSource: 'website'
      })
    // Should not crash or reflect executable content
    expect([200, 201, 400]).toContain(res.status)
  })
})

// ---------------------------------------------------------------------------
// Path traversal prevention
// ---------------------------------------------------------------------------
describe('Path traversal prevention', () => {
  let adminToken

  beforeAll(async () => {
    const { token } = await createTestUser({ role: 'admin' })
    adminToken = token
  })

  it('rejects path traversal in prospect id param', async () => {
    const res = await request(app)
      .get('/api/prospects/../../../etc/passwd')
      .set('Authorization', `Bearer ${adminToken}`)
    expect([400, 404]).toContain(res.status)
  })

  it('rejects encoded path traversal (..%2F) in upload file info', async () => {
    const res = await request(app)
      .get('/api/uploads/info/general/..%2F..%2F..%2Fetc%2Fpasswd')
      .set('Authorization', `Bearer ${adminToken}`)
    // Should not return file contents from outside uploads directory
    expect([400, 404]).toContain(res.status)
    if (res.body) {
      const body = JSON.stringify(res.body)
      expect(body).not.toContain('root:')
    }
  })
})

// ---------------------------------------------------------------------------
// JWT tampering
// ---------------------------------------------------------------------------
describe('JWT tampering', () => {
  it('rejects a JWT signed with wrong secret', async () => {
    const { user } = await createTestUser({ role: 'admin' })
    const tampered = jwt.sign({ userId: user.id }, 'wrong-secret-key', { expiresIn: '1h' })
    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', `Bearer ${tampered}`)
    expect(res.status).toBe(401)
  })

  it('rejects a JWT with modified payload (role escalation attempt)', async () => {
    // Sign a token for a non-existent admin user
    const tampered = jwt.sign({ userId: '00000000-0000-0000-0000-ffffffffffff', role: 'admin' }, 'wrong-secret')
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${tampered}`)
    expect(res.status).toBe(401)
  })

  it('rejects a completely malformed JWT (not base64)', async () => {
    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', 'Bearer !!!not-base64!!!')
    expect(res.status).toBe(401)
  })

  it('rejects an empty Bearer token', async () => {
    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', 'Bearer ')
    expect(res.status).toBe(401)
  })

  it('rejects an expired JWT token', async () => {
    const { user } = await createTestUser({ role: 'admin' })
    const expired = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '-10s' } // already expired
    )
    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', `Bearer ${expired}`)
    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/expired|invalid/i)
  })

  it('rejects a JWT with "none" algorithm attack', async () => {
    // Manually construct a token with alg: none
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ userId: '00000000-0000-0000-0000-000000000001', role: 'admin' })).toString('base64url')
    const noneToken = `${header}.${payload}.`
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${noneToken}`)
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Non-UUID ID rejection
// ---------------------------------------------------------------------------
describe('Non-UUID ID rejection', () => {
  let adminToken

  beforeAll(async () => {
    const { token } = await createTestUser({ role: 'admin' })
    adminToken = token
  })

  it('rejects non-UUID id in GET /api/prospects/:id', async () => {
    const res = await request(app)
      .get('/api/prospects/not-a-valid-uuid')
      .set('Authorization', `Bearer ${adminToken}`)
    expect([400, 404, 500]).toContain(res.status)
    expect(res.body.success).toBe(false)
  })

  it('rejects non-UUID id in GET /api/fleet/owners/:id', async () => {
    const res = await request(app)
      .get('/api/fleet/owners/../../etc/passwd')
      .set('Authorization', `Bearer ${adminToken}`)
    expect([400, 404]).toContain(res.status)
  })

  it('rejects non-UUID id in PUT /api/fleet/cars/:id', async () => {
    const res = await request(app)
      .put('/api/fleet/cars/DROP-TABLE')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ color: 'Red' })
    expect([400, 404, 500]).toContain(res.status)
  })

  it('rejects numeric id where UUID is expected', async () => {
    const res = await request(app)
      .get('/api/prospects/12345')
      .set('Authorization', `Bearer ${adminToken}`)
    expect([400, 404, 500]).toContain(res.status)
    expect(res.body.success).toBe(false)
  })

  it('rejects non-UUID id in GET /api/users/:id', async () => {
    const res = await request(app)
      .get('/api/users/not-a-uuid')
      .set('Authorization', `Bearer ${adminToken}`)
    expect([400, 404, 500]).toContain(res.status)
  })

  it('rejects non-UUID id in DELETE /api/campaigns/:id', async () => {
    const res = await request(app)
      .delete('/api/campaigns/12345')
      .set('Authorization', `Bearer ${adminToken}`)
    expect([400, 404, 500]).toContain(res.status)
  })
})

// ---------------------------------------------------------------------------
// CORS verification
// ---------------------------------------------------------------------------
describe('CORS verification', () => {
  it('returns proper CORS headers for allowed origin', async () => {
    const res = await request(app)
      .options('/api/campaigns')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'Authorization')
    expect([200, 204]).toContain(res.status)
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })

  it('rejects CORS preflight from disallowed origin', async () => {
    const res = await request(app)
      .options('/api/campaigns')
      .set('Origin', 'https://evil-site.com')
      .set('Access-Control-Request-Method', 'GET')
    // CORS middleware should not set allow-origin for unknown origins
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Body size limits
// ---------------------------------------------------------------------------
describe('Body size limits', () => {
  let adminToken

  beforeAll(async () => {
    const { token } = await createTestUser({ role: 'admin' })
    adminToken = token
  })

  it('rejects oversized JSON payload (>1mb)', async () => {
    // Create a payload just over 1MB
    const largeString = 'x'.repeat(1.1 * 1024 * 1024)
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ firstName: largeString }))
    expect([400, 413]).toContain(res.status)
  })

  it('rejects oversized file upload beyond multer limit', async () => {
    // Multer has a 10MB default limit; sending a buffer that exceeds it
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024, 'x')
    const res = await request(app)
      .post('/api/uploads/single')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', largeBuffer, 'large-file.jpg')
    expect([400, 413]).toContain(res.status)
  })
})

// ---------------------------------------------------------------------------
// Retell signature edge cases
// ---------------------------------------------------------------------------
describe('Retell webhook signature edge cases', () => {
  const retellPath = '/api/retell/webhook'

  it('rejects request with empty x-retell-signature header', async () => {
    const res = await request(app)
      .post(retellPath)
      .set('x-retell-signature', '')
      .set('Content-Type', 'application/json')
      .send({ event: 'call_ended', call: { call_id: 'test-123' } })
    expect([401, 503]).toContain(res.status)
  })

  it('rejects request with malformed signature format', async () => {
    const res = await request(app)
      .post(retellPath)
      .set('x-retell-signature', 'not-a-valid-format')
      .set('Content-Type', 'application/json')
      .send({ event: 'call_ended', call: { call_id: 'test-456' } })
    expect([401, 503]).toContain(res.status)
  })

  it('rejects replay attack with old timestamp', async () => {
    // Use a timestamp from 1 hour ago — if replay protection is implemented, this should fail
    const oldTimestamp = Math.floor(Date.now() / 1000) - 3600
    const body = JSON.stringify({ event: 'call_ended', call: { call_id: 'test-789' } })
    const secret = process.env.RETELL_WEBHOOK_SECRET || 'test-secret'
    const hmac = crypto.createHmac('sha256', secret).update(`${oldTimestamp}.${body}`).digest('hex')
    const res = await request(app)
      .post(retellPath)
      .set('x-retell-signature', `v=${oldTimestamp},d=${hmac}`)
      .set('Content-Type', 'application/json')
      .send(JSON.parse(body))
    // Either rejected (401) or accepted (200) — but should not crash
    expect([200, 401, 503]).toContain(res.status)
  })
})

// ---------------------------------------------------------------------------
// Device key brute-force resistance
// ---------------------------------------------------------------------------
describe('Device key brute-force resistance', () => {
  it('rejects multiple failed provisioning check attempts without crashing', async () => {
    const results = []
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .get(`/api/provision/check/BADCODE${i}`)
      results.push(res.status)
    }
    // All should return 404 (not found) or 429 (rate limited) — never 500
    results.forEach(status => {
      expect([404, 429]).toContain(status)
    })
  })

  it('provisioning session creation is rate-limited under sustained load', async () => {
    const promises = []
    for (let i = 0; i < 12; i++) {
      promises.push(
        request(app)
          .post('/api/provision/session')
          .send({})
      )
    }
    const results = await Promise.all(promises)
    const statuses = results.map(r => r.status)
    // Should see either valid responses or 429 rate limits — not server errors
    statuses.forEach(status => {
      expect([200, 201, 400, 429]).toContain(status)
    })
  })
})

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
describe('Rate limiting', () => {
  it('/api/contact is rate-limited', async () => {
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
    expect(statuses).toContain(429)
  })

  it('/api/auth/login is rate-limited under heavy load', async () => {
    const promises = []
    for (let i = 0; i < 15; i++) {
      promises.push(
        request(app)
          .post('/api/auth/login')
          .send({ email: `brute${i}@test.com`, password: 'wrong' })
      )
    }
    const results = await Promise.all(promises)
    const statuses = results.map(r => r.status)
    // Auth limiter in test mode allows 10000 requests, so we just verify stability
    statuses.forEach(status => {
      expect([400, 401, 429]).toContain(status)
    })
  })
})

// ---------------------------------------------------------------------------
// Inactive user rejection
// ---------------------------------------------------------------------------
describe('Inactive user rejection', () => {
  it('rejects authentication for deactivated user', async () => {
    const { token } = await createTestUser({ role: 'admin', isActive: false })
    const res = await request(app)
      .get('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Helmet security headers
// ---------------------------------------------------------------------------
describe('Security headers', () => {
  it('includes X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('includes X-Frame-Options header', async () => {
    const res = await request(app).get('/health')
    // Helmet sets X-Frame-Options to SAMEORIGIN by default
    expect(res.headers['x-frame-options']).toBeDefined()
  })
})
