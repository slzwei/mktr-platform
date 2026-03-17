import './setup.js'
import crypto from 'crypto'
import request from 'supertest'

// Set feature flags BEFORE importing getApp, since route mounting is conditional at init time
process.env.MANIFEST_ENABLED = 'true'
process.env.BEACONS_ENABLED = 'true'
process.env.ENABLE_DOMAIN_PREFIXES = 'true'

import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js'
import { Device, DeviceCampaignAssignment, CampaignMediaItem } from '../src/models/index.js'

let app, adminUser, adminToken

// Helper: create a device with a known raw key and return { device, rawKey }
async function createTestDevice(overrides = {}) {
  const rawKey = crypto.randomBytes(32).toString('hex')
  const secretHash = crypto.createHash('sha256').update(rawKey).digest('hex')

  const device = await Device.create({
    status: overrides.status || 'active',
    model: overrides.model || 'test-tablet',
    campaignIds: overrides.campaignIds || [],
    campaignId: overrides.campaignId || null,
    ...overrides,
    secretHash
  })

  return { device, rawKey }
}

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminUser = admin.user
  adminToken = admin.token
}, 15000)

afterAll(async () => {
  await closeDb()
})

// ─────────────────────────────────────────────────────────────────────────────
// Beacon Endpoints
// ─────────────────────────────────────────────────────────────────────────────

describe('Adtech Beacons — Heartbeat', () => {
  let testDevice, rawKey

  beforeAll(async () => {
    const result = await createTestDevice()
    testDevice = result.device
    rawKey = result.rawKey
  })

  it('POST /api/adtech/v1/beacons/heartbeat — success with valid device key', async () => {
    const res = await request(app)
      .post('/api/adtech/v1/beacons/heartbeat')
      .set('X-Device-Key', rawKey)
      .send({ status: 'playing', batteryLevel: 85 })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.timestamp).toBeDefined()
  })

  it('POST /api/adtech/v1/beacons/heartbeat — updates lastSeenAt', async () => {
    const before = testDevice.lastSeenAt

    await request(app)
      .post('/api/adtech/v1/beacons/heartbeat')
      .set('X-Device-Key', rawKey)
      .send({ status: 'idle' })

    await testDevice.reload()
    // lastSeenAt should be updated (or set if null)
    expect(testDevice.lastSeenAt).not.toEqual(before)
  })

  it('POST /api/adtech/v1/beacons/heartbeat — accepts GPS coordinates', async () => {
    const res = await request(app)
      .post('/api/adtech/v1/beacons/heartbeat')
      .set('X-Device-Key', rawKey)
      .send({ status: 'playing', latitude: 1.3521, longitude: 103.8198 })

    expect(res.status).toBe(200)
    await testDevice.reload()
    expect(testDevice.latitude).toBeCloseTo(1.3521, 3)
    expect(testDevice.longitude).toBeCloseTo(103.8198, 3)
  })

  it('POST /api/adtech/v1/beacons/heartbeat — 400 without X-Device-Key', async () => {
    const res = await request(app)
      .post('/api/adtech/v1/beacons/heartbeat')
      .send({ status: 'playing' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Missing/i)
  })

  it('POST /api/adtech/v1/beacons/heartbeat — 401 with invalid device key', async () => {
    const res = await request(app)
      .post('/api/adtech/v1/beacons/heartbeat')
      .set('X-Device-Key', 'invalid-key-that-does-not-exist')
      .send({ status: 'playing' })

    expect(res.status).toBe(401)
  })

  it('POST /api/adtech/v1/beacons/heartbeat — 403 for disabled device', async () => {
    const { rawKey: disabledKey } = await createTestDevice({ status: 'disabled' })

    const res = await request(app)
      .post('/api/adtech/v1/beacons/heartbeat')
      .set('X-Device-Key', disabledKey)
      .send({ status: 'playing' })

    expect(res.status).toBe(403)
  })
})

