/**
 * Redeem Ops Discover tool — DB-backed service tests with the Apify client mocked
 * (no network). Covers: run start + quota, terminal-state processing (completed +
 * failed), idempotent materialization, batched dedupe classification, convert →
 * partners (skips existing), Instagram enrichment (fill-blanks), webhook secret.
 */
process.env.REDEEM_OPS_ENABLED = 'true';
process.env.DISCOVERY_ENABLED = 'true';
process.env.DISCOVERY_WEBHOOK_SECRET = 'test-secret';

import { jest } from '@jest/globals';
import { getApp, closeDb, createTestUser, seedRedeemOpsCategory } from './helpers.js';
import { makeDiscoveryService } from '../src/services/redeemOps/discoveryService.js';
import { makePartnerService } from '../src/services/redeemOps/partnerService.js';
import { DiscoveryRun, DiscoveryCandidate, PartnerOrganisation } from '../src/models/index.js';

let admin;
const partners = makePartnerService();

function makeApifyStub() {
  return { startRun: jest.fn(), getRun: jest.fn(), getDatasetItems: jest.fn() };
}

const mapsItems = [
  { placeId: 'p1', title: 'Nail Bliss Studio', phoneUnformatted: '+6591230001', website: 'https://nailbliss.sg', instagrams: ['https://instagram.com/nailbliss'], city: 'Tampines', totalScore: 4.8, reviewsCount: 120, url: 'https://maps.google.com/?cid=1' },
  { placeId: 'p2', title: 'Glossy Nails', phoneUnformatted: '+6591230002', city: 'Tampines', totalScore: 4.2, reviewsCount: 30, url: 'https://maps.google.com/?cid=2' },
];

beforeAll(async () => {
  await getApp(); // boots + syncs the test DB
  admin = await createTestUser({ role: 'admin' });
  await seedRedeemOpsCategory('Nail Salon');
});

afterAll(async () => { await closeDb(); });

async function startedRun(svc, apify) {
  apify.startRun.mockResolvedValue({ runId: `run_${Date.now()}_${Math.random()}`, datasetId: 'ds1', status: 'RUNNING' });
  return svc.startDiscovery({ category: 'Nail Salon', area: 'Tampines', limit: 60 }, admin.user);
}

describe('start + quota', () => {
  test('startDiscovery creates a running run and calls Apify', async () => {
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const run = await startedRun(svc, apify);
    expect(apify.startRun).toHaveBeenCalledTimes(1);
    expect(run.status).toBe('running');
    expect(run.providerRunId).toBeTruthy();
    expect(Number(run.estimatedCostUsd)).toBeGreaterThan(0);
  });

  test('per-user daily quota → 429', async () => {
    process.env.DISCOVERY_MAX_RUNS_PER_USER_DAY = '2';
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const solo = await createTestUser({ role: 'admin' });
    apify.startRun.mockResolvedValue({ runId: `r_${Math.random()}`, datasetId: 'ds', status: 'RUNNING' });
    await svc.startDiscovery({ category: 'Nail Salon', area: 'A', limit: 30 }, solo.user);
    await svc.startDiscovery({ category: 'Nail Salon', area: 'B', limit: 30 }, solo.user);
    await expect(svc.startDiscovery({ category: 'Nail Salon', area: 'C', limit: 30 }, solo.user))
      .rejects.toMatchObject({ statusCode: 429 });
    delete process.env.DISCOVERY_MAX_RUNS_PER_USER_DAY;
  });
});

describe('terminal-state processing', () => {
  test('completed run materializes + classifies candidates (idempotent)', async () => {
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const run = await startedRun(svc, apify);

    apify.getRun.mockResolvedValue({ runId: run.providerRunId, status: 'SUCCEEDED', datasetId: 'ds1', usageTotalUsd: 0.4, terminalStatus: 'completed' });
    apify.getDatasetItems.mockResolvedValue(mapsItems);

    await svc.processRun(run.id);
    await svc.processRun(run.id); // second call must be a no-op (idempotent)

    await run.reload();
    expect(run.status).toBe('completed');
    expect(Number(run.actualCostUsd)).toBe(0.4);
    const cands = await DiscoveryCandidate.findAll({ where: { discoveryRunId: run.id } });
    expect(cands).toHaveLength(2); // not 4 — dedup on (run, placeId)
    const bliss = cands.find((c) => c.name === 'Nail Bliss Studio');
    expect(bliss.instagramHandle).toBe('nailbliss');
    expect(bliss.primaryPhone).toBe('+6591230001');
  });

  test('failed Apify run marks the run failed', async () => {
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const run = await startedRun(svc, apify);
    apify.getRun.mockResolvedValue({ runId: run.providerRunId, status: 'FAILED', datasetId: null, usageTotalUsd: 0, terminalStatus: 'failed' });
    await svc.processRun(run.id);
    await run.reload();
    expect(run.status).toBe('failed');
    expect(apify.getDatasetItems).not.toHaveBeenCalled();
  });
});

