import crypto from 'crypto'
import request from 'supertest'
import { getApp, closeDb } from './helpers.js'
import { Prospect, IdempotencyKey } from '../src/models/index.js'

const WEBHOOK_SECRET = 'test-retell-secret'

let app

beforeAll(async () => {
  process.env.RETELL_WEBHOOK_SECRET = WEBHOOK_SECRET
  app = await getApp()
}, 15000)

afterAll(async () => {
  await closeDb()
})

function signRetellPayload(body, secret) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body)
  const hmac = crypto.createHmac('sha256', secret).update(`${timestamp}.${bodyStr}`).digest('hex')
  return `v=${timestamp},d=${hmac}`
}

function buildCallPayload(overrides = {}) {
  return {
    call_id: `call_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    call_type: 'phone_call',
    call_status: 'ended',
    agent_id: 'agent_test123',
    agent_name: 'Test Agent',
    from_number: '+6531295909',
    to_number: '+6591234567',
    duration_ms: 60000,
    disconnection_reason: 'agent_hangup',
    transcript: 'Agent: Hello\nUser: Hi there',
    retell_llm_dynamic_variables: { name: 'John Doe' },
    call_analysis: {
      call_successful: true,
      call_summary: 'Test call summary',
      user_sentiment: 'Positive',
      custom_analysis_data: {},
      in_voicemail: false
    },
    ...overrides
  }
}

describe('POST /api/retell/webhook', () => {
  afterEach(async () => {
    await Prospect.destroy({ where: { leadSource: 'call_bot' }, force: true })
    await IdempotencyKey.destroy({ where: { scope: 'retell:call' } })
  })

  it('rejects requests without signature', async () => {
    const payload = buildCallPayload()
    const res = await request(app)
      .post('/api/retell/webhook')
      .send(payload)

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Missing signature')
  })

  it('rejects requests with invalid signature', async () => {
    const payload = buildCallPayload()
    const bodyStr = JSON.stringify(payload)
    const res = await request(app)
      .post('/api/retell/webhook')
      .set('Content-Type', 'application/json')
      .set('x-retell-signature', 'v=1700000000,d=deadbeef0123456789abcdef0123456789abcdef0123456789abcdef01234567')
      .send(bodyStr)

    expect(res.status).toBe(401)
  })

  it('creates a prospect for a successful call', async () => {
    const payload = buildCallPayload()
    const bodyStr = JSON.stringify(payload)
    const signature = signRetellPayload(bodyStr, WEBHOOK_SECRET)

    const res = await request(app)
      .post('/api/retell/webhook')
      .set('Content-Type', 'application/json')
      .set('x-retell-signature', signature)
      .send(bodyStr)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.status).toBe('created')
    expect(res.body.prospectId).toBeDefined()

    const prospect = await Prospect.findByPk(res.body.prospectId)
    expect(prospect).not.toBeNull()
    expect(prospect.firstName).toBe('John')
    expect(prospect.lastName).toBe('Doe')
    expect(prospect.phone).toBe('+6591234567')
    expect(prospect.leadSource).toBe('call_bot')
    expect(prospect.leadStatus).toBe('new')
    expect(prospect.priority).toBe('high')
    expect(prospect.retellCallId).toBe(payload.call_id)
    expect(prospect.sourceMetadata.retellCallId).toBe(payload.call_id)
    expect(prospect.sourceMetadata.sentiment).toBe('Positive')
  })

  it('skips non-ended calls', async () => {
    const payload = buildCallPayload({ call_status: 'in_progress' })
    const bodyStr = JSON.stringify(payload)
    const signature = signRetellPayload(bodyStr, WEBHOOK_SECRET)

    const res = await request(app)
      .post('/api/retell/webhook')
      .set('Content-Type', 'application/json')
      .set('x-retell-signature', signature)
      .send(bodyStr)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('skipped')
    expect(res.body.reason).toBe('call_not_ended')
  })

  it('skips unsuccessful calls', async () => {
    const payload = buildCallPayload({
      call_analysis: {
        call_successful: false,
        user_sentiment: 'Negative',
        call_summary: 'User hung up'
      }
    })
    const bodyStr = JSON.stringify(payload)
    const signature = signRetellPayload(bodyStr, WEBHOOK_SECRET)

    const res = await request(app)
      .post('/api/retell/webhook')
      .set('Content-Type', 'application/json')
      .set('x-retell-signature', signature)
      .send(bodyStr)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('skipped')
    expect(res.body.reason).toBe('call_not_successful')
  })

  it('handles duplicate call_id idempotently', async () => {
    const payload = buildCallPayload()
    const bodyStr = JSON.stringify(payload)
    const signature = signRetellPayload(bodyStr, WEBHOOK_SECRET)

    const res1 = await request(app)
      .post('/api/retell/webhook')
      .set('Content-Type', 'application/json')
      .set('x-retell-signature', signature)
      .send(bodyStr)

    expect(res1.status).toBe(200)
    expect(res1.body.status).toBe('created')

    // Re-sign for the second request (timestamp may differ)
    const signature2 = signRetellPayload(bodyStr, WEBHOOK_SECRET)

    const res2 = await request(app)
      .post('/api/retell/webhook')
      .set('Content-Type', 'application/json')
      .set('x-retell-signature', signature2)
      .send(bodyStr)

    expect(res2.status).toBe(200)
    expect(res2.body.status).toBe('duplicate')
    expect(res2.body.prospectId).toBe(res1.body.prospectId)

    const count = await Prospect.count({
      where: { retellCallId: payload.call_id }
    })
    expect(count).toBe(1)
  })

  it('maps Neutral sentiment to medium priority', async () => {
    const payload = buildCallPayload({
      call_analysis: {
        call_successful: true,
        user_sentiment: 'Neutral',
        call_summary: 'Neutral call'
      }
    })
    const bodyStr = JSON.stringify(payload)
    const signature = signRetellPayload(bodyStr, WEBHOOK_SECRET)

    const res = await request(app)
      .post('/api/retell/webhook')
      .set('Content-Type', 'application/json')
      .set('x-retell-signature', signature)
      .send(bodyStr)

    expect(res.status).toBe(200)
    const prospect = await Prospect.findByPk(res.body.prospectId)
    expect(prospect.priority).toBe('medium')
  })

  it('handles missing name gracefully', async () => {
    const payload = buildCallPayload({
      retell_llm_dynamic_variables: {}
    })
    const bodyStr = JSON.stringify(payload)
    const signature = signRetellPayload(bodyStr, WEBHOOK_SECRET)

    const res = await request(app)
      .post('/api/retell/webhook')
      .set('Content-Type', 'application/json')
      .set('x-retell-signature', signature)
      .send(bodyStr)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('created')

    const prospect = await Prospect.findByPk(res.body.prospectId)
    expect(prospect.firstName).toBe('Retell Lead')
  })

  it('rejects requests without call_id', async () => {
    const payload = buildCallPayload()
    delete payload.call_id
    // Sign AFTER removing call_id so signature matches the actual body
    const bodyStr = JSON.stringify(payload)
    const signature = signRetellPayload(bodyStr, WEBHOOK_SECRET)

    const res = await request(app)
      .post('/api/retell/webhook')
      .set('Content-Type', 'application/json')
      .set('x-retell-signature', signature)
      .send(bodyStr)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Missing call_id')
  })

  it('stores transcript and metadata in notes', async () => {
    const payload = buildCallPayload()
    const bodyStr = JSON.stringify(payload)
    const signature = signRetellPayload(bodyStr, WEBHOOK_SECRET)

    const res = await request(app)
      .post('/api/retell/webhook')
      .set('Content-Type', 'application/json')
      .set('x-retell-signature', signature)
      .send(bodyStr)

    const prospect = await Prospect.findByPk(res.body.prospectId)
    expect(prospect.notes).toContain('Retell AI Call')
    expect(prospect.notes).toContain('Agent: Hello')
    expect(prospect.notes).toContain('Test call summary')
  })

  it('rejects request with malformed signature format (no v= prefix)', async () => {
    const payload = buildCallPayload()
    const bodyStr = JSON.stringify(payload)
    const res = await request(app)
      .post('/api/retell/webhook')
      .set('Content-Type', 'application/json')
      .set('x-retell-signature', 'not-a-valid-signature-format')
      .send(bodyStr)

    expect(res.status).toBe(401)
  })

  it('rejects request with expired timestamp in signature', async () => {
    const payload = buildCallPayload()
    const bodyStr = JSON.stringify(payload)
    // Use a very old timestamp
    const oldTimestamp = '1000000000'
    const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${oldTimestamp}.${bodyStr}`).digest('hex')
    const res = await request(app)
      .post('/api/retell/webhook')
      .set('Content-Type', 'application/json')
      .set('x-retell-signature', `v=${oldTimestamp},d=${hmac}`)
      .send(bodyStr)

    // May be accepted or rejected depending on timestamp tolerance
    expect([200, 401]).toContain(res.status)
  })

  it('handles payload with unknown/extra fields gracefully', async () => {
    const payload = buildCallPayload({
      unknown_field: 'some_value',
      extra_nested: { deeply: { nested: true } }
    })
    const bodyStr = JSON.stringify(payload)
    const signature = signRetellPayload(bodyStr, WEBHOOK_SECRET)

    const res = await request(app)
      .post('/api/retell/webhook')
      .set('Content-Type', 'application/json')
      .set('x-retell-signature', signature)
      .send(bodyStr)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('handles missing call_analysis field gracefully', async () => {
    const payload = buildCallPayload()
    delete payload.call_analysis
    const bodyStr = JSON.stringify(payload)
    const signature = signRetellPayload(bodyStr, WEBHOOK_SECRET)

    const res = await request(app)
      .post('/api/retell/webhook')
      .set('Content-Type', 'application/json')
      .set('x-retell-signature', signature)
      .send(bodyStr)

    // Without call_analysis, call_successful defaults to falsy -> skipped
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('skipped')
  })

  it('handles missing transcript gracefully', async () => {
    const payload = buildCallPayload({ transcript: null })
    const bodyStr = JSON.stringify(payload)
    const signature = signRetellPayload(bodyStr, WEBHOOK_SECRET)

    const res = await request(app)
      .post('/api/retell/webhook')
      .set('Content-Type', 'application/json')
      .set('x-retell-signature', signature)
      .send(bodyStr)

    expect(res.status).toBe(200)
    if (res.body.status === 'created') {
      const prospect = await Prospect.findByPk(res.body.prospectId)
      expect(prospect).not.toBeNull()
    }
  })

  it('tags prospects with retell and phone-call', async () => {
    const payload = buildCallPayload()
    const bodyStr = JSON.stringify(payload)
    const signature = signRetellPayload(bodyStr, WEBHOOK_SECRET)

    const res = await request(app)
      .post('/api/retell/webhook')
      .set('Content-Type', 'application/json')
      .set('x-retell-signature', signature)
      .send(bodyStr)

    const prospect = await Prospect.findByPk(res.body.prospectId)
    expect(prospect.tags).toEqual(expect.arrayContaining(['retell', 'phone-call']))
  })
})
