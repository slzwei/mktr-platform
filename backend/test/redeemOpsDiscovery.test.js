/**
 * Redeem Ops Discover tool — DB-backed service tests with the Apify client mocked
 * (no network). Covers: run start + quota (incl. fairness for never-started runs),
 * category fail-fast + canonical casing, terminal-state processing (completed /
 * failed / aborted, IG-failure candidate reset), idempotent materialization,
 * batched dedupe classification (exact + pg_trgm fuzzy), reconciliation (stuck +
 * stranded), convert → partners (run-scoped, notFound, 409 keeps the link),
 * Instagram enrichment (eligibility, profile quotas, fill-blanks), retention
 * purge, PATCH dismiss/restore back-compat over HTTP, webhook secret.
 */
process.env.REDEEM_OPS_ENABLED = 'true';
process.env.DISCOVERY_ENABLED = 'true';
process.env.DISCOVERY_WEBHOOK_SECRET = 'test-secret';

import { jest } from '@jest/globals';
import request from 'supertest';
import { getApp, closeDb, createTestUser, seedRedeemOpsCategory } from './helpers.js';
import { makeDiscoveryService } from '../src/services/redeemOps/discoveryService.js';
import { makePartnerService } from '../src/services/redeemOps/partnerService.js';
import { makeDedupeService } from '../src/services/redeemOps/dedupeService.js';
import { DiscoveryRun, DiscoveryCandidate, PartnerOrganisation, sequelize } from '../src/models/index.js';

let app;
let admin;
const partners = makePartnerService();
const auth = (t) => ({ Authorization: `Bearer ${t}` });

function makeApifyStub() {
  return { startRun: jest.fn(), getRun: jest.fn(), getDatasetItems: jest.fn() };
}

const mapsItems = [
  { placeId: 'p1', title: 'Nail Bliss Studio', phoneUnformatted: '+6591230001', website: 'https://nailbliss.sg', instagrams: ['https://instagram.com/nailbliss'], city: 'Tampines', totalScore: 4.8, reviewsCount: 120, url: 'https://maps.google.com/?cid=1' },
  { placeId: 'p2', title: 'Glossy Nails', phoneUnformatted: '+6591230002', city: 'Tampines', totalScore: 4.2, reviewsCount: 30, url: 'https://maps.google.com/?cid=2' },
];

beforeAll(async () => {
  app = await getApp(); // boots + syncs the test DB
  admin = await createTestUser({ role: 'admin' });
  await seedRedeemOpsCategory('Nail Salon');
});

afterAll(async () => { await closeDb(); });
// Tests override DISCOVERY_* quotas/TTLs; snapshot at module load (after this
// file's own env sets above) and restore after EVERY test so an override — or a
// mid-assertion throw — never leaks into the next test.
const DISCOVERY_ENV_SNAPSHOT = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => k.startsWith('DISCOVERY_')),
);
afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('DISCOVERY_')) delete process.env[k];
  }
  Object.assign(process.env, DISCOVERY_ENV_SNAPSHOT);
});

let runIdSeq = 0;
// mockImplementation (not mockResolvedValue) so each call yields a UNIQUE runId —
// the providerRunId unique index would otherwise 409 the 2nd call on a fresh DB.
const uniqueRunId = () => ({ runId: `run_${Date.now()}_${++runIdSeq}`, datasetId: 'ds1', status: 'RUNNING' });

// Default user = the shared admin; new tests that call startDiscovery pass a
// FRESH user instead — the shared admin's 24h search quota fills up across the
// suite (direct DiscoveryRun.create rows count too).
async function startedRun(svc, apify, user = null) {
  apify.startRun.mockImplementation(async () => uniqueRunId());
  return svc.startDiscovery({ category: 'Nail Salon', area: 'Tampines', limit: 60 }, user || admin.user);
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
    apify.startRun.mockImplementation(async () => uniqueRunId());
    await svc.startDiscovery({ category: 'Nail Salon', area: 'A', limit: 30 }, solo.user);
    await svc.startDiscovery({ category: 'Nail Salon', area: 'B', limit: 30 }, solo.user);
    await expect(svc.startDiscovery({ category: 'Nail Salon', area: 'C', limit: 30 }, solo.user))
      .rejects.toMatchObject({ statusCode: 429 });
    // env cleanup handled by afterEach (leak-proof even if an assertion throws)
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

    const res = await svc.addToPartners(run.id, [fresh.id, existing.id], admin.user);
    expect(res.added).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.notFound).toBe(0);
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
    expect(cand.isVerified).toBe(true);
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

