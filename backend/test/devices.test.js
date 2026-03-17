import './setup.js'
import crypto from 'crypto'
import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js'
import { Device, DeviceCampaignAssignment, CampaignMediaItem } from '../src/models/index.js'

let app, adminToken, adminUser, agentToken

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminUser = admin.user; adminToken = admin.token
  const agent = await createTestUser({ role: 'agent' })
  agentToken = agent.token
}, 15000)

afterAll(async () => {
  await closeDb()
})

/** Helper: create a Device row directly in the DB */
async function createTestDevice(overrides = {}) {
  const key = crypto.randomBytes(16).toString('hex')
  const secretHash = crypto.createHash('sha256').update(key).digest('hex')
  return Device.create({
    secretHash,
    status: 'active',
    model: 'TestTablet',
    ...overrides
  })
}

describe('Device list and detail', () => {
  let device

  beforeAll(async () => {
    device = await createTestDevice({ model: 'ListTestTab' })
  })

  it('GET /api/devices — admin lists all devices', async () => {
    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data.length).toBeGreaterThanOrEqual(1)
  })

  it('GET /api/devices — hydrates campaign names', async () => {
    const campaign = await createTestCampaign(adminUser.id, {
      name: 'DeviceCampaign',
      type: 'lead_generation'
    })
    await DeviceCampaignAssignment.create({
      deviceId: device.id,
      campaignId: campaign.id,
      sortOrder: 0
    })

    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const d = res.body.data.find(d => d.id === device.id)
    expect(d).toBeDefined()
    expect(d.campaigns).toBeDefined()
    expect(d.campaigns.length).toBe(1)
    expect(d.campaigns[0].name).toBe('DeviceCampaign')
  })

  it('GET /api/devices/:id — returns a specific device', async () => {
    const res = await request(app)
      .get(`/api/devices/${device.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.id).toBe(device.id)
    expect(res.body.data.model).toBe('ListTestTab')
  })

  it('GET /api/devices/:id — returns 404 for non-existent device', async () => {
    const res = await request(app)
      .get('/api/devices/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })
})

describe('Device update (PATCH)', () => {
  let device

  beforeAll(async () => {
    device = await createTestDevice({ model: 'PatchTab' })
  })

  it('PATCH /api/devices/:id — updates status', async () => {
    const res = await request(app)
      .patch(`/api/devices/${device.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'inactive' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.status).toBe('inactive')
  })

  it('PATCH /api/devices/:id — assigns valid campaigns', async () => {
    const campaign = await createTestCampaign(adminUser.id, {
      name: 'AssignableDevCamp',
      type: 'lead_generation'
    })
    // Campaigns must have media to be assignable to devices
    await CampaignMediaItem.create({
      campaignId: campaign.id,
      mediaType: 'video',
      url: 'http://example.com/ad.mp4',
      sortOrder: 0
    })

    const res = await request(app)
      .patch(`/api/devices/${device.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ campaignIds: [campaign.id] })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.campaigns).toBeDefined()
    expect(res.body.data.campaigns.length).toBe(1)
  })

  it('PATCH /api/devices/:id — rejects non-existent campaigns', async () => {
    const res = await request(app)
      .patch(`/api/devices/${device.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ campaignIds: ['00000000-0000-0000-0000-000000000000'] })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/campaign/i)
  })

  it('PATCH /api/devices/:id — rejects campaigns with no media', async () => {
    const emptyMediaCampaign = await createTestCampaign(adminUser.id, {
      name: 'NoMediaCamp',
      type: 'lead_generation',
      ad_playlist: []
    })

    const res = await request(app)
      .patch(`/api/devices/${device.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ campaignIds: [emptyMediaCampaign.id] })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/media/i)
  })

  it('PATCH /api/devices/:id — clears campaigns with empty array', async () => {
    const res = await request(app)
      .patch(`/api/devices/${device.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ campaignIds: [] })

    expect(res.status).toBe(200)
    expect(res.body.data.campaigns).toEqual([])
  })

  it('PATCH /api/devices/:id — returns 404 for non-existent device', async () => {
    const res = await request(app)
      .patch('/api/devices/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'inactive' })

    expect(res.status).toBe(404)
  })
})

describe('Device logs', () => {
  let device

  beforeAll(async () => {
    device = await createTestDevice({ model: 'LogTab' })
  })

  it('GET /api/devices/:id/logs — returns paginated logs', async () => {
    const res = await request(app)
      .get(`/api/devices/${device.id}/logs`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.pagination).toBeDefined()
    expect(res.body.pagination.page).toBe(1)
    expect(res.body.pagination.limit).toBe(50)
  })

  it('GET /api/devices/:id/logs — supports custom pagination', async () => {
    const res = await request(app)
      .get(`/api/devices/${device.id}/logs?page=1&limit=10`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.pagination.page).toBe(1)
    expect(res.body.pagination.limit).toBe(10)
  })

  it('GET /api/devices/:id/logs — rejects page > 20', async () => {
    const res = await request(app)
      .get(`/api/devices/${device.id}/logs?page=21`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/depth/i)
  })

  it('GET /api/devices/:id/logs — returns 404 for non-existent device', async () => {
    const res = await request(app)
      .get('/api/devices/00000000-0000-0000-0000-000000000000/logs')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })
})

describe('Device auth enforcement', () => {
  it('GET /api/devices — agent cannot access (admin-only)', async () => {
    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(403)
  })

  it('PATCH /api/devices/:id — agent cannot update devices', async () => {
    const res = await request(app)
      .patch('/api/devices/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'inactive' })

    expect(res.status).toBe(403)
  })

  it('GET /api/devices — unauthenticated request returns 401', async () => {
    const res = await request(app)
      .get('/api/devices')

    expect([401, 403]).toContain(res.status)
  })

  it('PATCH /api/devices/:id — unauthenticated request returns 401', async () => {
    const res = await request(app)
      .patch('/api/devices/00000000-0000-0000-0000-000000000000')
      .send({ status: 'inactive' })

    expect([401, 403]).toContain(res.status)
  })

  it('GET /api/devices/:id/logs — agent cannot access device logs', async () => {
    const res = await request(app)
      .get('/api/devices/00000000-0000-0000-0000-000000000000/logs')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(403)
  })
})
