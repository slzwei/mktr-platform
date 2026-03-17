import './setup.js'
import { getApp, closeDb, createTestUser } from './helpers.js'
import { Campaign, Prospect, QrTag, Car } from '../src/models/index.js'

let _app
let adminUser

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminUser = admin.user
}, 15000)

afterAll(async () => {
  await closeDb()
})

// ---------------------------------------------------------------------------
// envValidation
// ---------------------------------------------------------------------------
describe('envValidation', () => {
  it('throws when required env vars are missing in production', async () => {
    const origNodeEnv = process.env.NODE_ENV
    const origJwtSecret = process.env.JWT_SECRET
    const origDbHost = process.env.DB_HOST
    const origDbName = process.env.DB_NAME
    const origDbUser = process.env.DB_USER
    const origDbPassword = process.env.DB_PASSWORD

    try {
      // Set production mode and remove required vars
      process.env.NODE_ENV = 'production'
      delete process.env.JWT_SECRET
      delete process.env.DB_HOST
      delete process.env.DB_NAME
      delete process.env.DB_USER
      delete process.env.DB_PASSWORD

      // Dynamic import to bypass module cache
      const mod = await import(`../src/config/envValidation.js?t=${Date.now()}`)
      expect(() => mod.validateEnv()).toThrow(/Missing required environment variables/)
    } finally {
      // Restore
      process.env.NODE_ENV = origNodeEnv
      if (origJwtSecret) process.env.JWT_SECRET = origJwtSecret
      if (origDbHost) process.env.DB_HOST = origDbHost
      if (origDbName) process.env.DB_NAME = origDbName
      if (origDbUser) process.env.DB_USER = origDbUser
      if (origDbPassword) process.env.DB_PASSWORD = origDbPassword
    }
  })

  it('does not throw when not in production', async () => {
    const origNodeEnv = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'test'
      const mod = await import(`../src/config/envValidation.js?t=${Date.now() + 1}`)
      expect(() => mod.validateEnv()).not.toThrow()
    } finally {
      process.env.NODE_ENV = origNodeEnv
    }
  })

  it('throws listing specific missing vars', async () => {
    const origNodeEnv = process.env.NODE_ENV
    const origJwtSecret = process.env.JWT_SECRET
    const origDbHost = process.env.DB_HOST
    const origDbName = process.env.DB_NAME
    const origDbUser = process.env.DB_USER
    const origDbPassword = process.env.DB_PASSWORD

    try {
      process.env.NODE_ENV = 'production'
      // Set some but not all
      process.env.JWT_SECRET = 'test-secret'
      process.env.DB_HOST = 'localhost'
      delete process.env.DB_NAME
      delete process.env.DB_USER
      delete process.env.DB_PASSWORD

      const mod = await import(`../src/config/envValidation.js?t=${Date.now() + 2}`)
      expect(() => mod.validateEnv()).toThrow(/DB_NAME/)
      expect(() => mod.validateEnv()).toThrow(/DB_USER/)
    } finally {
      process.env.NODE_ENV = origNodeEnv
      if (origJwtSecret) process.env.JWT_SECRET = origJwtSecret; else delete process.env.JWT_SECRET
      if (origDbHost) process.env.DB_HOST = origDbHost; else delete process.env.DB_HOST
      if (origDbName) process.env.DB_NAME = origDbName; else delete process.env.DB_NAME
      if (origDbUser) process.env.DB_USER = origDbUser; else delete process.env.DB_USER
      if (origDbPassword) process.env.DB_PASSWORD = origDbPassword; else delete process.env.DB_PASSWORD
    }
  })
})

