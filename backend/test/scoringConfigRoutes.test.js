import express from 'express'
import request from 'supertest'
import path from 'path'
import { fileURLToPath } from 'url'
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js'
import { sequelize } from '../src/models/index.js'
import scoringConfigsRouter, { meta } from '../src/routes/scoringConfigs.js'
import { createDraftConfig } from '../src/services/scoringConfigService.js'
import { _resetConfigCache } from '../src/services/consumerScoringService.js'
import { DEFAULT_SCORING_CONFIG } from '../src/utils/consumerScoring.js'

/**
 * The scoring-config admin surface (per-campaign-lead-scoring.md §8, PR D).
 *
 * TWO THINGS THIS FILE EXISTS TO PROVE:
 *
 *  1. THE ROUTER IS DARK BY DEFAULT. These endpoints author the rules that
 *     score every lead, and /propose spends money at a provider. The flag is
 *     asserted on the exported `meta`, because that descriptor is what
 *     routes/index.js actually reads — a test that only mounted the router by
 *     hand would pass while the real app skipped it, or mounted it wide open.
 *  2. APPROVAL IS THE ONLY DOOR TO LIVE. Every other verb here leaves the
 *     resolver's answer unchanged.
 *
 * The router is mounted on a bare express app rather than the real one, since
 * the real app deliberately does NOT mount it under the default flag value.
 * /propose is exercised in scoringConfigAuthoring.test.js, where the provider
 * can be injected; it is not reachable through HTTP without one.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(__dirname, '../src/database/migrations')

let app, adminToken, agentToken, campaign

const config = (agePoints) => ({
  ...DEFAULT_SCORING_CONFIG,
  components: { ...DEFAULT_SCORING_CONFIG.components, age: { maxPoints: agePoints } },
})

const clearConfigs = () => sequelize.query('DELETE FROM enrichment_scoring_configs')

beforeAll(async () => {
  // Boots the DB + models; the real app is not used for routing here.
  await getApp()
  const { up: up100 } = await import(path.join(migrationsDir, '100-scoring-config-scope.js'))
  await up100(sequelize.getQueryInterface())

  const admin = await createTestUser({ role: 'admin' })
  adminToken = admin.token
  const agent = await createTestUser({ role: 'agent' })
  agentToken = agent.token
  campaign = await createTestCampaign(admin.user.id, {
    name: `Routes ${Date.now()}`,
    targetAudience: { objective: 'agent_leads', product: 'insurance' },
  })

  app = express()
  app.use(express.json())
  app.use(meta.path, scoringConfigsRouter)
   
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || 500).json({ success: false, message: err.message })
  })
})

beforeEach(async () => {
  await clearConfigs()
  _resetConfigCache()
})

afterAll(async () => {
  await clearConfigs()
  await closeDb()
})

const asAdmin = (r) => r.set('Authorization', `Bearer ${adminToken}`)

describe('the surface is dark and admin-only', () => {
  test('the route descriptor is flag-gated, and the flag defaults OFF', () => {
    expect(meta.path).toBe('/api/admin/scoring-configs')
    expect(meta.flag).toBe('SCORING_CONFIG_ADMIN_ENABLED')
    expect(meta.flagDefault).toBe('false')
  })

  test('the real app does not mount it under the default flag', async () => {
    const realApp = await getApp()
    const res = await request(realApp)
      .get('/api/admin/scoring-configs')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(404)
  })

  test('an unauthenticated caller is refused', async () => {
    expect((await request(app).get(`${meta.path}/`)).status).toBe(401)
  })

  test('a non-admin is refused', async () => {
    const res = await request(app).get(`${meta.path}/`).set('Authorization', `Bearer ${agentToken}`)
    expect(res.status).toBe(403)
  })
})

describe('authoring and listing', () => {
  test('POST / stores a draft and GET / lists it', async () => {
    const created = await asAdmin(request(app).post(`${meta.path}/`))
      .send({ config: config(9), campaignId: campaign.id })
    expect(created.status).toBe(201)
    expect(created.body.data.status).toBe('draft')
    expect(created.body.data.scope).toBe('campaign')

    const list = await asAdmin(request(app).get(`${meta.path}/?status=draft`))
    expect(list.status).toBe(200)
    expect(list.body.data.map((r) => r.version)).toContain(created.body.data.version)
  })

  test('POST / re-runs the semantic invariants — no door skips them', async () => {
    const res = await asAdmin(request(app).post(`${meta.path}/`))
      .send({ config: { components: { telepathy: { maxPoints: 10 } } } })
    expect(res.status).toBe(422)
    expect(res.body.message).toMatch(/not a scoreable component/)
  })

  test('POST / refuses two scopes at once', async () => {
    const res = await asAdmin(request(app).post(`${meta.path}/`))
      .send({ config: config(5), campaignId: campaign.id, productKey: 'insurance' })
    expect(res.status).toBe(422)
    expect(res.body.message).toMatch(/one scope/)
  })

  test('POST / rejects an unknown productKey at the Joi door', async () => {
    const res = await asAdmin(request(app).post(`${meta.path}/`))
      .send({ config: config(5), productKey: 'crypto' })
    expect(res.status).toBe(400)
  })

  test('GET /:version 400s on a non-integer rather than hunting for a row', async () => {
    expect((await asAdmin(request(app).get(`${meta.path}/not-a-number`))).status).toBe(400)
  })

  test('GET /:version 404s on a version that does not exist', async () => {
    expect((await asAdmin(request(app).get(`${meta.path}/999999`))).status).toBe(404)
  })

  test('GET /:version carries the houseDefault ghosts the lead-page sheet peek renders', async () => {
    const draft = await createDraftConfig({ config: config(7), campaignId: campaign.id })
    const res = await asAdmin(request(app).get(`${meta.path}/${draft.version}`))
    expect(res.status).toBe(200)
    expect(res.body.data.houseDefault.components.age.maxPoints)
      .toBe(DEFAULT_SCORING_CONFIG.components.age.maxPoints)
    // leadComponents defaulted the way the scorer defaults them.
    expect(res.body.data.houseDefault.leadComponents.screening.maxPoints).toBe(20)
  })
})

/** The observed live baseline for a scope — what the editor sends (§4.5). */
async function liveVersionFor(query = '') {
  const res = await asAdmin(request(app).get(`${meta.path}/resolve?${query}${query ? '&' : ''}strict=1`))
  return res.body.data.version
}

