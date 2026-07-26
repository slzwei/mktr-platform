import { createHash } from 'crypto'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js'
import { sequelize, Consumer, WaMessageSend } from '../src/models/index.js'
import { recordWaSend, WA_SEND_KINDS } from '../src/services/redeemOps/waMessageOwnership.js'
import { eraseConsumer } from '../src/services/erasureService.js'

/**
 * Send-time message ownership (per-campaign-lead-scoring.md §5, migration 096).
 *
 * Real Postgres: the value of this table is entirely in its write semantics —
 * the ON CONFLICT, the snapshot columns and the erasure delete — none of which
 * a mock can prove. The sender-side wiring (which kind each template stamps,
 * and that a failed send stamps nothing) is DI-tested in
 * src/tests/whatsappService.test.js.
 */

let admin, campA, campB
let seq = Math.floor(Math.random() * 700000)
const e164 = () => `+65${(81000000 + (seq += 1)).toString()}`
const sha256hex = (s) => createHash('sha256').update(s).digest('hex')

async function personWithLead(campaign = campA) {
  const phone = e164()
  const consumer = await Consumer.create({
    phone,
    phoneHash: sha256hex(phone),
    firstSeenAt: new Date('2026-06-01T00:00:00Z'),
    lastSeenAt: new Date('2026-06-01T00:00:00Z'),
    signupCount: 1,
    verifiedSignupCount: 1,
  })
  const prospect = await createTestProspect(campaign.id, { consumerId: consumer.id, phone })
  return { consumer, prospect }
}

const rowFor = (wamid) => WaMessageSend.findByPk(wamid)

beforeAll(async () => {
  await getApp()
  const made = await createTestUser({ role: 'admin' })
  admin = made.user
  campA = await createTestCampaign(admin.id, { name: `WaSends A ${Date.now()}` })
  campB = await createTestCampaign(admin.id, { name: `WaSends B ${Date.now()}` })
})

afterAll(async () => {
  await closeDb()
})

