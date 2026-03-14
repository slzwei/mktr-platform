import './setup.js'
import crypto from 'crypto'
import request from 'supertest'
import { getApp, closeDb, createTestUser } from './helpers.js'
import { Device, ProvisioningSession } from '../src/models/index.js'
import { v4 as uuidv4 } from 'uuid'

let app, adminToken, agentToken

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminToken = admin.token
  const agent = await createTestUser({ role: 'agent' })
  agentToken = agent.token
}, 15000)

afterAll(async () => {
  await closeDb()
})

/** Helper: create a Device with a known key */
async function createDeviceWithKey(deviceKey) {
  const secretHash = crypto.createHash('sha256').update(deviceKey).digest('hex')
  return Device.create({
    secretHash,
    status: 'active',
    model: 'ProvisionTab'
  })
}

describe('Provisioning session creation', () => {
  it('POST /api/provision/session — creates a new session (no auth required)', async () => {
    const sessionCode = uuidv4()
    const res = await request(app)
      .post('/api/provision/session')
      .send({ sessionCode })

    // No Authorization header sent -- proves tablet endpoint needs no auth
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.expiresAt).toBeDefined()
  })

  it('POST /api/provision/session — requires sessionCode', async () => {
    const res = await request(app)
      .post('/api/provision/session')
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/sessionCode/i)
  })

  it('POST /api/provision/session — handles duplicate sessionCode gracefully', async () => {
    const sessionCode = uuidv4()

    // First creation
    await request(app)
      .post('/api/provision/session')
      .send({ sessionCode })

    // Duplicate
    const res = await request(app)
      .post('/api/provision/session')
      .send({ sessionCode })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

describe('Provisioning status check', () => {
  it('GET /api/provision/check/:code — returns pending (no auth required)', async () => {
    const sessionCode = uuidv4()
    // Create session directly to avoid burning rate limit quota
    await ProvisioningSession.create({
      sessionCode,
      status: 'pending',
      expiresAt: new Date(Date.now() + 3600000)
    })

    const res = await request(app)
      .get(`/api/provision/check/${sessionCode}`)

    // No Authorization header sent -- proves tablet endpoint needs no auth
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('pending')
  })

  it('GET /api/provision/check/:code — returns not_found for unknown code', async () => {
    const res = await request(app)
      .get(`/api/provision/check/${uuidv4()}`)

    expect(res.status).toBe(404)
    expect(res.body.status).toBe('not_found')
  })

  it('GET /api/provision/check/:code — returns expired for expired session', async () => {
    const sessionCode = uuidv4()
    await ProvisioningSession.create({
      sessionCode,
      status: 'pending',
      expiresAt: new Date(Date.now() - 60000)
    })

    const res = await request(app)
      .get(`/api/provision/check/${sessionCode}`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('expired')
  })

  it('GET /api/provision/check/:code — returns fulfilled with deviceKey', async () => {
    const sessionCode = uuidv4()
    const deviceKey = 'test-device-key-123'

    await ProvisioningSession.create({
      sessionCode,
      status: 'fulfilled',
      deviceKey,
      expiresAt: new Date(Date.now() + 3600000)
    })

    const res = await request(app)
      .get(`/api/provision/check/${sessionCode}`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('fulfilled')
    expect(res.body.deviceKey).toBe(deviceKey)
  })
})

describe('Provisioning fulfillment (admin)', () => {
  let sessionCode, deviceKey

  beforeEach(async () => {
    sessionCode = uuidv4()
    deviceKey = crypto.randomBytes(16).toString('hex')
    await createDeviceWithKey(deviceKey)

    await ProvisioningSession.create({
      sessionCode,
      status: 'pending',
      expiresAt: new Date(Date.now() + 3600000)
    })
  })

  it('POST /api/provision/fulfill — admin fulfills session with valid key', async () => {
    const res = await request(app)
      .post('/api/provision/fulfill')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sessionCode, deviceKey })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    // Verify session updated in DB
    const session = await ProvisioningSession.findOne({ where: { sessionCode } })
    expect(session.status).toBe('fulfilled')
    expect(session.deviceKey).toBe(deviceKey)
  })

  it('POST /api/provision/fulfill — requires sessionCode and deviceKey', async () => {
    const res1 = await request(app)
      .post('/api/provision/fulfill')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sessionCode })

    expect(res1.status).toBe(400)
    expect(res1.body.message).toMatch(/required/i)

    const res2 = await request(app)
      .post('/api/provision/fulfill')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ deviceKey })

    expect(res2.status).toBe(400)
    expect(res2.body.message).toMatch(/required/i)
  })

  it('POST /api/provision/fulfill — returns 404 for unknown session', async () => {
    const res = await request(app)
      .post('/api/provision/fulfill')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sessionCode: uuidv4(), deviceKey })

    expect(res.status).toBe(404)
  })

  it('POST /api/provision/fulfill — rejects expired session', async () => {
    const expiredCode = uuidv4()
    await ProvisioningSession.create({
      sessionCode: expiredCode,
      status: 'pending',
      expiresAt: new Date(Date.now() - 60000)
    })

    const res = await request(app)
      .post('/api/provision/fulfill')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sessionCode: expiredCode, deviceKey })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/expired/i)
  })

  it('POST /api/provision/fulfill — rejects already-fulfilled session', async () => {
    // Fulfill the session first
    await request(app)
      .post('/api/provision/fulfill')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sessionCode, deviceKey })

    // Try to fulfill again
    const res = await request(app)
      .post('/api/provision/fulfill')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sessionCode, deviceKey })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/already fulfilled/i)
  })

  it('POST /api/provision/fulfill — rejects invalid device key', async () => {
    const res = await request(app)
      .post('/api/provision/fulfill')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sessionCode, deviceKey: 'totally-bogus-key-that-does-not-exist' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/invalid device key/i)
  })
})

describe('Provisioning auth enforcement', () => {
  it('POST /api/provision/fulfill — agent cannot fulfill (admin-only)', async () => {
    const res = await request(app)
      .post('/api/provision/fulfill')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ sessionCode: uuidv4(), deviceKey: 'anything' })

    expect(res.status).toBe(403)
  })

  it('POST /api/provision/fulfill — unauthenticated cannot fulfill', async () => {
    const res = await request(app)
      .post('/api/provision/fulfill')
      .send({ sessionCode: uuidv4(), deviceKey: 'anything' })

    expect([401, 403]).toContain(res.status)
  })
})
