import { createHash } from 'crypto'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js'
import {
  sequelize, Consumer, ConsentEvent, ConsumerProfile, Prospect,
} from '../src/models/index.js'
import {
  scoreOneLead, loadLeadTelemetry, findStaleLeadIds,
} from '../src/services/leadScoringService.js'
import { markLeadsDirtyTx } from '../src/services/leadScoreDirty.js'
import { recordWaSend } from '../src/services/redeemOps/waMessageOwnership.js'
import { _resetConfigCache } from '../src/services/consumerScoringService.js'
import { eraseConsumer } from '../src/services/erasureService.js'
import { LEAD_ALGORITHM_VERSION } from '../src/utils/consumerScoring.js'

/**
 * The LEAD-GRAIN contract (per-campaign-lead-scoring.md §3.5), at the database.
 *
 * One person, two live leads on different campaigns. §3.2's rule is "one
 * event, two projections": a `read` on campaign A's message advances the
 * PERSON's WhatsApp frontier (capability — B may rely on it) AND is a response
 * for lead A, but it must never appear as a response on lead B.
 *
 * Every isolation test asserts B is BYTE-IDENTICAL rather than merely
 * "unchanged score": two different breakdowns that happen to round to the same
 * integer would pass a score-only assertion and still be a leak.
 */

let admin, campA, campB
let seq = Math.floor(Math.random() * 700000)
const e164 = () => `+65${(81000000 + (seq += 1)).toString()}`
const sha256hex = (s) => createHash('sha256').update(s).digest('hex')

/** One person, one live lead on each campaign. A is the OLDER signup. */
async function personWithTwoLeads() {
  const phone = e164()
  const consumer = await Consumer.create({
    phone,
    phoneHash: sha256hex(phone),
    firstSeenAt: new Date('2026-06-01T00:00:00Z'),
    lastSeenAt: new Date('2026-06-01T00:00:00Z'),
    signupCount: 2,
    verifiedSignupCount: 1,
    email: `lead-${seq}@example.com`,
  })
  const a = await createTestProspect(campA.id, { consumerId: consumer.id, phone })
  const b = await createTestProspect(campB.id, { consumerId: consumer.id, phone: e164() })
  // Raw SQL: Sequelize silently drops `createdAt` from an instance update, and
  // two rows created in the same millisecond leave "newest" to a UUID coin flip.
  await sequelize.query('UPDATE prospects SET "createdAt" = :ts WHERE id = :id', {
    replacements: { ts: new Date('2026-06-01T00:00:00Z'), id: a.id },
  })
  await sequelize.query('UPDATE prospects SET "createdAt" = :ts WHERE id = :id', {
    replacements: { ts: new Date('2026-07-01T00:00:00Z'), id: b.id },
  })
  return { consumer, a: await a.reload(), b: await b.reload() }
}

/** Send a message owned by `prospect`, then post Meta's status for it. */
async function sendAndStatus(prospect, consumer, status, { at = new Date(), kind = 'pass' } = {}) {
  const wamid = `wamid.LS.${seq += 1}`
  await recordWaSend({ wamid, prospect, kind })
  await sequelize.query(
    `INSERT INTO wa_message_statuses
       (wamid, status, "recipientHash", "occurredAt", "createdAt", "updatedAt")
     VALUES (:wamid, :status, :hash, :at, NOW(), NOW())
     ON CONFLICT (wamid) DO UPDATE SET status = EXCLUDED.status, "occurredAt" = EXCLUDED."occurredAt"`,
    { replacements: { wamid, status, hash: consumer.phoneHash, at } }
  )
  return wamid
}

const scoreOf = async (id) => {
  const r = await scoreOneLead(id, { force: true })
  expect(['scored', 'unchanged']).toContain(r.status)
  return r
}
const rowOf = (id) => Prospect.findByPk(id)
/** The full stored judgement — what "byte-identical" means here. */
const judgementOf = async (id) => {
  const p = await rowOf(id)
  return JSON.stringify({
    score: p.score, meet: p.meetScore, buy: p.buyScore, bd: p.scoreBreakdown,
  })
}

