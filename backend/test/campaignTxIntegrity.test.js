/**
 * H1 + H5 (review round 3): campaign writes must be transactional.
 *
 * H1 — the draw boost rail used to commit in its OWN transaction before
 * campaign.update() ran. A PUT {is_active:true, slug:<taken>} on an inactive
 * draw campaign provisioned + committed an active activation and allocated
 * stock, THEN died on the slug unique constraint (409) — leaving a live rail
 * on a campaign that never activated. The rail must commit WITH the save.
 *
 * H5 — assigned_agents was validated as UUID *syntax* only, and
 * syncAgentAssignments ran in its own transaction after the campaign row
 * committed. POST with a ghost UUID left an orphan campaign behind a 500;
 * PUT committed field changes even when the assignment write then failed.
 * Campaign + assignment writes must land (or fail) together, and ghost ids
 * must 422 before anything commits.
 */
import request from 'supertest'
import { getApp, closeDb, createTestUser } from './helpers.js'
import {
  Campaign, User, Activation, RewardOffer, PartnerOrganisation, CampaignAgentAssignment,
} from '../src/models/index.js'
import { buildDrawTermsHtml } from '../src/utils/drawTermsTemplate.js'

let app, adminToken, adminUser, agentUser

const BRIEF = { objective: 'agent_leads', product: 'insurance' }
const GHOST_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' // well-formed, no such user

const DRAW_FACTS = { prize: 'iPhone 17 Pro', closesAt: '2027-01-31', minAge: 21, maxAge: 55 }

function drawDesignConfig(campaignName) {
  return {
    luckyDraw: { enabled: true, closesAt: DRAW_FACTS.closesAt, prize: DRAW_FACTS.prize },
    termsContent: buildDrawTermsHtml({
      campaignName,
      prize: DRAW_FACTS.prize,
      closesAt: DRAW_FACTS.closesAt,
      minAge: DRAW_FACTS.minAge,
      maxAge: DRAW_FACTS.maxAge,
    }),
  }
}

const ENV_KEYS = ['REDEEM_OPS_ENTITLEMENTS_ENABLED', 'DRAW_BOOST_AUTOPROVISION_ENABLED', 'REDEEM_HOUSE_PARTNER_ORG_ID']
const envBackup = {}

beforeAll(async () => {
  ENV_KEYS.forEach((k) => { envBackup[k] = process.env[k] })
  // The rail provisions only with the entitlement engine on + a house partner.
  process.env.REDEEM_OPS_ENTITLEMENTS_ENABLED = 'true'
  delete process.env.DRAW_BOOST_AUTOPROVISION_ENABLED
  delete process.env.REDEEM_HOUSE_PARTNER_ORG_ID

  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminUser = admin.user; adminToken = admin.token
  const agent = await createTestUser({ role: 'agent' })
  agentUser = agent.user
  await PartnerOrganisation.create({
    legalName: 'MKTR PTE. LTD.',
    normalizedName: 'mktr pte. ltd.',
    createdBy: adminUser.id,
  })
})

afterAll(async () => {
  ENV_KEYS.forEach((k) => {
    if (envBackup[k] === undefined) delete process.env[k]
    else process.env[k] = envBackup[k]
  })
  await closeDb()
})

const post = (body) => request(app)
  .post('/api/campaigns')
  .set('Authorization', `Bearer ${adminToken}`)
  .send(body)

const put = (id, body) => request(app)
  .put(`/api/campaigns/${id}`)
  .set('Authorization', `Bearer ${adminToken}`)
  .send(body)

