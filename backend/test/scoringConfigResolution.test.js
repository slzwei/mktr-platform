import { createHash } from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js'
import { sequelize, Consumer, Prospect } from '../src/models/index.js'
import { getActiveScoringConfig, _resetConfigCache } from '../src/services/consumerScoringService.js'
import {
  bustScoringConfigCache, _scoringConfigCacheSize,
} from '../src/services/scoringConfigCache.js'
import { scoreOneLead, findStaleLeadIds } from '../src/services/leadScoringService.js'
import { briefProductKey } from '../src/utils/campaignBrief.js'
import { DEFAULT_SCORING_CONFIG } from '../src/utils/consumerScoring.js'

/**
 * CONFIG RESOLUTION — campaign → product → global
 * (docs/plans/per-campaign-lead-scoring.md §9, PR C).
 *
 * Three properties carry this file:
 *
 *  1. RESOLUTION ORDER IS TIER-FIRST, NOT VERSION-FIRST. A campaign row with a
 *     LOWER version still beats a global row with a higher one; otherwise every
 *     global recalibration would silently repossess every campaign that had
 *     been tuned away from it.
 *  2. ONLY 'approved' RESOLVES. Before migration 100 the reader took the
 *     highest version outright, so an AI proposal inserted into this table
 *     would have been live within one cache TTL, before anyone read it (§8.3).
 *  3. THE TWO RESOLVERS AGREE. `getActiveScoringConfig` resolves in JS+SQL for
 *     scoring; `findStaleLeadIds` resolves in pure SQL for staleness. They are
 *     twins, and a divergence would mean the sweep either rescored forever or
 *     never noticed an approval — the parity block pins them against shared
 *     fixtures.
 *
 * SELF-CONTAINED STATE, for two separate reasons.
 *
 * ROWS: boot only seeds config rows on the FIRST boot of a fresh database —
 * `_migrations` is not a model table, so it survives sync({force:true}) while
 * the re-created config table comes back empty and runMigrations() skips
 * everything. So this file writes every row it reads and never assumes
 * 093/094/095's seeds are present.
 *
 * SCHEMA: the same trap costs this suite its CHECK CONSTRAINTS. sync() builds
 * the table from the model, which carries columns but not constraints, and a
 * reused database then skips migration 100 as already-applied. So the suite
 * replays 100's up() itself — it is idempotent by construction (ADD COLUMN IF
 * NOT EXISTS, catalog-guarded constraints, CREATE INDEX IF NOT EXISTS) — and
 * every assertion below runs against schema this file put there.
 */

let admin, campInsurance, campRecruitment, campNoBrief
let seq = Math.floor(Math.random() * 700000)
const sha256hex = (s) => createHash('sha256').update(s).digest('hex')
const e164 = () => `+65${(81000000 + (seq += 1)).toString()}`

/** A valid config that differs from every other row by one visible weight. */
const configWith = (agePoints) => ({
  ...DEFAULT_SCORING_CONFIG,
  components: { ...DEFAULT_SCORING_CONFIG.components, age: { maxPoints: agePoints } },
})

/**
 * Insert a config row WITHOUT naming a version — the identity column allocates
 * it (§9). That this works at all is the migration's contract: two concurrent
 * runtime writers used to race on MAX(version)+1.
 */
async function insertConfig({ config, campaignId = null, productKey = null, status = 'approved' }) {
  const [rows] = await sequelize.query(
    `INSERT INTO enrichment_scoring_configs
       ("configJson", "campaignId", "productKey", status, "activatedAt", "createdAt", "updatedAt")
     VALUES (:cfg::jsonb, :campaignId, :productKey, :status, now(), now(), now())
     RETURNING version`,
    { replacements: { cfg: JSON.stringify(config), campaignId, productKey, status } }
  )
  return rows[0].version
}

const clearConfigs = () => sequelize.query('DELETE FROM enrichment_scoring_configs')