beforeAll(async () => {
  await getApp()
  _resetConfigCache()
  const made = await createTestUser({ role: 'admin' })
  admin = made.user
  campA = await createTestCampaign(admin.id, { name: `Lead A ${Date.now()}` })
  campB = await createTestCampaign(admin.id, { name: `Lead B ${Date.now()}` })
})

afterAll(async () => {
  await closeDb()
})

describe('responses do not cross campaigns', () => {
  test('a read on A, when the person already has ≥delivered proof elsewhere, leaves B byte-identical', async () => {
    const { consumer, a, b } = await personWithTwoLeads()
    // Deliverability already proven by an UNOWNED message, so the read below
    // adds no capability — it can only act as a response.
    await sequelize.query(
      `INSERT INTO wa_message_statuses (wamid, status, "recipientHash", "occurredAt", "createdAt", "updatedAt")
       VALUES (:w, 'delivered', :h, NOW(), NOW(), NOW())`,
      { replacements: { w: `wamid.PRE.${seq += 1}`, h: consumer.phoneHash } }
    )
    await scoreOf(a.id)
    await scoreOf(b.id)
    const beforeB = await judgementOf(b.id)

    await sendAndStatus(a, consumer, 'read')
    await scoreOf(a.id)
    await scoreOf(b.id)

    expect(await judgementOf(b.id)).toBe(beforeB)
    const aRow = await rowOf(a.id)
    expect(aRow.scoreBreakdown.components.response.state).toBe('assessed')
    expect(aRow.scoreBreakdown.events.some((e) => e.type === 'wa_read')).toBe(true)
    // And B has no response event at all — it owns no message.
    const bRow = await rowOf(b.id)
    expect(bRow.scoreBreakdown.components.response.state).toBe('unknown')
    expect(bRow.scoreBreakdown.events).toEqual([])
  })

  test("a read that is the person's FIRST proof raises B's capability but gives B no response", async () => {
    const { consumer, a, b } = await personWithTwoLeads()
    await scoreOf(b.id)
    const bBefore = await rowOf(b.id)
    expect(bBefore.scoreBreakdown.components.contactability.note).not.toContain('WhatsApp')

    await sendAndStatus(a, consumer, 'read')
    await scoreOf(b.id)

    const bAfter = await rowOf(b.id)
    // Capability travels BY DESIGN — pinned so an over-scoping "fix" fails here.
    expect(bAfter.scoreBreakdown.components.contactability.note).toContain('WhatsApp')
    expect(bAfter.scoreBreakdown.components.contactability.points)
      .toBeGreaterThan(bBefore.scoreBreakdown.components.contactability.points)
    // …but the RESPONSE stays with the lead that owns the message.
    expect(bAfter.scoreBreakdown.components.response.state).toBe('unknown')
    expect(bAfter.scoreBreakdown.events).toEqual([])
  })

  test('a screening refusal on A leaves B byte-identical', async () => {
    const { a, b } = await personWithTwoLeads()
    await scoreOf(b.id)
    const beforeB = await judgementOf(b.id)

    await sequelize.query(
      `UPDATE prospects SET "screeningVerdict" = 'not_qualified',
          "screeningMetadata" = :meta::jsonb WHERE id = :id`,
      {
        replacements: {
          id: a.id,
          meta: JSON.stringify({
            verdictDetail: {
              interestLevel: 'cold', sentiment: 'Negative',
              decidedAt: new Date().toISOString(),
              checks: { qualified: false, meet_consultant: false },
            },
          }),
        },
      }
    )
    await scoreOf(a.id)
    await scoreOf(b.id)

    expect(await judgementOf(b.id)).toBe(beforeB)
    const aRow = await rowOf(a.id)
    expect(aRow.scoreBreakdown.components.screening.state).toBe('assessed')
    expect(aRow.scoreBreakdown.components.screening.points).toBe(0)
  })

  test("each lead's recency is its OWN signup — a newer sibling does not refresh A", async () => {
    const { a, b } = await personWithTwoLeads()
    const ta = await loadLeadTelemetry(a.id)
    const tb = await loadLeadTelemetry(b.id)
    expect(new Date(ta.newestSignupAt).toISOString()).toBe(new Date('2026-06-01T00:00:00Z').toISOString())
    expect(new Date(tb.newestSignupAt).toISOString()).toBe(new Date('2026-07-01T00:00:00Z').toISOString())
    // B is a month younger, so its engagement recency must be strictly higher.
    await scoreOf(a.id)
    await scoreOf(b.id)
    const [ra, rb] = [await rowOf(a.id), await rowOf(b.id)]
    expect(rb.scoreBreakdown.components.engagement.points)
      .toBeGreaterThan(ra.scoreBreakdown.components.engagement.points)
  })
})

