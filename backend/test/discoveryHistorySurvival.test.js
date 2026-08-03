/**
 * M11 (review round 3): paid discovery history survives operator deletion.
 *
 * Pre-fix, discovery_runs.createdBy was NOT NULL + ON DELETE CASCADE and
 * candidates cascade from each run: permanentlyDeleteUser on a former
 * operator (no campaign/commission/wallet blockers) silently erased provider
 * run ids, actual costs, raw results, and candidate provenance — the rows
 * quota history and cost audits are built from.
 *
 * Post-fix (migration 110): createdBy is nullable with SET NULL, and
 * createdByEmail keeps the immutable creator-identity snapshot on the row.
 */
import { getApp, closeDb, createTestUser } from './helpers.js'
import { DiscoveryRun, DiscoveryCandidate, User } from '../src/models/index.js'
import { permanentlyDeleteUser } from '../src/services/userService.js'

let admin

beforeAll(async () => {
  await getApp()
  admin = (await createTestUser({ role: 'admin' })).user
})

afterAll(async () => {
  await closeDb()
})

test('deleting a former operator preserves runs, candidates, and the identity snapshot', async () => {
  const { user: operator } = await createTestUser({ role: 'redeem_ops', redeemOpsRole: 'outreach_exec' })

  const run = await DiscoveryRun.create({
    createdBy: operator.id,
    createdByEmail: operator.email,
    provider: 'apify_google_maps',
    category: 'nail_salon',
    area: 'Tampines',
    requestedLimit: 60,
    status: 'completed',
    providerRunId: `apify-${Date.now()}`,
    actualCostUsd: 1.234,
    resultCount: 1,
  })
  const candidate = await DiscoveryCandidate.create({
    discoveryRunId: run.id,
    name: 'Polished Nails Tampines',
    externalPlaceId: `place-${Date.now()}`,
  })

  await permanentlyDeleteUser(operator.id, admin.id)
  expect(await User.findByPk(operator.id)).toBeNull()

  // Pre-fix: the CASCADE took the run — and its candidates — with the user.
  const survivingRun = await DiscoveryRun.findByPk(run.id, { raw: true })
  expect(survivingRun).not.toBeNull()
  expect(survivingRun.createdBy).toBeNull()
  expect(survivingRun.createdByEmail).toBe(operator.email)
  expect(survivingRun.providerRunId).toBe(run.providerRunId)
  expect(Number(survivingRun.actualCostUsd)).toBeCloseTo(1.234)

  const survivingCandidate = await DiscoveryCandidate.findByPk(candidate.id, { raw: true })
  expect(survivingCandidate).not.toBeNull()
  expect(survivingCandidate.discoveryRunId).toBe(run.id)
})