describe('terminal-state processing — failure paths', () => {
  test('aborted maps run maps status and fetches no dataset', async () => {
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const solo = await createTestUser({ role: 'admin' });
    const run = await startedRun(svc, apify, solo.user);
    apify.getRun.mockResolvedValue({ runId: run.providerRunId, status: 'ABORTED', datasetId: null, usageTotalUsd: 0.1, terminalStatus: 'aborted' });
    await svc.processRun(run.id);
    await run.reload();
    expect(run.status).toBe('aborted');
    expect(apify.getDatasetItems).not.toHaveBeenCalled();
  });

  test('failed IG run resets its PENDING targets to failed (enriched ones untouched)', async () => {
    const mapsRun = await DiscoveryRun.create({ createdBy: admin.user.id, provider: 'apify_google_maps', status: 'completed', requestedLimit: 10 });
    const target = await DiscoveryCandidate.create({ discoveryRunId: mapsRun.id, name: 'Fail Reset Nails', instagramHandle: 'failreset', enrichmentStatus: 'pending' });
    const untouched = await DiscoveryCandidate.create({ discoveryRunId: mapsRun.id, name: 'Concurrent Enriched', instagramHandle: 'otherok', enrichmentStatus: 'enriched' });
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const igRun = await DiscoveryRun.create({
      createdBy: admin.user.id, provider: 'apify_instagram', status: 'running',
      providerRunId: `ig_${Date.now()}_${++runIdSeq}`, startedAt: new Date(), requestedLimit: 2,
      rawPayload: { targetCandidateIds: [target.id, untouched.id] },
    });
    apify.getRun.mockResolvedValue({ runId: igRun.providerRunId, status: 'FAILED', datasetId: null, usageTotalUsd: 0, terminalStatus: 'failed' });
    await svc.processRun(igRun.id);
    await svc.processRun(igRun.id); // idempotent — terminal runs early-return
    await igRun.reload(); await target.reload(); await untouched.reload();
    expect(igRun.status).toBe('failed');
    expect(target.enrichmentStatus).toBe('failed');
    expect(untouched.enrichmentStatus).toBe('enriched');
  });
});

describe('reconciliation', () => {
  test('drives a stuck running run terminal via Apify re-fetch', async () => {
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const solo = await createTestUser({ role: 'admin' });
    const run = await startedRun(svc, apify, solo.user);
    await run.update({ startedAt: new Date(Date.now() - 30 * 60 * 1000) }); // past the 10-min cutoff
    apify.getRun.mockResolvedValue({ runId: run.providerRunId, status: 'SUCCEEDED', datasetId: 'ds1', usageTotalUsd: 0.2, terminalStatus: 'completed' });
    apify.getDatasetItems.mockResolvedValue([mapsItems[1]]);
    const { checked } = await svc.reconcileStuckRuns();
    expect(checked).toBeGreaterThanOrEqual(1);
    await run.reload();
    expect(run.status).toBe('completed');
  });

  test('sweeps a stranded pending run with no provider id → failed + IG targets reset', async () => {
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const mapsRun = await DiscoveryRun.create({ createdBy: admin.user.id, provider: 'apify_google_maps', status: 'completed', requestedLimit: 5 });
    const target = await DiscoveryCandidate.create({ discoveryRunId: mapsRun.id, name: 'Stranded Target', instagramHandle: 'strandedtarget', enrichmentStatus: 'pending' });
    const stranded = await DiscoveryRun.create({
      createdBy: admin.user.id, provider: 'apify_instagram', status: 'pending', providerRunId: null,
      requestedLimit: 1, rawPayload: { targetCandidateIds: [target.id] },
    });
    // Backdate past the cutoff via raw SQL (bulletproof against timestamp auto-set)
    await sequelize.query(
      `UPDATE discovery_runs SET "createdAt" = NOW() - INTERVAL '30 minutes' WHERE id = :id`,
      { replacements: { id: stranded.id } },
    );
    const res = await svc.reconcileStuckRuns();
    expect(res.stranded).toBeGreaterThanOrEqual(1);
    await stranded.reload(); await target.reload();
    expect(stranded.status).toBe('failed');
    expect(stranded.error).toMatch(/never started/);
    expect(target.enrichmentStatus).toBe('failed');
  });
});