const resolveFor = async (campaignId) => {
  _resetConfigCache()
  return getActiveScoringConfig({ campaignId })
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(__dirname, '../src/database/migrations')

beforeAll(async () => {
  await getApp()
  const { up: up100 } = await import(path.join(migrationsDir, '100-scoring-config-scope.js'))
  await up100(sequelize.getQueryInterface())

  const made = await createTestUser({ role: 'admin' })
  admin = made.user
  campInsurance = await createTestCampaign(admin.id, {
    name: `Cfg insurance ${Date.now()}`,
    targetAudience: { objective: 'agent_leads', product: 'insurance' },
  })
  campRecruitment = await createTestCampaign(admin.id, {
    name: `Cfg recruitment ${Date.now()}`,
    targetAudience: { objective: 'agent_leads', product: 'recruitment' },
  })
  campNoBrief = await createTestCampaign(admin.id, { name: `Cfg nobrief ${Date.now()}` })
})

beforeEach(async () => {
  await clearConfigs()
  _resetConfigCache()
})

afterAll(async () => {
  await clearConfigs()
  await closeDb()
})

describe('the resolution chain', () => {
  test('falls back to the code defaults at version 0 when the table is empty', async () => {
    const r = await resolveFor(campInsurance.id)
    expect(r.version).toBe(0)
    expect(r.scope).toBe('default')
    expect(r.config.components.age.maxPoints).toBe(DEFAULT_SCORING_CONFIG.components.age.maxPoints)
  })

  test('step 3 — a campaign with no product and no row of its own gets global', async () => {
    await insertConfig({ config: configWith(3) })
    const r = await resolveFor(campNoBrief.id)
    expect(r.scope).toBe('global')
    expect(r.config.components.age.maxPoints).toBe(3)
  })

  test('step 2 — product beats global for a campaign whose brief names that product', async () => {
    await insertConfig({ config: configWith(3) })
    await insertConfig({ config: configWith(7), productKey: 'insurance' })

    expect((await resolveFor(campInsurance.id)).config.components.age.maxPoints).toBe(7)
    expect((await resolveFor(campInsurance.id)).scope).toBe('product')
    // A different product does not inherit it.
    expect((await resolveFor(campRecruitment.id)).config.components.age.maxPoints).toBe(3)
    // Nor does a campaign with no brief at all — it skips step 2 entirely.
    expect((await resolveFor(campNoBrief.id)).config.components.age.maxPoints).toBe(3)
  })

  test('step 1 — a campaign row beats both, even at a LOWER version', async () => {
    const campaignVersion = await insertConfig({ config: configWith(9), campaignId: campInsurance.id })
    const productVersion = await insertConfig({ config: configWith(7), productKey: 'insurance' })
    const globalVersion = await insertConfig({ config: configWith(3) })

    expect(campaignVersion).toBeLessThan(productVersion)
    expect(productVersion).toBeLessThan(globalVersion)

    const r = await resolveFor(campInsurance.id)
    // Tier-first: the OLDEST row wins because it is the most specific.
    expect(r.version).toBe(campaignVersion)
    expect(r.scope).toBe('campaign')
    expect(r.config.components.age.maxPoints).toBe(9)
  })

  test('within a tier the highest version wins — recalibration is an append', async () => {
    await insertConfig({ config: configWith(7), productKey: 'insurance' })
    const newer = await insertConfig({ config: configWith(8), productKey: 'insurance' })
    const r = await resolveFor(campInsurance.id)
    expect(r.version).toBe(newer)
    expect(r.config.components.age.maxPoints).toBe(8)
  })

  test('no campaign at all (the person grain) resolves GLOBAL, never a campaign row', async () => {
    await insertConfig({ config: configWith(9), campaignId: campInsurance.id })
    await insertConfig({ config: configWith(7), productKey: 'insurance' })
    await insertConfig({ config: configWith(3) })

    _resetConfigCache()
    const r = await getActiveScoringConfig()
    expect(r.scope).toBe('global')
    expect(r.config.components.age.maxPoints).toBe(3)
  })

  test('a campaign deleted out from under its rows leaves the leads resolving global', async () => {
    // §9's snapshot semantics: there is deliberately no FK, so the row survives
    // as unreachable history rather than cascading away a version that leads
    // still carry as their stamp.
    const doomed = await createTestCampaign(admin.id, {
      name: `Cfg doomed ${Date.now()}`,
      targetAudience: { objective: 'agent_leads', product: 'insurance' },
    })
    const scoped = await insertConfig({ config: configWith(9), campaignId: doomed.id })
    await insertConfig({ config: configWith(3) })

    await sequelize.query('DELETE FROM campaigns WHERE id = :id', { replacements: { id: doomed.id } })

    const [[still]] = await sequelize.query(
      'SELECT version FROM enrichment_scoring_configs WHERE version = :v',
      { replacements: { v: scoped } }
    )
    expect(still).toBeTruthy() // the stamp still resolves to a real row

    // A lead whose campaignId was nulled by the delete falls through to global.
    _resetConfigCache()
    expect((await getActiveScoringConfig({ campaignId: null })).config.components.age.maxPoints).toBe(3)
  })
})

describe('draft rows are invisible to the reader (§8.3)', () => {
  test('a draft at ANY scope never resolves, however high its version', async () => {
    await insertConfig({ config: configWith(3) })
    await insertConfig({ config: configWith(99), campaignId: campInsurance.id, status: 'draft' })
    await insertConfig({ config: configWith(98), productKey: 'insurance', status: 'draft' })
    await insertConfig({ config: configWith(97), status: 'draft' })

    const r = await resolveFor(campInsurance.id)
    expect(r.scope).toBe('global')
    expect(r.config.components.age.maxPoints).toBe(3)
  })

  test('a superseded row is equally invisible', async () => {
    await insertConfig({ config: configWith(3) })
    await insertConfig({ config: configWith(50), status: 'superseded' })
    expect((await resolveFor(campNoBrief.id)).config.components.age.maxPoints).toBe(3)
  })

  test('approving the draft is what makes it live', async () => {
    await insertConfig({ config: configWith(3) })
    const draft = await insertConfig({ config: configWith(9), campaignId: campInsurance.id, status: 'draft' })
    expect((await resolveFor(campInsurance.id)).scope).toBe('global')

    await sequelize.query(
      `UPDATE enrichment_scoring_configs SET status = 'approved' WHERE version = :v`,
      { replacements: { v: draft } }
    )
    const r = await resolveFor(campInsurance.id)
    expect(r.version).toBe(draft)
    expect(r.scope).toBe('campaign')
  })
})

describe('the database refuses an incoherent row', () => {
  test('a row cannot bind two scopes at once', async () => {
    await expect(insertConfig({
      config: configWith(5), campaignId: campInsurance.id, productKey: 'insurance',
    })).rejects.toThrow(/chk_escfg_single_scope/)
  })

  test('a status outside the vocabulary is refused — an unrecognised one is invisible, not pending', async () => {
    await expect(insertConfig({ config: configWith(5), status: 'pending' }))
      .rejects.toThrow(/chk_escfg_status/)
  })

  test('version allocates itself — concurrent writers cannot collide on MAX+1', async () => {
    const versions = await Promise.all([
      insertConfig({ config: configWith(1) }),
      insertConfig({ config: configWith(2) }),
      insertConfig({ config: configWith(3) }),
    ])
    expect(new Set(versions).size).toBe(3)
  })
})

describe('caching is per entry point, and busts whole-map', () => {
  test('a campaign entry and the global entry are separate slots', async () => {
    await insertConfig({ config: configWith(3) })
    bustScoringConfigCache()
    expect(_scoringConfigCacheSize()).toBe(0)

    await getActiveScoringConfig({ campaignId: campInsurance.id })
    await getActiveScoringConfig()
    expect(_scoringConfigCacheSize()).toBe(2)
  })

  test('an inherited entry is stale after an approval it cannot see — which is why the bust is whole-map', async () => {
    await insertConfig({ config: configWith(3) })
    bustScoringConfigCache()

    // campaign:C now caches the GLOBAL row (inherited).
    expect((await getActiveScoringConfig({ campaignId: campInsurance.id })).scope).toBe('global')

    // A campaign-scoped approval changes no row campaign:C's cached VALUE
    // points at, yet campaign:C must now resolve differently.
    await insertConfig({ config: configWith(9), campaignId: campInsurance.id })
    expect((await getActiveScoringConfig({ campaignId: campInsurance.id })).scope).toBe('global') // still cached

    bustScoringConfigCache()
    expect((await getActiveScoringConfig({ campaignId: campInsurance.id })).scope).toBe('campaign')
  })

  test('the TTL expires an entry without an explicit bust', async () => {
    await insertConfig({ config: configWith(3) })
    bustScoringConfigCache()
    const t0 = Date.now()
    expect((await getActiveScoringConfig({ campaignId: campInsurance.id, now: t0 })).config.components.age.maxPoints).toBe(3)

    await insertConfig({ config: configWith(9), campaignId: campInsurance.id })
    // Same instant: still the cached inherited row.
    expect((await getActiveScoringConfig({ campaignId: campInsurance.id, now: t0 })).scope).toBe('global')
    // 61s later: refetched, and the campaign row wins.
    expect((await getActiveScoringConfig({ campaignId: campInsurance.id, now: t0 + 61_000 })).scope).toBe('campaign')
  })
})

describe('the JS and SQL resolvers are twins', () => {
  /** One live lead per campaign, so findStaleLeadIds has something to judge. */
  async function leadOn(campaign) {
    const phone = e164()
    const consumer = await Consumer.create({
      phone, phoneHash: sha256hex(phone), signupCount: 1, verifiedSignupCount: 1,
      firstSeenAt: new Date(), lastSeenAt: new Date(),
    })
    return createTestProspect(campaign.id, { consumerId: consumer.id, phone })
  }

  test('briefProductKey matches what the SQL twin reads out of targetAudience', async () => {
    const [rows] = await sequelize.query(
      `SELECT id, "targetAudience"->>'product' AS sql_product, "targetAudience"
         FROM campaigns WHERE id IN (:a, :b, :c)`,
      { replacements: { a: campInsurance.id, b: campRecruitment.id, c: campNoBrief.id } }
    )
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      // The SQL side has no vocabulary check; it relies on productKey rows
      // being validated on the way in. For every real brief the two agree.
      expect(row.sql_product).toBe(briefProductKey(row.targetAudience))
    }
  })

  test('a lead is stale exactly when its OWN campaign resolves to a different version', async () => {
    const globalVersion = await insertConfig({ config: configWith(3) })
    const lead = await leadOn(campInsurance)
    const other = await leadOn(campRecruitment)

    // Both score under global.
    _resetConfigCache()
    await scoreOneLead(lead.id, { force: true })
    await scoreOneLead(other.id, { force: true })
    expect((await Prospect.findByPk(lead.id)).scoredConfigVersion).toBe(globalVersion)

    let stale = await findStaleLeadIds({ limit: 500 })
    expect(stale).not.toContain(lead.id)
    expect(stale).not.toContain(other.id)

    // An INSURANCE-scoped approval must dirty only the insurance lead.
    await insertConfig({ config: configWith(7), productKey: 'insurance' })
    stale = await findStaleLeadIds({ limit: 500 })
    expect(stale).toContain(lead.id)
    expect(stale).not.toContain(other.id)

    // Rescoring it under the newly-resolved config clears it, and stamps the
    // version the JS resolver picked — the two twins agreeing is the point.
    bustScoringConfigCache()
    await scoreOneLead(lead.id, { force: true })
    const resolved = await getActiveScoringConfig({ campaignId: campInsurance.id })
    expect((await Prospect.findByPk(lead.id)).scoredConfigVersion).toBe(resolved.version)
    expect(await findStaleLeadIds({ limit: 500 })).not.toContain(lead.id)
  })

  test('a global approval dirties everything still inheriting from global', async () => {
    await insertConfig({ config: configWith(3) })
    const inheriting = await leadOn(campNoBrief)
    const pinned = await leadOn(campInsurance)
    await insertConfig({ config: configWith(9), campaignId: campInsurance.id })

    bustScoringConfigCache()
    await scoreOneLead(inheriting.id, { force: true })
    await scoreOneLead(pinned.id, { force: true })
    expect(await findStaleLeadIds({ limit: 500 })).toEqual(
      expect.not.arrayContaining([inheriting.id, pinned.id])
    )

    await insertConfig({ config: configWith(4) }) // new global
    const stale = await findStaleLeadIds({ limit: 500 })
    expect(stale).toContain(inheriting.id)
    // The campaign-pinned lead does NOT inherit from global, so it is untouched.
    expect(stale).not.toContain(pinned.id)
  })

  test('scoreOneLead stamps the resolved version, and the weight actually applied is that row\'s', async () => {
    await insertConfig({ config: configWith(3) })
    const campaignVersion = await insertConfig({ config: configWith(25), campaignId: campInsurance.id })
    const lead = await leadOn(campInsurance)

    bustScoringConfigCache()
    await scoreOneLead(lead.id, { force: true })

    const row = await Prospect.findByPk(lead.id)
    expect(row.scoredConfigVersion).toBe(campaignVersion)
    expect(row.scoreBreakdown.components.age.maxPoints).toBe(25)
  })
})