describe('consent is read at (consumer, campaign) scope — canMarketTo semantics', () => {
  const grant = (consumer, campaignId) => ConsentEvent.create({
    consumerId: consumer.id,
    campaignId,
    kind: 'contact',
    granted: true,
    verified: true,
    version: 'test-v1',
    occurredAt: new Date(),
    source: 'signup',
  })

  test('a grant scoped to A feeds A only; a global act feeds both', async () => {
    const { consumer, a, b } = await personWithTwoLeads()
    await grant(consumer, campA.id)
    expect((await loadLeadTelemetry(a.id)).marketingConsent).toBe(true)
    expect((await loadLeadTelemetry(b.id)).marketingConsent).toBe(false)

    // The brand-era capture mints the NULL-campaign twin, which every scope
    // merges — so it lifts B too, without B ever having its own grant.
    await grant(consumer, null)
    expect((await loadLeadTelemetry(a.id)).marketingConsent).toBe(true)
    expect((await loadLeadTelemetry(b.id)).marketingConsent).toBe(true)
  })

  test('a global revoke zeroes them all', async () => {
    const { consumer, a, b } = await personWithTwoLeads()
    await grant(consumer, campA.id)
    await grant(consumer, null)
    await ConsentEvent.create({
      consumerId: consumer.id,
      campaignId: null,
      kind: 'contact',
      granted: false,
      verified: true,
      version: 'test-v1',
      occurredAt: new Date(Date.now() + 1000),
      source: 'unsubscribe',
    })
    expect((await loadLeadTelemetry(a.id)).marketingConsent).toBe(false)
    expect((await loadLeadTelemetry(b.id)).marketingConsent).toBe(false)
  })
})

describe('one authority — the person score is a projection (§4)', () => {
  test('the person takes the highest-scoring lead, and follows it when that changes', async () => {
    const { consumer, a, b } = await personWithTwoLeads()
    // Give A a screening qualification so it outscores B decisively.
    await sequelize.query(
      `UPDATE prospects SET "screeningVerdict" = 'qualified',
          "screeningMetadata" = :meta::jsonb WHERE id = :id`,
      {
        replacements: {
          id: a.id,
          meta: JSON.stringify({
            verdictDetail: { interestLevel: 'hot', sentiment: 'Positive', decidedAt: new Date().toISOString() },
          }),
        },
      }
    )
    const ra = await scoreOf(a.id)
    const rb = await scoreOf(b.id)
    expect(ra.score).toBeGreaterThan(rb.score)

    const profile = await ConsumerProfile.findByPk(consumer.id)
    expect(profile.consumerScore).toBe(ra.score)
    expect(profile.meetScore).toBe(ra.meetScore)
    expect(profile.buyScore).toBe(ra.buyScore)
    // The breakdown travels with the numbers, or the card would render
    // components that don't sum to the score above them.
    expect(profile.scoreBreakdown.groups.meet.score).toBe(ra.meetScore)
  })

  test('scoreOneConsumer no longer writes the numbers — only the lead scorer does', async () => {
    const { consumer, a } = await personWithTwoLeads()
    await scoreOf(a.id)
    const before = await ConsumerProfile.findByPk(consumer.id)

    const { scoreOneConsumer } = await import('../src/services/consumerScoringService.js')
    const r = await scoreOneConsumer(consumer.id, { force: true })
    expect(r.status).toBe('scored')

    const after = await ConsumerProfile.findByPk(consumer.id)
    // It still computes and returns a person-grain view, and still stamps what
    // scored it — but the stored numbers are the projection's, untouched.
    expect(after.consumerScore).toBe(before.consumerScore)
    expect(after.meetScore).toBe(before.meetScore)
    expect(after.buyScore).toBe(before.buyScore)
    expect(after.scoredConfigVersion).not.toBeNull()
  })
})