describe('resolve answers "which config scores this campaign, and why"', () => {
  test('reports the winning tier', async () => {
    const g = await createDraftConfig({ config: config(3) })
    await asAdmin(request(app).post(`${meta.path}/${g.version}/approve`))
      .send({ expectedLiveVersion: await liveVersionFor() })

    const res = await asAdmin(request(app).get(`${meta.path}/resolve?campaignId=${campaign.id}`))
    expect(res.status).toBe(200)
    expect(res.body.data.scope).toBe('global')
    expect(res.body.data.version).toBe(g.version)
  })

  test('refuses two scopes at once', async () => {
    const res = await asAdmin(request(app)
      .get(`${meta.path}/resolve?campaignId=${campaign.id}&productKey=insurance`))
    expect(res.status).toBe(400)
  })
})

describe('simulate writes nothing, approve is the only door to live', () => {
  test('POST /:version/simulate returns a distribution diff', async () => {
    const draft = await createDraftConfig({ config: config(9), campaignId: campaign.id })
    const res = await asAdmin(request(app).post(`${meta.path}/${draft.version}/simulate`))
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('before')
    expect(res.body.data).toHaveProperty('after')
    expect(res.body.data.diff).toHaveProperty('movedOver20')
    expect(res.body.data.population).toHaveProperty('truncated')
  })

  test('simulating leaves the draft a draft', async () => {
    const draft = await createDraftConfig({ config: config(9), campaignId: campaign.id })
    await asAdmin(request(app).post(`${meta.path}/${draft.version}/simulate`))
    const after = await asAdmin(request(app).get(`${meta.path}/${draft.version}`))
    expect(after.body.data.status).toBe('draft')

    const resolved = await asAdmin(request(app).get(`${meta.path}/resolve?campaignId=${campaign.id}`))
    expect(resolved.body.data.version).not.toBe(draft.version)
  })

  test('POST /:version/approve makes it live and is refused a second time', async () => {
    const draft = await createDraftConfig({ config: config(9), campaignId: campaign.id })
    // The concurrency guard is REQUIRED at the route: no body → 400, wrong
    // baseline → 409 with the re-open-preview sentence (§4.5).
    expect((await asAdmin(request(app).post(`${meta.path}/${draft.version}/approve`)).send({})).status).toBe(400)
    const stale = await asAdmin(request(app).post(`${meta.path}/${draft.version}/approve`))
      .send({ expectedLiveVersion: 999999 })
    expect(stale.status).toBe(409)
    expect(stale.body.message).toMatch(/changed while you were editing/)

    const ok = await asAdmin(request(app).post(`${meta.path}/${draft.version}/approve`))
      .send({ expectedLiveVersion: await liveVersionFor(`campaignId=${campaign.id}`) })
    expect(ok.status).toBe(200)
    expect(ok.body.data.status).toBe('approved')

    const resolved = await asAdmin(request(app).get(`${meta.path}/resolve?campaignId=${campaign.id}`))
    expect(resolved.body.data.version).toBe(draft.version)
    expect(resolved.body.data.scope).toBe('campaign')

    const again = await asAdmin(request(app).post(`${meta.path}/${draft.version}/approve`))
      .send({ expectedLiveVersion: draft.version })
    expect(again.status).toBe(409)
  })
})

