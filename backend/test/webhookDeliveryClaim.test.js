/**
 * P2-2 regression: one pending delivery is sent ONCE.
 *
 * A failed delivery scheduled its retry on a setTimeout while leaving the row
 * `status: 'pending'` with `nextRetryAt` set — and recoverPendingRetries (boot
 * + every 60s) selects exactly those rows, with no claim and no lock. Once
 * nextRetryAt passed, the in-process timer and the poll could both enqueue the
 * same delivery: the receiver got the webhook twice, and the read-modify-write
 * `attempts` counter over- or under-shot maxAttempts.
 *
 * The fix is a conditional pending→sending claim that also increments attempts
 * column-relative, so only the winner sends. These drive the real service
 * against real Postgres.
 */
import { randomUUID } from 'crypto'
import { WebhookSubscriber, WebhookDelivery } from '../src/models/index.js'
import { makeWebhookService } from '../src/services/webhookService.js'
import { getApp, closeDb } from './helpers.js'

let subscriber

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

/** A delivery already scheduled for retry — pending, its backoff elapsed. */
async function pendingDelivery(over = {}) {
  return WebhookDelivery.create({
    subscriberId: subscriber.id,
    deliveryId: randomUUID(),
    eventType: 'lead.created',
    payload: { event: 'lead.created', data: { id: 'lead-1' } },
    status: 'pending',
    attempts: 1,
    maxAttempts: 3,
    nextRetryAt: new Date(Date.now() - 1000),
    ...over,
  })
}

beforeAll(async () => {
  await getApp()
  subscriber = await WebhookSubscriber.create({
    name: 'Claim Test Receiver',
    url: 'https://receiver.test/hook',
    secret: 'shhh',
    events: ['lead.created'],
    enabled: true,
  })
})

afterAll(async () => {
  await WebhookDelivery.destroy({ where: { subscriberId: subscriber.id } })
  await subscriber.destroy()
  await closeDb()
})

describe('concurrent dispatch of one pending delivery', () => {
  it('sends exactly once and counts exactly one attempt', async () => {
    const row = await pendingDelivery()
    const sends = []
    const svc = makeWebhookService({
      logger: silent,
      fetch: async (url) => {
        sends.push(url)
        // Hold the flight open so the second dispatcher is guaranteed to
        // overlap — the interleaving the claim has to survive.
        await new Promise((r) => setTimeout(r, 150))
        return { ok: true, status: 200, text: async () => 'ok' }
      },
    })

    // The lost setTimeout retry and the recovery poll, racing on one row.
    const a = await WebhookDelivery.findByPk(row.id)
    const b = await WebhookDelivery.findByPk(row.id)
    await Promise.all([
      svc.attemptDelivery(a, subscriber),
      svc.attemptDelivery(b, subscriber),
    ])

    expect(sends).toHaveLength(1)

    const after = await WebhookDelivery.findByPk(row.id)
    expect(after.status).toBe('success')
    expect(after.attempts).toBe(2) // started at 1, exactly one attempt added
  })

  it('leaves the loser a no-op — no second attempt is charged', async () => {
    const row = await pendingDelivery({ attempts: 2, maxAttempts: 3 })
    let calls = 0
    const svc = makeWebhookService({
      logger: silent,
      fetch: async () => {
        calls += 1
        await new Promise((r) => setTimeout(r, 120))
        return { ok: true, status: 200, text: async () => 'ok' }
      },
    })

    const a = await WebhookDelivery.findByPk(row.id)
    const b = await WebhookDelivery.findByPk(row.id)
    await Promise.all([
      svc.attemptDelivery(a, subscriber),
      svc.attemptDelivery(b, subscriber),
    ])

    expect(calls).toBe(1)
    // 3 would have tripped maxAttempts and failed the delivery outright.
    expect((await WebhookDelivery.findByPk(row.id)).attempts).toBe(3)
  })

  it('returns a retryable failure to pending so the queue can pick it up again', async () => {
    const row = await pendingDelivery({ attempts: 0 })
    const svc = makeWebhookService({
      logger: silent,
      fetch: async () => ({ ok: false, status: 503, text: async () => 'upstream down' }),
    })

    const live = await WebhookDelivery.findByPk(row.id)
    await svc.attemptDelivery(live, subscriber)

    const after = await WebhookDelivery.findByPk(row.id)
    expect(after.status).toBe('pending') // NOT stranded in 'sending'
    expect(after.attempts).toBe(1)
    expect(after.nextRetryAt).toBeInstanceOf(Date)
  })

  it('marks the delivery failed once attempts are exhausted', async () => {
    const row = await pendingDelivery({ attempts: 2, maxAttempts: 3 })
    const svc = makeWebhookService({
      logger: silent,
      fetch: async () => ({ ok: false, status: 500, text: async () => 'nope' }),
    })

    const live = await WebhookDelivery.findByPk(row.id)
    await svc.attemptDelivery(live, subscriber)

    const after = await WebhookDelivery.findByPk(row.id)
    expect(after.status).toBe('failed')
    expect(after.attempts).toBe(3)
  })
})

describe('crash recovery', () => {
  it('reclaims a delivery stranded in flight and re-sends it', async () => {
    // A process that died mid-fetch: claimed, never resolved, long past the 10s
    // send budget. Without reclamation this row is invisible to timer AND poll.
    const row = await pendingDelivery({
      status: 'sending',
      lastAttemptAt: new Date(Date.now() - 5 * 60_000),
    })

    const svc = makeWebhookService({
      logger: silent,
      fetch: async () => ({ ok: true, status: 200, text: async () => 'ok' }),
    })

    await svc.recoverPendingRetries()
    await new Promise((r) => setTimeout(r, 400)) // let the queue drain

    const after = await WebhookDelivery.findByPk(row.id)
    expect(after.status).toBe('success')
  })

  it('does not touch a delivery that is legitimately still in flight', async () => {
    const row = await pendingDelivery({ status: 'sending', lastAttemptAt: new Date() })

    const svc = makeWebhookService({ logger: silent, fetch: async () => ({ ok: true, status: 200, text: async () => 'ok' }) })
    await svc.recoverPendingRetries()

    expect((await WebhookDelivery.findByPk(row.id)).status).toBe('sending')
  })
})