describe('the write gate (§6)', () => {
  test('a second pass with nothing moved does not rewrite', async () => {
    const { a } = await personWithTwoLeads()
    expect((await scoreOneLead(a.id)).status).toBe('scored')
    const first = await rowOf(a.id)
    const second = await scoreOneLead(a.id)
    expect(second.status).toBe('unchanged')
    expect((await rowOf(a.id)).scoreComputedAt.toISOString())
      .toBe(first.scoreComputedAt.toISOString())
  })

  test('decay that moves the integer DOES rewrite, at the same inputs', async () => {
    const { consumer, a } = await personWithTwoLeads()
    await sendAndStatus(a, consumer, 'read', { at: new Date('2026-07-01T00:00:00Z') })
    await scoreOneLead(a.id, { now: new Date('2026-07-02T00:00:00Z').getTime() })
    const fresh = await rowOf(a.id)

    // Two years later: identical facts, identical config, identical hash —
    // only the clock moved. The person-grain gate would skip this forever.
    const r = await scoreOneLead(a.id, { now: new Date('2028-07-02T00:00:00Z').getTime() })
    expect(r.status).toBe('scored')
    const aged = await rowOf(a.id)
    expect(aged.scoreInputHash).toBe(fresh.scoreInputHash)
    expect(aged.score).toBeLessThan(fresh.score)
  })

  test('a dirty marker forces a rewrite and is cleared by it', async () => {
    const { a } = await personWithTwoLeads()
    await scoreOneLead(a.id)
    expect((await scoreOneLead(a.id)).status).toBe('unchanged')

    await sequelize.transaction((t) => markLeadsDirtyTx(t, [a.id]))
    expect((await rowOf(a.id)).scoreDirtyAt).not.toBeNull()
    // Dirty ⇒ provably stale ⇒ first claim on the sweep's budget.
    // No configVersion: staleness resolves each lead's own campaign → product
    // → global chain in SQL now (§9). Full coverage of that lives in
    // test/scoringConfigResolution.test.js; what this asserts is the dirty
    // marker's own clause.
    expect(await findStaleLeadIds({ limit: 500 })).toContain(a.id)

    expect((await scoreOneLead(a.id)).status).toBe('scored')
    expect((await rowOf(a.id)).scoreDirtyAt).toBeNull()
  })

  test('the algorithm version is the lead lineage, not the person one', async () => {
    const { a } = await personWithTwoLeads()
    await scoreOneLead(a.id)
    expect((await rowOf(a.id)).scoringAlgorithmVersion).toBe(LEAD_ALGORITHM_VERSION)
    expect(LEAD_ALGORITHM_VERSION).toBe('lead/v1')
  })
})

describe('erasure (§11)', () => {
  test('erasing the person nulls the score, the breakdown and every stamp', async () => {
    const { consumer, a, b } = await personWithTwoLeads()
    await sendAndStatus(a, consumer, 'read')
    await scoreOf(a.id)
    await scoreOf(b.id)
    expect((await rowOf(a.id)).score).not.toBeNull()
    expect((await rowOf(a.id)).scoreBreakdown.events.length).toBeGreaterThan(0)

    await eraseConsumer(consumer.id, { actorUser: admin, reason: 'lead score erasure test' })

    for (const id of [a.id, b.id]) {
      const p = await rowOf(id)
      expect(p.score).toBeNull()
      expect(p.meetScore).toBeNull()
      expect(p.buyScore).toBeNull()
      // The breakdown is the sharp end: it carried read timestamps and the
      // inferred screening sentiment.
      expect(p.scoreBreakdown).toBeNull()
      expect(p.scoreComputedAt).toBeNull()
      expect(p.scoredConfigVersion).toBeNull()
      expect(p.scoringAlgorithmVersion).toBeNull()
      expect(p.scoreInputHash).toBeNull()
      expect(p.scoreDirtyAt).toBeNull()
    }
  })

  test('an erased person\'s leads are not handed back by the stale query', async () => {
    const { consumer, a } = await personWithTwoLeads()
    await scoreOf(a.id)
    await eraseConsumer(consumer.id, { actorUser: admin, reason: 'lead score erasure fence' })
    const stale = await findStaleLeadIds({ limit: 1000 })
    expect(stale).not.toContain(a.id)
  })
})
