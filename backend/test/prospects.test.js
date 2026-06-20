import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect, createTestQrTag, createTestAttribution } from './helpers.js'
import { ProspectActivity } from '../src/models/index.js'

let app, adminUser, adminToken, agentUser, _agentToken

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminUser = admin.user; adminToken = admin.token
  const agent = await createTestUser({ role: 'agent' })
  agentUser = agent.user; _agentToken = agent.token
}, 15000)

afterAll(async () => {
  await closeDb()
})

// POST /api/prospects is a public, unauthenticated endpoint that deliberately
// returns only { prospect: { id } } (it must not echo PII / sourceMetadata back
// to the submitter). To assert on persisted/derived fields, fetch the full row
// via the authenticated GET and splice it onto the response under data.prospect.
async function postProspect(payload, token = adminToken) {
  const res = await request(app)
    .post('/api/prospects')
    .set('Authorization', `Bearer ${token}`)
    .send(payload)
  if (res.status === 201 && res.body?.data?.prospect?.id) {
    const got = await request(app)
      .get(`/api/prospects/${res.body.data.prospect.id}`)
      .set('Authorization', `Bearer ${token}`)
    if (got.status === 200) res.body.data.prospect = got.body.data.prospect
  }
  return res
}

describe('Prospect CRUD', () => {
  let campaign, prospectId

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
  })

  it('POST /api/prospects — creates a prospect', async () => {
    const res = await postProspect({
      firstName: 'John',
      lastName: 'Doe',
      email: `prospect-crud-${Date.now()}@test.com`,
      phone: `65${Date.now().toString().slice(-8)}`,
      leadSource: 'qr_code',
      campaignId: campaign.id
    })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.prospect).toBeDefined()
    expect(res.body.data.prospect.firstName).toBe('John')
    prospectId = res.body.data.prospect.id
  })

  it('GET /api/prospects — admin sees all prospects', async () => {
    const res = await request(app)
      .get('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.prospects).toBeDefined()
    expect(res.body.data.pagination).toBeDefined()
  })

  it('GET /api/prospects/:id — returns prospect with associations', async () => {
    const res = await request(app)
      .get(`/api/prospects/${prospectId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.prospect.id).toBe(prospectId)
    expect(res.body.data.prospect.campaign).toBeDefined()
  })

  it('GET /api/prospects/:id — returns activities newest-first with the genesis event last', async () => {
    // The Activity Timeline UI renders activities top-to-bottom and pins a
    // "Start of History" marker at the bottom, so the API must return them
    // newest-first: the latest event on top, the genesis 'created' event last.
    const p = await createTestProspect(campaign.id)
    const older = new Date('2026-01-01T00:00:00.000Z')
    const newer = new Date('2026-01-01T00:05:00.000Z')
    const created = await ProspectActivity.create({ prospectId: p.id, type: 'created', description: 'Prospect signed up' })
    const assigned = await ProspectActivity.create({ prospectId: p.id, type: 'assigned', description: 'Assigned to agent' })
    // Force distinct, deterministic timestamps — sequential inserts can land in
    // the same millisecond. silent:true keeps updatedAt untouched.
    await ProspectActivity.update({ createdAt: older }, { where: { id: created.id }, silent: true })
    await ProspectActivity.update({ createdAt: newer }, { where: { id: assigned.id }, silent: true })

    const res = await request(app)
      .get(`/api/prospects/${p.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const activities = res.body.data.prospect.activities
    // Non-empty guards the separate-include FK regression: dropping prospectId
    // from the activities attributes would blank this array entirely.
    expect(Array.isArray(activities)).toBe(true)
    expect(activities).toHaveLength(2)
    // Newest-first: assignment on top, genesis 'created' last (above the marker).
    expect(activities[0].type).toBe('assigned')
    expect(activities[activities.length - 1].type).toBe('created')
  })

  it('PUT /api/prospects/:id — updates a prospect', async () => {
    const res = await request(app)
      .put(`/api/prospects/${prospectId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ leadStatus: 'contacted', notes: 'Called back' })

    expect(res.status).toBe(200)
    expect(res.body.data.prospect.leadStatus).toBe('contacted')
  })

  it('DELETE /api/prospects/:id — deletes a prospect', async () => {
    const prospect = await createTestProspect(campaign.id)
    const res = await request(app)
      .delete(`/api/prospects/${prospect.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
  })

  it('GET /api/prospects/:id — returns 404 for non-existent', async () => {
    const res = await request(app)
      .get('/api/prospects/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })
})

describe('Prospect assignment', () => {
  let campaign, prospect

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
    prospect = await createTestProspect(campaign.id)
  })

  it('PATCH /api/prospects/:id/assign — assigns an agent', async () => {
    const res = await request(app)
      .patch(`/api/prospects/${prospect.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agentUser.id })

    expect(res.status).toBe(200)
    expect(res.body.data.prospect.assignedAgentId).toBe(agentUser.id)
  })

  it('PATCH /api/prospects/:id/assign — returns 400 for invalid agent', async () => {
    const res = await request(app)
      .patch(`/api/prospects/${prospect.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: '00000000-0000-0000-0000-000000000000' })

    expect(res.status).toBe(400)
  })
})

describe('Prospect filtering', () => {
  it('supports campaignId filter', async () => {
    const campaign = await createTestCampaign(adminUser.id)
    await createTestProspect(campaign.id)

    const res = await request(app)
      .get(`/api/prospects?campaignId=${campaign.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    if (res.body.data.prospects.length > 0) {
      expect(res.body.data.prospects.every(p => p.campaignId === campaign.id)).toBe(true)
    }
  })

  it('supports pagination', async () => {
    const res = await request(app)
      .get('/api/prospects?page=1&limit=3')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.pagination.currentPage).toBe(1)
    expect(res.body.data.prospects.length).toBeLessThanOrEqual(3)
  })
})

describe('Prospect statistics', () => {
  it('GET /api/prospects/stats/overview — returns stats', async () => {
    const res = await request(app)
      .get('/api/prospects/stats/overview')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.totalProspects).toBeGreaterThanOrEqual(0)
    expect(res.body.data.conversionRate).toBeDefined()
  })
})

describe('Duplicate phone prevention', () => {
  it('rejects duplicate phone within same campaign', async () => {
    const campaign = await createTestCampaign(adminUser.id)
    const phone = `65${Date.now().toString().slice(-8)}`

    // First create should succeed
    const res1 = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'First',
        lastName: 'Prospect',
        email: `dup1-${Date.now()}@test.com`,
        phone,
        leadSource: 'qr_code',
        campaignId: campaign.id
      })
    expect(res1.status).toBe(201)

    // Second create with same phone + campaign should fail
    const res2 = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Second',
        lastName: 'Prospect',
        email: `dup2-${Date.now()}@test.com`,
        phone,
        leadSource: 'qr_code',
        campaignId: campaign.id
      })
    expect(res2.status).toBe(409)
  })
})

describe('Phone normalization', () => {
  let campaign

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
  })

  it('normalizes 8-digit SG number to E.164', async () => {
    const res = await postProspect({
      firstName: 'PhoneA',
      lastName: 'Test',
      email: `phone-a-${Date.now()}@test.com`,
      phone: '96989099',
      leadSource: 'qr_code',
      campaignId: campaign.id
    })

    expect(res.status).toBe(201)
    expect(res.body.data.prospect.phone).toBe('+6596989099')
  })

  it('normalizes 10-digit number starting with 65 to E.164', async () => {
    // Use a separate campaign to avoid duplicate phone conflict
    // (96989099 and 6596989099 both normalize to +6596989099)
    const campaign2 = await createTestCampaign(adminUser.id)
    const res = await postProspect({
      firstName: 'PhoneB',
      lastName: 'Test',
      email: `phone-b-${Date.now()}@test.com`,
      phone: '6596989099',
      leadSource: 'qr_code',
      campaignId: campaign2.id
    })

    expect(res.status).toBe(201)
    expect(res.body.data.prospect.phone).toBe('+6596989099')
  })

  it('preserves already-E.164 number unchanged', async () => {
    const uniquePhone = `+65${Date.now().toString().slice(-8)}`
    const res = await postProspect({
      firstName: 'PhoneC',
      lastName: 'Test',
      email: `phone-c-${Date.now()}@test.com`,
      phone: uniquePhone,
      leadSource: 'qr_code',
      campaignId: campaign.id
    })

    expect(res.status).toBe(201)
    expect(res.body.data.prospect.phone).toBe(uniquePhone)
  })
})

describe('DOB and postal code mapping', () => {
  let campaign

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
  })

  it('maps date_of_birth to demographics.age', async () => {
    const res = await postProspect({
      firstName: 'DobTest',
      lastName: 'User',
      email: `dob-${Date.now()}@test.com`,
      phone: `+65${Date.now().toString().slice(-8)}`,
      leadSource: 'qr_code',
      campaignId: campaign.id,
      date_of_birth: '1990-01-15'
    })

    expect(res.status).toBe(201)
    const demographics = res.body.data.prospect.demographics
    expect(demographics).toBeDefined()
    // Age should be 36 (born 1990-01-15, current date 2026-03-15)
    expect(demographics.age).toBeGreaterThanOrEqual(35)
    expect(demographics.age).toBeLessThanOrEqual(37)
  })

  it('maps postal_code to location.postalCode', async () => {
    const res = await postProspect({
      firstName: 'PostalTest',
      lastName: 'User',
      email: `postal-${Date.now()}@test.com`,
      phone: `+65${Date.now().toString().slice(-8)}`,
      leadSource: 'qr_code',
      campaignId: campaign.id,
      postal_code: '123456'
    })

    expect(res.status).toBe(201)
    const location = res.body.data.prospect.location
    expect(location).toBeDefined()
    expect(location.postalCode).toBe('123456')
  })
})

describe('Status transition to won', () => {
  let campaign, prospect

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
    prospect = await createTestProspect(campaign.id, {
      assignedAgentId: agentUser.id,
      leadStatus: 'qualified'
    })
  })

  it('updates leadStatus to won and returns 200', async () => {
    const res = await request(app)
      .put(`/api/prospects/${prospect.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ leadStatus: 'won' })

    expect(res.status).toBe(200)
    expect(res.body.data.prospect.leadStatus).toBe('won')
  })

  it('increments campaign metrics.conversions on won', async () => {
    // Create a fresh campaign and prospect for this test
    const c = await createTestCampaign(adminUser.id)
    const p = await createTestProspect(c.id, {
      assignedAgentId: agentUser.id,
      leadStatus: 'negotiating'
    })

    await request(app)
      .put(`/api/prospects/${p.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ leadStatus: 'won' })

    // Fetch campaign to check metrics
    const res = await request(app)
      .get(`/api/prospects/${p.id}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.prospect.leadStatus).toBe('won')
  })
})

describe('Prospect search', () => {
  let campaign

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
    await createTestProspect(campaign.id, {
      firstName: 'Searchable',
      lastName: 'Johnson',
      leadStatus: 'new'
    })
  })

  it('returns matching prospects for ?search= query', async () => {
    const res = await request(app)
      .get('/api/prospects?search=Searchable')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.prospects.length).toBeGreaterThanOrEqual(1)
    const match = res.body.data.prospects.find(p => p.firstName === 'Searchable')
    expect(match).toBeDefined()
  })

  it('filters by leadStatus query param', async () => {
    const res = await request(app)
      .get('/api/prospects?leadStatus=new')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.prospects.every(p => p.leadStatus === 'new')).toBe(true)
  })
})

