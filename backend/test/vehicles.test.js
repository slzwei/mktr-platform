import './setup.js'
import crypto from 'crypto'
import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js'
import { Device, Vehicle } from '../src/models/index.js'

let app, adminToken, adminUser, agentToken

/** Short unique suffix for carplates to avoid SQLite collisions across runs */
const ts = Date.now().toString(36).toUpperCase()
let plateSeq = 0
function uniquePlate(prefix = 'T') {
  return `${prefix}${ts}${(++plateSeq).toString().padStart(2, '0')}`
}

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

describe('Vehicle CRUD', () => {
  let vehicleId, createPlate

  it('POST /api/vehicles — admin can create a vehicle', async () => {
    createPlate = uniquePlate('CR')
    const res = await request(app)
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ carplate: createPlate })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.carplate).toBe(createPlate.toUpperCase())
    expect(res.body.data.hotspotSsid).toBe(`MKTR-${createPlate.toUpperCase()}`)
    expect(res.body.data.hotspotPassword).toBeDefined()
    vehicleId = res.body.data.id
  })

  it('POST /api/vehicles — requires carplate', async () => {
    const res = await request(app)
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/carplate/i)
  })

  it('POST /api/vehicles — duplicate carplate returns 409', async () => {
    const res = await request(app)
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ carplate: createPlate })

    expect(res.status).toBe(409)
  })

  it('POST /api/vehicles — uppercases carplate', async () => {
    const plate = uniquePlate('lc')
    const res = await request(app)
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ carplate: plate })

    expect(res.status).toBe(201)
    expect(res.body.data.carplate).toBe(plate.toUpperCase())
  })

  it('GET /api/vehicles — admin lists all vehicles', async () => {
    const res = await request(app)
      .get('/api/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data.length).toBeGreaterThanOrEqual(1)
  })

  it('GET /api/vehicles — hydrates campaign names', async () => {
    const campaign = await createTestCampaign(adminUser.id, { name: `VehCamp${ts}` })
    await Vehicle.update({ campaignIds: [campaign.id] }, { where: { id: vehicleId } })

    const res = await request(app)
      .get('/api/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const v = res.body.data.find(v => v.id === vehicleId)
    expect(v).toBeDefined()
    expect(v.campaigns).toBeDefined()
    expect(v.campaigns.length).toBe(1)
    expect(v.campaigns[0].name).toBe(`VehCamp${ts}`)
  })

  it('GET /api/vehicles/:id — returns a specific vehicle', async () => {
    const res = await request(app)
      .get(`/api/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.id).toBe(vehicleId)
  })

  it('GET /api/vehicles/:id — returns 404 for non-existent vehicle', async () => {
    const res = await request(app)
      .get('/api/vehicles/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })

  it('PATCH /api/vehicles/:id — updates carplate and status', async () => {
    const newPlate = uniquePlate('PA')
    const res = await request(app)
      .patch(`/api/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ carplate: newPlate, status: 'inactive' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.carplate).toBe(newPlate.toUpperCase())
    expect(res.body.data.status).toBe('inactive')
    expect(res.body.data.hotspotSsid).toBe(`MKTR-${newPlate.toUpperCase()}`)
  })

  it('PATCH /api/vehicles/:id — returns 404 for non-existent vehicle', async () => {
    const res = await request(app)
      .patch('/api/vehicles/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'inactive' })

    expect(res.status).toBe(404)
  })

  it('PATCH /api/vehicles/:id — validates campaignIds exist', async () => {
    const res = await request(app)
      .patch(`/api/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ campaignIds: ['00000000-0000-0000-0000-000000000000'] })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/campaign/i)
  })

  it('PATCH /api/vehicles/:id — assigns valid campaigns', async () => {
    const campaign = await createTestCampaign(adminUser.id, { name: `Assign${ts}` })
    const res = await request(app)
      .patch(`/api/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ campaignIds: [campaign.id] })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('DELETE /api/vehicles/:id — admin can delete a vehicle', async () => {
    const plate = uniquePlate('DL')
    const createRes = await request(app)
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ carplate: plate })
    const delId = createRes.body.data.id

    const res = await request(app)
      .delete(`/api/vehicles/${delId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.message).toMatch(/deleted/i)
  })

  it('DELETE /api/vehicles/:id — returns 404 for non-existent vehicle', async () => {
    const res = await request(app)
      .delete('/api/vehicles/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })

  it('DELETE /api/vehicles/:id — unpairs devices on delete', async () => {
    const device = await createTestDevice()
    const plate = uniquePlate('UP')
    const createRes = await request(app)
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ carplate: plate })
    const vId = createRes.body.data.id

    // Pair the device
    await request(app)
      .put(`/api/vehicles/${vId}/pair`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ masterDeviceId: device.id })

    // Delete the vehicle
    await request(app)
      .delete(`/api/vehicles/${vId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    // Verify device was unpaired
    const updatedDevice = await Device.findByPk(device.id)
    expect(updatedDevice.vehicleId).toBeNull()
    expect(updatedDevice.role).toBeNull()
  })
})

describe('Vehicle volume', () => {
  let vehicleId

  beforeAll(async () => {
    const plate = uniquePlate('VL')
    const res = await request(app)
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ carplate: plate })
    vehicleId = res.body.data.id
  })

  it('PUT /api/vehicles/:id/volume — sets volume', async () => {
    const res = await request(app)
      .put(`/api/vehicles/${vehicleId}/volume`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ volume: 75 })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.message).toContain('75')
  })

  it('PUT /api/vehicles/:id/volume — rejects invalid volume (> 100)', async () => {
    const res = await request(app)
      .put(`/api/vehicles/${vehicleId}/volume`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ volume: 150 })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/volume/i)
  })

  it('PUT /api/vehicles/:id/volume — rejects negative volume', async () => {
    const res = await request(app)
      .put(`/api/vehicles/${vehicleId}/volume`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ volume: -5 })

    expect(res.status).toBe(400)
  })

  it('PUT /api/vehicles/:id/volume — returns 404 for non-existent vehicle', async () => {
    const res = await request(app)
      .put('/api/vehicles/00000000-0000-0000-0000-000000000000/volume')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ volume: 50 })

    expect(res.status).toBe(404)
  })
})

