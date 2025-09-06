import request from 'supertest'
import { app as expressApp } from '../src/server.js'

describe('Backend routing/auth smoke tests', () => {
  it('health check should return OK', async () => {
    const res = await request(expressApp).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('OK')
  })

  it('auth config should indicate googleClientId presence flag (no secret exposed)', async () => {
    const res = await request(expressApp).get('/api/auth/google/config')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(typeof res.body.data.googleClientId).toBe('boolean')
  })

  it('protected resource without token returns 401', async () => {
    const res = await request(expressApp).get('/api/campaigns')
    expect([401, 403]).toContain(res.status)
  })

  it('legacy leadgen guard returns 410 when disabled', async () => {
    const prev = process.env.ENABLE_LEGACY_LEADGEN
    process.env.ENABLE_LEGACY_LEADGEN = 'false'
    // Reload server app with flag off (import cycle guards prevent double-start)
    const { app } = await import('../src/server.js')
    const res = await request(app).get('/api/qrcodes')
    expect(res.status).toBe(410)
    expect(res.body?.message).toMatch(/Use \/api\/leadgen\/*/)
    process.env.ENABLE_LEGACY_LEADGEN = prev
  })
})