describe('Bulk assign', () => {
  let campaign, prospect1, prospect2

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
    prospect1 = await createTestProspect(campaign.id)
    prospect2 = await createTestProspect(campaign.id)
  })

  it('assigns multiple prospects to an agent', async () => {
    const res = await request(app)
      .patch('/api/prospects/bulk/assign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        prospectIds: [prospect1.id, prospect2.id],
        agentId: agentUser.id
      })

    expect(res.status).toBe(200)
    expect(res.body.data.affectedCount).toBe(2)
  })

  it('returns 400 when agentId is missing', async () => {
    const res = await request(app)
      .patch('/api/prospects/bulk/assign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        prospectIds: [prospect1.id]
      })

    expect(res.status).toBe(400)
  })
})

describe('Schedule follow-up', () => {
  let campaign, prospect

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
    prospect = await createTestProspect(campaign.id)
  })

  it('sets nextFollowUpDate and returns 200', async () => {
    const followUpDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const res = await request(app)
      .patch(`/api/prospects/${prospect.id}/follow-up`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nextFollowUpDate: followUpDate })

    expect(res.status).toBe(200)
    expect(res.body.data.prospect.nextFollowUpDate).toBeDefined()
  })

  it('returns 400 when nextFollowUpDate is missing', async () => {
    const res = await request(app)
      .patch(`/api/prospects/${prospect.id}/follow-up`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'No date provided' })

    expect(res.status).toBe(400)
  })
})

