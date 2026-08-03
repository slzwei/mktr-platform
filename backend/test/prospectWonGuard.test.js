/**
 * H4 (review round 3): only genuinely-assigned leads may be marked won, and
 * the rule must hold at MUTATION time.
 *
 * Pre-fix the guard was `if (assignedAgentId && assignedAgentId === systemId)`
 * — a held/unassigned row (assignedAgentId=null, externalAgentId=null)
 * accepted {leadStatus:'won'}, got a conversionDate, and fired the won
 * outcome hook with no real assignee. And because the precheck read the row
 * without a lock, a concurrent unassignment committing between the read and
 * the status write produced the same won-and-unassigned state.
 *
 * Post-fix: the precheck rejects null assignees too (external mktr-leads
 * assignees count as real), and the won-transition write is a CONDITIONAL
 * UPDATE whose WHERE re-checks the assignment under the row's write lock —
 * zero affected rows = reject, so the race window is closed.
 */
import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js'
import { Prospect, ExternalAgent } from '../src/models/index.js'
import { makeProspectService } from '../src/services/prospectService.js'
import { getSystemAgentId } from '../src/services/systemAgent.js'

let app, adminToken, adminUser, agentUser, campaign

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminUser = admin.user; adminToken = admin.token
  const agent = await createTestUser({ role: 'agent' })
  agentUser = agent.user
  campaign = await createTestCampaign(adminUser.id, { name: 'Won Guard Campaign' })
})

afterAll(async () => {
  await closeDb()
})

const putStatus = (id, leadStatus) => request(app)
  .put(`/api/prospects/${id}`)
  .set('Authorization', `Bearer ${adminToken}`)
  .send({ leadStatus })

describe('H4 — won requires a real assignee', () => {
  it('an UNASSIGNED lead (null agent, null external) cannot be marked won', async () => {
    const p = await createTestProspect(campaign.id)
    expect(p.assignedAgentId ?? null).toBeNull()

    const res = await putStatus(p.id, 'won')
    // Pre-fix: 200 — the null case slipped the truthy-and-equals guard.
    expect(res.status).toBe(400)

    const row = await Prospect.findByPk(p.id, { raw: true })
    expect(row.leadStatus).not.toBe('won')
    expect(row.conversionDate).toBeNull()
  })

  it('a System-Agent-assigned lead still cannot be marked won', async () => {
    const systemId = await getSystemAgentId()
    const p = await createTestProspect(campaign.id, { assignedAgentId: systemId })
    const res = await putStatus(p.id, 'won')
    expect(res.status).toBe(400)
  })

  it('a real-agent-assigned lead CAN be marked won', async () => {
    const p = await createTestProspect(campaign.id, { assignedAgentId: agentUser.id })
    const res = await putStatus(p.id, 'won')
    expect(res.status).toBe(200)
    const row = await Prospect.findByPk(p.id, { raw: true })
    expect(row.leadStatus).toBe('won')
    expect(row.conversionDate).not.toBeNull()
  })

  it('an EXTERNAL (mktr-leads) assignee counts as a real assignee', async () => {
    const ext = await ExternalAgent.create({ phone: `65${String(Date.now()).slice(-8)}`, fullName: 'Rival Agent' })
    const p = await createTestProspect(campaign.id, { externalAgentId: ext.id })
    expect(p.assignedAgentId ?? null).toBeNull()

    const res = await putStatus(p.id, 'won')
    expect(res.status).toBe(200)
    const row = await Prospect.findByPk(p.id, { raw: true })
    expect(row.leadStatus).toBe('won')
  })

  it('a concurrent unassignment between precheck and write is rejected at mutation time', async () => {
    const p = await createTestProspect(campaign.id, { assignedAgentId: agentUser.id })
    const realSystemId = await getSystemAgentId()

    // Deterministic race: getSystemAgentId is called exactly between the
    // precheck's unlocked read and the status write on the won path — unassign
    // the row there, simulating the concurrent reassignment committing first.
    const svc = makeProspectService({
      getSystemAgentId: async () => {
        await Prospect.update({ assignedAgentId: null }, { where: { id: p.id } })
        return realSystemId
      },
    })

    // Pre-fix: the stale instance passed the precheck and the unconditional
    // UPDATE committed → a won row with NO assignee. Post-fix the conditional
    // UPDATE matches zero rows and the transition is rejected.
    await expect(svc.updateProspect(p.id, { leadStatus: 'won' }, adminUser))
      .rejects.toMatchObject({ statusCode: 400 })

    const row = await Prospect.findByPk(p.id, { raw: true })
    expect(row.leadStatus).not.toBe('won')
    expect(row.assignedAgentId).toBeNull()
    expect(row.conversionDate).toBeNull()
  })
})