describe('dedupe classification', () => {
  test('a candidate matching a live partner by phone → existing_partner', async () => {
    const svc = makeDiscoveryService({ apify: makeApifyStub() });
    const { partner } = await partners.createPartner(
      { tradingName: 'Already Ours Nails', primaryPhone: '+6598887777', category: 'Nail Salon' },
      admin.user,
    );
    const run = await DiscoveryRun.create({ createdBy: admin.user.id, provider: 'apify_google_maps', status: 'completed', requestedLimit: 10 });
    const hit = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'Dup By Phone', primaryPhone: '+6598887777' });
    const miss = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'Totally New Salon', primaryPhone: '+6590001234' });

    await svc.classifyAgainstPartners([hit, miss]);
    await hit.reload(); await miss.reload();
    expect(hit.dedupeStatus).toBe('existing_partner');
    expect(hit.matchedPartnerId).toBe(partner.id);
    expect(miss.dedupeStatus).toBe('new');
  });
});

describe('convert → partners', () => {
  test('adds new candidates, skips existing_partner', async () => {
    const svc = makeDiscoveryService({ apify: makeApifyStub() });
    const run = await DiscoveryRun.create({ createdBy: admin.user.id, provider: 'apify_google_maps', status: 'completed', category: 'Nail Salon', requestedLimit: 10 });
    const fresh = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'Fresh Prospect Nails', primaryPhone: '+6591112222', instagramHandle: 'freshnails', dedupeStatus: 'new', status: 'pending' });
    const existing = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'Existing One', dedupeStatus: 'existing_partner', status: 'pending' });

    const res = await svc.addToPartners([fresh.id, existing.id], admin.user);
    expect(res.added).toBe(1);
    expect(res.skipped).toBe(1);
    await fresh.reload();
    expect(fresh.status).toBe('added');
    expect(fresh.addedPartnerId).toBeTruthy();
    const created = await PartnerOrganisation.findByPk(fresh.addedPartnerId);
    expect(created.source).toBe('discovery');
    expect(created.category).toBe('Nail Salon');
  });
});

describe('instagram enrichment', () => {
  test('applyEnrichment fills followers/bio/email on the target candidates (fill-blanks)', async () => {
    const svc = makeDiscoveryService({ apify: makeApifyStub() });
    const run = await DiscoveryRun.create({ createdBy: admin.user.id, provider: 'apify_google_maps', status: 'completed', requestedLimit: 10 });
    const cand = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'Enrich Me Nails', instagramHandle: 'enrichme', enrichmentStatus: 'pending' });
    const enrichRun = await DiscoveryRun.create({ createdBy: admin.user.id, provider: 'apify_instagram', status: 'running', requestedLimit: 1, rawPayload: { targetCandidateIds: [cand.id] } });

    await svc.applyEnrichment(enrichRun, [
      { username: 'enrichme', followersCount: 5400, biography: 'Best nails in town — hello@enrichme.sg', verified: true },
    ]);
    await cand.reload();
    expect(cand.enrichmentStatus).toBe('enriched');
    expect(cand.followersCount).toBe(5400);
    expect(cand.email).toBe('hello@enrichme.sg');
    expect(cand.bio).toContain('Best nails');
  });
});

describe('webhook secret', () => {
  test('verifyWebhookSecret is constant-time exact match', () => {
    const svc = makeDiscoveryService({ apify: makeApifyStub() });
    expect(svc.verifyWebhookSecret('test-secret')).toBe(true);
    expect(svc.verifyWebhookSecret('wrong')).toBe(false);
    expect(svc.verifyWebhookSecret('')).toBe(false);
  });
});