describe('recordWaSend — the ownership stamp', () => {
  test('stamps lead, campaign and consumer as they were at send', async () => {
    const { consumer, prospect } = await personWithLead()
    const wamid = `wamid.OK.${seq}`
    expect(await recordWaSend({ wamid, prospect, kind: 'draw_pass' })).toBe(true)

    const row = await rowFor(wamid)
    expect(row.prospectId).toBe(prospect.id)
    expect(row.campaignId).toBe(campA.id)
    expect(row.consumerId).toBe(consumer.id)
    expect(row.kind).toBe('draw_pass')
    expect(row.sentAt).toBeInstanceOf(Date)
  })

  test('the snapshot survives the lead moving campaign — ownership is not a live lookup', async () => {
    const { prospect } = await personWithLead()
    const wamid = `wamid.SNAP.${seq}`
    await recordWaSend({ wamid, prospect, kind: 'voucher' })

    // The lead is re-homed after the send. §5 exists because deriving
    // ownership later would now answer campB for a message sent for campA.
    await prospect.update({ campaignId: campB.id })

    const row = await rowFor(wamid)
    expect(row.campaignId).toBe(campA.id)
    expect(row.prospectId).toBe(prospect.id)
  })

  test('a repeated wamid never re-homes an existing row (ON CONFLICT DO NOTHING)', async () => {
    const { prospect } = await personWithLead()
    const other = await personWithLead(campB)
    const wamid = `wamid.DUP.${seq}`

    await recordWaSend({ wamid, prospect, kind: 'pass' })
    // Meta redelivery, or a second writer racing on the same id. The FIRST
    // owner stands: a wamid is unique, so a second insert can only be a repeat.
    expect(await recordWaSend({ wamid, prospect: other.prospect, kind: 'voucher' })).toBe(true)

    const row = await rowFor(wamid)
    expect(row.prospectId).toBe(prospect.id)
    expect(row.kind).toBe('pass')
    const [rows] = await sequelize.query('SELECT count(*)::int AS n FROM wa_message_sends WHERE wamid = :w', {
      replacements: { w: wamid },
    })
    expect(rows[0].n).toBe(1)
  })

  test('a resend is a second owned row — each send owns its own wamid', async () => {
    const { prospect } = await personWithLead()
    const first = `wamid.RS1.${seq}`
    const second = `wamid.RS2.${seq}`
    await recordWaSend({ wamid: first, prospect, kind: 'voucher' })
    await recordWaSend({ wamid: second, prospect, kind: 'voucher' })

    const [rows] = await sequelize.query(
      'SELECT wamid FROM wa_message_sends WHERE "prospectId" = :p ORDER BY wamid',
      { replacements: { p: prospect.id } }
    )
    expect(rows.map((r) => r.wamid)).toEqual([first, second])
  })

  test('a lead with no campaign is still owned — prospectId is the ownership', async () => {
    const { prospect } = await personWithLead()
    await sequelize.query('UPDATE prospects SET "campaignId" = NULL WHERE id = :id', {
      replacements: { id: prospect.id },
    })
    await prospect.reload()
    const wamid = `wamid.NOCAMP.${seq}`
    expect(await recordWaSend({ wamid, prospect, kind: 'pass' })).toBe(true)
    const row = await rowFor(wamid)
    expect(row.campaignId).toBeNull()
    expect(row.prospectId).toBe(prospect.id)
  })

  test('writes nothing without a wamid, without a lead, or with an unknown kind', async () => {
    const { prospect } = await personWithLead()
    expect(await recordWaSend({ wamid: null, prospect, kind: 'pass' })).toBe(false)
    expect(await recordWaSend({ wamid: `wamid.NOP.${seq}`, prospect: null, kind: 'pass' })).toBe(false)
    // The pre-prospect OTP shape: a phone, no lead. It must never invent one.
    expect(await recordWaSend({ wamid: `wamid.OTP.${seq}`, prospect: { phone: '+6591234567' }, kind: 'pass' })).toBe(false)
    expect(await recordWaSend({ wamid: `wamid.BAD.${seq}`, prospect, kind: 'otp' })).toBe(false)

    const [rows] = await sequelize.query(
      `SELECT count(*)::int AS n FROM wa_message_sends WHERE wamid LIKE 'wamid.%${seq}' AND wamid <> ''`
    )
    expect(rows[0].n).toBe(0)
  })

  test('the kind vocabulary is closed', () => {
    expect(WA_SEND_KINDS).toEqual(['pass', 'draw_pass', 'voucher', 'boost_receipt', 'screening_callback'])
  })
})

describe('erasure', () => {
  test('erasing the person deletes their ownership rows', async () => {
    const { consumer, prospect } = await personWithLead()
    const mine = `wamid.ERASE.${seq}`
    await recordWaSend({ wamid: mine, prospect, kind: 'voucher' })

    // A bystander's row, to prove the delete is keyed and not a truncate.
    const bystander = await personWithLead()
    const theirs = `wamid.KEEP.${seq}`
    await recordWaSend({ wamid: theirs, prospect: bystander.prospect, kind: 'voucher' })

    const report = await eraseConsumer(consumer.id, { actorUser: admin, reason: 'wa sends erasure test' })
    expect(report.waMessageSends).toBe(1)
    expect(await rowFor(mine)).toBeNull()
    expect(await rowFor(theirs)).not.toBeNull()
  })

  test('a pre-spine row with no consumerId is still erased, via its lead', async () => {
    const { consumer, prospect } = await personWithLead()
    const wamid = `wamid.PRESPINE.${seq}`
    // Ownership written before the spine linked this lead to a person.
    await recordWaSend({ wamid, prospect: { id: prospect.id, campaignId: campA.id }, kind: 'pass' })
    expect((await rowFor(wamid)).consumerId).toBeNull()

    await eraseConsumer(consumer.id, { actorUser: admin, reason: 'wa sends pre-spine erasure' })
    expect(await rowFor(wamid)).toBeNull()
  })
})