describe('Adtech Beacons — Impressions', () => {
  let testDevice, rawKey, testCampaign

  beforeAll(async () => {
    testCampaign = await createTestCampaign(adminUser.id, {
      name: 'Impression Test Campaign',
      status: 'active'
    })
    const result = await createTestDevice({ campaignId: testCampaign.id })
    testDevice = result.device
    rawKey = result.rawKey
  })

  it('POST /api/adtech/v1/beacons/impressions — records batch impressions', async () => {
    const res = await request(app)
      .post('/api/adtech/v1/beacons/impressions')
      .set('X-Device-Key', rawKey)
      .send({
        impressions: [
          { adId: 'asset_001', campaignId: testCampaign.id, durationMs: 10000, mediaType: 'image' },
          { adId: 'asset_002', campaignId: testCampaign.id, durationMs: 15000, mediaType: 'video' }
        ]
      })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.count).toBe(2)
  })

  it('POST /api/adtech/v1/beacons/impressions — sets device status to playing', async () => {
    await request(app)
      .post('/api/adtech/v1/beacons/impressions')
      .set('X-Device-Key', rawKey)
      .send({
        impressions: [
          { adId: 'asset_003', durationMs: 5000, mediaType: 'image' }
        ]
      })

    await testDevice.reload()
    expect(testDevice.status).toBe('playing')
  })

  it('POST /api/adtech/v1/beacons/impressions — 400 with empty impressions array', async () => {
    const res = await request(app)
      .post('/api/adtech/v1/beacons/impressions')
      .set('X-Device-Key', rawKey)
      .send({ impressions: [] })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/No impressions/i)
  })

  it('POST /api/adtech/v1/beacons/impressions — 400 without impressions field', async () => {
    const res = await request(app)
      .post('/api/adtech/v1/beacons/impressions')
      .set('X-Device-Key', rawKey)
      .send({ data: 'wrong' })

    expect(res.status).toBe(400)
  })

  it('POST /api/adtech/v1/beacons/impressions — 400 without X-Device-Key', async () => {
    const res = await request(app)
      .post('/api/adtech/v1/beacons/impressions')
      .send({ impressions: [{ adId: 'x', durationMs: 1000 }] })

    expect(res.status).toBe(400)
  })

  it('POST /api/adtech/v1/beacons/impressions — falls back to device campaignId when impression has no campaignId', async () => {
    const res = await request(app)
      .post('/api/adtech/v1/beacons/impressions')
      .set('X-Device-Key', rawKey)
      .send({
        impressions: [
          { adId: 'asset_fallback', durationMs: 7000, mediaType: 'image' }
        ]
      })

    expect(res.status).toBe(200)
    expect(res.body.count).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Manifest Endpoint
// ─────────────────────────────────────────────────────────────────────────────

describe('Adtech Manifest', () => {
  let testDevice, rawKey

  beforeAll(async () => {
    const campaign = await createTestCampaign(adminUser.id, {
      name: 'Manifest Test Campaign',
      status: 'active'
    })
    // Create media items (replaces ad_playlist JSON column)
    await CampaignMediaItem.create({
      campaignId: campaign.id,
      mediaType: 'image',
      url: 'https://example.com/img1.jpg',
      durationSecs: 10,
      sortOrder: 0
    })
    await CampaignMediaItem.create({
      campaignId: campaign.id,
      mediaType: 'video',
      url: 'https://example.com/vid1.mp4',
      durationSecs: 15,
      sortOrder: 1
    })
    const result = await createTestDevice()
    testDevice = result.device
    rawKey = result.rawKey
    // Use join table for device-campaign assignment
    await DeviceCampaignAssignment.create({
      deviceId: testDevice.id,
      campaignId: campaign.id,
      sortOrder: 0
    })
  })

  it('GET /api/adtech/v1/manifest — returns manifest with playlist', async () => {
    const res = await request(app)
      .get('/api/adtech/v1/manifest')
      .set('X-Device-Key', rawKey)

    expect(res.status).toBe(200)
    expect(res.body.version).toBe(1)
    expect(res.body.device_id).toBe(testDevice.id)
    expect(res.body.refresh_seconds).toBeDefined()
    expect(Array.isArray(res.body.assets)).toBe(true)
    expect(Array.isArray(res.body.playlist)).toBe(true)
    expect(res.body.sync_config).toBeDefined()
  })

  it('GET /api/adtech/v1/manifest — contains assets derived from campaign playlist', async () => {
    const res = await request(app)
      .get('/api/adtech/v1/manifest')
      .set('X-Device-Key', rawKey)

    expect(res.status).toBe(200)
    expect(res.body.assets.length).toBeGreaterThanOrEqual(1)
    // Each asset should have id, url, sha256, size_bytes
    const asset = res.body.assets[0]
    expect(asset.id).toBeDefined()
    expect(asset.url).toBeDefined()
  })

  it('GET /api/adtech/v1/manifest — playlist items reference valid asset IDs', async () => {
    const res = await request(app)
      .get('/api/adtech/v1/manifest')
      .set('X-Device-Key', rawKey)

    expect(res.status).toBe(200)
    const assetIds = res.body.assets.map(a => a.id)
    for (const item of res.body.playlist) {
      expect(assetIds).toContain(item.asset_id)
    }
  })

  it('GET /api/adtech/v1/manifest — returns ETag header', async () => {
    const res = await request(app)
      .get('/api/adtech/v1/manifest')
      .set('X-Device-Key', rawKey)

    expect(res.status).toBe(200)
    expect(res.headers['etag']).toBeDefined()
    expect(res.headers['etag']).toMatch(/^W\//)
  })

  it('GET /api/adtech/v1/manifest — returns 304 with matching If-None-Match', async () => {
    // First request to get the ETag
    const first = await request(app)
      .get('/api/adtech/v1/manifest')
      .set('X-Device-Key', rawKey)

    expect(first.status).toBe(200)
    const etag = first.headers['etag']

    // Second request with If-None-Match
    const second = await request(app)
      .get('/api/adtech/v1/manifest')
      .set('X-Device-Key', rawKey)
      .set('If-None-Match', etag)

    expect(second.status).toBe(304)
  })

  it('GET /api/adtech/v1/manifest — 400 without X-Device-Key', async () => {
    const res = await request(app)
      .get('/api/adtech/v1/manifest')

    expect(res.status).toBe(400)
  })

  it('GET /api/adtech/v1/manifest — 401 with invalid device key', async () => {
    const res = await request(app)
      .get('/api/adtech/v1/manifest')
      .set('X-Device-Key', 'bogus-key')

    expect(res.status).toBe(401)
  })

  it('GET /api/adtech/v1/manifest — returns empty playlist when device has no campaigns', async () => {
    const { rawKey: emptyKey } = await createTestDevice({ campaignIds: [] })

    const res = await request(app)
      .get('/api/adtech/v1/manifest')
      .set('X-Device-Key', emptyKey)

    expect(res.status).toBe(200)
    expect(res.body.playlist).toHaveLength(0)
    expect(res.body.assets).toHaveLength(0)
  })

  it('GET /api/adtech/v1/manifest — sync_config is present', async () => {
    const res = await request(app)
      .get('/api/adtech/v1/manifest')
      .set('X-Device-Key', rawKey)

    expect(res.status).toBe(200)
    expect(res.body.sync_config.enabled).toBe(true)
    expect(res.body.sync_config.mode).toBe('QUANTIZED_WALL_CLOCK')
    expect(res.body.sync_config.cycle_duration_ms).toBeGreaterThanOrEqual(60000)
  })
})

describe('Adtech Manifest — feature flag', () => {
  it('manifest guardFlags returns 404 when MANIFEST_ENABLED is toggled off at request time', async () => {
    // The guardFlags middleware reads process.env at request time
    const original = process.env.MANIFEST_ENABLED
    process.env.MANIFEST_ENABLED = 'false'

    const { rawKey } = await createTestDevice()
    const res = await request(app)
      .get('/api/adtech/v1/manifest')
      .set('X-Device-Key', rawKey)

    expect(res.status).toBe(404)

    // Restore
    process.env.MANIFEST_ENABLED = original
  })
})

describe('Adtech Health', () => {
  it('GET /api/adtech/health — returns ok', async () => {
    const res = await request(app)
      .get('/api/adtech/health')

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.service).toBe('adtech')
  })
})
