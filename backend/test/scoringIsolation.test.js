import { createHash } from 'crypto'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js'
import { sequelize, Consumer, ConsentEvent, WaMessageStatus } from '../src/models/index.js'
import {
  loadTelemetry, scoreOneConsumer, _resetConfigCache,
} from '../src/services/consumerScoringService.js'

/**
 * The capability-vs-response contract, at the database
 * (per-campaign-lead-scoring.md §3.2 / §16 B1; the Phase-0 fix).
 *
 * ONE person, TWO live leads on different campaigns. Both directions are
 * pinned so neither future "fix" can silently invert the contract:
 *
 *   RESPONSES must NOT move the person score —
 *     a WhatsApp READ adds nothing beyond deliverability (it IS proof of
 *     deliverability, because the status upsert keeps only the furthest
 *     status), and a lastSeenAt touch moves nothing at all (recency anchors
 *     to the newest SIGNUP, and telemetry no longer even carries lastSeenAt).
 *
 *   CAPABILITIES must KEEP crossing campaigns —
 *     a delivered/read status (deliverability) and a granted `contact`
 *     consent (marketing authority) each raise the person score, wherever
 *     they were earned. Asserting the positive direction is what catches a
 *     future over-scoping "fix" that blanket-scopes telemetry per campaign.
 */

let admin, campA, campB
let phoneSeq = Math.floor(Math.random() * 700000)

const e164 = () => `+65${(81000000 + (phoneSeq += 1)).toString()}`
const sha256hex = (s) => createHash('sha256').update(s).digest('hex')

/** One person with two live leads on different campaigns. */
async function personWithTwoLeads() {
  const phone = e164()
  const consumer = await Consumer.create({
    phone,
    phoneHash: sha256hex(phone),
    firstSeenAt: new Date('2026-06-01T00:00:00Z'),
    lastSeenAt: new Date('2026-06-01T00:00:00Z'),
    signupCount: 2,
    verifiedSignupCount: 1,
    email: `iso-${phoneSeq}@example.com`,
  })
  // Raw SQL: Sequelize quietly drops `createdAt` from an instance update, and
  // an un-backdated pair can share a millisecond, leaving "newest" to the id
  // tiebreak over random UUIDs.
  const older = await createTestProspect(campA.id, { consumerId: consumer.id, phone })
  await sequelize.query('UPDATE prospects SET "createdAt" = :ts WHERE id = :id', {
    replacements: { ts: new Date('2026-06-01T00:00:00Z'), id: older.id },
  })
  const newer = await createTestProspect(campB.id, { consumerId: consumer.id, phone: e164() })
  return { consumer, older, newer }
}

const scoreOf = async (consumerId) => {
  const r = await scoreOneConsumer(consumerId, { force: true })
  expect(r.status).toBe('scored')
  return r
}

beforeAll(async () => {
  await getApp()
  _resetConfigCache()
  const made = await createTestUser({ role: 'admin' })
  admin = made.user
  campA = await createTestCampaign(admin.id, { name: `Iso A ${Date.now()}` })
  campB = await createTestCampaign(admin.id, { name: `Iso B ${Date.now()}` })
})

afterAll(async () => {
  await closeDb()
})

describe('telemetry shape', () => {
  test('recency anchors to the NEWEST prospect (createdAt DESC, id DESC) and lastSeenAt is gone', async () => {
    const { consumer, newer } = await personWithTwoLeads()
    const t = await loadTelemetry(consumer.id)
    expect(t.lastSeenAt).toBeUndefined()
    expect(new Date(t.newestSignupAt).getTime()).toBe(new Date(newer.createdAt).getTime())
  })
})

