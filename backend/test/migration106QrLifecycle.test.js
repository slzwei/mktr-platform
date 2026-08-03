/**
 * 106 on real Postgres (M1). Self-contained replay: down() strips the
 * constraint + NOT NULL so drifted pre-106 rows can be seeded, up() must then
 * reconcile them with DEACTIVATION INTENT WINNING — a row either side ever
 * marked not-live goes not-live; reactivating a QR the admin believed dead is
 * the one wrong answer — and afterwards a single-column lifecycle write that
 * would reintroduce the drift must be unstorable (CHECK).
 */
import { getApp, closeDb, createTestUser, createTestCampaign, createTestQrTag } from './helpers.js'
import { sequelize, QrTag } from '../src/models/index.js'
import { up, down } from '../src/database/migrations/106-qr-lifecycle-coherence.js'

let admin, campaign

beforeAll(async () => {
  await getApp()
  admin = await createTestUser({ role: 'admin' })
  campaign = await createTestCampaign(admin.user.id, { name: 'Migration 106 Campaign' })
})

afterAll(async () => {
  await closeDb()
})

const qi = () => sequelize.getQueryInterface()

/** Seed a tag then force a drifted lifecycle pair via raw SQL (the model —
 *  and post-106 the CHECK — would refuse the contradiction). */
async function driftedTag({ status, active }) {
  const tag = await createTestQrTag(campaign.id, admin.user.id)
  await sequelize.query(
    `UPDATE qr_tags SET status = :status, active = ${active === null ? 'NULL' : ':active'} WHERE id = :id`,
    { replacements: { status, active, id: tag.id } }
  )
  return tag.id
}

const rowOf = async (id) => QrTag.findByPk(id, { raw: true })

test('reconciles every drift shape with deactivation intent winning, then locks coherence', async () => {
  await down(qi())

  const putDeactivated = await driftedTag({ status: 'active', active: false }) // PUT flipped the boolean only
  const bulkDeactivated = await driftedTag({ status: 'inactive', active: true }) // bulk flipped status only
  const archivedLive = await driftedTag({ status: 'archived', active: true })
  const legacyNull = await driftedTag({ status: 'active', active: null })
  const coherentLive = await driftedTag({ status: 'active', active: true })
  const coherentDead = await driftedTag({ status: 'inactive', active: false })

  await up(qi())

  // PUT-deactivated: the boolean's intent wins — status follows it down.
  expect(await rowOf(putDeactivated)).toMatchObject({ status: 'inactive', active: false })
  // Bulk-deactivated/archived: status wins — the boolean follows it down.
  expect(await rowOf(bulkDeactivated)).toMatchObject({ status: 'inactive', active: false })
  expect(await rowOf(archivedLive)).toMatchObject({ status: 'archived', active: false })
  // Legacy NULL on a live status: fail safe, never fail live.
  expect(await rowOf(legacyNull)).toMatchObject({ status: 'inactive', active: false })
  // Coherent rows pass through untouched.
  expect(await rowOf(coherentLive)).toMatchObject({ status: 'active', active: true })
  expect(await rowOf(coherentDead)).toMatchObject({ status: 'inactive', active: false })

  // The drift that started this is now unstorable: a lone status flip…
  await expect(
    sequelize.query('UPDATE qr_tags SET status = :s WHERE id = :id', {
      replacements: { s: 'inactive', id: coherentLive },
    })
  ).rejects.toThrow(/ck_qr_tags_lifecycle_coherent/)
  // …and a lone boolean flip both violate the CHECK.
  await expect(
    sequelize.query('UPDATE qr_tags SET active = false WHERE id = :id', {
      replacements: { id: coherentLive },
    })
  ).rejects.toThrow(/ck_qr_tags_lifecycle_coherent/)

  // Dual writes (what the services now do) pass.
  await sequelize.query(
    "UPDATE qr_tags SET status = 'inactive', active = false WHERE id = :id",
    { replacements: { id: coherentLive } }
  )
  expect(await rowOf(coherentLive)).toMatchObject({ status: 'inactive', active: false })
})
