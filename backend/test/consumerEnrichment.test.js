import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js'
import {
  sequelize, Prospect, Consumer, ConsumerObservation, ConsumerProfile, EnrichmentJob,
} from '../src/models/index.js'
import { drainMapJobs, MAPPER_PIPELINE_VERSION } from '../src/services/factMapperService.js'
import { bumpEnrichmentInputTx } from '../src/services/enrichmentFence.js'
import { makeErasureService } from '../src/services/erasureService.js'
import { makeProspectService } from '../src/services/prospectService.js'

/**
 * Consumer enrichment PR 1 — the DB half
 * (docs/plans/consumer-profile-enrichment.md §3, §5, §9).
 *
 * Covers the load-bearing lifecycle: capture writes the map-job OUTBOX in
 * the capture transaction → drain activates revision 1 observations + bumps
 * the input version → a staff demographics edit mints revision 2 whose
 * activation SUPERSEDES revision 1 (a cleared DOB kills the old band via a
 * zero-fact snapshot) → erasure deletes ledger + profile, nulls job
 * payloads/lastError, and scrubs screeningMetadata (the pre-existing PII
 * gap this PR closes).
 */

let app, admin, adminToken, campaign
const phoneFor = (n) => `65${(80000000 + n).toString()}`
let phoneSeq = Math.floor(Math.random() * 800000)

async function capture(overrides = {}) {
  phoneSeq += 1
  const res = await request(app)
    .post('/api/prospects')
    .send({
      firstName: 'Enrich',
      lastName: 'Case',
      email: `enrich-${phoneSeq}@example.com`,
      phone: phoneFor(phoneSeq),
      leadSource: 'website',
      campaignId: campaign.id,
      date_of_birth: '1988-06-15',
      ...overrides,
    })
  expect(res.status).toBe(201)
  return Prospect.findByPk(res.body.data.prospect.id)
}

beforeAll(async () => {
  app = await getApp()
  const made = await createTestUser({ role: 'admin' })
  admin = made.user
  adminToken = made.token
  campaign = await createTestCampaign(admin.id, { name: `Enrichment IT ${Date.now()}` })
})

