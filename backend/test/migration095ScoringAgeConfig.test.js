import path from 'path'
import { fileURLToPath } from 'url'
import { getApp, closeDb } from './helpers.js'
import { sequelize } from '../src/models/index.js'
import { normalizeConfig } from '../src/utils/consumerScoring.js'

/**
 * Migration 095 — the score/v3 config row (age curve, §13.2 / PR B).
 *
 * The append is what makes the change REAL in prod: the effective algorithm
 * version comes from the config row, and the stored groups.buy decides
 * whether age contributes to any sub-score at all. These tests pin the
 * mutation (curve + weight + grouping added, predecessor weights preserved),
 * idempotency, the dedupe guard on groups.buy, the down() surgical delete,
 * and the empty-table no-op.
 *
 * SELF-CONTAINED STATE: boot only seeds config rows on the FIRST boot of a
 * fresh database — `_migrations` bookkeeping is not a model table, so it
 * survives sync({force:true}) while the re-created config table comes back
 * empty and runMigrations() skips everything (runMigrations.js). So this
 * file wipes the table and replays the 093→094→095 chain itself; every
 * assertion is against state it built.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(__dirname, '../src/database/migrations')

let up093, up094, up, down, queryInterface

const rows = async () => {
  const [r] = await sequelize.query(
    'SELECT version, "configJson" FROM enrichment_scoring_configs ORDER BY version ASC'
  )
  return r
}
const top = async () => (await rows()).at(-1)

beforeAll(async () => {
  await getApp()
  ;({ up: up093 } = await import(path.join(migrationsDir, '093-consumer-scores.js')))
  ;({ up: up094 } = await import(path.join(migrationsDir, '094-scoring-recency-anchor.js')))
  ;({ up, down } = await import(path.join(migrationsDir, '095-scoring-age-curve.js')))
  queryInterface = sequelize.getQueryInterface()

  await sequelize.query('DELETE FROM enrichment_scoring_configs')
  await up093(queryInterface) // seeds v1 (score/v1); DDL is IF-NOT-EXISTS-safe
  await up094(queryInterface) // appends v2 (score/v2)
  await up(queryInterface) // appends v3 — the row under test
})

afterAll(async () => {
  await closeDb()
})

describe('migration 095 — score/v3 age config row', () => {
  it('the 093→095 chain leaves the v3 row on top: curve + age weight + Buy grouping, predecessor weights intact', async () => {
    const all = await rows()
    expect(all.map((r) => r.configJson.algorithmVersion)).toEqual(['score/v1', 'score/v2', 'score/v3'])

    const v3 = all.at(-1).configJson
    expect(v3.components.age).toEqual({ maxPoints: 10 })
    expect(v3.groups.buy).toContain('age')
    expect(v3.groups.buy.filter((n) => n === 'age')).toHaveLength(1)
    expect(Array.isArray(v3.ageCurve)).toBe(true)
    expect(v3.ageCurve.at(-1)).toEqual({ upTo: null, value: 0.3 })

    // An algorithm re-version + one added component — every predecessor
    // weight rides along untouched.
    const v2 = all.at(-2).configJson
    for (const [name, def] of Object.entries(v2.components)) {
      expect(v3.components[name]).toEqual(def)
    }
    expect(v3.targetSegments).toEqual(v2.targetSegments)
    expect(v3.decay).toEqual(v2.decay)

    // The stored row survives the reader's merge with age grouped exactly once.
    const merged = normalizeConfig(v3)
    expect(merged.groups.buy.filter((n) => n === 'age')).toHaveLength(1)
    expect(merged.ageCurve).toEqual(v3.ageCurve)
  })

  it('up() is idempotent — the highest row already carries score/v3', async () => {
    const before = await rows()
    await up(queryInterface)
    expect(await rows()).toEqual(before)
  })

  it('down() deletes exactly the appended row; up() re-appends at MAX+1', async () => {
    const before = await rows()
    expect(before).toHaveLength(3)

    await down(queryInterface)
    const afterDown = await rows()
    expect(afterDown).toHaveLength(2)
    expect(afterDown.at(-1).configJson.algorithmVersion).toBe('score/v2')

    await down(queryInterface) // no v3 on top — must touch nothing
    expect(await rows()).toEqual(afterDown)

    await up(queryInterface)
    const restored = await top()
    expect(restored.configJson).toEqual(before.at(-1).configJson)
  })

  it('does not duplicate age when the predecessor already grouped it', async () => {
    const t = await top()
    // A synthetic later calibration that already lists age but pins an older
    // algorithm version (as a human recalibration row could).
    const crafted = { ...t.configJson, algorithmVersion: 'score/v2' }
    await sequelize.query(
      `INSERT INTO enrichment_scoring_configs
         (version, "configJson", "activatedAt", "actorUserId", "createdAt", "updatedAt")
       VALUES (:v, :cfg::jsonb, now(), NULL, now(), now())`,
      { replacements: { v: t.version + 1, cfg: JSON.stringify(crafted) } }
    )

    await up(queryInterface)
    const appended = await top()
    expect(appended.version).toBe(t.version + 2)
    expect(appended.configJson.algorithmVersion).toBe('score/v3')
    expect(appended.configJson.groups.buy.filter((n) => n === 'age')).toHaveLength(1)

    await sequelize.query(
      'DELETE FROM enrichment_scoring_configs WHERE version > :v',
      { replacements: { v: t.version } }
    )
  })

  it('an empty table inserts nothing — code defaults already carry v3', async () => {
    // Runs LAST: it empties the table. Later-booting files see an empty
    // table anyway (see the header) and the reader falls back to code
    // defaults, so nothing leaks past this file.
    await sequelize.query('DELETE FROM enrichment_scoring_configs')
    await up(queryInterface)
    expect(await rows()).toHaveLength(0)
  })
})