describe('category validation', () => {
  test('unknown category → 422, no run row (count delta), no Apify call', async () => {
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const solo = await createTestUser({ role: 'admin' });
    const before = await DiscoveryRun.count();
    await expect(svc.startDiscovery({ category: 'Cat Cafes', area: 'Tampines', limit: 10 }, solo.user))
      .rejects.toMatchObject({ statusCode: 422 });
    expect(await DiscoveryRun.count()).toBe(before);
    expect(apify.startRun).not.toHaveBeenCalled();
  });

  test('category stored with canonical taxonomy casing', async () => {
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const solo = await createTestUser({ role: 'admin' });
    apify.startRun.mockImplementation(async () => uniqueRunId());
    const run = await svc.startDiscovery({ category: 'nail salon', area: 'Bedok', limit: 5 }, solo.user);
    expect(run.category).toBe('Nail Salon');
  });
});

describe('geo-anchored search input', () => {
  test('area is sent as locationQuery (Singapore-anchored), never in the search string', async () => {
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const solo = await createTestUser({ role: 'admin' });
    apify.startRun.mockImplementation(async () => uniqueRunId());
    await svc.startDiscovery({ category: 'Nail Salon', area: 'Tampines', limit: 5 }, solo.user);
    const input = apify.startRun.mock.calls[0][1];
    expect(input.searchStringsArray).toEqual(['Nail Salon']);
    expect(input.locationQuery).toBe('Tampines, Singapore');
  });

  test('an area already naming Singapore is not double-suffixed', async () => {
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const solo = await createTestUser({ role: 'admin' });
    apify.startRun.mockImplementation(async () => uniqueRunId());
    await svc.startDiscovery({ category: 'Nail Salon', area: 'Bedok, Singapore', limit: 5 }, solo.user);
    expect(apify.startRun.mock.calls[0][1].locationQuery).toBe('Bedok, Singapore');
  });
});

describe('fuzzy classification (pg_trgm)', () => {
  test('near-name candidate → possible_duplicate even with ZERO exact hits in the batch', async () => {
    if (!(await makeDedupeService().trgmAvailable())) {
      console.warn('[test] pg_trgm unavailable in this DB — skipping fuzzy assertions');
      return;
    }
    const svc = makeDiscoveryService({ apify: makeApifyStub() });
    const { partner } = await partners.createPartner(
      { tradingName: 'Aurora Skin Atelier', category: 'Nail Salon' }, admin.user,
    );
    const run = await DiscoveryRun.create({ createdBy: admin.user.id, provider: 'apify_google_maps', status: 'completed', requestedLimit: 5 });
    const near = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'Aurora Skin Atelier Tampines', status: 'pending' });
    await svc.classifyAgainstPartners([near]);
    await near.reload();
    expect(near.dedupeStatus).toBe('possible_duplicate');
    expect(near.matchedPartnerId).toBe(partner.id);
  });

  test('exact normalized-name match beats fuzzy', async () => {
    if (!(await makeDedupeService().trgmAvailable())) return;
    const svc = makeDiscoveryService({ apify: makeApifyStub() });
    const { partner } = await partners.createPartner(
      { tradingName: 'Velvet Lash Loft', category: 'Nail Salon' }, admin.user,
    );
    const run = await DiscoveryRun.create({ createdBy: admin.user.id, provider: 'apify_google_maps', status: 'completed', requestedLimit: 5 });
    const exact = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'Velvet Lash Loft', status: 'pending' });
    await svc.classifyAgainstPartners([exact]);
    await exact.reload();
    expect(exact.dedupeStatus).toBe('existing_partner');
    expect(exact.matchedPartnerId).toBe(partner.id);
  });
});

