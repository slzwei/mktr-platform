/**
 * P2-6 regression: an expired map-job lease returns to the queue.
 *
 * drainMapJobs claims with a 5-minute internal lease but only ever selects
 * status='pending', and nothing reset an expired 'leased' row. A worker that
 * died between the claim and finish() stranded its job PERMANENTLY — that
 * person's facts never activate and their score is computed forever on
 * incomplete evidence, silently, because a stuck row is indistinguishable from
 * one in flight. The partial index idx_ejobs_lease_expiry (WHERE
 * status='leased') was built for a reaper that was never written.
 */
import { randomUUID } from 'crypto'
import { EnrichmentJob, sequelize } from '../src/models/index.js'
import { reapExpiredLeases, drainMapJobs } from '../src/services/factMapperService.js'
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js'

let campaign, prospect
const made = []

/** A map job parked in 'leased' with a lease that expired `agoMs` ago. */
let revisionSeq = 0
async function leasedJob({ expiresInMs }) {
  const job = await EnrichmentJob.create({
    kind: 'map',
    status: 'leased',
    subjectProspectId: prospect.id,
    // chk_ejobs_kind + uq_ejobs_map (migration 091, enforced in prod): a map
    // job MUST carry its revision + content hash, and only ONE live job may
    // exist per (prospect, revision) — the old sync-then-migrate boot dropped
    // both after the first suite, so the fixtures got away without either.
    sourceRevisionId: (revisionSeq += 1),
    sourceContentHash: `hash-${randomUUID()}`,
    pipelineVersion: 'test-reaper-v1',
    leaseToken: randomUUID(), // the dead worker's token
    leaseExpiresAt: new Date(Date.now() + expiresInMs),
    workerId: 'in-process',
  })
  made.push(job.id)
  return job
}

const statusOf = async (id) => (await EnrichmentJob.findByPk(id))?.status

beforeAll(async () => {
  await getApp()
  const admin = await createTestUser({ role: 'admin' })
  campaign = await createTestCampaign(admin.user.id, { name: 'Lease Reaper Campaign' })
  prospect = await createTestProspect(campaign.id, {})
})

afterAll(async () => {
  if (made.length) await EnrichmentJob.destroy({ where: { id: made } })
  await closeDb()
})

describe('reapExpiredLeases', () => {
  it('returns a job whose lease expired to pending', async () => {
    const job = await leasedJob({ expiresInMs: -60_000 }) // expired a minute ago

    const reaped = await reapExpiredLeases()

    expect(reaped).toBeGreaterThanOrEqual(1)
    expect(await statusOf(job.id)).toBe('pending')
  })

  it('clears the dead worker’s lease fields so the next claim owns it cleanly', async () => {
    const job = await leasedJob({ expiresInMs: -60_000 })

    await reapExpiredLeases()

    const row = await EnrichmentJob.findByPk(job.id)
    expect(row.leaseToken).toBeNull()
    expect(row.leaseExpiresAt).toBeNull()
    expect(row.workerId).toBeNull()
  })

  it('leaves a LIVE lease alone — a job in flight is not stolen', async () => {
    const job = await leasedJob({ expiresInMs: 5 * 60_000 })

    await reapExpiredLeases()

    expect(await statusOf(job.id)).toBe('leased')
  })

  it('is a no-op when nothing has expired', async () => {
    await sequelize.query(
      `UPDATE enrichment_jobs SET "leaseExpiresAt" = now() + interval '10 minutes'
        WHERE status = 'leased' AND "leaseExpiresAt" < now()`
    )
    await expect(reapExpiredLeases()).resolves.toBe(0)
  })
})

describe('drainMapJobs reclaims before it claims', () => {
  it('picks up a job orphaned by a dead worker instead of draining around it forever', async () => {
    const job = await leasedJob({ expiresInMs: -60_000 })

    // The drain's own claim only ever sees status='pending', so without the
    // reap this orphan is invisible to it — permanently.
    await drainMapJobs({ limit: 20 })

    expect(await statusOf(job.id)).not.toBe('leased')
  })

  it('can be told not to reap, leaving the orphan untouched', async () => {
    const job = await leasedJob({ expiresInMs: -60_000 })

    await drainMapJobs({ limit: 20, reap: false })

    expect(await statusOf(job.id)).toBe('leased')
  })
})
