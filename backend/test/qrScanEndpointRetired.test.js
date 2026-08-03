/**
 * M3 (review round 3): the authenticated scan endpoint is retired.
 *
 * POST /api/qrcodes/:id/scan required only ANY valid login and loaded the tag
 * by PK with no buildOwnerWhere or admin check — any customer/agent who
 * obtained another owner's QR UUID could repeatedly inflate that tag's
 * scanCount and dailyScans analytics. The endpoint duplicated the public
 * tracker path (/t/:slug — the one real scan recorder, which M2 made
 * per-scanner and atomic) and no frontend surface ever called it, so per the
 * task's first option it is retired outright rather than scoped.
 */
import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestQrTag } from './helpers.js'
import { QrTag } from '../src/models/index.js'

let app, adminUser, adminToken, agentToken, campaign

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminUser = admin.user; adminToken = admin.token
  const agent = await createTestUser({ role: 'agent' })
  agentToken = agent.token
  campaign = await createTestCampaign(adminUser.id, { name: 'Scan Endpoint Retired' })
})

afterAll(async () => {
  await closeDb()
})

describe('M3 — POST /api/qrcodes/:id/scan no longer exists', () => {
  it("an agent can no longer inflate another owner's counters", async () => {
    const tag = await createTestQrTag(campaign.id, adminUser.id)

    const res = await request(app)
      .post(`/api/qrcodes/${tag.id}/scan`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({})

    // Pre-fix: 200 "Scan recorded successfully" — scanCount and dailyScans
    // of the admin's tag moved on a rival agent's request.
    expect(res.status).toBe(404)

    const row = await QrTag.findByPk(tag.id, { raw: true })
    expect(row.scanCount).toBe(0)
    expect(row.lastScanned).toBeNull()
  })

  it('the route is gone for admins too — the public tracker path is the recorder', async () => {
    const tag = await createTestQrTag(campaign.id, adminUser.id)

    const res = await request(app)
      .post(`/api/qrcodes/${tag.id}/scan`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})

    expect(res.status).toBe(404)
    expect((await QrTag.findByPk(tag.id, { raw: true })).scanCount).toBe(0)
  })
})
