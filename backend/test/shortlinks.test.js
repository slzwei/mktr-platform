import './setup.js'
import request from 'supertest'
import { getApp, closeDb, createTestUser } from './helpers.js'

let app, adminToken, adminUser, agentToken

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

// ---- POST /api/shortlinks (admin-only) ----
describe('POST /api/shortlinks', () => {
  it('admin creates a short link with targetUrl', async () => {
    const res = await request(app)
      .post('/api/shortlinks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ targetUrl: 'https://example.com/LeadCapture?c=test' })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.slug).toBeDefined()
    expect(typeof res.body.data.slug).toBe('string')
    expect(res.body.data.slug.length).toBe(8)
    expect(res.body.data.url).toContain('/share/')
  })

  it('admin creates short link with custom purpose and ttlDays', async () => {
    const res = await request(app)
      .post('/api/shortlinks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ targetUrl: 'https://example.com/page', purpose: 'promo', ttlDays: 30 })

    expect(res.status).toBe(201)
    expect(res.body.data.link).toBeDefined()
    expect(res.body.data.link.purpose).toBe('promo')
  })

  it('validation: missing targetUrl returns 400', async () => {
    const res = await request(app)
      .post('/api/shortlinks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})

    expect(res.status).toBe(400)
  })

  it('validation: non-string targetUrl returns 400', async () => {
    const res = await request(app)
      .post('/api/shortlinks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ targetUrl: 12345 })

    expect(res.status).toBe(400)
  })

  it('agent cannot create short link (admin-only)', async () => {
    const res = await request(app)
      .post('/api/shortlinks')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ targetUrl: 'https://example.com/page' })

    expect(res.status).toBe(403)
  })

  it('unauthenticated request returns 401', async () => {
    const res = await request(app)
      .post('/api/shortlinks')
      .send({ targetUrl: 'https://example.com/page' })

    expect(res.status).toBe(401)
  })
})

// ---- POST /api/shortlinks/public/share (public, rate-limited) ----
describe('POST /api/shortlinks/public/share', () => {
  it('creates a share link for a LeadCapture URL', async () => {
    const res = await request(app)
      .post('/api/shortlinks/public/share')
      .send({ targetUrl: 'https://app.example.com/LeadCapture?c=abc123' })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.slug).toBeDefined()
    expect(res.body.data.slug.length).toBe(8)
  })

  it('rejects non-lead-capture URL', async () => {
    const res = await request(app)
      .post('/api/shortlinks/public/share')
      .send({ targetUrl: 'https://evil.com/phishing' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/lead capture/i)
  })

  it('rejects missing targetUrl', async () => {
    const res = await request(app)
      .post('/api/shortlinks/public/share')
      .send({})

    expect(res.status).toBe(400)
  })
})

// ---- GET /api/shortlinks (admin list) ----
describe('GET /api/shortlinks', () => {
  it('admin lists short links', async () => {
    // Ensure at least one link exists
    await request(app)
      .post('/api/shortlinks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ targetUrl: 'https://example.com/list-test' })

    const res = await request(app)
      .get('/api/shortlinks')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.items).toBeDefined()
    expect(Array.isArray(res.body.data.items)).toBe(true)
    expect(res.body.data.total).toBeGreaterThanOrEqual(1)
  })

  it('supports pagination parameters', async () => {
    const res = await request(app)
      .get('/api/shortlinks?page=1&limit=2')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.items.length).toBeLessThanOrEqual(2)
  })

  it('agent cannot list short links (admin-only)', async () => {
    const res = await request(app)
      .get('/api/shortlinks')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(403)
  })

  it('unauthenticated request returns 401', async () => {
    const res = await request(app)
      .get('/api/shortlinks')

    expect(res.status).toBe(401)
  })
})

// ---- PATCH /api/shortlinks/:id (admin update) ----
describe('PATCH /api/shortlinks/:id', () => {
  let createdLinkId

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/shortlinks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ targetUrl: 'https://example.com/update-test' })
    createdLinkId = res.body.data.link.id
  })

  it('admin updates expiresAt on a short link', async () => {
    const newExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    const res = await request(app)
      .patch(`/api/shortlinks/${createdLinkId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ expiresAt: newExpiry })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.link).toBeDefined()
  })

  it('returns 404 for non-existent link', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000'
    const res = await request(app)
      .patch(`/api/shortlinks/${fakeId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ expiresAt: new Date().toISOString() })

    expect(res.status).toBe(404)
  })

  it('agent cannot update short link (admin-only)', async () => {
    const res = await request(app)
      .patch(`/api/shortlinks/${createdLinkId}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ expiresAt: new Date().toISOString() })

    expect(res.status).toBe(403)
  })
})

// ---- GET /api/shortlinks/:id/clicks (admin stats) ----
describe('GET /api/shortlinks/:id/clicks', () => {
  let linkId

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/shortlinks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ targetUrl: 'https://example.com/clicks-test' })
    linkId = res.body.data.link.id
  })

  it('admin retrieves click data for a short link', async () => {
    const res = await request(app)
      .get(`/api/shortlinks/${linkId}/clicks`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.clicks).toBeDefined()
    expect(Array.isArray(res.body.data.clicks)).toBe(true)
  })

  it('agent cannot access click data (admin-only)', async () => {
    const res = await request(app)
      .get(`/api/shortlinks/${linkId}/clicks`)
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(403)
  })
})

// ---- DELETE /api/shortlinks/:id ----
describe('DELETE /api/shortlinks/:id', () => {
  it('admin deletes a short link', async () => {
    // Create a link to delete
    const create = await request(app)
      .post('/api/shortlinks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ targetUrl: 'https://example.com/delete-me' })
    const linkId = create.body.data.link.id

    const res = await request(app)
      .delete(`/api/shortlinks/${linkId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    // Verify it is gone
    const verify = await request(app)
      .get(`/api/shortlinks/${linkId}/clicks`)
      .set('Authorization', `Bearer ${adminToken}`)

    // After deletion, clicks endpoint returns empty array (link gone)
    expect(verify.status).toBe(200)
  })

  it('returns 404 when deleting non-existent link', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000'
    const res = await request(app)
      .delete(`/api/shortlinks/${fakeId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })

  it('agent cannot delete short link (admin-only)', async () => {
    const create = await request(app)
      .post('/api/shortlinks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ targetUrl: 'https://example.com/no-agent-delete' })
    const linkId = create.body.data.link.id

    const res = await request(app)
      .delete(`/api/shortlinks/${linkId}`)
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(403)
  })
})

// ---- GET /share/:slug (public redirect) ----
describe('GET /share/:slug (public redirect)', () => {
  it('redirects to targetUrl for valid slug', async () => {
    const create = await request(app)
      .post('/api/shortlinks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ targetUrl: 'https://example.com/destination' })
    const slug = create.body.data.slug

    const res = await request(app)
      .get(`/share/${slug}`)
      .redirects(0) // do not follow redirect

    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://example.com/destination')
  })

  it('redirects to error page for non-existent slug', async () => {
    const res = await request(app)
      .get('/share/does_not_exist_xyz')
      .redirects(0)

    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('error=not_found')
  })
})
