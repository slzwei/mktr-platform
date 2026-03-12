import request from 'supertest'
import { getApp, closeDb } from './helpers.js'

let app

beforeAll(async () => {
  app = await getApp()
}, 15000)

afterAll(async () => {
  await closeDb()
})

describe('Backend routing/auth smoke tests', () => {
  it('health check should return OK', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('OK')
  })

  it('auth config should indicate googleClientId presence flag (no secret exposed)', async () => {
    const res = await request(app).get('/api/auth/google/config')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(typeof res.body.data.googleClientId).toBe('boolean')
  })

  it('protected resource without token returns 401', async () => {
    const res = await request(app).get('/api/campaigns')
    expect([401, 403]).toContain(res.status)
  })
})
