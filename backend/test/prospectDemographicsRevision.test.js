/**
 * H3 (review round 3): concurrent demographic edits must mint DISTINCT
 * enrichment revisions, each snapshotting the PERSISTED row.
 *
 * Pre-fix, updateProspect wrote demographics non-transactionally, then a
 * separate transaction computed `rev = instance.enrichmentRevision + 1` from
 * the possibly-stale loaded instance and built the snapshot from in-memory
 * state. Two concurrent staff edits both computed revision 2; the map-job
 * unique index + ON CONFLICT DO NOTHING kept only ONE payload — and when the
 * surviving payload was the LOSER's, the mapper published stale facts with no
 * higher revision left for the sweep to recover.
 *
 * Post-fix the field write, a column-relative bump (UPDATE … RETURNING), the
 * snapshot (from the returned row), and the outbox insert share one
 * transaction — concurrent edits serialize on the row lock, so these
 * invariants hold on EVERY interleave:
 *   1. two edits → final enrichmentRevision = 3 (1 + one per edit)
 *   2. two form map jobs, at revisions 2 and 3 (none collapsed)
 *   3. the HIGHEST-revision job's payload matches the FINAL row demographics
 */
import request from 'supertest'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js'
import { Prospect, EnrichmentJob } from '../src/models/index.js'
import { buildFactSnapshot } from '../src/services/factMapperService.js'

let app, adminToken, campaign

beforeAll(async () => {
  app = await getApp()
  const admin = await createTestUser({ role: 'admin' })
  adminToken = admin.token
  campaign = await createTestCampaign(admin.user.id, { name: 'Demographics Revision Race' })
})

afterAll(async () => {
  await closeDb()
})

// Different 5-year birth bands → the two snapshots carry DIFFERENT facts.
const DEMO_A = { dateOfBirth: '1990-06-15' } // identity.birth_year_band 1990-1994
const DEMO_B = { dateOfBirth: '1985-03-02' } // identity.birth_year_band 1985-1989

const putDemographics = (id, demographics) => request(app)
  .put(`/api/prospects/${id}`)
  .set('Authorization', `Bearer ${adminToken}`)
  .send({ demographics })

async function formJobsFor(prospectId) {
  const jobs = await EnrichmentJob.findAll({
    where: { kind: 'map', subjectProspectId: prospectId },
    order: [['sourceRevisionId', 'ASC']],
    raw: true,
  })
  // Form-revision jobs only (quiz/profile artifacts are pinned to revision 1
  // and none exist here anyway — the edits only touch demographics).
  return jobs.filter((j) => !j.sourceArtifactId || String(j.sourceArtifactId).startsWith('form:'))
}

function factsOf(payload) {
  const p = typeof payload === 'string' ? JSON.parse(payload) : payload
  return (p?.facts || []).map((f) => ({ key: f.key, value: f.value }))
}

describe('H3 — concurrent demographic edits keep revision/fact integrity', () => {
  // The race window is load→write; several rounds make the pre-fix collapse
  // overwhelmingly likely while the post-fix invariants are deterministic.
  const ROUNDS = 6

  for (let i = 0; i < ROUNDS; i++) {
    it(`round ${i + 1}: two concurrent edits mint revisions 2 and 3, last one matching the row`, async () => {
      const prospect = await createTestProspect(campaign.id)
      expect(prospect.enrichmentRevision).toBe(1)

      const [r1, r2] = await Promise.all([
        putDemographics(prospect.id, DEMO_A),
        putDemographics(prospect.id, DEMO_B),
      ])
      expect(r1.status).toBe(200)
      expect(r2.status).toBe(200)

      const row = await Prospect.findByPk(prospect.id, { raw: true })
      // 1: every edit minted its own revision — none reused a stale number.
      expect(row.enrichmentRevision).toBe(3)

      const jobs = await formJobsFor(prospect.id)
      const revisions = jobs.map((j) => Number(j.sourceRevisionId)).sort((a, b) => a - b)
      // 2: both payloads survived as distinct revisions (no ON CONFLICT collapse).
      expect(revisions).toEqual([2, 3])

      // 3: the winning (highest) revision snapshots the FINAL persisted row —
      // the published facts can never diverge from the prospect.
      const winner = jobs.find((j) => Number(j.sourceRevisionId) === 3)
      const expected = buildFactSnapshot({ demographics: row.demographics || {} }).sections.form.facts
      expect(factsOf(winner.payload)).toEqual(expected)
    })
  }

  it('a single edit still bumps once and snapshots the new value', async () => {
    const prospect = await createTestProspect(campaign.id)
    const res = await putDemographics(prospect.id, DEMO_A)
    expect(res.status).toBe(200)

    const row = await Prospect.findByPk(prospect.id, { raw: true })
    expect(row.enrichmentRevision).toBe(2)
    expect(row.demographics).toMatchObject(DEMO_A)

    const jobs = await formJobsFor(prospect.id)
    expect(jobs.map((j) => Number(j.sourceRevisionId))).toEqual([2])
    const expected = buildFactSnapshot({ demographics: row.demographics }).sections.form.facts
    expect(factsOf(jobs[0].payload)).toEqual(expected)
  })
})
