import path from 'path'
import { fileURLToPath } from 'url'
import { getApp, closeDb } from './helpers.js'
import { sequelize } from '../src/models/index.js'

/**
 * Migration 100 — scope + lifecycle on enrichment_scoring_configs
 * (docs/plans/per-campaign-lead-scoring.md §9, PR C).
 *
 * The load-bearing properties:
 *
 *  - GRANDFATHERING. Pre-100 rows are live today. A default of anything but
 *    'approved' would blank the resolution for the whole population at the
 *    instant this runs.
 *  - VERSION ALLOCATION. Every writer from here on omits `version`. Two
 *    concurrent runtime writers (an AI draft and an admin approval, §8) used
 *    to race on the hand-allocated MAX(version)+1 pattern.
 *  - THE DOWN() DOES NOT PROMOTE A DRAFT. Dropping the columns bare would turn
 *    every draft and every scoped row into "global approved" — live on the next
 *    cache expiry, which is the exact failure §8 exists to prevent.
 *
 * SELF-CONTAINED: replays its own chain. `_migrations` survives
 * sync({force:true}), so on a reused test database the runner skips 100 while
 * the table itself comes back model-shaped and empty.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(__dirname, '../src/database/migrations')

let up, down, queryInterface

const rows = async () => {
  const [r] = await sequelize.query(
    'SELECT version, status, "campaignId", "productKey" FROM enrichment_scoring_configs ORDER BY version ASC'
  )
  return r
}

const constraintExists = async (name) => {
  const [[r]] = await sequelize.query(
    'SELECT 1 AS ok FROM pg_constraint WHERE conname = :name', { replacements: { name } }
  )
  return Boolean(r)
}

const indexExists = async (name) => {
  const [[r]] = await sequelize.query(
    'SELECT 1 AS ok FROM pg_class WHERE relname = :name AND relkind = \'i\'', { replacements: { name } }
  )
  return Boolean(r)
}

const hasSequence = async () => {
  const [[r]] = await sequelize.query(
    `SELECT pg_get_serial_sequence('enrichment_scoring_configs', 'version') AS seq`
  )
  return Boolean(r?.seq)
}

/** A minimal valid config body — this file tests DDL, not weights. */
const CFG = JSON.stringify({ algorithmVersion: 'score/v3' })

beforeAll(async () => {
  await getApp()
  ;({ up, down } = await import(path.join(migrationsDir, '100-scoring-config-scope.js')))
  queryInterface = sequelize.getQueryInterface()
})

beforeEach(async () => {
  // Rebuild the PRE-100 shape by hand: the columns this migration adds, gone.
  await down(queryInterface)
  await sequelize.query('DELETE FROM enrichment_scoring_configs')
})

afterAll(async () => {
  await up(queryInterface) // leave the schema forward for anything after us
  await sequelize.query('DELETE FROM enrichment_scoring_configs')
  await closeDb()
})

