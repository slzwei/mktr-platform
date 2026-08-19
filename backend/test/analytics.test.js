import './setup.js'
import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js'

let app, adminToken, adminUser

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminUser = admin.user
  adminToken = admin.token
})

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

  // Exact-origin matrix (ads-centralisation §4.3): the old prefix match let a
  // lookalike host through — https://mktr.sg.evil.example startsWith
  // https://mktr.sg. Origin AND the Referer fallback must both compare exactly.
  it('rejects lookalike-host origins the old prefix match accepted', async () => {
    for (const evil of ['https://mktr.sg.evil.example', 'https://redeem.sg.evil.example']) {
      const res = await request(app)
        .post('/api/analytics/events')
        .set('Origin', evil)
        .set('x-session-id', 'test-sid-lookalike')
        .send({ type: 'page_view' })
      expect(res.status).toBe(403)
    }
    const viaReferer = await request(app)
      .post('/api/analytics/events')
      .set('Referer', 'https://redeem.sg.evil.example/offers/x')
      .set('x-session-id', 'test-sid-lookalike')
      .send({ type: 'page_view' })
    expect(viaReferer.status).toBe(403)
  })

  it('still accepts a genuine Referer-only request (no Origin header)', async () => {
    const res = await request(app)
      .post('/api/analytics/events')
      .set('Referer', 'https://redeem.sg/offers/airpods')
      .set('x-session-id', 'test-sid-referer-ok')
      .send({ type: 'page_view' })
    expect(res.status).toBe(200)
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

  // e1fd8d7 made this endpoint deliberately LENIENT: the "Referred by" badge
  // must work for a fresh referee with no session cookie, and a public beacon
  // never leaks validation shape — bad/missing input degrades to a 200 with a
  // null referrerName instead of 400/404.
  it('degrades to 200 with a null name when campaignId is missing', async () => {
    const res = await request(app)
      .post('/api/analytics/referrals')
      .set('Origin', 'http://localhost:5173')
      .set('x-session-id', 'test-sid-ref-nocamp')
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.referrerName ?? null).toBeNull()
  })

  it('degrades to 200 with a null name for a non-existent campaignId', async () => {
    const res = await request(app)
      .post('/api/analytics/referrals')
      .set('Origin', 'http://localhost:5173')
      .set('x-session-id', 'test-sid-ref-bad')
      .send({ campaignId: '00000000-0000-0000-0000-000000000000' })

    expect(res.status).toBe(200)
    expect(res.body.data.referrerName ?? null).toBeNull()
  })

  it('works without a session — the fresh-referee case the badge exists for', async () => {
    const res = await request(app)
      .post('/api/analytics/referrals')
      .set('Origin', 'http://localhost:5173')
      .send({ campaignId: campaign.id })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
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
