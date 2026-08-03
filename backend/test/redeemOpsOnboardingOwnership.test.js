/**
 * H2 (review round 3): partner onboarding endpoints must honour row-level
 * ownership. onboarding.manage is a CAPABILITY — an outreach_exec holds it,
 * yet may only act on partners they own. Pre-fix, GET
 * /partners/:id/onboarding queried (and lazily SEEDED) solely by the supplied
 * partner UUID, and PATCH /onboarding/:itemId loaded solely by item PK — so
 * knowing another partner/item UUID exposed its notes and permitted writing
 * status/assignee/notes/completedAt across the ownership boundary.
 * assigneeUserId was also written unvalidated (ghost ids died on the FK as a
 * 500; any known user id — redeem-ops or not — was accepted).
 */
process.env.REDEEM_OPS_ENABLED = 'true';

import request from 'supertest'
import { getApp, closeDb, createTestUser } from './helpers.js'
import { PartnerOnboardingItem } from '../src/models/index.js'

let app, admin, execA, execB, agent

beforeAll(async () => {
  app = await getApp()
  admin = await createTestUser({ role: 'admin' })
  execA = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' })
  execB = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' })
  agent = await createTestUser({ role: 'agent' }) // active, but NOT a Redeem Ops principal
})

afterAll(async () => {
  await closeDb()
})

const auth = (t) => ({ Authorization: `Bearer ${t}` })

/** Partner owned by execA, walked to PARTNERED so its checklist is seeded. */
async function makeOwnedPartner(name) {
  const created = await request(app)
    .post('/api/redeem-ops/partners')
    .set(auth(execA.token))
    .send({ tradingName: name })
  const partner = created.body.data.partner
  await request(app).post(`/api/redeem-ops/partners/${partner.id}/claim`).set(auth(execA.token))
  await request(app)
    .post(`/api/redeem-ops/partners/${partner.id}/contacts`)
    .set(auth(execA.token))
    .send({ name: 'Deal Signer', mobile: '+6598765432' })
  // Ownership stays with execA (claim above); the stage force is admin-only,
  // and admin's row override lets it ride without touching the owner.
  const staged = await request(app)
    .patch(`/api/redeem-ops/partners/${partner.id}/stage`)
    .set(auth(admin.token))
    .send({ toStage: 'PARTNERED', reason: 'closed for fixtures' })
  if (staged.status !== 200) throw new Error(`fixture close failed: ${staged.status} ${JSON.stringify(staged.body)}`)
  return partner
}

describe('H2 — onboarding endpoints enforce partner row ownership', () => {
  let partner, item

  beforeAll(async () => {
    partner = await makeOwnedPartner('Ownership Boundary Nails')
    item = await PartnerOnboardingItem.findOne({
      where: { partnerOrganisationId: partner.id, itemKey: 'partnership_confirmed' },
    })
    expect(item).not.toBeNull()
  })

  it("GET another owner's checklist is 403", async () => {
    const res = await request(app)
      .get(`/api/redeem-ops/partners/${partner.id}/onboarding`)
      .set(auth(execB.token))
    expect(res.status).toBe(403)
  })

  it("PATCH another owner's item is 403 and writes NOTHING", async () => {
    const res = await request(app)
      .patch(`/api/redeem-ops/onboarding/${item.id}`)
      .set(auth(execB.token))
      .send({ status: 'done', notes: 'crossed the boundary' })
    expect(res.status).toBe(403)

    await item.reload()
    expect(item.status).toBe('pending')
    expect(item.notes).toBeNull()
    expect(item.completedAt).toBeNull()
  })

  it('the owner still reads and writes their checklist', async () => {
    const list = await request(app)
      .get(`/api/redeem-ops/partners/${partner.id}/onboarding`)
      .set(auth(execA.token))
    expect(list.status).toBe(200)
    expect(list.body.data.items.length).toBeGreaterThan(0)

    const res = await request(app)
      .patch(`/api/redeem-ops/onboarding/${item.id}`)
      .set(auth(execA.token))
      .send({ status: 'in_progress', notes: 'owner note' })
    expect(res.status).toBe(200)
    await item.reload()
    expect(item.status).toBe('in_progress')
    expect(item.notes).toBe('owner note')
  })

  it('platform admin overrides the row gate (ops backstop)', async () => {
    const list = await request(app)
      .get(`/api/redeem-ops/partners/${partner.id}/onboarding`)
      .set(auth(admin.token))
    expect(list.status).toBe(200)

    const res = await request(app)
      .patch(`/api/redeem-ops/onboarding/${item.id}`)
      .set(auth(admin.token))
      .send({ status: 'na' })
    expect(res.status).toBe(200)
  })

  it('an UNOWNED partner belongs to nobody until claimed — no cross-owner lazy seed', async () => {
    const created = await request(app)
      .post('/api/redeem-ops/partners')
      .set(auth(admin.token))
      .send({ tradingName: 'Unclaimed Onboarding Lead' })
    const unowned = created.body.data.partner

    const res = await request(app)
      .get(`/api/redeem-ops/partners/${unowned.id}/onboarding`)
      .set(auth(execB.token))
    expect(res.status).toBe(403)
    // Pre-fix the GET lazily seeded 11 items for a partner execB cannot act on.
    const seeded = await PartnerOnboardingItem.count({ where: { partnerOrganisationId: unowned.id } })
    expect(seeded).toBe(0)
  })

  it('a ghost partner id is a clean 404, not a failed lazy seed', async () => {
    const res = await request(app)
      .get('/api/redeem-ops/partners/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/onboarding')
      .set(auth(admin.token))
    expect(res.status).toBe(404)
  })
})

describe('H2 — assigneeUserId must be an active Redeem Ops user', () => {
  let partner, item

  beforeAll(async () => {
    partner = await makeOwnedPartner('Assignee Validation Nails')
    item = await PartnerOnboardingItem.findOne({
      where: { partnerOrganisationId: partner.id, itemKey: 'primary_contact_verified' },
    })
  })

  it('a ghost user id is a 422, not an FK 500', async () => {
    const res = await request(app)
      .patch(`/api/redeem-ops/onboarding/${item.id}`)
      .set(auth(execA.token))
      .send({ assigneeUserId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })
    expect(res.status).toBe(422)
  })

  it('an active user who is NOT a Redeem Ops principal is rejected', async () => {
    const res = await request(app)
      .patch(`/api/redeem-ops/onboarding/${item.id}`)
      .set(auth(execA.token))
      .send({ assigneeUserId: agent.user.id })
    expect(res.status).toBe(422)
    await item.reload()
    expect(item.assigneeUserId).toBeNull()
  })

  it('an active Redeem Ops colleague is assignable; null clears', async () => {
    const set = await request(app)
      .patch(`/api/redeem-ops/onboarding/${item.id}`)
      .set(auth(execA.token))
      .send({ assigneeUserId: execB.user.id })
    expect(set.status).toBe(200)
    await item.reload()
    expect(item.assigneeUserId).toBe(execB.user.id)

    const clear = await request(app)
      .patch(`/api/redeem-ops/onboarding/${item.id}`)
      .set(auth(execA.token))
      .send({ assigneeUserId: null })
    expect(clear.status).toBe(200)
    await item.reload()
    expect(item.assigneeUserId).toBeNull()
  })
})