describe('Vehicle device pairing', () => {
  let vehicleId, masterDevice, slaveDevice

  beforeAll(async () => {
    masterDevice = await createTestDevice({ model: 'MasterTab' })
    slaveDevice = await createTestDevice({ model: 'SlaveTab' })

    const plate = uniquePlate('PR')
    const res = await request(app)
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ carplate: plate })
    vehicleId = res.body.data.id
  })

  it('PUT /api/vehicles/:id/pair — pairs master device', async () => {
    const res = await request(app)
      .put(`/api/vehicles/${vehicleId}/pair`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ masterDeviceId: masterDevice.id })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.masterDeviceId).toBe(masterDevice.id)

    // Verify device was updated
    const updated = await Device.findByPk(masterDevice.id)
    expect(updated.vehicleId).toBe(vehicleId)
    expect(updated.role).toBe('master')
  })

  it('PUT /api/vehicles/:id/pair — pairs slave device', async () => {
    const res = await request(app)
      .put(`/api/vehicles/${vehicleId}/pair`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slaveDeviceId: slaveDevice.id })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.slaveDeviceId).toBe(slaveDevice.id)
  })

  it('PUT /api/vehicles/:id/pair — rejects non-existent device', async () => {
    const res = await request(app)
      .put(`/api/vehicles/${vehicleId}/pair`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ masterDeviceId: '00000000-0000-0000-0000-000000000000' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/not found/i)
  })

  it('PUT /api/vehicles/:id/pair — rejects device already paired to another vehicle', async () => {
    const plate = uniquePlate('OT')
    const v2Res = await request(app)
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ carplate: plate })
    const v2Id = v2Res.body.data.id

    // Try to pair the already-paired master device to the new vehicle
    const res = await request(app)
      .put(`/api/vehicles/${v2Id}/pair`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ masterDeviceId: masterDevice.id })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/already paired/i)
  })

  it('PUT /api/vehicles/:id/pair — returns 404 for non-existent vehicle', async () => {
    const res = await request(app)
      .put('/api/vehicles/00000000-0000-0000-0000-000000000000/pair')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ masterDeviceId: masterDevice.id })

    expect(res.status).toBe(404)
  })

  it('DELETE /api/vehicles/:id/pair — unpairs all devices', async () => {
    const res = await request(app)
      .delete(`/api/vehicles/${vehicleId}/pair`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.message).toMatch(/unpaired/i)

    // Verify devices were unpaired
    const master = await Device.findByPk(masterDevice.id)
    expect(master.vehicleId).toBeNull()
    expect(master.role).toBeNull()

    const slave = await Device.findByPk(slaveDevice.id)
    expect(slave.vehicleId).toBeNull()
    expect(slave.role).toBeNull()
  })

  it('DELETE /api/vehicles/:id/pair — returns 404 for non-existent vehicle', async () => {
    const res = await request(app)
      .delete('/api/vehicles/00000000-0000-0000-0000-000000000000/pair')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })
})

describe('Vehicle auth enforcement', () => {
  it('GET /api/vehicles — agent cannot access (admin-only)', async () => {
    const res = await request(app)
      .get('/api/vehicles')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(403)
  })

  it('POST /api/vehicles — agent cannot create vehicles', async () => {
    const res = await request(app)
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ carplate: uniquePlate('AG') })

    expect(res.status).toBe(403)
  })

  it('GET /api/vehicles — unauthenticated request returns 401', async () => {
    const res = await request(app)
      .get('/api/vehicles')

    expect([401, 403]).toContain(res.status)
  })

  it('POST /api/vehicles — unauthenticated request returns 401', async () => {
    const res = await request(app)
      .post('/api/vehicles')
      .send({ carplate: uniquePlate('NA') })

    expect([401, 403]).toContain(res.status)
  })

  it('PATCH /api/vehicles/:id — agent cannot update vehicles', async () => {
    const res = await request(app)
      .patch('/api/vehicles/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'inactive' })

    expect(res.status).toBe(403)
  })

  it('DELETE /api/vehicles/:id — agent cannot delete vehicles', async () => {
    const res = await request(app)
      .delete('/api/vehicles/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${agentToken}`)

    expect(res.status).toBe(403)
  })
})
