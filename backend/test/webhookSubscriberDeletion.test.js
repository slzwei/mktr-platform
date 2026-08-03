/**
 * M5 (review round 3): a used webhook subscriber can actually be deleted.
 *
 * Pre-fix, webhook_deliveries.subscriberId was NOT NULL while its FK said
 * ON DELETE SET NULL (migration 014) — a contradiction Postgres resolves by
 * rejecting the parent delete. Any subscriber with delivery history 500ed on
 * DELETE, so a retired integration could never be removed as advertised.
 *
 * Policy (one truth across model + column + FK, migration 108): history
 * SURVIVES — the delete succeeds, deliveries keep their audit row with
 * subscriberId NULL, listings LEFT JOIN, and a retry of an orphaned delivery
 * rejects cleanly instead of dying on a missing parent.
 */
import { getApp, closeDb } from './helpers.js'
import { WebhookSubscriber, WebhookDelivery } from '../src/models/index.js'
import { deleteSubscriber, listDeliveries } from '../src/services/webhookAdminService.js'
import { makeWebhookService } from '../src/services/webhookService.js'

beforeAll(async () => {
  await getApp()
})

afterAll(async () => {
  await closeDb()
})

async function subscriberWithDelivery() {
  const subscriber = await WebhookSubscriber.create({
    name: `Retired Integration ${Date.now()}`,
    url: 'https://example.invalid/hook',
    secret: 'shh',
    events: ['lead.created'],
    enabled: false,
  })
  const delivery = await WebhookDelivery.create({
    subscriberId: subscriber.id,
    eventType: 'lead.created',
    payload: { hello: 'world' },
    status: 'failed',
    attempts: 3,
  })
  return { subscriber, delivery }
}

describe('M5 — deleting a subscriber with delivery history', () => {
  it('succeeds, and the delivery survives as an orphaned audit row', async () => {
    const { subscriber, delivery } = await subscriberWithDelivery()

    // Pre-fix: Postgres tried to SET NULL a NOT NULL column and rejected the
    // delete — the admin DELETE path surfaced a database error.
    await expect(deleteSubscriber(subscriber.id)).resolves.toBeUndefined()

    expect(await WebhookSubscriber.findByPk(subscriber.id)).toBeNull()
    const survivor = await WebhookDelivery.findByPk(delivery.id)
    expect(survivor).not.toBeNull()
    expect(survivor.subscriberId).toBeNull()
    expect(survivor.eventType).toBe('lead.created')
  })

  it('orphaned deliveries still list (LEFT JOIN) and retry rejects cleanly', async () => {
    const { subscriber, delivery } = await subscriberWithDelivery()
    await deleteSubscriber(subscriber.id)

    const { deliveries } = await listDeliveries({ status: 'failed', limit: 100 })
    const row = deliveries.find((d) => d.id === delivery.id)
    expect(row).toBeDefined()
    expect(row.subscriber).toBeNull()

    const svc = makeWebhookService()
    await expect(svc.retryDelivery(delivery.id)).rejects.toThrow('Subscriber not found for delivery')
  })
})