describe('H1 — draw rail commits with the activation save, not before it', () => {
  let drawId

  beforeAll(async () => {
    // Holds the slug the activation PUT will collide with.
    const holder = await post({ name: 'H1 Slug Holder', targetAudience: BRIEF, slug: 'h1-taken-slug' })
    expect(holder.status).toBe(201)

    const draw = await post({
      name: 'H1 Draw Campaign',
      targetAudience: BRIEF,
      is_active: false,
      min_age: DRAW_FACTS.minAge,
      max_age: DRAW_FACTS.maxAge,
      design_config: drawDesignConfig('H1 Draw Campaign'),
    })
    expect(draw.status).toBe(201)
    drawId = draw.body.data.campaign.id
  })

  it('a slug-conflict 409 on the arming PUT leaves NO committed rail behind', async () => {
    const res = await put(drawId, { is_active: true, slug: 'h1-taken-slug' })
    expect(res.status).toBe(409)

    // Pre-fix: ensureRail's own transaction had already committed an active
    // activation + allocated offer stock before campaign.update() 409ed.
    const acts = await Activation.count({ where: { campaignId: drawId } })
    expect(acts).toBe(0)
    const offer = await RewardOffer.findOne({ where: { internalRef: `draw-boost:${drawId}` } })
    expect(offer).toBeNull()

    const campaign = await Campaign.findByPk(drawId)
    expect(campaign.is_active).toBe(false)
    expect(campaign.slug).toBeNull()
  })

  it('control: the same PUT with a free slug provisions the rail AND activates', async () => {
    const res = await put(drawId, { is_active: true, slug: 'h1-free-slug' })
    expect(res.status).toBe(200)

    const acts = await Activation.findAll({ where: { campaignId: drawId } })
    expect(acts).toHaveLength(1)
    expect(acts[0].status).toBe('active')

    const campaign = await Campaign.findByPk(drawId)
    expect(campaign.is_active).toBe(true)
    expect(campaign.design_config?.luckyDraw?.activationId).toBe(acts[0].id)
  })
})

describe('H5 — campaign + agent-assignment writes are one transaction', () => {
  it('POST with a ghost agent id 422s and leaves NO orphan campaign', async () => {
    const res = await post({
      name: 'H5 Ghost Agent Campaign',
      targetAudience: BRIEF,
      assigned_agents: [GHOST_ID],
    })
    // Pre-fix: Campaign.create() committed, then the FK violation surfaced as
    // a 500 — the campaign row survived its own failed create call.
    expect(res.status).toBe(422)
    const orphan = await Campaign.findOne({ where: { name: 'H5 Ghost Agent Campaign' } })
    expect(orphan).toBeNull()
  })

  it('POST with a real active agent still creates campaign + assignment', async () => {
    const res = await post({
      name: 'H5 Assigned Campaign',
      targetAudience: BRIEF,
      assigned_agents: [agentUser.id],
    })
    expect(res.status).toBe(201)
    expect(res.body.data.campaign.assigned_agents).toEqual([agentUser.id])
    const rows = await CampaignAgentAssignment.findAll({
      where: { campaignId: res.body.data.campaign.id },
    })
    expect(rows.map((r) => r.agentId)).toEqual([agentUser.id])
  })

  it('PUT that renames AND assigns a ghost id rolls the rename back with the 422', async () => {
    const created = await post({
      name: 'H5 Atomic Update',
      targetAudience: BRIEF,
      assigned_agents: [agentUser.id],
    })
    expect(created.status).toBe(201)
    const id = created.body.data.campaign.id

    const res = await put(id, { name: 'H5 Atomic Update RENAMED', assigned_agents: [GHOST_ID] })
    expect(res.status).toBe(422)

    // Pre-fix: the rename committed before syncAgentAssignments failed — the
    // response was a 500 for a half-applied update.
    const campaign = await Campaign.findByPk(id)
    expect(campaign.name).toBe('H5 Atomic Update')
    const rows = await CampaignAgentAssignment.findAll({ where: { campaignId: id } })
    expect(rows.map((r) => r.agentId)).toEqual([agentUser.id])
  })

  it('an agent already on the campaign may stay after deactivation; ADDING an inactive agent 422s', async () => {
    const { user: retiring } = await createTestUser({ role: 'agent' })

    const created = await post({
      name: 'H5 Retained Agent',
      targetAudience: BRIEF,
      assigned_agents: [retiring.id],
    })
    expect(created.status).toBe(201)
    const id = created.body.data.campaign.id

    await User.update({ isActive: false }, { where: { id: retiring.id } })

    // Routine save resending the stored list must keep working (no regression
    // for campaigns whose assigned agent later went inactive)…
    const keep = await put(id, { name: 'H5 Retained Agent v2', assigned_agents: [retiring.id] })
    expect(keep.status).toBe(200)

    // …but newly ADDING an inactive agent is rejected.
    const other = await post({ name: 'H5 Add Inactive Target', targetAudience: BRIEF })
    expect(other.status).toBe(201)
    const add = await put(other.body.data.campaign.id, { assigned_agents: [retiring.id] })
    expect(add.status).toBe(422)
  })
})