// ---------------------------------------------------------------------------
// Campaign model validators
// ---------------------------------------------------------------------------
describe('Campaign model validators', () => {
  it('rejects endDate before startDate', async () => {
    const campaign = Campaign.build({
      name: 'Bad Dates Campaign',
      createdBy: adminUser.id,
      startDate: '2025-06-01',
      endDate: '2020-01-01'
    })
    await expect(campaign.validate()).rejects.toThrow(/end date/i)
  })

  it('accepts endDate after startDate', async () => {
    const campaign = Campaign.build({
      name: 'Good Dates Campaign',
      createdBy: adminUser.id,
      startDate: '2025-01-01',
      endDate: '2025-12-31'
    })
    // Should not throw
    await expect(campaign.validate()).resolves.toBeDefined()
  })

  it('rejects empty campaign name', async () => {
    const campaign = Campaign.build({
      name: '',
      createdBy: adminUser.id
    })
    await expect(campaign.validate()).rejects.toThrow()
  })

  it('rejects negative budget', async () => {
    const campaign = Campaign.build({
      name: 'Negative Budget',
      createdBy: adminUser.id,
      budget: -100
    })
    await expect(campaign.validate()).rejects.toThrow()
  })

  // Skipped: agentAssignmentMode was removed from Campaign model (migration 012)
  it.skip('rejects invalid agentAssignmentMode', async () => {
    const campaign = Campaign.build({
      name: 'Bad Mode',
      createdBy: adminUser.id,
      agentAssignmentMode: 'invalid_mode'
    })
    await expect(campaign.validate()).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Campaign model tags getter/setter
// ---------------------------------------------------------------------------
describe('Campaign model tags getter/setter', () => {
  it('getter parses JSON string into array', () => {
    const campaign = Campaign.build({ name: 'Tags Test', createdBy: adminUser.id })
    campaign.setDataValue('tags', '["marketing","promo"]')
    expect(campaign.tags).toEqual(['marketing', 'promo'])
  })

  it('getter returns empty array for null', () => {
    const campaign = Campaign.build({ name: 'Tags Null', createdBy: adminUser.id })
    campaign.setDataValue('tags', null)
    expect(campaign.tags).toEqual([])
  })

  it('setter stringifies array to JSON', () => {
    const campaign = Campaign.build({ name: 'Tags Set', createdBy: adminUser.id })
    campaign.tags = ['a', 'b', 'c']
    expect(campaign.getDataValue('tags')).toBe('["a","b","c"]')
  })

  it('setter handles null/undefined by storing empty array', () => {
    const campaign = Campaign.build({ name: 'Tags Null Set', createdBy: adminUser.id })
    campaign.tags = null
    expect(campaign.getDataValue('tags')).toBe('[]')
  })
})

// ---------------------------------------------------------------------------
// Prospect model tags getter/setter
// ---------------------------------------------------------------------------
describe('Prospect model tags getter/setter', () => {
  it('getter parses JSON string into array', () => {
    const prospect = Prospect.build({
      firstName: 'TagTest',
      email: 'tagtest@test.com',
      leadSource: 'website'
    })
    prospect.setDataValue('tags', '["vip","hot"]')
    expect(prospect.tags).toEqual(['vip', 'hot'])
  })

  it('getter returns empty array for null', () => {
    const prospect = Prospect.build({
      firstName: 'TagNull',
      email: 'tagnull@test.com',
      leadSource: 'website'
    })
    prospect.setDataValue('tags', null)
    expect(prospect.tags).toEqual([])
  })

  it('setter stringifies array to JSON', () => {
    const prospect = Prospect.build({
      firstName: 'TagSet',
      email: 'tagset@test.com',
      leadSource: 'website'
    })
    prospect.tags = ['lead', 'qualified']
    expect(prospect.getDataValue('tags')).toBe('["lead","qualified"]')
  })

  it('setter handles null by storing empty array', () => {
    const prospect = Prospect.build({
      firstName: 'TagNullSet',
      email: 'tagnullset@test.com',
      leadSource: 'website'
    })
    prospect.tags = null
    expect(prospect.getDataValue('tags')).toBe('[]')
  })
})

// ---------------------------------------------------------------------------
// Prospect model interests getter/setter
// ---------------------------------------------------------------------------
describe('Prospect model interests getter/setter', () => {
  it('getter parses JSON string into array', () => {
    const prospect = Prospect.build({
      firstName: 'IntTest',
      email: 'inttest@test.com',
      leadSource: 'website'
    })
    prospect.setDataValue('interests', '["cars","insurance"]')
    expect(prospect.interests).toEqual(['cars', 'insurance'])
  })

  it('setter stringifies array to JSON', () => {
    const prospect = Prospect.build({
      firstName: 'IntSet',
      email: 'intset@test.com',
      leadSource: 'website'
    })
    prospect.interests = ['finance', 'tech']
    expect(prospect.getDataValue('interests')).toBe('["finance","tech"]')
  })
})

// ---------------------------------------------------------------------------
// QrTag model tags getter/setter
// ---------------------------------------------------------------------------
describe('QrTag model tags getter/setter', () => {
  it('getter parses JSON string into array', () => {
    const qr = QrTag.build({})
    qr.setDataValue('tags', '["outdoor","bus"]')
    expect(qr.tags).toEqual(['outdoor', 'bus'])
  })

  it('getter returns empty array for null', () => {
    const qr = QrTag.build({})
    qr.setDataValue('tags', null)
    expect(qr.tags).toEqual([])
  })

  it('setter stringifies array to JSON', () => {
    const qr = QrTag.build({})
    qr.tags = ['indoor', 'mall']
    expect(qr.getDataValue('tags')).toBe('["indoor","mall"]')
  })

  it('setter handles null by storing empty array', () => {
    const qr = QrTag.build({})
    qr.tags = null
    expect(qr.getDataValue('tags')).toBe('[]')
  })
})

// ---------------------------------------------------------------------------
// Car model features getter/setter
// ---------------------------------------------------------------------------
describe('Car model features getter/setter', () => {
  it('getter parses JSON string into array', () => {
    const car = Car.build({
      make: 'Toyota', model: 'Camry', year: 2023,
      plate_number: 'TEST1', type: 'sedan', fleet_owner_id: '00000000-0000-0000-0000-000000000001'
    })
    car.setDataValue('features', '["bluetooth","gps"]')
    expect(car.features).toEqual(['bluetooth', 'gps'])
  })

  it('getter returns empty array for null', () => {
    const car = Car.build({
      make: 'Toyota', model: 'Camry', year: 2023,
      plate_number: 'TEST2', type: 'sedan', fleet_owner_id: '00000000-0000-0000-0000-000000000001'
    })
    car.setDataValue('features', null)
    expect(car.features).toEqual([])
  })

  it('setter stringifies array to JSON', () => {
    const car = Car.build({
      make: 'Toyota', model: 'Camry', year: 2023,
      plate_number: 'TEST3', type: 'sedan', fleet_owner_id: '00000000-0000-0000-0000-000000000001'
    })
    car.features = ['sunroof', 'heated_seats']
    expect(car.getDataValue('features')).toBe('["sunroof","heated_seats"]')
  })

  it('setter handles null by storing empty array', () => {
    const car = Car.build({
      make: 'Toyota', model: 'Camry', year: 2023,
      plate_number: 'TEST4', type: 'sedan', fleet_owner_id: '00000000-0000-0000-0000-000000000001'
    })
    car.features = null
    expect(car.getDataValue('features')).toBe('[]')
  })
})

// ---------------------------------------------------------------------------
// Car model validators
// ---------------------------------------------------------------------------
describe('Car model validators', () => {
  it('rejects year before 1900', async () => {
    const car = Car.build({
      make: 'OldCar', model: 'Ancient', year: 1800,
      plate_number: 'OLD1', type: 'sedan', fleet_owner_id: '00000000-0000-0000-0000-000000000001'
    })
    await expect(car.validate()).rejects.toThrow()
  })

  it('rejects negative mileage', async () => {
    const car = Car.build({
      make: 'Toyota', model: 'Camry', year: 2023,
      plate_number: 'NEG1', type: 'sedan', fleet_owner_id: '00000000-0000-0000-0000-000000000001',
      mileage: -100
    })
    await expect(car.validate()).rejects.toThrow()
  })

  it('rejects VIN that is not exactly 17 characters', async () => {
    const car = Car.build({
      make: 'Toyota', model: 'Camry', year: 2023,
      plate_number: 'VIN1', type: 'sedan', fleet_owner_id: '00000000-0000-0000-0000-000000000001',
      vin: 'SHORT'
    })
    await expect(car.validate()).rejects.toThrow()
  })

  it('accepts valid VIN of exactly 17 characters', async () => {
    const car = Car.build({
      make: 'Toyota', model: 'Camry', year: 2023,
      plate_number: 'VIN2', type: 'sedan', fleet_owner_id: '00000000-0000-0000-0000-000000000001',
      vin: '12345678901234567'
    })
    await expect(car.validate()).resolves.toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Prospect model validators
// ---------------------------------------------------------------------------
describe('Prospect model validators', () => {
  it('rejects invalid email format', async () => {
    const prospect = Prospect.build({
      firstName: 'BadEmail',
      email: 'not-an-email',
      leadSource: 'website'
    })
    await expect(prospect.validate()).rejects.toThrow()
  })

  it('rejects invalid E.164 phone format', async () => {
    const prospect = Prospect.build({
      firstName: 'BadPhone',
      email: 'badphone@test.com',
      leadSource: 'website',
      phone: '12345'
    })
    await expect(prospect.validate()).rejects.toThrow()
  })

  it('accepts valid E.164 phone format', async () => {
    const prospect = Prospect.build({
      firstName: 'GoodPhone',
      email: 'goodphone@test.com',
      leadSource: 'website',
      phone: '+6591234567'
    })
    await expect(prospect.validate()).resolves.toBeDefined()
  })
})