// ── the editor's wire additions (campaign-scoring-editor §3-§4) ─────────────

describe('strict resolve is the editor read path', () => {
  test('?strict=1 carries activation metadata, the raw doc, and houseDefault ghosts', async () => {
    const g = await createDraftConfig({ config: config(3) })
    await asAdmin(request(app).post(`${meta.path}/${g.version}/approve`))
      .send({ expectedLiveVersion: await liveVersionFor() })

    const res = await asAdmin(request(app).get(`${meta.path}/resolve?campaignId=${campaign.id}&strict=1`))
    expect(res.status).toBe(200)
    expect(res.body.data.version).toBe(g.version)
    expect(res.body.data.scope).toBe('global')
    expect(res.body.data.raw.components.age.maxPoints).toBe(3)
    expect(res.body.data.activatedAt).toBeTruthy()
    // The server-owned ghost/reset source (round-2 B12).
    expect(res.body.data.houseDefault.components.age.maxPoints)
      .toBe(DEFAULT_SCORING_CONFIG.components.age.maxPoints)
  })

  test('version 0 is the legitimate house-default baseline, raw {}', async () => {
    const res = await asAdmin(request(app).get(`${meta.path}/resolve?campaignId=${campaign.id}&strict=1`))
    expect(res.status).toBe(200)
    expect(res.body.data.version).toBe(0)
    expect(res.body.data.scope).toBe('default')
    expect(res.body.data.raw).toEqual({})
  })

  test('a malformed campaignId is a 400 sentence, not a Postgres cast error', async () => {
    const res = await asAdmin(request(app).get(`${meta.path}/resolve?campaignId=not-a-uuid&strict=1`))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/UUID/)
  })
})

