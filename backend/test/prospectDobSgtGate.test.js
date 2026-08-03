/**
 * M8 (review round 3): the DOB age gate is strict-calendar and Singapore-time.
 *
 * Pre-fix the API accepted arbitrary date strings, parsed them with
 * new Date(), and compared server-LOCAL date parts: garbage formats silently
 * SKIPPED the gate (lead created with no age at all), timezone-bearing
 * strings could shift the birth day, and on the UTC prod host a birthday
 * starting at 00:00 SGT was still "yesterday" until 08:00 SGT.
 *
 * Post-fix: strict YYYY-MM-DD at the Joi door, real-calendar validation via
 * cleanYmd (2012-02-31 dies), age computed on the SGT calendar
 * (sgtAgeFromDob — unit-proven in test/unit/sgtAge.test.js), and the
 * canonical date string stored on demographics.
 */
import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js'
import { Prospect } from '../src/models/index.js'

let app, adminToken, campaign

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminToken = admin.token
  campaign = await createTestCampaign(admin.user.id, { name: 'SGT DOB Gate', min_age: 21, max_age: 65 })
})

afterAll(async () => {
  await closeDb()
})

let n = 0
const post = (extra) => request(app)
  .post('/api/prospects')
  .set('Authorization', `Bearer ${adminToken}`)
  .send({
    firstName: 'Dob',
    lastName: `Gate${++n}`,
    email: `dob-gate-${n}-${Date.now()}@test.com`,
    phone: `+65${String(Date.now() + n).slice(-8)}`,
    leadSource: 'website',
    campaignId: campaign.id,
    ...extra,
  })

describe('M8 — strict SGT date-of-birth gate', () => {
  it('a non-calendar format is rejected, never silently skipped', async () => {
    const res = await post({ date_of_birth: '15/06/1990' })
    // Pre-fix: new Date('15/06/1990') was Invalid → the gate silently skipped
    // and the lead was CREATED with no age stored at all.
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it('a timezone-bearing string is rejected (it could shift the birth day)', async () => {
    const res = await post({ date_of_birth: '1990-06-15T23:00:00-11:00' })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it('an impossible calendar date is rejected', async () => {
    const res = await post({ date_of_birth: '2012-02-31' })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it('a valid date stores the canonical string and the SGT-computed age', async () => {
    const res = await post({ date_of_birth: '1990-06-15' })
    expect(res.status).toBe(201)
    const row = await Prospect.findByPk(res.body.data.prospect.id, { raw: true })
    expect(row.demographics.dateOfBirth).toBe('1990-06-15')
    expect(typeof row.demographics.age).toBe('number')
    expect(row.demographics.age).toBeGreaterThanOrEqual(35)
  })

  it('the campaign age gate still rejects an underage applicant', async () => {
    const res = await post({ date_of_birth: '2015-01-01' })
    expect(res.status).toBe(422)
    expect(res.body.message).toContain('21')
  })
})