describe('enrichment eligibility + profile quotas', () => {
  test('server-side eligibility: pending/enriched excluded; all-ineligible → 400', async () => {
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const run = await DiscoveryRun.create({ createdBy: admin.user.id, provider: 'apify_google_maps', status: 'completed', requestedLimit: 10 });
    const fresh = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'Eligible Nails', instagramHandle: 'eligible1', enrichmentStatus: 'none' });
    const already = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'Enriched Nails', instagramHandle: 'already1', enrichmentStatus: 'enriched' });
    const inflight = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'Inflight Nails', instagramHandle: 'inflight1', enrichmentStatus: 'pending' });
    apify.startRun.mockImplementation(async () => uniqueRunId());
    await svc.enrichCandidates([fresh.id, already.id, inflight.id], admin.user);
    expect(apify.startRun.mock.calls[0][1].usernames).toEqual(['eligible1']);
    await expect(svc.enrichCandidates([already.id, inflight.id], admin.user))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('per-user profile cap → 429', async () => {
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const solo = await createTestUser({ role: 'admin' });
    const run = await DiscoveryRun.create({ createdBy: solo.user.id, provider: 'apify_google_maps', status: 'completed', requestedLimit: 10 });
    const c1 = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'UserCap One', instagramHandle: 'usercap1', enrichmentStatus: 'none' });
    const c2 = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'UserCap Two', instagramHandle: 'usercap2', enrichmentStatus: 'none' });
    process.env.DISCOVERY_ENRICH_MAX_PER_USER_DAY = '1';
    await expect(svc.enrichCandidates([c1.id, c2.id], solo.user)).rejects.toMatchObject({ statusCode: 429 });
    expect(apify.startRun).not.toHaveBeenCalled();
  });

  test('global cap is baseline-relative and never-started runs are excluded', async () => {
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const solo = await createTestUser({ role: 'admin' });
    // A 500-profile IG run that failed BEFORE start — must not consume budget.
    await DiscoveryRun.create({
      createdBy: solo.user.id, provider: 'apify_instagram', status: 'failed',
      providerRunId: null, requestedLimit: 500,
    });
    // Baseline: profiles counted by the quota rule in the last 24h (shared DB).
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const igRuns = await DiscoveryRun.findAll({ where: { provider: 'apify_instagram' } });
    const used = igRuns
      .filter((r) => r.createdAt >= since && !(r.status === 'failed' && !r.providerRunId))
      .reduce((s, r) => s + r.requestedLimit, 0);
    process.env.DISCOVERY_ENRICH_MAX_PER_DAY = String(used + 2);
    process.env.DISCOVERY_ENRICH_MAX_PER_USER_DAY = String(used + 2);

    const run = await DiscoveryRun.create({ createdBy: solo.user.id, provider: 'apify_google_maps', status: 'completed', requestedLimit: 10 });
    const c1 = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'Global One', instagramHandle: 'globalone', enrichmentStatus: 'none' });
    const c2 = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'Global Two', instagramHandle: 'globaltwo', enrichmentStatus: 'none' });
    const c3 = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'Global Three', instagramHandle: 'globalthree', enrichmentStatus: 'none' });
    apify.startRun.mockImplementation(async () => uniqueRunId());
    // Succeeds ⇒ the 500-profile never-started run was excluded from the sum.
    await svc.enrichCandidates([c1.id, c2.id], solo.user);
    // Budget now exhausted (used+2 == cap) ⇒ one more profile trips 429.
    await expect(svc.enrichCandidates([c3.id], solo.user)).rejects.toMatchObject({ statusCode: 429 });
  });
});

describe('quota fairness (search)', () => {
  test('failed-before-start runs do not count toward the search quota', async () => {
    const svc = makeDiscoveryService({ apify: makeApifyStub() });
    const solo = await createTestUser({ role: 'admin' });
    await DiscoveryRun.create({
      createdBy: solo.user.id, provider: 'apify_google_maps', status: 'failed',
      providerRunId: null, requestedLimit: 10,
    });
    const q = await svc.getQuota(solo.user);
    expect(q.used).toBe(0);
    expect(q.costPerResultUsd).toBeGreaterThan(0);
  });
});

describe('run-scoped add', () => {
  test('candidates from another run are not added and reported as notFound', async () => {
    const svc = makeDiscoveryService({ apify: makeApifyStub() });
    const runA = await DiscoveryRun.create({ createdBy: admin.user.id, provider: 'apify_google_maps', status: 'completed', category: 'Nail Salon', requestedLimit: 5 });
    const runB = await DiscoveryRun.create({ createdBy: admin.user.id, provider: 'apify_google_maps', status: 'completed', category: 'Nail Salon', requestedLimit: 5 });
    const a1 = await DiscoveryCandidate.create({ discoveryRunId: runA.id, name: 'Scoped Add Nails', primaryPhone: '+6598111222', dedupeStatus: 'new', status: 'pending' });
    const b1 = await DiscoveryCandidate.create({ discoveryRunId: runB.id, name: 'Foreign Run Nails', primaryPhone: '+6598111333', dedupeStatus: 'new', status: 'pending' });
    const res = await svc.addToPartners(runA.id, [a1.id, b1.id], admin.user);
    expect(res.added).toBe(1);
    expect(res.notFound).toBe(1);
    await b1.reload();
    expect(b1.status).toBe('pending'); // untouched — different run
  });

  test('409 downgrade keeps the matched-partner link', async () => {
    const svc = makeDiscoveryService({ apify: makeApifyStub() });
    const { partner } = await partners.createPartner(
      { tradingName: 'Link Keeper Nails', primaryPhone: '+6598777666', category: 'Nail Salon' }, admin.user,
    );
    const run = await DiscoveryRun.create({ createdBy: admin.user.id, provider: 'apify_google_maps', status: 'completed', category: 'Nail Salon', requestedLimit: 5 });
    const cand = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'Link Keeper Nails Studio', primaryPhone: '+6598777666', dedupeStatus: 'new', status: 'pending' });
    const res = await svc.addToPartners(run.id, [cand.id], admin.user);
    expect(res.skipped).toBe(1);
    await cand.reload();
    expect(cand.dedupeStatus).toBe('existing_partner');
    expect(cand.matchedPartnerId).toBe(partner.id);
  });
});

