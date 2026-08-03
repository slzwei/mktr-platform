/**
 * Durable-retry hardening: a retry attempt is governed by the subscriber's
 * CURRENT row, not the in-memory copy the setTimeout captured minutes ago.
 *
 * The delivery pipeline is already a durable DB-backed queue (persisted
 * nextRetryAt, atomic pending→sending claim, boot + 60s recovery poll — the
 * old "retries lost on restart" debt is at most 60s of added latency). The
 * one hole left: the timer path replayed a STALE subscriber — an endpoint
 * disabled between attempts kept receiving retries, signed with a
 * rotated-away secret. The claim now reloads the subscriber and lets the
 * fresh row govern.
 */
import crypto from 'crypto'
import { jest } from '@jest/globals'
import { getApp, closeDb } from './helpers.js'
import { WebhookSubscriber, WebhookDelivery } from '../src/models/index.js'
import { makeWebhookService } from '../src/services/webhookService.js'

beforeAll(async () => {
  await getApp()
})

afterAll(async () => {
  await closeDb()
})

async function fixture({ enabled = true } = {}) {
  const subscriber = await WebhookSubscriber.create({
    name: `Freshness ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    url: 'https://example.invalid/hook',
    secret: 'original-secret',
    events: ['lead.created'],
    enabled,
  })
  const delivery = await WebhookDelivery.create({
    subscriberId: subscriber.id,
    eventType: 'lead.created',
    payload: { hello: 'fresh' },
    status: 'pending',
    attempts: 1,
    nextRetryAt: new Date(Date.now() - 1000),
  })
  return { subscriber, delivery }
}

test('a subscriber disabled between attempts stops receiving retries', async () => {
  const { subscriber, delivery } = await fixture()
  const staleCopy = { ...subscriber.get(), enabled: true } // what the timer captured

  await subscriber.update({ enabled: false }) // admin or auto-disable cut it off

  const fetchSpy = jest.fn(async () => ({ ok: true, status: 200, text: async () => 'ok' }))
  const svc = makeWebhookService({ fetch: fetchSpy })
  await svc.attemptDelivery(delivery, staleCopy)

  // Pre-fix: the stale copy was used and the disabled endpoint got the POST.
  expect(fetchSpy).not.toHaveBeenCalled()
  await delivery.reload()
  expect(delivery.status).toBe('failed')
  expect(delivery.errorMessage).toContain('disabled or deleted')
})

test('a secret rotated between attempts signs the retry with the NEW secret', async () => {
  const { subscriber, delivery } = await fixture()
  const staleCopy = { ...subscriber.get(), secret: 'original-secret' }

  await subscriber.update({ secret: 'rotated-secret' })

  const fetchSpy = jest.fn(async () => ({ ok: true, status: 200, text: async () => 'ok' }))
  const svc = makeWebhookService({ fetch: fetchSpy })
  await svc.attemptDelivery(delivery, staleCopy)

  expect(fetchSpy).toHaveBeenCalledTimes(1)
  const [, opts] = fetchSpy.mock.calls[0]
  const sig = opts.headers['X-Webhook-Signature']
  const ts = opts.headers['X-Webhook-Timestamp']
  const rawBody = opts.body
  // v2 scheme signs body+timestamp; recompute with BOTH secrets and assert
  // the rotated one produced the header (whatever the scheme version, the
  // stale secret must not verify).
  const h = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex')
  const candidatesNew = [h('rotated-secret', rawBody), h('rotated-secret', `${rawBody}.${ts}`), h('rotated-secret', `${ts}.${rawBody}`)]
  const candidatesOld = [h('original-secret', rawBody), h('original-secret', `${rawBody}.${ts}`), h('original-secret', `${ts}.${rawBody}`)]
  const sigHex = String(sig).replace(/^sha256=/, '')
  expect(candidatesOld).not.toContain(sigHex)
  expect(candidatesNew).toContain(sigHex)
})