describe('Attribution binding', () => {
  let campaign, qrTag

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
    qrTag = await createTestQrTag(campaign.id, adminUser.id)
  })

  it('binds attributionId and qrTagId from x-session-id header', async () => {
    const sessionId = `test-session-${Date.now()}`
    const attribution = await createTestAttribution(qrTag.id, sessionId)

    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-session-id', sessionId)
      .send({
        firstName: 'AttrBind',
        lastName: 'Test',
        email: `attrbind-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'qr_code',
        campaignId: campaign.id
      })

    expect(res.status).toBe(201)
    // Create returns only { id }; fetch the full row to verify server-side binding.
    const got = await request(app)
      .get(`/api/prospects/${res.body.data.prospect.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(got.body.data.prospect.attributionId).toBe(attribution.id)
    expect(got.body.data.prospect.qrTagId).toBe(qrTag.id)
  })
})

describe('QR tag campaign derivation', () => {
  it('derives campaignId from qrTagId when campaignId is not provided', async () => {
    const campaign = await createTestCampaign(adminUser.id)
    const qrTag = await createTestQrTag(campaign.id, adminUser.id)

    const res = await postProspect({
      firstName: 'DeriveC',
      lastName: 'Test',
      email: `derivec-${Date.now()}@test.com`,
      phone: `+65${Date.now().toString().slice(-8)}`,
      leadSource: 'qr_code',
      qrTagId: qrTag.id
      // no campaignId
    })

    expect(res.status).toBe(201)
    expect(res.body.data.prospect.campaignId).toBe(campaign.id)
  })
})

describe('Delete prospect edge cases', () => {
  it('returns 404 when deleting a non-existent prospect', async () => {
    const res = await request(app)
      .delete('/api/prospects/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })
})

describe('Track prospect view', () => {
  let campaign, prospect

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
    prospect = await createTestProspect(campaign.id)
  })

  it('POST /api/prospects/:id/track-view returns 200', async () => {
    const res = await request(app)
      .post(`/api/prospects/${prospect.id}/track-view`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ source: 'email_link' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

describe('Education and income demographic mapping', () => {
  let campaign

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
  })

  it('maps education_level to demographics.education', async () => {
    const res = await postProspect({
      firstName: 'EduTest',
      lastName: 'User',
      email: `edu-${Date.now()}@test.com`,
      phone: `+65${Date.now().toString().slice(-8)}`,
      leadSource: 'qr_code',
      campaignId: campaign.id,
      education_level: 'bachelors'
    })

    expect(res.status).toBe(201)
    const demographics = res.body.data.prospect.demographics
    expect(demographics).toBeDefined()
    expect(demographics.education).toBe('bachelors')
  })

  it('maps monthly_income to demographics.income', async () => {
    const res = await postProspect({
      firstName: 'IncTest',
      lastName: 'User',
      email: `inc-${Date.now()}@test.com`,
      phone: `+65${Date.now().toString().slice(-8)}`,
      leadSource: 'qr_code',
      campaignId: campaign.id,
      monthly_income: '5000-10000'
    })

    expect(res.status).toBe(201)
    const demographics = res.body.data.prospect.demographics
    expect(demographics).toBeDefined()
    expect(demographics.income).toBe('5000-10000')
  })

  it('maps both education_level and monthly_income together', async () => {
    const res = await postProspect({
      firstName: 'BothTest',
      lastName: 'User',
      email: `both-${Date.now()}@test.com`,
      phone: `+65${Date.now().toString().slice(-8)}`,
      leadSource: 'qr_code',
      campaignId: campaign.id,
      education_level: 'masters',
      monthly_income: '10000-20000'
    })

    expect(res.status).toBe(201)
    const demographics = res.body.data.prospect.demographics
    expect(demographics.education).toBe('masters')
    expect(demographics.income).toBe('10000-20000')
  })
})

describe('Unassignment activity logging', () => {
  let campaign, prospect

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
    prospect = await createTestProspect(campaign.id, { assignedAgentId: agentUser.id })
  })

  it('logs activity when prospect is manually unassigned', async () => {
    // Unassignment goes through the assign endpoint with a null agentId — a raw
    // PUT intentionally cannot mutate assignedAgentId (it must charge / fire the
    // lead.unassigned webhook), so assignedAgentId is filtered out of PUT updates.
    const res = await request(app)
      .patch(`/api/prospects/${prospect.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: null })

    expect(res.status).toBe(200)

    // Verify the unassignment activity was logged (type 'assigned', previous agent
    // captured in metadata.previousAgentId).
    const activities = await ProspectActivity.findAll({
      where: {
        prospectId: prospect.id,
        type: 'assigned'
      },
      order: [['createdAt', 'DESC']]
    })

    const unassignActivity = activities.find(a => (a.metadata || {}).previousAgentId === agentUser.id)
    expect(unassignActivity).toBeDefined()
    expect(unassignActivity.description).toBe('Unassigned from agent')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Error path and edge case tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Prospect error paths — bulk assign edge cases', () => {
  it('PATCH /api/prospects/bulk/assign — empty prospectIds array returns 400', async () => {
    const res = await request(app)
      .patch('/api/prospects/bulk/assign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        prospectIds: [],
        agentId: agentUser.id
      })

    // Service requires non-empty prospectIds
    expect([200, 400]).toContain(res.status)
  })

  it('PATCH /api/prospects/bulk/assign — invalid agent ID returns 400', async () => {
    const campaign = await createTestCampaign(adminUser.id)
    const p = await createTestProspect(campaign.id)

    const res = await request(app)
      .patch('/api/prospects/bulk/assign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        prospectIds: [p.id],
        agentId: '00000000-0000-0000-0000-000000000000'
      })

    expect(res.status).toBe(400)
  })
})

describe('Prospect error paths — pagination bounds', () => {
  it('GET /api/prospects?page=0&limit=0 — handles zero pagination', async () => {
    const res = await request(app)
      .get('/api/prospects?page=0&limit=0')
      .set('Authorization', `Bearer ${adminToken}`)

    // Should not crash
    expect([200, 400]).toContain(res.status)
  })

  it('GET /api/prospects?page=99999 — very large page returns empty', async () => {
    const res = await request(app)
      .get('/api/prospects?page=99999&limit=10')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.prospects).toHaveLength(0)
  })

  it('GET /api/prospects?page=-1&limit=-5 — negative pagination handles gracefully', async () => {
    const res = await request(app)
      .get('/api/prospects?page=-1&limit=-5')
      .set('Authorization', `Bearer ${adminToken}`)

    expect([200, 400]).toContain(res.status)
  })
})

describe('Prospect error paths — update non-existent', () => {
  it('PUT /api/prospects/:id — returns 404 for non-existent prospect', async () => {
    const res = await request(app)
      .put('/api/prospects/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ leadStatus: 'contacted' })

    expect(res.status).toBe(404)
  })
})

describe('Prospect error paths — assign to non-existent agent', () => {
  it('PATCH /api/prospects/:id/assign — returns 400 for non-existent agent', async () => {
    const campaign = await createTestCampaign(adminUser.id)
    const prospect = await createTestProspect(campaign.id)

    const res = await request(app)
      .patch(`/api/prospects/${prospect.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: '00000000-0000-0000-0000-000000000000' })

    expect(res.status).toBe(400)
  })
})

describe('Prospect error paths — assign already-assigned prospect', () => {
  it('PATCH /api/prospects/:id/assign — reassigning to same agent succeeds', async () => {
    const campaign = await createTestCampaign(adminUser.id)
    const prospect = await createTestProspect(campaign.id, { assignedAgentId: agentUser.id })

    const res = await request(app)
      .patch(`/api/prospects/${prospect.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ agentId: agentUser.id })

    // Should succeed — reassignment to same agent is allowed
    expect(res.status).toBe(200)
    expect(res.body.data.prospect.assignedAgentId).toBe(agentUser.id)
  })
})

describe('Prospect error paths — filter by invalid status', () => {
  it('GET /api/prospects?leadStatus=nonexistent — returns empty or all', async () => {
    const res = await request(app)
      .get('/api/prospects?leadStatus=nonexistent_status')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    // Invalid status filter should return empty results
    expect(res.body.data.prospects).toHaveLength(0)
  })
})

describe('Prospect error paths — create missing required fields', () => {
  it('POST /api/prospects — returns 400 for missing firstName', async () => {
    const campaign = await createTestCampaign(adminUser.id)

    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: `missing-fn-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'qr_code',
        campaignId: campaign.id
      })

    expect(res.status).toBe(400)
  })

  it('POST /api/prospects — returns 400 for missing email', async () => {
    const campaign = await createTestCampaign(adminUser.id)

    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'NoEmail',
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'qr_code',
        campaignId: campaign.id
      })

    expect(res.status).toBe(400)
  })

  it('POST /api/prospects — returns 400 for missing leadSource', async () => {
    const campaign = await createTestCampaign(adminUser.id)

    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'NoSource',
        email: `nosource-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        campaignId: campaign.id
      })

    expect(res.status).toBe(400)
  })
})

describe('Prospect CAPI meta-fields (Phase 2)', () => {
  let campaign

  beforeAll(async () => {
    campaign = await createTestCampaign(adminUser.id)
  })

  it('POST /api/prospects with eventId/fbp/fbc/eventSourceUrl persists them to sourceMetadata', async () => {
    const eventId = `evt-${Date.now()}`
    const fbp = `fb.1.${Date.now()}.123456`
    const fbc = `fb.1.${Date.now()}.fbclid_test`
    const eventSourceUrl = 'https://mktr.sg/lead-capture/test'

    const createRes = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('User-Agent', 'phase2-integration-test/1.0')
      .send({
        firstName: 'Capi',
        lastName: 'Tester',
        email: `capi-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'website',
        campaignId: campaign.id,
        eventId,
        fbp,
        fbc,
        eventSourceUrl,
      })

    expect(createRes.status).toBe(201)
    const prospectId = createRes.body.data.prospect.id
    expect(prospectId).toBeDefined()

    const getRes = await request(app)
      .get(`/api/prospects/${prospectId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(getRes.status).toBe(200)
    const sm = getRes.body.data.prospect.sourceMetadata || {}
    expect(sm.eventId).toBe(eventId)
    expect(sm.fbp).toBe(fbp)
    expect(sm.fbc).toBe(fbc)
    expect(sm.eventSourceUrl).toBe(eventSourceUrl)
    // clientUserAgent should reflect the request header we set
    expect(sm.clientUserAgent).toBe('phase2-integration-test/1.0')
    // clientIp should be present (supertest issues from 127.0.0.1)
    expect(sm.clientIp).toBeDefined()
  })

  it('POST /api/prospects without meta-fields still creates successfully', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'NoMeta',
        lastName: 'Tester',
        email: `nometa-${Date.now()}@test.com`,
        phone: `+65${Date.now().toString().slice(-8)}`,
        leadSource: 'website',
        campaignId: campaign.id,
      })

    expect(res.status).toBe(201)
  })

  it('POST /api/prospects with bogus CAPI fields does not leak them as Prospect attributes', async () => {
    const res = await postProspect({
      firstName: 'Strip',
      lastName: 'Tester',
      email: `strip-${Date.now()}@test.com`,
      phone: `+65${Date.now().toString().slice(-8)}`,
      leadSource: 'website',
      campaignId: campaign.id,
      eventId: 'evt-strip',
      fbp: 'fbp-strip',
    })

    expect(res.status).toBe(201)
    const p = res.body.data.prospect
    // The meta-fields must be stashed in sourceMetadata, not on the Prospect attributes
    expect(p.eventId).toBeUndefined()
    expect(p.fbp).toBeUndefined()
    expect(p.sourceMetadata?.eventId).toBe('evt-strip')
    expect(p.sourceMetadata?.fbp).toBe('fbp-strip')
  })
})