describe('retention purge', () => {
  test('expired pending deleted, added stripped (provenance kept), fresh untouched', async () => {
    const svc = makeDiscoveryService({ apify: makeApifyStub() });
    const oldRun = await DiscoveryRun.create({
      createdBy: admin.user.id, provider: 'apify_google_maps', status: 'completed',
      requestedLimit: 5, completedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
    });
    const freshRun = await DiscoveryRun.create({
      createdBy: admin.user.id, provider: 'apify_google_maps', status: 'completed',
      requestedLimit: 5, completedAt: new Date(),
    });
    const goner = await DiscoveryCandidate.create({ discoveryRunId: oldRun.id, name: 'Purge Me', status: 'pending', primaryPhone: '+6590009000', rawPayload: { a: 1 } });
    const keeper = await DiscoveryCandidate.create({
      discoveryRunId: oldRun.id, name: 'Keep Provenance', status: 'added',
      primaryPhone: '+6590009001', email: 'keep@x.sg', bio: 'bio', address: '1 Test Rd',
      rawPayload: { a: 2 }, website: 'https://keep.sg', instagramHandle: 'keepprov',
    });
    const freshCand = await DiscoveryCandidate.create({ discoveryRunId: freshRun.id, name: 'Too Fresh', status: 'pending', primaryPhone: '+6590009002' });

    const res = await svc.purgeExpiredCandidates();
    expect(res.deleted).toBeGreaterThanOrEqual(1);
    expect(res.stripped).toBeGreaterThanOrEqual(1);
    expect(await DiscoveryCandidate.findByPk(goner.id)).toBeNull();
    await keeper.reload();
    expect(keeper.primaryPhone).toBeNull();
    expect(keeper.email).toBeNull();
    expect(keeper.bio).toBeNull();
    expect(keeper.address).toBeNull();
    expect(keeper.rawPayload).toBeNull();
    expect(keeper.name).toBe('Keep Provenance'); // provenance stays legible
    expect(keeper.website).toBe('https://keep.sg');
    expect(keeper.instagramHandle).toBe('keepprov');
    const still = await DiscoveryCandidate.findByPk(freshCand.id);
    expect(still).not.toBeNull();
    expect(still.primaryPhone).toBe('+6590009002');
  });

  test('TTL=0 disables the purge', async () => {
    process.env.DISCOVERY_CANDIDATE_TTL_DAYS = '0';
    const svc = makeDiscoveryService({ apify: makeApifyStub() });
    await expect(svc.purgeExpiredCandidates()).resolves.toEqual({ deleted: 0, stripped: 0 });
  });
});

describe('PATCH /discovery/candidates/:id over HTTP (back-compat)', () => {
  test('empty body dismisses (old client contract) and {action:restore} restores', async () => {
    const run = await DiscoveryRun.create({ createdBy: admin.user.id, provider: 'apify_google_maps', status: 'completed', requestedLimit: 5 });
    const cand = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'Http Flip Nails', status: 'pending' });
    const url = `/api/redeem-ops/discovery/candidates/${cand.id}`;
    await request(app).patch(url).set(auth(admin.token)).send({}).expect(200);
    await cand.reload();
    expect(cand.status).toBe('dismissed');
    await request(app).patch(url).set(auth(admin.token)).send({ action: 'restore' }).expect(200);
    await cand.reload();
    expect(cand.status).toBe('pending');
  });

  test('restore on an added candidate is a no-op', async () => {
    const run = await DiscoveryRun.create({ createdBy: admin.user.id, provider: 'apify_google_maps', status: 'completed', requestedLimit: 5 });
    const cand = await DiscoveryCandidate.create({ discoveryRunId: run.id, name: 'Http Added Nails', status: 'added' });
    await request(app)
      .patch(`/api/redeem-ops/discovery/candidates/${cand.id}`)
      .set(auth(admin.token)).send({ action: 'restore' }).expect(200);
    await cand.reload();
    expect(cand.status).toBe('added');
  });
});