describe('migration 100 — up()', () => {
  it('grandfathers every pre-existing row as approved', async () => {
    // Written the pre-100 way: a hand-allocated version, no scope, no status.
    await sequelize.query(
      `INSERT INTO enrichment_scoring_configs (version, "configJson", "activatedAt", "createdAt", "updatedAt")
       VALUES (7, :cfg::jsonb, now(), now(), now())`,
      { replacements: { cfg: CFG } }
    )

    await up(queryInterface)

    const all = await rows()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ version: 7, status: 'approved', campaignId: null, productKey: null })
  })

  it('adds the scope constraint, the status vocabulary and the three partial indexes', async () => {
    await up(queryInterface)

    expect(await constraintExists('chk_escfg_single_scope')).toBe(true)
    expect(await constraintExists('chk_escfg_status')).toBe(true)
    expect(await indexExists('idx_escfg_campaign')).toBe(true)
    expect(await indexExists('idx_escfg_product')).toBe(true)
    expect(await indexExists('idx_escfg_global')).toBe(true)
  })

  it('leaves version self-allocating, continuing PAST the highest historical row', async () => {
    await sequelize.query(
      `INSERT INTO enrichment_scoring_configs (version, "configJson", "activatedAt", "createdAt", "updatedAt")
       VALUES (41, :cfg::jsonb, now(), now(), now())`,
      { replacements: { cfg: CFG } }
    )

    await up(queryInterface)
    expect(await hasSequence()).toBe(true)

    const [inserted] = await sequelize.query(
      `INSERT INTO enrichment_scoring_configs ("configJson", "activatedAt", "createdAt", "updatedAt")
       VALUES (:cfg::jsonb, now(), now(), now()) RETURNING version`,
      { replacements: { cfg: CFG } }
    )
    // 42, not a collision with 41 — the setval is what buys this.
    expect(inserted[0].version).toBe(42)
  })

  it('allocates from 1 on an empty table', async () => {
    await up(queryInterface)
    const [inserted] = await sequelize.query(
      `INSERT INTO enrichment_scoring_configs ("configJson", "activatedAt", "createdAt", "updatedAt")
       VALUES (:cfg::jsonb, now(), now(), now()) RETURNING version`,
      { replacements: { cfg: CFG } }
    )
    expect(inserted[0].version).toBe(1)
  })

  it('is idempotent — a second run changes nothing and does not throw', async () => {
    await up(queryInterface)
    const version = (await sequelize.query(
      `INSERT INTO enrichment_scoring_configs ("configJson", "campaignId", status, "activatedAt", "createdAt", "updatedAt")
       VALUES (:cfg::jsonb, gen_random_uuid(), 'draft', now(), now(), now()) RETURNING version`,
      { replacements: { cfg: CFG } }
    ))[0][0].version

    await expect(up(queryInterface)).resolves.not.toThrow()

    const all = await rows()
    expect(all).toHaveLength(1)
    expect(all[0].version).toBe(version)
    expect(all[0].status).toBe('draft')
  })

  it('the CHECKs it installs actually bite', async () => {
    await up(queryInterface)

    await expect(sequelize.query(
      `INSERT INTO enrichment_scoring_configs ("configJson", "campaignId", "productKey", "activatedAt", "createdAt", "updatedAt")
       VALUES (:cfg::jsonb, gen_random_uuid(), 'insurance', now(), now(), now())`,
      { replacements: { cfg: CFG } }
    )).rejects.toThrow(/chk_escfg_single_scope/)

    await expect(sequelize.query(
      `INSERT INTO enrichment_scoring_configs ("configJson", status, "activatedAt", "createdAt", "updatedAt")
       VALUES (:cfg::jsonb, 'live', now(), now(), now())`,
      { replacements: { cfg: CFG } }
    )).rejects.toThrow(/chk_escfg_status/)
  })
})

describe('migration 100 — down()', () => {
  it('deletes scoped and non-approved rows instead of promoting them to global-approved', async () => {
    await up(queryInterface)
    await sequelize.query(
      `INSERT INTO enrichment_scoring_configs ("configJson", "campaignId", "productKey", status, "activatedAt", "createdAt", "updatedAt")
       VALUES (:cfg::jsonb, NULL,             NULL,        'approved',   now(), now(), now()),
              (:cfg::jsonb, gen_random_uuid(), NULL,        'approved',   now(), now(), now()),
              (:cfg::jsonb, NULL,             'insurance', 'approved',   now(), now(), now()),
              (:cfg::jsonb, NULL,             NULL,        'draft',      now(), now(), now()),
              (:cfg::jsonb, NULL,             NULL,        'superseded', now(), now(), now())`,
      { replacements: { cfg: CFG } }
    )
    expect(await rows()).toHaveLength(5)

    await down(queryInterface)

    // Only the row that was global AND approved — the pre-100 state — remains.
    const [remaining] = await sequelize.query('SELECT version FROM enrichment_scoring_configs')
    expect(remaining).toHaveLength(1)
  })

  it('removes the columns, constraints and indexes', async () => {
    await up(queryInterface)
    await down(queryInterface)

    const [cols] = await sequelize.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'enrichment_scoring_configs'`
    )
    const names = cols.map((c) => c.column_name)
    expect(names).not.toContain('campaignId')
    expect(names).not.toContain('productKey')
    expect(names).not.toContain('status')

    expect(await constraintExists('chk_escfg_single_scope')).toBe(false)
    expect(await constraintExists('chk_escfg_status')).toBe(false)
    expect(await indexExists('idx_escfg_campaign')).toBe(false)
  })

  it('up → down → up round-trips', async () => {
    await up(queryInterface)
    await down(queryInterface)
    await expect(up(queryInterface)).resolves.not.toThrow()
    expect(await constraintExists('chk_escfg_status')).toBe(true)
    expect(await hasSequence()).toBe(true)
  })
})