describe('responses do not cross campaigns', () => {
  test('a WhatsApp READ adds nothing beyond deliverability — read and delivered score identically', async () => {
    const { consumer } = await personWithTwoLeads()

    await WaMessageStatus.create({
      wamid: `wamid.iso.read.${phoneSeq}`,
      status: 'read',
      recipientHash: consumer.phoneHash,
      occurredAt: new Date(),
    })
    const asRead = await scoreOf(consumer.id)

    // Same person, same message — had the webhook only ever reached
    // 'delivered', the score must be identical. (The upsert keeps only the
    // FURTHEST status, so 'read' REPLACES 'delivered'; scoring 'read' higher
    // would turn a lead-scoped response into person-scoped points.)
    await WaMessageStatus.update(
      { status: 'delivered' },
      { where: { wamid: `wamid.iso.read.${phoneSeq}` } }
    )
    const asDelivered = await scoreOf(consumer.id)

    expect(asRead.meetScore).toBe(asDelivered.meetScore)
    expect(asRead.consumerScore).toBe(asDelivered.consumerScore)
  })

  test('a lastSeenAt touch (any response, anywhere) moves nothing', async () => {
    const { consumer } = await personWithTwoLeads()
    const before = await scoreOf(consumer.id)

    // A response touch lands somewhere — the spine refreshes lastSeenAt.
    await Consumer.update({ lastSeenAt: new Date() }, { where: { id: consumer.id } })

    const after = await scoreOf(consumer.id)
    expect(after.meetScore).toBe(before.meetScore)
    expect(after.buyScore).toBe(before.buyScore)
    expect(after.consumerScore).toBe(before.consumerScore)
  })

  test('the anchor is the newest SIGNUP: backdating it decays engagement', async () => {
    const { consumer, older, newer } = await personWithTwoLeads()
    const fresh = await scoreOf(consumer.id)

    // Push the newest signup one engagement half-life into the past. Backdate
    // BOTH leads (with only `newer` backdated, `older` would become the newest
    // and the anchor would move less than a half-life), and do it in raw SQL —
    // Sequelize quietly drops `createdAt` from an instance update.
    const halfLifeAgo = new Date(Date.now() - 180 * 86_400_000)
    await sequelize.query('UPDATE prospects SET "createdAt" = :ts WHERE id = :id', {
      replacements: { ts: halfLifeAgo, id: newer.id },
    })
    await sequelize.query('UPDATE prospects SET "createdAt" = :ts WHERE id = :id', {
      replacements: { ts: new Date(halfLifeAgo.getTime() - 86_400_000), id: older.id },
    })

    const t = await loadTelemetry(consumer.id)
    expect(new Date(t.newestSignupAt).getTime()).toBe(halfLifeAgo.getTime())

    const aged = await scoreOf(consumer.id)
    expect(aged.meetScore).toBeLessThan(fresh.meetScore)
  })
})

describe('capabilities DO cross campaigns — pinned so an over-scoping "fix" fails here', () => {
  test('WhatsApp deliverability earned on ONE campaign raises the person score', async () => {
    const { consumer } = await personWithTwoLeads()
    const unreachable = await scoreOf(consumer.id)

    await WaMessageStatus.create({
      wamid: `wamid.iso.cap.${phoneSeq}`,
      status: 'delivered',
      recipientHash: consumer.phoneHash,
      occurredAt: new Date(),
    })
    const reachable = await scoreOf(consumer.id)
    expect(reachable.meetScore).toBeGreaterThan(unreachable.meetScore)
  })

  test('a `contact` consent granted via one campaign raises the person score', async () => {
    const { consumer, older } = await personWithTwoLeads()
    const before = await scoreOf(consumer.id)

    await ConsentEvent.create({
      consumerId: consumer.id,
      prospectId: older.id,
      campaignId: campA.id, // purpose-scoped row — authority is still person-grain
      kind: 'contact',
      granted: true,
      version: 'test-v1',
      source: 'signup',
      occurredAt: new Date(),
    })
    const after = await scoreOf(consumer.id)
    expect(after.meetScore).toBeGreaterThan(before.meetScore)
  })
})
