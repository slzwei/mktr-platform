import request from 'supertest'
import express from 'express'
import { init } from '../src/server_internal.js'
import { sequelize } from '../src/database/connection.js'

let expressApp

beforeAll(async () => {
  expressApp = express()
  await init(expressApp)
}, 15000)

afterAll(async () => {
  await sequelize.close()
})

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
})
