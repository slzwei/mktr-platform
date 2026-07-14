/**
 * Phase 3 atomic Singapore-day Discover usage counters.
 * DB-backed: per-user atomic caps, concurrent reservations, search settlement,
 * pre-provider and stranded refunds, profile refunds, and flag-off compatibility.
 */
process.env.REDEEM_OPS_ENABLED = 'true';
process.env.DISCOVERY_ENABLED = 'true';

import { jest } from '@jest/globals';
import { getApp, closeDb, createTestUser, seedRedeemOpsCategory } from './helpers.js';
import {
  DiscoveryCandidate, DiscoveryRun, sequelize,
} from '../src/models/index.js';
import { makeDiscoveryService } from '../src/services/redeemOps/discoveryService.js';
import { makeDiscoveryUsageService } from '../src/services/redeemOps/discoveryUsageService.js';
import { sgDateKey } from '../src/services/redeemOps/taskService.js';

let runSeq = 0;

const DISCOVERY_ENV_SNAPSHOT = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.startsWith('DISCOVERY_')),
);

function apifyStub() {
  return {
    startRun: jest.fn(async () => ({
      runId: `usage_run_${Date.now()}_${++runSeq}`,
      datasetId: `usage_ds_${runSeq}`,
      status: 'RUNNING',
    })),
    getRun: jest.fn(),
    getDatasetItems: jest.fn(),
  };
}

beforeAll(async () => {
  await getApp();
  await seedRedeemOpsCategory('Nail Salon');
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('DISCOVERY_')) delete process.env[key];
  }
  Object.assign(process.env, DISCOVERY_ENV_SNAPSHOT);
});

afterAll(async () => {
  await closeDb();
});

describe('atomic reservations', () => {
  test('sgDateKey flips at the same Singapore midnight boundary as the quota window', () => {
    expect(sgDateKey(new Date('2026-07-13T15:59:59.999Z'))).toBe('2026-07-13');
    expect(sgDateKey(new Date('2026-07-13T16:00:00.000Z'))).toBe('2026-07-14');
  });

  test('a reservation that crosses the per-user cap returns 429', async () => {
    const { user } = await createTestUser({ role: 'admin' });
    const usage = makeDiscoveryUsageService();
    const base = {
      userId: user.id, sgDate: sgDateKey(), userCap: 5, teamCap: 10000,
    };
    await expect(usage.reserveResults({ ...base, amount: 4 })).resolves.toBe(4);
    await expect(usage.reserveResults({ ...base, amount: 2 }))
      .rejects.toMatchObject({ statusCode: 429 });
    await expect(usage.getUsage(user.id, base.sgDate)).resolves.toMatchObject({ resultsUsed: 4 });
  });

  test("two concurrent reserves cannot take one user's counter over the cap", async () => {
    const { user } = await createTestUser({ role: 'admin' });
    const usage = makeDiscoveryUsageService();
    const args = {
      userId: user.id, sgDate: sgDateKey(), amount: 7, userCap: 10, teamCap: 10000,
    };
    const settled = await Promise.allSettled([
      usage.reserveResults(args),
      usage.reserveResults(args),
    ]);
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const current = await usage.getUsage(user.id, args.sgDate);
    expect(current.resultsUsed).toBe(7);
    expect(current.resultsUsed).toBeLessThanOrEqual(args.userCap);
  });
});

