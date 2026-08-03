/**
 * M1 (review round 3): one QR lifecycle truth across both fields.
 *
 * qr_tags carried TWO independent lifecycle fields: `status` (written by the
 * bulk activate/deactivate/archive ops, read by the authenticated scan path)
 * and `active` (written by PUT, read by the PUBLIC slug resolver and the
 * attribution resolver). Pre-fix, bulk-deactivating a printed QR flipped
 * status only — the tag stayed publicly resolvable after the admin saw a
 * successful deactivation; and PUT {active:false} flipped the boolean only —
 * the status-gated /:id/scan path still accepted the "disabled" tag.
 *
 * Post-fix `status` is canonical, `active` is its dual-written mirror
 * (migration 106 reconciles + adds the coherence CHECK), and every resolver
 * gates on the canonical lifecycle.
 */
import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestQrTag } from './helpers.js'
import { QrTag } from '../src/models/index.js'
import { resolveQrTag } from '../src/services/trackerService.js'

let app, adminToken, adminUser, campaign

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminUser = admin.user; adminToken = admin.token
  campaign = await createTestCampaign(adminUser.id, { name: 'QR Lifecycle Campaign' })
})

afterAll(async () => {
  await closeDb()
})

const bulk = (operation, qrTagIds) => request(app)
  .post('/api/qrcodes/bulk')
  .set('Authorization', `Bearer ${adminToken}`)
  .send({ operation, qrTagIds })

const putTag = (id, body) => request(app)
  .put(`/api/qrcodes/${id}`)
  .set('Authorization', `Bearer ${adminToken}`)
  .send(body)

describe('M1 — bulk lifecycle ops kill public resolution', () => {
  it('bulk deactivate stops the slug resolver, the scan path, and mirrors active=false', async () => {
    const tag = await createTestQrTag(campaign.id, adminUser.id)
    expect(await resolveQrTag(tag.slug)).not.toBeNull()

    const res = await bulk('deactivate', [tag.id])
    expect(res.status).toBe(200)

    // Pre-fix: status flipped but active stayed true — the printed QR kept
    // resolving publicly after a successful deactivation response.
    expect(await resolveQrTag(tag.slug)).toBeNull()
    const row = await QrTag.findByPk(tag.id, { raw: true })
    expect(row.status).toBe('inactive')
    expect(row.active).toBe(false)

  })

  it('bulk archive does the same', async () => {
    const tag = await createTestQrTag(campaign.id, adminUser.id)
    await bulk('archive', [tag.id])

    expect(await resolveQrTag(tag.slug)).toBeNull()
    const row = await QrTag.findByPk(tag.id, { raw: true })
    expect(row.status).toBe('archived')
    expect(row.active).toBe(false)
  })

  it('bulk activate restores both fields and resolution', async () => {
    const tag = await createTestQrTag(campaign.id, adminUser.id)
    await bulk('deactivate', [tag.id])
    await bulk('activate', [tag.id])

    expect(await resolveQrTag(tag.slug)).not.toBeNull()
    const row = await QrTag.findByPk(tag.id, { raw: true })
    expect(row.status).toBe('active')
    expect(row.active).toBe(true)
  })
})

describe('M1 — PUT {active} moves the canonical lifecycle too', () => {
  it('PUT {active:false} disables the status-gated scan path as well', async () => {
    const tag = await createTestQrTag(campaign.id, adminUser.id)
    const res = await putTag(tag.id, { active: false })
    expect(res.status).toBe(200)

    const row = await QrTag.findByPk(tag.id, { raw: true })
    expect(row.active).toBe(false)
    expect(row.status).toBe('inactive')

    // (The authenticated scan path this used to leak through was retired in
    // M3 — the resolver + row state above are the surviving lifecycle gates.)
    expect(await resolveQrTag(tag.slug)).toBeNull()
  })

  it('PUT {active:false} on an ARCHIVED tag preserves the archived state', async () => {
    const tag = await createTestQrTag(campaign.id, adminUser.id)
    await bulk('archive', [tag.id])

    const res = await putTag(tag.id, { active: false })
    expect(res.status).toBe(200)
    const row = await QrTag.findByPk(tag.id, { raw: true })
    expect(row.status).toBe('archived')
    expect(row.active).toBe(false)
  })

  it('PUT {active:true} relaunches: status follows, scan + resolver reopen', async () => {
    const tag = await createTestQrTag(campaign.id, adminUser.id)
    await putTag(tag.id, { active: false })
    const res = await putTag(tag.id, { active: true })
    expect(res.status).toBe(200)

    const row = await QrTag.findByPk(tag.id, { raw: true })
    expect(row.status).toBe('active')
    expect(row.active).toBe(true)
    expect(await resolveQrTag(tag.slug)).not.toBeNull()
  })
})
