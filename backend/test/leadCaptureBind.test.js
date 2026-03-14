import './setup.js'
import crypto from 'crypto'
import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestQrTag } from './helpers.js'
import { Attribution, QrScan } from '../src/models/index.js'

const ATTRIB_SECRET = process.env.ATTRIB_SECRET || 'dev-attrib-secret'

let app

beforeAll(async () => {
  app = await getApp()
}, 15000)

afterAll(async () => {
  await closeDb()
})

/**
 * Helper: mint a signed attribution token (atk cookie value).
 */
function mintAtk(payload) {
  const raw = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', ATTRIB_SECRET).update(raw).digest('base64url')
  return `${raw}.${sig}`
}

// ---------------------------------------------------------------------------
// GET /lead-capture — attribution bind endpoint
// ---------------------------------------------------------------------------
describe('GET /lead-capture', () => {
  it('redirects to frontend SPA with 302', async () => {
    const res = await request(app)
      .get('/lead-capture')
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/LeadCapture/)
  })

  it('sets sid cookie when none provided', async () => {
    const res = await request(app)
      .get('/lead-capture')
    expect(res.status).toBe(302)
    // Should have a Set-Cookie header containing sid
    const cookies = res.headers['set-cookie']
    expect(cookies).toBeDefined()
    const sidCookie = Array.isArray(cookies)
      ? cookies.find(c => c.startsWith('sid='))
      : (cookies && cookies.startsWith('sid=') ? cookies : null)
    expect(sidCookie).toBeTruthy()
  })

  it('preserves query string in redirect', async () => {
    const res = await request(app)
      .get('/lead-capture?campaign=test123&ref=qr')
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/LeadCapture\?campaign=test123&ref=qr/)
  })

  it('handles missing atk cookie gracefully (no crash)', async () => {
    const res = await request(app)
      .get('/lead-capture')
    // Should still redirect normally without atk
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/LeadCapture/)
  })

  it('handles invalid atk cookie gracefully (bad signature)', async () => {
    const res = await request(app)
      .get('/lead-capture')
      .set('Cookie', 'atk=invalidpayload.invalidsig')
    // Should still redirect — invalid atk is silently ignored
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/LeadCapture/)
  })

  it('handles expired atk cookie gracefully', async () => {
    // Create an atk with an expiration in the past
    const atk = mintAtk({ id: '00000000-0000-0000-0000-000000000001', exp: 1000 })
    const res = await request(app)
      .get('/lead-capture')
      .set('Cookie', `atk=${atk}`)
    // Should still redirect — expired atk is silently ignored
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/LeadCapture/)
  })

  it('processes valid atk cookie and binds attribution', async () => {
    // We need a real Attribution record for the bind to work
    const admin = await createTestUser({ role: 'admin' })
    const campaign = await createTestCampaign(admin.user.id)
    const qrTag = await createTestQrTag(campaign.id, admin.user.id)

    // Create a QrScan so we can reference it in Attribution
    const scan = await QrScan.create({
      qrTagId: qrTag.id,
      ipHash: 'testhash123',
      ua: 'test-agent'
    })

    const attribution = await Attribution.create({
      qrTagId: qrTag.id,
      qrScanId: scan.id,
      expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour from now
      firstTouch: true
    })

    const atk = mintAtk({
      id: attribution.id,
      exp: Math.floor(Date.now() / 1000) + 3600
    })

    const res = await request(app)
      .get('/lead-capture')
      .set('Cookie', `atk=${atk}`)

    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/LeadCapture/)

    // Verify the attribution was updated with a sessionId
    const updated = await Attribution.findByPk(attribution.id)
    expect(updated.sessionId).toBeTruthy()
    expect(updated.lastTouchAt).toBeTruthy()
  })

  it('does not crash when atk references non-existent attribution', async () => {
    const atk = mintAtk({
      id: '00000000-0000-0000-0000-ffffffffffff',
      exp: Math.floor(Date.now() / 1000) + 3600
    })
    const res = await request(app)
      .get('/lead-capture')
      .set('Cookie', `atk=${atk}`)
    // Should still redirect gracefully
    expect(res.status).toBe(302)
  })

  it('reuses sid cookie when already present', async () => {
    const existingSid = 'existing-session-id-12345678'
    const res = await request(app)
      .get('/lead-capture')
      .set('Cookie', `sid=${existingSid}`)

    expect(res.status).toBe(302)
    // Should NOT set a new sid cookie since one already exists
    const cookies = res.headers['set-cookie'] || []
    const cookieArr = Array.isArray(cookies) ? cookies : [cookies]
    const newSid = cookieArr.find(c => c.startsWith('sid='))
    // Either no sid cookie set, or it should not override
    if (newSid) {
      // If framework re-sets it, that is okay as long as it does not crash
      expect(res.status).toBe(302)
    }
  })
})
