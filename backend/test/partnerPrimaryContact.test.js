/**
 * M7 (review round 3): at most one live primary contact per partner, even
 * under concurrency.
 *
 * Pre-fix, two concurrent addContact(..., {isPrimary:true}) transactions on a
 * partner with no contacts both demoted ZERO rows and both inserted a primary
 * — no lock serialized the switch and no index rejected the second row. The
 * cadence materializer then silently picked the OLDER primary by createdAt,
 * so automated outreach could target a different person than the operator's
 * chosen primary.
 *
 * Post-fix the parent partner row is locked for the demote+insert pair, and
 * the partial unique index uq_pc_one_live_primary (migration 109) makes a
 * second live primary unstorable outright.
 */
import { getApp, closeDb, createTestUser } from './helpers.js'
import { PartnerContact, PartnerOrganisation, sequelize } from '../src/models/index.js'
import partnerService from '../src/services/redeemOps/partnerService.js'

let admin

beforeAll(async () => {
  await getApp()
  admin = (await createTestUser({ role: 'admin' })).user
})

afterAll(async () => {
  await closeDb()
})

async function makePartner(name) {
  return PartnerOrganisation.create({
    legalName: name,
    normalizedName: name.toLowerCase(),
    createdBy: admin.id,
    ownerUserId: admin.id,
  })
}

const livePrimaries = (partnerId) => PartnerContact.count({
  where: { partnerOrganisationId: partnerId, isPrimary: true, archivedAt: null },
})

describe('M7 — one live primary per partner', () => {
  it('two CONCURRENT make-primary adds leave exactly ONE live primary', async () => {
    const partner = await makePartner('Primary Race Nails')

    const results = await Promise.allSettled([
      partnerService.addContact(partner.id, { name: 'Alice Tan', isPrimary: true }, admin),
      partnerService.addContact(partner.id, { name: 'Ben Lim', isPrimary: true }, admin),
    ])

    // Both requests may succeed (the lock serializes them — the second demotes
    // the first) — what must NEVER happen is two live primaries.
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true)
    expect(await livePrimaries(partner.id)).toBe(1)
  })

  it('a sequential switch demotes the old primary (operator intent follows the latest set)', async () => {
    const partner = await makePartner('Primary Switch Spa')
    const a = await partnerService.addContact(partner.id, { name: 'First Person', isPrimary: true }, admin)
    const b = await partnerService.addContact(partner.id, { name: 'Second Person', isPrimary: true }, admin)

    expect(await livePrimaries(partner.id)).toBe(1)
    expect((await PartnerContact.findByPk(a.id)).isPrimary).toBe(false)
    expect((await PartnerContact.findByPk(b.id)).isPrimary).toBe(true)
  })

  it('updateContact promotion swaps, never duplicates', async () => {
    const partner = await makePartner('Primary Update Gym')
    const a = await partnerService.addContact(partner.id, { name: 'Old Primary', isPrimary: true }, admin)
    const b = await partnerService.addContact(partner.id, { name: 'New Primary' }, admin)

    await partnerService.updateContact(b.id, { isPrimary: true }, admin)
    expect(await livePrimaries(partner.id)).toBe(1)
    expect((await PartnerContact.findByPk(a.id)).isPrimary).toBe(false)
    expect((await PartnerContact.findByPk(b.id)).isPrimary).toBe(true)
  })

  it('the DB backstop: a raw second live primary violates uq_pc_one_live_primary', async () => {
    const partner = await makePartner('Primary Backstop Cafe')
    await partnerService.addContact(partner.id, { name: 'Held Primary', isPrimary: true }, admin)
    const rogue = await partnerService.addContact(partner.id, { name: 'Rogue Contact' }, admin)

    await expect(
      sequelize.query('UPDATE partner_contacts SET "isPrimary" = true WHERE id = :id', {
        replacements: { id: rogue.id },
      })
    ).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' })
  })

  it('an ARCHIVED primary does not block a new live primary', async () => {
    const partner = await makePartner('Primary Archive Bar')
    const a = await partnerService.addContact(partner.id, { name: 'Departed Primary', isPrimary: true }, admin)
    await sequelize.query(
      'UPDATE partner_contacts SET "archivedAt" = now() WHERE id = :id',
      { replacements: { id: a.id } }
    )

    const b = await partnerService.addContact(partner.id, { name: 'Replacement Primary', isPrimary: true }, admin)
    expect(b.isPrimary).toBe(true)
    expect(await livePrimaries(partner.id)).toBe(1)
  })
})
