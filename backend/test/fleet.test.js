import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestFleetOwner, createTestCar } from './helpers.js'

let app, adminToken, agentToken

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminToken = admin.token
  const agent = await createTestUser({ role: 'agent' })
  agentToken = agent.token
}, 15000)

afterAll(async () => {
  await closeDb()
})

describe('Fleet Owner CRUD', () => {
  let fleetOwnerId

  it('POST /api/fleet/owners — admin can create fleet owner', async () => {
    const res = await request(app)
      .post('/api/fleet/owners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        full_name: 'Test Fleet Owner',
        email: `fleet-crud-${Date.now()}@test.com`,
        phone: '91234567',
        company_name: 'Test Fleet Co'
      })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.fleetOwner.full_name).toBe('Test Fleet Owner')
    fleetOwnerId = res.body.data.fleetOwner.id
  })

  it('GET /api/fleet/owners — lists fleet owners', async () => {
    const res = await request(app)
      .get('/api/fleet/owners')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.fleetOwners).toBeDefined()
    expect(res.body.data.fleetOwners.length).toBeGreaterThanOrEqual(1)
  })

  it('GET /api/fleet/owners/:id — returns fleet owner', async () => {
    const res = await request(app)
      .get(`/api/fleet/owners/${fleetOwnerId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.fleetOwner.id).toBe(fleetOwnerId)
  })

  it('PUT /api/fleet/owners/:id — admin can update fleet owner', async () => {
    const res = await request(app)
      .put(`/api/fleet/owners/${fleetOwnerId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ company_name: 'Updated Fleet Co' })

    expect(res.status).toBe(200)
    expect(res.body.data.fleetOwner.company_name).toBe('Updated Fleet Co')
  })

  it('GET /api/fleet/owners/:id — returns 404 for non-existent', async () => {
    const res = await request(app)
      .get('/api/fleet/owners/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })
})

describe('Car CRUD', () => {
  let fleetOwner, carId

  beforeAll(async () => {
    fleetOwner = await createTestFleetOwner()
  })

  it('POST /api/fleet/cars — creates a car', async () => {
    const res = await request(app)
      .post('/api/fleet/cars')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        make: 'Honda',
        model: 'Civic',
        year: 2024,
        plate_number: `TEST${Date.now().toString().slice(-6)}`,
        type: 'sedan',
        fleet_owner_id: fleetOwner.id
      })

    expect(res.status).toBe(201)
    expect(res.body.data.car.make).toBe('Honda')
    carId = res.body.data.car.id
  })

  it('GET /api/fleet/cars — lists cars with associations', async () => {
    const res = await request(app)
      .get('/api/fleet/cars')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.cars).toBeDefined()
    expect(res.body.data.cars.length).toBeGreaterThanOrEqual(1)
  })

  it('GET /api/fleet/cars/:id — returns car', async () => {
    const res = await request(app)
      .get(`/api/fleet/cars/${carId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.car.id).toBe(carId)
  })

  it('PUT /api/fleet/cars/:id — updates a car', async () => {
    const res = await request(app)
      .put(`/api/fleet/cars/${carId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ color: 'Red' })

    expect(res.status).toBe(200)
  })

  it('DELETE /api/fleet/cars/:id — deletes a car', async () => {
    const car = await createTestCar(fleetOwner.id)
    const res = await request(app)
      .delete(`/api/fleet/cars/${car.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.message).toContain('deleted')
  })
})

describe('Fleet statistics', () => {
  it('GET /api/fleet/stats/overview — returns fleet stats', async () => {
    const res = await request(app)
      .get('/api/fleet/stats/overview')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.totalCars).toBeGreaterThanOrEqual(0)
    expect(res.body.data.totalFleetOwners).toBeGreaterThanOrEqual(0)
    expect(res.body.data.utilizationRate).toBeDefined()
  })
})

describe('Fleet owner deletion constraints', () => {
  it('DELETE /api/fleet/owners/:id — cannot delete owner with cars', async () => {
    const owner = await createTestFleetOwner()
    await createTestCar(owner.id)

    const res = await request(app)
      .delete(`/api/fleet/owners/${owner.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('vehicles')
  })

  it('DELETE /api/fleet/owners/:id — can delete owner without cars', async () => {
    const owner = await createTestFleetOwner()

    const res = await request(app)
      .delete(`/api/fleet/owners/${owner.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
  })
})