// The service fires opportunistic post-commit drains (capture + staff edits).
// Those RACE any drain the test runs itself: the async drain can hold the
// job leased while the test's drain sees nothing pending, and the assertion
// then reads pre-activation state. Quiesce = drain + wait until no live map
// job remains for the prospect.
async function drainAndQuiesce(prospectId, { timeoutMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    await drainMapJobs({ limit: 10 })
    const live = await EnrichmentJob.count({
      where: { kind: 'map', subjectProspectId: prospectId, status: ['pending', 'leased'] },
    })
    if (live === 0) return
    if (Date.now() > deadline) throw new Error(`map jobs never quiesced for ${prospectId}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

afterAll(async () => {
  await closeDb()
})

describe('capture outbox → drain → observations', () => {
  it('capture enqueues a map job (revision 1) and the drain mints the birth-year band', async () => {
    const prospect = await capture()
    expect(prospect.enrichmentRevision).toBe(1)
    expect(prospect.consumerId).toBeTruthy()

    // The outbox row is durable regardless of the post-commit drain's timing.
    const job = await EnrichmentJob.findOne({
      where: { kind: 'map', subjectProspectId: prospect.id, sourceRevisionId: 1 },
    })
    expect(job).toBeTruthy()
    expect(job.pipelineVersion).toBe(MAPPER_PIPELINE_VERSION)
    expect(job.payload.facts).toEqual([
      { key: 'identity.birth_year_band', value: { v: '1985-1989' }, artifact: 'form' },
    ])

    // Post-capture drain may have already processed it — drain to certainty.
    await drainAndQuiesce(prospect.id)
    const obs = await ConsumerObservation.findAll({
      where: { sourceProspectId: prospect.id, key: 'identity.birth_year_band' },
    })
    expect(obs).toHaveLength(1)
    expect(obs[0].value).toEqual({ v: '1985-1989' })
    expect(obs[0].source).toBe('form')
    expect(obs[0].supersededAt).toBeNull()
    expect(obs[0].sourceArtifactId).toBe(`form:${prospect.id}`)
    expect(Number(obs[0].sourceRevisionId)).toBe(1)

    // The owner's profile went dirty via the bump upsert.
    const profile = await ConsumerProfile.findByPk(prospect.consumerId)
    expect(profile).toBeTruthy()
    expect(Number(profile.inputVersion)).toBeGreaterThan(Number(profile.syncedInputVersion))

    // Drain is idempotent: nothing new on a second pass.
    await drainMapJobs({ limit: 10 })
    expect(await ConsumerObservation.count({ where: { sourceProspectId: prospect.id } })).toBe(1)
  })

  it('a staff demographics edit mints revision 2 whose activation supersedes revision 1', async () => {
    const prospect = await capture()
    // Revision 1 must be ACTIVATED (not merely enqueued) before the edit —
    // otherwise the rev bump correctly stales the rev-1 job and only one row
    // ever exists.
    await drainAndQuiesce(prospect.id)

    const service = makeProspectService()
    await service.updateProspect(prospect.id, { demographics: { dateOfBirth: '1995-02-02', age: 31 } }, admin)
    await drainAndQuiesce(prospect.id)

    const all = await ConsumerObservation.findAll({
      where: { sourceProspectId: prospect.id, key: 'identity.birth_year_band' },
      order: [['sourceRevisionId', 'ASC']],
    })
    expect(all).toHaveLength(2)
    expect(all[0].supersededAt).not.toBeNull() // revision 1 superseded
    expect(all[1].supersededAt).toBeNull()
    expect(all[1].value).toEqual({ v: '1995-1999' })
    expect(Number(all[1].sourceRevisionId)).toBe(2)

    // Clearing the DOB entirely: zero-fact snapshot still ACTIVATES (§3.1) —
    // revision 3 supersedes revision 2's band and inserts nothing.
    await service.updateProspect(prospect.id, { demographics: {} }, admin)
    await drainAndQuiesce(prospect.id)
    const active = await ConsumerObservation.findAll({
      where: { sourceProspectId: prospect.id, supersededAt: null },
    })
    expect(active).toHaveLength(0)
  })

  it('a stale-revision job can never activate (late rev-1 after rev-2)', async () => {
    const prospect = await capture()
    // Freeze the rev-1 job in pending (kill the auto-drain's claim if any by
    // resetting), then advance the prospect to revision 2 and drain BOTH.
    await EnrichmentJob.update(
      { status: 'pending', leaseToken: null, leaseExpiresAt: null },
      { where: { subjectProspectId: prospect.id, kind: 'map' } }
    )
    const service = makeProspectService()
    await service.updateProspect(prospect.id, { demographics: { dateOfBirth: '2000-03-03', age: 26 } }, admin)
    await drainAndQuiesce(prospect.id)

    const jobs = await EnrichmentJob.findAll({
      where: { subjectProspectId: prospect.id, kind: 'map' },
      order: [['sourceRevisionId', 'ASC']],
    })
    expect(jobs.map((j) => j.status).sort()).toEqual(['done', 'stale'])
    const active = await ConsumerObservation.findAll({
      where: { sourceProspectId: prospect.id, supersededAt: null },
    })
    expect(active).toHaveLength(1)
    expect(active[0].value).toEqual({ v: '2000-2004' })
  })

  it('deleting the prospect cascades its observations away', async () => {
    const prospect = await capture()
    await drainMapJobs({ limit: 10 })
    const service = makeProspectService()
    await service.deleteProspect(prospect.id, admin)
    expect(await ConsumerObservation.count({ where: { sourceProspectId: prospect.id } })).toBe(0)
  })
})

describe('erasure cascade (§9)', () => {
  it('deletes observations + profile, nulls job payloads/lastError, scrubs screeningMetadata', async () => {
    const prospect = await capture()
    await drainMapJobs({ limit: 10 })
    const consumerId = prospect.consumerId

    // Seed the pre-existing-gap fields + a manual observation + job lastError.
    await prospect.update({
      screeningMetadata: { attempts: { tok1: { transcript: 'User: I have two kids aged 5 and 8' } } },
      screeningActiveCallId: 'call_abc123',
    })
    await ConsumerObservation.create({
      consumerId,
      key: 'assets.car_owner',
      value: { v: true },
      confidence: 1,
      source: 'manual',
      sourceEventAt: new Date(),
      pipeline: 'manual',
      pipelineVersion: 'manual/v1',
    })
    await EnrichmentJob.update(
      { lastError: 'validation: invalid fact about the person' },
      { where: { subjectProspectId: prospect.id } }
    )

    const erasure = makeErasureService()
    const out = await erasure.eraseConsumer(consumerId, { reason: 'test' })
    expect(out?.report ?? out).toBeTruthy()

    expect(await ConsumerObservation.count({ where: { sourceProspectId: prospect.id } })).toBe(0)
    expect(await ConsumerObservation.count({ where: { consumerId } })).toBe(0)
    expect(await ConsumerProfile.findByPk(consumerId)).toBeNull()

    const scrubbed = await Prospect.findByPk(prospect.id)
    expect(scrubbed.screeningMetadata).toBeNull()
    expect(scrubbed.screeningActiveCallId).toBeNull()

    const jobs = await EnrichmentJob.findAll({ where: { subjectProspectId: prospect.id } })
    expect(jobs.length).toBeGreaterThan(0)
    for (const j of jobs) {
      expect(j.payload).toBeNull()
      expect(j.lastError).toBeNull()
      expect(['cancelled', 'done', 'stale', 'dead']).toContain(j.status)
    }

    // The bump upsert must NEVER resurrect a profile for an erased person.
    await sequelize.transaction(async (t) => {
      await bumpEnrichmentInputTx(t, consumerId)
    })
    expect(await ConsumerProfile.findByPk(consumerId)).toBeNull()
  })

  it('post-erasure drain cancels the person’s pending map jobs instead of writing', async () => {
    const prospect = await capture()
    const consumerId = prospect.consumerId
    // Hold the job pending, erase, THEN drain.
    await EnrichmentJob.update(
      { status: 'pending', leaseToken: null, leaseExpiresAt: null },
      { where: { subjectProspectId: prospect.id, kind: 'map' } }
    )
    await ConsumerObservation.destroy({ where: { sourceProspectId: prospect.id } })

    const erasure = makeErasureService()
    await erasure.eraseConsumer(consumerId, { reason: 'test' })

    // Erasure already cancelled the pending job; a drain finds nothing to do
    // and writes nothing.
    await drainMapJobs({ limit: 10 })
    expect(await ConsumerObservation.count({ where: { sourceProspectId: prospect.id } })).toBe(0)
    const jobs = await EnrichmentJob.findAll({ where: { subjectProspectId: prospect.id } })
    for (const j of jobs) expect(j.status).not.toBe('leased')
    expect(await ConsumerProfile.findByPk(consumerId)).toBeNull()
  })
})

describe('profile questions PR 0 (studio-profile-questions §5)', () => {
  let pqCampaign
  const V2_PQ = {
    version: 2,
    template: { id: 'express' },
    profileQuestions: { enabled: true, questionIds: ['language', 'pets', 'children'] },
  }

  beforeAll(async () => {
    pqCampaign = await createTestCampaign(admin.id, {
      name: `PQ IT ${Date.now()}`,
      design_config: V2_PQ,
    })
  })

  afterEach(() => {
    delete process.env.ENRICHMENT_MAP_ARTIFACT_JOBS
  })

  it('flag OFF (deploy window): answers persist as evidence; legacy job carries NO profile facts', async () => {
    const prospect = await capture({
      campaignId: pqCampaign.id,
      profileAnswers: { language: 'zh', pets: ['dog', 'cat'] },
    })
    expect(prospect.sourceMetadata.profileAnswers).toEqual({ language: 'zh', pets: ['dog', 'cat'] })

    const jobs = await EnrichmentJob.findAll({ where: { kind: 'map', subjectProspectId: prospect.id } })
    expect(jobs).toHaveLength(1)
    expect(jobs[0].sourceArtifactId).toBeNull() // legacy shape
    const artifacts = (jobs[0].payload.facts || []).map((f) => f.artifact)
    expect(artifacts).not.toContain('profile')

    await drainAndQuiesce(prospect.id)
    // Post-flip remap re-derives profile facts from the durable answers.
    process.env.ENRICHMENT_MAP_ARTIFACT_JOBS = 'true'
    const { getProfileQuestion, resolveAnswer } = await import('../src/utils/profileQuestionLibrary.js')
    const profileFacts = Object.entries(prospect.sourceMetadata.profileAnswers)
      .map(([qid, provided]) => ({ key: getProfileQuestion(qid).factKey, value: resolveAnswer(qid, provided) }))
    const { buildFactSnapshot, enqueueMapJobsTx } = await import('../src/services/factMapperService.js')
    await sequelize.transaction(async (t) => {
      await enqueueMapJobsTx(t, {
        prospectId: prospect.id,
        formRevision: 1,
        snapshot: buildFactSnapshot({ profileFacts }),
      })
    })
    await drainAndQuiesce(prospect.id)
    const obs = await ConsumerObservation.findAll({
      where: { sourceProspectId: prospect.id, sourceArtifactId: `profile:${prospect.id}`, supersededAt: null },
    })
    expect(obs.map((o) => o.key).sort()).toEqual(['household.pets', 'identity.preferred_language'])
    expect(obs.find((o) => o.key === 'household.pets').value).toEqual({ v: ['cat', 'dog'], complete: true })
  })

  it('flag ON: artifact-scoped capture → profile observations; demographics edit leaves them UNTOUCHED (the #281 regression)', async () => {
    process.env.ENRICHMENT_MAP_ARTIFACT_JOBS = 'true'
    const prospect = await capture({
      campaignId: pqCampaign.id,
      profileAnswers: { language: 'en', children: 'two' },
    })
    const jobs = await EnrichmentJob.findAll({ where: { kind: 'map', subjectProspectId: prospect.id } })
    expect(jobs.every((j) => j.sourceArtifactId !== null)).toBe(true)
    expect(jobs.map((j) => j.sourceArtifactId).sort()).toEqual([
      `form:${prospect.id}`, `profile:${prospect.id}`,
    ])

    await drainAndQuiesce(prospect.id)
    const before = await ConsumerObservation.findAll({
      where: { sourceProspectId: prospect.id, sourceArtifactId: `profile:${prospect.id}`, supersededAt: null },
    })
    expect(before.map((o) => o.key).sort()).toEqual(['family.children_count_band', 'identity.preferred_language'])

    // The regression that motivated v1.1: a staff demographics edit must
    // supersede ONLY the form artifact.
    const service = makeProspectService()
    await service.updateProspect(prospect.id, { demographics: { dateOfBirth: '1990-05-05', age: 36 } }, admin)
    await drainAndQuiesce(prospect.id)

    const profileAfter = await ConsumerObservation.findAll({
      where: { sourceProspectId: prospect.id, sourceArtifactId: `profile:${prospect.id}`, supersededAt: null },
    })
    expect(profileAfter).toHaveLength(2) // untouched
    const formActive = await ConsumerObservation.findAll({
      where: { sourceProspectId: prospect.id, sourceArtifactId: `form:${prospect.id}`, supersededAt: null },
    })
    expect(formActive).toHaveLength(1)
    expect(formActive[0].value).toEqual({ v: '1990-1994' })
  })

  it('ineligible campaigns ignore answers entirely (disabled subtree / not v2)', async () => {
    const plain = await createTestCampaign(admin.id, { name: `PQ plain ${Date.now()}` })
    const p1 = await capture({ campaignId: plain.id, profileAnswers: { language: 'zh' } })
    expect(p1.sourceMetadata?.profileAnswers).toBeUndefined()

    const disabled = await createTestCampaign(admin.id, {
      name: `PQ disabled ${Date.now()}`,
      design_config: { version: 2, template: { id: 'express' }, profileQuestions: { enabled: false, questionIds: ['language'] } },
    })
    const p2 = await capture({ campaignId: disabled.id, profileAnswers: { language: 'zh' } })
    expect(p2.sourceMetadata?.profileAnswers).toBeUndefined()
  })

  it('invalid answers dropped per-question; valid siblings survive; none-exclusivity enforced', async () => {
    const prospect = await capture({
      campaignId: pqCampaign.id,
      profileAnswers: { language: 'zh', pets: ['none', 'dog'], children: 'seventeen' },
    })
    expect(prospect.sourceMetadata.profileAnswers).toEqual({ language: 'zh' })
  })

  it('legacy combined job (form+quiz) splits per artifact — never single-artifact-activated', async () => {
    const prospect = await capture()
    await drainAndQuiesce(prospect.id)
    // Hand-insert a legacy combined job (as an old writer would have):
    // form + quiz facts in one payload. Revision 2 — capture's own rev-1
    // legacy job is done and owns the rev-1 slot in the legacy unique.
    await Prospect.update({ enrichmentRevision: 2 }, { where: { id: prospect.id } })
    const { MAPPER_PIPELINE_VERSION: PV } = await import('../src/services/factMapperService.js')
    const { randomUUID } = await import('crypto')
    await sequelize.query(
      `INSERT INTO enrichment_jobs
         (id, kind, "subjectProspectId", "sourceRevisionId", "sourceContentHash",
          payload, "taxonomyVersion", "pipelineVersion", status, attempts, "createdAt", "updatedAt")
       VALUES (:id, 'map', :pid, 2, 'legacyhash', :payload::jsonb, 'v2', :pv, 'pending', 0, now(), now())`,
      {
        replacements: {
          id: randomUUID(),
          pid: prospect.id,
          payload: JSON.stringify({
            facts: [
              { key: 'identity.birth_year_band', value: { v: '1985-1989' }, artifact: 'form' },
              { key: 'assets.car_owner', value: { v: true }, artifact: 'quiz' },
            ],
          }),
          pv: PV,
        },
      }
    )
    await drainAndQuiesce(prospect.id)
    const quizObs = await ConsumerObservation.findAll({
      where: { sourceProspectId: prospect.id, sourceArtifactId: `quiz:${prospect.id}`, supersededAt: null },
    })
    expect(quizObs).toHaveLength(1)
    expect(quizObs[0].key).toBe('assets.car_owner')
    expect(quizObs[0].source).toBe('quiz')
  })
})

describe('relink bumps (§6.3)', () => {
  it('recomputeConsumersByPhone dirties both sides when a prospect moves', async () => {
    const prospect = await capture()
    await drainMapJobs({ limit: 10 })
    const oldConsumerId = prospect.consumerId

    // Point the row at a synthetic wrong owner, then let recompute heal it.
    const stray = await Consumer.create({
      phone: `+${phoneFor(phoneSeq + 500000)}`,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      signupCount: 0,
      verifiedSignupCount: 0,
    })
    await Prospect.update({ consumerId: stray.id }, { where: { id: prospect.id } })

    const { recomputeConsumersByPhone } = await import('../src/services/consumerService.js')
    await recomputeConsumersByPhone([prospect.phone])

    const healed = await Prospect.findByPk(prospect.id)
    expect(healed.consumerId).toBe(oldConsumerId)

    // Both the regained owner and the stray loser went dirty.
    const winner = await ConsumerProfile.findByPk(oldConsumerId)
    expect(winner).toBeTruthy()
    expect(Number(winner.inputVersion)).toBeGreaterThan(Number(winner.syncedInputVersion))
    const loser = await ConsumerProfile.findByPk(stray.id)
    expect(loser).toBeTruthy()
  })
})

describe('the band reaches the Buy score (score/v3 — PR B seam)', () => {
  it('a DOB-only capture scores Buy from age alone, under the migrated config, citing the band', async () => {
    const prospect = await capture()
    await drainAndQuiesce(prospect.id)

    const { scoreOneConsumer, _resetConfigCache } = await import('../src/services/consumerScoringService.js')
    _resetConfigCache()
    const result = await scoreOneConsumer(prospect.consumerId, { force: true })
    expect(result.status).toBe('scored')
    // Pre-v3 this person was buyScore NULL — no fact component assessable.
    expect(result.buyScore).not.toBeNull()

    const profile = await ConsumerProfile.findByPk(prospect.consumerId)
    // v3 semantics hold whether the config came from the 095 row (fresh-DB
    // boot) or the code defaults (reused DB — migrations skip, table empty);
    // the 095 row's own content is pinned by migration095ScoringAgeConfig.
    expect(profile.scoringAlgorithmVersion).toBe('score/v3')

    // THE BREAKDOWN NOW LIVES ON THE LEAD (per-campaign-lead-scoring.md §4).
    // scoreOneConsumer still resolves the facts and stamps what scored them —
    // that is what the assertion above checks — but the numbers and the
    // breakdown they must agree with are written by the lead scorer and
    // PROJECTED up, so that is where this contract is now pinned.
    const { scoreOneLead } = await import('../src/services/leadScoringService.js')
    const leadResult = await scoreOneLead(prospect.id, { force: true })
    expect(leadResult.status).toBe('scored')
    expect(leadResult.buyScore).not.toBeNull()

    const lead = await Prospect.findByPk(prospect.id)
    expect(lead.scoringAlgorithmVersion).toBe('lead/v1')
    expect(lead.scoreBreakdown.groups.buy.components).toContain('age')

    const comps = lead.scoreBreakdown.components
    expect(comps.age.state).toBe('assessed')
    const band = await ConsumerObservation.findOne({
      where: { sourceProspectId: prospect.id, key: 'identity.birth_year_band', supersededAt: null },
    })
    expect(comps.age.basisObservationIds).toContain(band.id)

    // Almost-everyone-scoreable must still read THIN: age is the only
    // assessed Buy fact, and completeness says so. Ten components now, not
    // eight — the lead grain adds `response` and `screening`, both unknown
    // for a lead nobody has messaged or called.
    expect(comps.capacity.state).toBe('unknown')
    expect(comps.family_gap.state).toBe('unknown')
    expect(comps.response.state).toBe('unknown')
    expect(comps.screening.state).toBe('unknown')
    expect(lead.scoreBreakdown.completeness.total).toBe(10)
    expect(lead.scoreBreakdown.completeness.assessed).toBeLessThan(4)

    // §4's projection: the person's numbers ARE the winning lead's numbers.
    await profile.reload()
    expect(profile.buyScore).toBe(leadResult.buyScore)
    expect(profile.meetScore).toBe(leadResult.meetScore)
    expect(profile.consumerScore).toBe(leadResult.score)
  })
})
