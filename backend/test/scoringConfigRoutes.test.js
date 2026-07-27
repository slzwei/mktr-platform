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
})

describe('resolve answers "which config scores this campaign, and why"', () => {
  test('reports the winning tier', async () => {
    const g = await createDraftConfig({ config: config(3) })
    await asAdmin(request(app).post(`${meta.path}/${g.version}/approve`))

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
    const ok = await asAdmin(request(app).post(`${meta.path}/${draft.version}/approve`))
    expect(ok.status).toBe(200)
    expect(ok.body.data.status).toBe('approved')

    const resolved = await asAdmin(request(app).get(`${meta.path}/resolve?campaignId=${campaign.id}`))
    expect(resolved.body.data.version).toBe(draft.version)
    expect(resolved.body.data.scope).toBe('campaign')

    const again = await asAdmin(request(app).post(`${meta.path}/${draft.version}/approve`))
    expect(again.status).toBe(409)
  })
})