describe('search reservation lifecycle', () => {
  test('completed search refunds requestedLimit minus actual resultCount', async () => {
    process.env.DISCOVERY_RESULT_QUOTA_ENABLED = 'true';
    process.env.DISCOVERY_RESULTS_PER_USER_DAY = '100';
    process.env.DISCOVERY_RESULTS_PER_TEAM_DAY = '10000';
    const { user } = await createTestUser({ role: 'admin' });
    const apify = apifyStub();
    const discovery = makeDiscoveryService({ apify });
    const run = await discovery.startDiscovery(
      { category: 'Nail Salon', area: 'Bedok', limit: 10 }, user,
    );
    const usage = makeDiscoveryUsageService();
    expect((await usage.getUsage(user.id, sgDateKey())).resultsUsed).toBe(10);

    apify.getRun.mockResolvedValue({
      runId: run.providerRunId, status: 'SUCCEEDED', datasetId: 'usage_settle_ds',
      usageTotalUsd: 0.021, terminalStatus: 'completed',
    });
    apify.getDatasetItems.mockResolvedValue([
      { placeId: `usage_place_${runSeq}_1`, title: 'Usage Nails One', countryCode: 'SG' },
      { placeId: `usage_place_${runSeq}_2`, title: 'Usage Nails Two', countryCode: 'SG' },
      { placeId: `usage_place_${runSeq}_3`, title: 'Usage Nails Three', countryCode: 'SG' },
    ]);
    await discovery.processRun(run.id);

    expect((await usage.getUsage(user.id, sgDateKey())).resultsUsed).toBe(3);
    const quota = await discovery.getQuota(user);
    expect(quota).toMatchObject({
      mode: 'results', resultsUsed: 3, resultsRemaining: 97,
      profilesRemaining: 200,
    });
    expect(quota.estimatedSpendUsd).toBe(0.021);
  });

  test('pre-Apify start failure refunds the full search reservation', async () => {
    process.env.DISCOVERY_RESULT_QUOTA_ENABLED = 'true';
    process.env.DISCOVERY_RESULTS_PER_USER_DAY = '100';
    process.env.DISCOVERY_RESULTS_PER_TEAM_DAY = '10000';
    const { user } = await createTestUser({ role: 'admin' });
    const apify = apifyStub();
    apify.startRun.mockRejectedValue(new Error('provider unavailable'));
    const discovery = makeDiscoveryService({ apify });

    await expect(discovery.startDiscovery(
      { category: 'Nail Salon', area: 'Bedok', limit: 25 }, user,
    )).rejects.toMatchObject({ statusCode: 502 });
    expect((await makeDiscoveryUsageService().getUsage(user.id, sgDateKey())).resultsUsed).toBe(0);
  });

  test('stranded-run sweep refunds the stored reservation exactly once', async () => {
    process.env.DISCOVERY_RESULT_QUOTA_ENABLED = 'true';
    process.env.DISCOVERY_RECONCILE_STUCK_MINUTES = '1';
    const { user } = await createTestUser({ role: 'admin' });
    const usage = makeDiscoveryUsageService();
    const sgDate = sgDateKey();
    await usage.reserveResults({
      userId: user.id, sgDate, amount: 20, userCap: 100, teamCap: 10000,
    });
    const run = await DiscoveryRun.create({
      createdBy: user.id, provider: 'apify_google_maps', status: 'pending', requestedLimit: 20,
      rawPayload: { dailyUsageReservation: { kind: 'results', sgDate, amount: 20 } },
    });
    await sequelize.query(
      `UPDATE discovery_runs SET "createdAt" = NOW() - INTERVAL '10 minutes' WHERE id = :id`,
      { replacements: { id: run.id } },
    );

    const discovery = makeDiscoveryService({ apify: apifyStub() });
    await discovery.reconcileStuckRuns();
    await discovery.reconcileStuckRuns();
    expect((await usage.getUsage(user.id, sgDate)).resultsUsed).toBe(0);
    await run.reload();
    expect(run.status).toBe('failed');
  });

  test('flag OFF preserves the existing run-count quota and writes no usage row', async () => {
    delete process.env.DISCOVERY_RESULT_QUOTA_ENABLED;
    process.env.DISCOVERY_MAX_RUNS_PER_USER_DAY = '1';
    process.env.DISCOVERY_MAX_RUNS_PER_DAY = '1000';
    const { user } = await createTestUser({ role: 'admin' });
    const discovery = makeDiscoveryService({ apify: apifyStub() });

    await discovery.startDiscovery({ category: 'Nail Salon', area: 'Bedok', limit: 5 }, user);
    await expect(discovery.startDiscovery(
      { category: 'Nail Salon', area: 'Tampines', limit: 5 }, user,
    )).rejects.toMatchObject({ statusCode: 429 });
    expect(await makeDiscoveryUsageService().getUsage(user.id, sgDateKey())).toEqual({
      resultsUsed: 0, profilesUsed: 0,
    });
    await expect(discovery.getQuota(user)).resolves.toMatchObject({
      used: 1, limit: 1, remaining: 0,
    });
  });
});

describe('profile reservation lifecycle', () => {
  test('Apify start failure refunds profiles after the atomic candidate claim', async () => {
    process.env.DISCOVERY_RESULT_QUOTA_ENABLED = 'true';
    process.env.DISCOVERY_PROFILES_PER_USER_DAY = '10';
    process.env.DISCOVERY_PROFILES_PER_TEAM_DAY = '10000';
    const { user } = await createTestUser({ role: 'admin' });
    const mapsRun = await DiscoveryRun.create({
      createdBy: user.id, provider: 'apify_google_maps', status: 'completed', requestedLimit: 2,
    });
    const candidates = await Promise.all(['usageigone', 'usageigtwo'].map((instagramHandle) => (
      DiscoveryCandidate.create({
        discoveryRunId: mapsRun.id, name: instagramHandle,
        instagramHandle, status: 'pending', enrichmentStatus: 'none',
      })
    )));
    const apify = apifyStub();
    apify.startRun.mockRejectedValue(new Error('profile actor unavailable'));
    const discovery = makeDiscoveryService({ apify });

    await expect(discovery.enrichCandidates(candidates.map((candidate) => candidate.id), user))
      .rejects.toMatchObject({ statusCode: 502 });
    const current = await makeDiscoveryUsageService().getUsage(user.id, sgDateKey());
    expect(current.profilesUsed).toBe(0);
    await Promise.all(candidates.map((candidate) => candidate.reload()));
    expect(candidates.every((candidate) => candidate.enrichmentStatus === 'failed')).toBe(true);
  });
});
