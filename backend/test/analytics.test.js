import './setup.js'
import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js'

let app, adminToken, adminUser

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminUser = admin.user
  adminToken = admin.token
}, 15000)

afterAll(async () => {
  await closeDb()
})

describe('POST /api/analytics/events', () => {
  it('records an analytics event with valid session', async () => {
    const res = await request(app)
      .post('/api/analytics/events')
      .set('Origin', 'http://localhost:5173')
      .set('x-session-id', 'test-sid-' + Date.now())
      .send({ type: 'page_view', meta: { path: '/lead-capture' } })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('creates session visit on first event then appends on second', async () => {
    const sid = 'test-sid-append-' + Date.now()

    const res1 = await request(app)
      .post('/api/analytics/events')
      .set('Origin', 'http://localhost:5173')
      .set('x-session-id', sid)
      .send({ type: 'page_view', meta: { path: '/landing' } })

    expect(res1.status).toBe(200)

    const res2 = await request(app)
      .post('/api/analytics/events')
      .set('Origin', 'http://localhost:5173')
      .set('x-session-id', sid)
      .send({ type: 'form_start', meta: { path: '/landing' } })

    expect(res2.status).toBe(200)
  })

  it('stores UTM parameters from meta', async () => {
    const res = await request(app)
      .post('/api/analytics/events')
      .set('Origin', 'http://localhost:5173')
      .set('x-session-id', 'test-sid-utm-' + Date.now())
      .send({
        type: 'page_view',
        meta: {
          path: '/lead-capture',
          utm_source: 'google',
          utm_medium: 'cpc',
          utm_campaign: 'spring-sale'
        }
      })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('returns 400 when event type is missing', async () => {
    const res = await request(app)
      .post('/api/analytics/events')
      .set('Origin', 'http://localhost:5173')
      .set('x-session-id', 'test-sid-notype-' + Date.now())
      .send({ meta: { path: '/' } })

    expect(res.status).toBe(400)
  })

  it('returns 400 when session id is missing', async () => {
    const res = await request(app)
      .post('/api/analytics/events')
      .set('Origin', 'http://localhost:5173')
      .send({ type: 'page_view' })

    expect(res.status).toBe(400)
  })

  it('returns 403 for disallowed origin', async () => {
    const res = await request(app)
      .post('/api/analytics/events')
      .set('Origin', 'https://evil.com')
      .set('x-session-id', 'test-sid-bad-origin')
      .send({ type: 'page_view' })

    expect(res.status).toBe(403)
  })
})

describe('POST /api/analytics/referrals', () => {
  let campaign

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
  })

  it('increments referral counter for a valid campaign', async () => {
    const res = await request(app)
      .post('/api/analytics/referrals')
      .set('Origin', 'http://localhost:5173')
      .set('x-session-id', 'test-sid-ref-' + Date.now())
      .send({ campaignId: campaign.id })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('returns 400 when campaignId is missing', async () => {
    const res = await request(app)
      .post('/api/analytics/referrals')
      .set('Origin', 'http://localhost:5173')
      .set('x-session-id', 'test-sid-ref-nocamp')
      .send({})

    expect(res.status).toBe(400)
  })

  it('returns 404 for non-existent campaignId', async () => {
    const res = await request(app)
      .post('/api/analytics/referrals')
      .set('Origin', 'http://localhost:5173')
      .set('x-session-id', 'test-sid-ref-bad')
      .send({ campaignId: '00000000-0000-0000-0000-000000000000' })

    expect(res.status).toBe(404)
  })

  it('returns 400 when session id is missing', async () => {
    const res = await request(app)
      .post('/api/analytics/referrals')
      .set('Origin', 'http://localhost:5173')
      .send({ campaignId: campaign.id })

    expect(res.status).toBe(400)
  })

  it('returns 403 for disallowed origin', async () => {
    const res = await request(app)
      .post('/api/analytics/referrals')
      .set('Origin', 'https://evil.com')
      .set('x-session-id', 'test-sid-ref-evil')
      .send({ campaignId: campaign.id })

    expect(res.status).toBe(403)
  })
})