describe('GET /progress rides before /:version', () => {
  test('the word "progress" is a route, not a version number', async () => {
    const res = await asAdmin(request(app).get(`${meta.path}/progress?campaignId=${campaign.id}`))
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('total')
    expect(res.body.data).toHaveProperty('current')
    expect(res.body.data).toHaveProperty('complete')
  })

  test('campaignId is required', async () => {
    expect((await asAdmin(request(app).get(`${meta.path}/progress`))).status).toBe(400)
  })
})

describe('the history list is scope-filterable server-side', () => {
  test('campaignId filter applies BEFORE the limit, and rows carry createdAt + actor name', async () => {
    // Noise: global editions that would crowd a client-side filter's window.
    for (let i = 0; i < 3; i += 1) {
      await createDraftConfig({ config: config(4 + i) })
    }
    const mine = await createDraftConfig({ config: config(9), campaignId: campaign.id })

    const res = await asAdmin(request(app).get(`${meta.path}/?campaignId=${campaign.id}`))
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].version).toBe(mine.version)
    expect(res.body.data[0]).toHaveProperty('createdAt')
    expect(res.body.data[0]).toHaveProperty('actorName')
  })

  test('two scope filters at once is a 422', async () => {
    const res = await asAdmin(request(app).get(`${meta.path}/?campaignId=${campaign.id}&productKey=insurance`))
    expect(res.status).toBe(422)
  })
})

describe('the editor draft door composes on the resolved winner', () => {
  test('POST / with composeOnResolved merges the patch onto the live raw doc', async () => {
    const g = await createDraftConfig({
      config: { ...config(5), decay: { engagementHalfLifeDays: 90, lifeEventHalfLifeDays: 365 } },
    })
    await asAdmin(request(app).post(`${meta.path}/${g.version}/approve`))
      .send({ expectedLiveVersion: await liveVersionFor() })

    const res = await asAdmin(request(app).post(`${meta.path}/`))
      .send({
        campaignId: campaign.id,
        composeOnResolved: true,
        config: { components: { age: { maxPoints: 8 } } },
      })
    expect(res.status).toBe(201)
    expect(res.body.data.configJson.components.age.maxPoints).toBe(8)
    // The winner's explicit extras rode into the campaign edition.
    expect(res.body.data.configJson.decay.engagementHalfLifeDays).toBe(90)
    expect(res.body.data.configJson.components.engagement.maxPoints)
      .toBe(DEFAULT_SCORING_CONFIG.components.engagement.maxPoints)
  })
})

describe('the no-op approve contract (§4.6)', () => {
  test('content-equal approve answers 200 {noOp:true} and the candidate stays a draft', async () => {
    const g = await createDraftConfig({ config: config(3) })
    await asAdmin(request(app).post(`${meta.path}/${g.version}/approve`))
      .send({ expectedLiveVersion: await liveVersionFor() })

    const dup = await createDraftConfig({ config: config(3), campaignId: campaign.id })
    const res = await asAdmin(request(app).post(`${meta.path}/${dup.version}/approve`))
      .send({ expectedLiveVersion: g.version })

    expect(res.status).toBe(200)
    expect(res.body.data.noOp).toBe(true)
    expect(res.body.data.live.version).toBe(g.version)
    expect(res.body.data.candidateVersion).toBe(dup.version)

    const after = await asAdmin(request(app).get(`${meta.path}/${dup.version}`))
    expect(after.body.data.status).toBe('draft')
  })
})

describe("simulate's compareTo rides the route", () => {
  test("body {compareTo:'resolved'} reaches the service and reports its base", async () => {
    const draft = await createDraftConfig({ config: config(9), campaignId: campaign.id })
    const res = await asAdmin(request(app).post(`${meta.path}/${draft.version}/simulate`))
      .send({ compareTo: 'resolved', sampleMax: 50 })
    expect(res.status).toBe(200)
    expect(res.body.data.comparedTo).toBe('resolved')
    expect(res.body.data).toHaveProperty('resolvedVersion')
    expect(res.body.data).toHaveProperty('stored')
  })
})
