/**
 * Redeem Ops Discover — Instagram hashtag-discovery pilot (DB-backed, Apify
 * mocked; DISCOVERY_IG_ENABLED). Covers: category hashtag curation (create/
 * update cleaning, resolveCategoryForInstagram 422), flag gating (503) +
 * provider validation, IG run start (actor/input/snapshot/canonical casing),
 * post→distinct-account materialization on the namespaced 'ig:<ownerId>'
 * externalPlaceId (idempotent re-materialization, pruned rawPayload, place
 * memory birth), the territory soft filter (specific town vs All Singapore),
 * partner dedupe by handle, profile enrichment on an IG candidate, the shared
 * cross-provider search quota, and the provider-default Maps path staying
 * byte-identical (input + run shape).
 */
process.env.REDEEM_OPS_ENABLED = 'true';
process.env.DISCOVERY_ENABLED = 'true';
process.env.DISCOVERY_IG_ENABLED = 'true';
process.env.DISCOVERY_WEBHOOK_SECRET = 'test-secret';

import { jest } from '@jest/globals';
import { getApp, closeDb, createTestUser, seedRedeemOpsCategory } from './helpers.js';
import { makeDiscoveryService } from '../src/services/redeemOps/discoveryService.js';
import { makeCategoryService } from '../src/services/redeemOps/categoryService.js';
import { makePartnerService } from '../src/services/redeemOps/partnerService.js';
import {
  DiscoveryRun, DiscoveryCandidate, DiscoveryPlaceMemory, RedeemOpsAuditEvent,
} from '../src/models/index.js';

let admin;
const partners = makePartnerService();
const categories = makeCategoryService();

function makeApifyStub() {
  return { startRun: jest.fn(), getRun: jest.fn(), getDatasetItems: jest.fn() };
}

beforeAll(async () => {
  await getApp(); // boots + syncs the test DB (no HTTP calls in this suite)
  admin = await createTestUser({ role: 'admin' });
});

afterAll(async () => { await closeDb(); });

// Same leak-proofing as the sibling suite: snapshot DISCOVERY_* after this
// file's own env sets, restore after every test.
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
const uniqueRunId = () => ({ runId: `igrun_${Date.now()}_${++runIdSeq}`, datasetId: 'ds1', status: 'RUNNING' });

// IG owner ids feed the GLOBAL place-memory table ('ig:<ownerId>' keys, shared
// DB) — every test mints fresh ids/handles or memory assertions become
// order-dependent (same discipline as uniquePlaceId in the sibling suite).
let igSeq = 0;
const uniqueOwner = (prefix = 'igbiz') => {
  igSeq += 1;
  return { ownerId: `${Date.now()}${igSeq}`, ownerUsername: `${prefix}${igSeq}.sg` };
};

/** Apify instagram-hashtag-scraper post item (heavy fields included so pruning is observable). */
const post = (over = {}) => ({
  ownerUsername: 'someone.sg',
  ownerId: '0',
  ownerFullName: 'Someone SG',
  caption: 'Fresh BIAB set — DM to book #sgnails',
  url: 'https://www.instagram.com/p/AAA/',
  locationName: null,
  hashtags: ['sgnails'],
  images: ['https://cdn.example/one.jpg'],
  childPosts: [{ id: 'child1' }],
  latestComments: [{ text: 'so pretty!' }],
  musicInfo: { song_name: 'x' },
  ...over,
});

async function seedIgCategory(igHashtags = ['sgnails', 'nailsg']) {
  const name = `IG Nails ${Date.now()}_${++igSeq}`;
  await seedRedeemOpsCategory(name, { igHashtags });
  return name;
}

describe('category hashtag curation', () => {
  test('createCategory cleans hashtags: # stripped, lowercased, deduped, blanks dropped', async () => {
    const category = await categories.createCategory(
      { name: `Tag Clean ${Date.now()}_${++igSeq}`, igHashtags: ['#SGNails', 'sgnails', '   ', '#nailsg', '#', '# BiabSG '] },
      admin.user,
    );
    expect(category.igHashtags).toEqual(['sgnails', 'nailsg', 'biabsg']);
  });

  test('resolveCategoryForInstagram → 422 when the category has no hashtags; search resolver unaffected', async () => {
    const name = `No Tags ${Date.now()}_${++igSeq}`;
    await seedRedeemOpsCategory(name);
    await expect(categories.resolveCategoryForInstagram(name)).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining('has no Instagram hashtags'),
    });
    // The Maps resolver keeps its name fallback — untouched by the pilot.
    await expect(categories.resolveCategoryForSearch(name)).resolves.toEqual({
      name, searchTerms: [name],
    });
  });

  test('emptying igHashtags on update stores NULL and turns the IG resolver off again', async () => {
    const category = await categories.createCategory(
      { name: `Tag Empty ${Date.now()}_${++igSeq}`, igHashtags: ['#keepme'] },
      admin.user,
    );
    await categories.updateCategory(category.id, { igHashtags: [] }, admin.user);
    await category.reload();
    expect(category.igHashtags).toBeNull();
    await expect(categories.resolveCategoryForInstagram(category.name))
      .rejects.toMatchObject({ statusCode: 422 });
  });
});

describe('flag + provider gating', () => {
  test('unknown provider → 400 before any run row or Apify call', async () => {
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const before = await DiscoveryRun.count();
    await expect(svc.startDiscovery(
      { category: 'whatever', area: 'Tampines', limit: 10, provider: 'tiktok' }, admin.user,
    )).rejects.toMatchObject({ statusCode: 400 });
    expect(await DiscoveryRun.count()).toBe(before);
    expect(apify.startRun).not.toHaveBeenCalled();
  });

  test('DISCOVERY_IG_ENABLED off → 503 (kill switch), Maps default unaffected', async () => {
    delete process.env.DISCOVERY_IG_ENABLED;
    const category = await seedIgCategory();
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const solo = await createTestUser({ role: 'admin' });
    const before = await DiscoveryRun.count();
    await expect(svc.startDiscovery(
      { category, area: 'All Singapore', limit: 10, provider: 'instagram_hashtag' }, solo.user,
    )).rejects.toMatchObject({ statusCode: 503 });
    expect(await DiscoveryRun.count()).toBe(before);
    expect(apify.startRun).not.toHaveBeenCalled();
    // The Maps path still starts with the pilot flag off.
    apify.startRun.mockImplementation(async () => uniqueRunId());
    const run = await svc.startDiscovery({ category, area: 'Tampines', limit: 5 }, solo.user);
    expect(run.provider).toBe('apify_google_maps');
  });

  test('IG search on a category without hashtags → 422 before any run row or spend', async () => {
    const name = `IG No Tags ${Date.now()}_${++igSeq}`;
    await seedRedeemOpsCategory(name);
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const before = await DiscoveryRun.count();
    await expect(svc.startDiscovery(
      { category: name, area: 'All Singapore', limit: 10, provider: 'instagram_hashtag' }, admin.user,
    )).rejects.toMatchObject({ statusCode: 422 });
    expect(await DiscoveryRun.count()).toBe(before);
    expect(apify.startRun).not.toHaveBeenCalled();
  });
});

describe('IG run start', () => {
  test('starts the hashtag actor with { hashtags, resultsLimit } and snapshots the run', async () => {
    const category = await seedIgCategory(['sgnails', 'homebasednailssg']);
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const solo = await createTestUser({ role: 'admin' });
    apify.startRun.mockImplementation(async () => uniqueRunId());

    const run = await svc.startDiscovery(
      { category: category.toLowerCase(), area: 'All Singapore', limit: 40, provider: 'instagram_hashtag' },
      solo.user,
    );

    expect(apify.startRun).toHaveBeenCalledTimes(1);
    const [actorId, input, opts] = apify.startRun.mock.calls[0];
    expect(actorId).toBe('apify~instagram-hashtag-scraper');
    expect(input).toEqual({ hashtags: ['sgnails', 'homebasednailssg'], resultsLimit: 40 });
    expect(opts.webhookUrl).toContain('test-secret');

    expect(run.provider).toBe('apify_instagram_hashtag');
    expect(run.category).toBe(category); // canonical taxonomy casing
    expect(run.area).toBe('All Singapore');
    expect(run.status).toBe('running');
    expect(run.rawPayload).toEqual({ hashtags: ['sgnails', 'homebasednailssg'], territory: 'All Singapore' });

    const audit = await RedeemOpsAuditEvent.findOne({
      where: { action: 'discovery.run_started', entityId: run.id },
    });
    expect(audit.after.provider).toBe('apify_instagram_hashtag');
    expect(audit.after.hashtags).toEqual(['sgnails', 'homebasednailssg']);
  });

  // Regression: ad-hoc hashtags without a category leave `resolved` null; the audit
  // payload used to read resolved.hashtags and crash AFTER Apify spend began.
  test('ad-hoc-only start (no category) completes and audits the fired hashtags', async () => {
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const solo = await createTestUser({ role: 'admin' });
    apify.startRun.mockImplementation(async () => uniqueRunId());

    const run = await svc.startDiscovery(
      { area: 'All Singapore', limit: 20, provider: 'instagram_hashtag', hashtags: ['#SGnails', 'biabsg'] },
      solo.user,
    );

    expect(run.status).toBe('running');
    expect(run.category).toBeNull();
    const [, input] = apify.startRun.mock.calls[0];
    expect(input).toEqual({ hashtags: ['SGnails', 'biabsg'], resultsLimit: 20 });

    const audit = await RedeemOpsAuditEvent.findOne({
      where: { action: 'discovery.run_started', entityId: run.id },
    });
    expect(audit.after.hashtags).toEqual(['SGnails', 'biabsg']);
  });
});

describe('materialization — posts collapse to distinct accounts', () => {
  test('6 posts from 2 owners → 2 candidates with ig:-namespaced ids (idempotent, pruned payloads)', async () => {
    const category = await seedIgCategory();
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const solo = await createTestUser({ role: 'admin' });
    apify.startRun.mockImplementation(async () => uniqueRunId());

    const a = uniqueOwner('juicyclawz');
    const b = uniqueOwner('aprilcollective');
    const sixPosts = [
      post({ ...a, ownerFullName: 'Juicy Clawz SG', url: 'https://www.instagram.com/p/A1/' }),
      post({ ...a, ownerFullName: 'Juicy Clawz SG', caption: 'Cat-eye chrome set #nailsg', url: 'https://www.instagram.com/p/A2/' }),
      post({ ...a, ownerFullName: 'Juicy Clawz SG', url: 'https://www.instagram.com/p/A3/' }),
      post({ ...a, ownerFullName: 'Juicy Clawz SG', url: 'https://www.instagram.com/p/A4/' }),
      post({ ...b, ownerFullName: 'April Collective', url: 'https://www.instagram.com/p/B1/' }),
      post({ ...b, ownerFullName: 'April Collective', url: 'https://www.instagram.com/p/B2/' }),
      // Not materializable — no owner id / no username / junk.
      post({ ownerUsername: 'noid.sg', ownerId: null }),
      { caption: 'no owner at all' },
    ];

    const run = await svc.startDiscovery(
      { category, area: 'All Singapore', limit: 60, provider: 'instagram_hashtag' }, solo.user,
    );
    apify.getRun.mockResolvedValue({
      runId: run.providerRunId, status: 'SUCCEEDED', datasetId: 'ds1',
      usageTotalUsd: 0.02, terminalStatus: 'completed',
    });
    apify.getDatasetItems.mockResolvedValue(sixPosts);

    await svc.processRun(run.id);
    await svc.processRun(run.id); // terminal early-return (idempotent)
    await run.reload();
    expect(run.status).toBe('completed');
    expect(run.resultCount).toBe(8); // budget counts POSTS scanned, not accounts

    // Re-materializing the same dataset directly must be an index-level no-op.
    await svc.materializeInstagramHashtagCandidates(run, sixPosts);

    const cands = await DiscoveryCandidate.findAll({
      where: { discoveryRunId: run.id }, order: [['name', 'ASC']],
    });
    expect(cands).toHaveLength(2);

    const april = cands.find((x) => x.instagramHandle === b.ownerUsername);
    const juicy = cands.find((x) => x.instagramHandle === a.ownerUsername);
    expect(juicy.externalPlaceId).toBe(`ig:${a.ownerId}`);
    expect(april.externalPlaceId).toBe(`ig:${b.ownerId}`);
    expect(juicy.name).toBe('Juicy Clawz SG');
    expect(juicy.sourceUrl).toBe(`https://instagram.com/${a.ownerUsername}`);
    expect(juicy.enrichmentStatus).toBe('none');
    expect(juicy.primaryPhone).toBeNull();
    expect(juicy.address).toBeNull();
    expect(juicy.rating).toBeNull();
    // Heavy arrays pruned; the useful post context kept.
    expect(juicy.rawPayload.images).toBeUndefined();
    expect(juicy.rawPayload.childPosts).toBeUndefined();
    expect(juicy.rawPayload.latestComments).toBeUndefined();
    expect(juicy.rawPayload.musicInfo).toBeUndefined();
    expect(juicy.rawPayload.caption).toContain('BIAB');

    // Place memory born on the namespaced key; the same-run re-materialization
    // above must not have inflated the sighting count.
    const mem = await DiscoveryPlaceMemory.findByPk(`ig:${a.ownerId}`);
    expect(mem).not.toBeNull();
    expect(mem.timesSeen).toBe(1);
  });
});

describe('territory soft filter', () => {
  const mkIgRun = (area) => DiscoveryRun.create({
    createdBy: admin.user.id, provider: 'apify_instagram_hashtag', status: 'running',
    area, requestedLimit: 30,
  });

  test('a specific territory keeps only accounts mentioning it (name/caption/location)', async () => {
    const svc = makeDiscoveryService({ apify: makeApifyStub() });
    const viaCaption = uniqueOwner('capmention');
    const viaLocation = uniqueOwner('locmention');
    const viaFullName = uniqueOwner('namemention');
    const noMention = uniqueOwner('nomention');
    const items = [
      post({ ...viaCaption, caption: 'Home studio in woodlands! DM to book' }),
      post({ ...viaLocation, caption: 'New set!', locationName: 'Woodlands Mart' }),
      post({ ...viaFullName, ownerFullName: 'Nails by Kim (Woodlands)', caption: 'Chrome francais' }),
      post({ ...noMention, caption: 'Tampines girlies come thru', locationName: 'Tampines Hub' }),
    ];

    const run = await mkIgRun('Woodlands');
    await svc.materializeInstagramHashtagCandidates(run, items);
    const kept = (await DiscoveryCandidate.findAll({ where: { discoveryRunId: run.id } }))
      .map((x) => x.instagramHandle).sort();
    expect(kept).toEqual([
      viaCaption.ownerUsername, viaLocation.ownerUsername, viaFullName.ownerUsername,
    ].sort());
  });

  test('any one of an account\'s posts mentioning the territory keeps the account', async () => {
    const svc = makeDiscoveryService({ apify: makeApifyStub() });
    const owner = uniqueOwner('multipost');
    const run = await mkIgRun('Yishun');
    await svc.materializeInstagramHashtagCandidates(run, [
      post({ ...owner, caption: 'nothing geographic here' }),
      post({ ...owner, caption: 'Based in YISHUN, islandwide mobile' }),
    ]);
    expect(await DiscoveryCandidate.count({ where: { discoveryRunId: run.id } })).toBe(1);
  });

  test('All Singapore (and a blank legacy area) keep every account', async () => {
    const svc = makeDiscoveryService({ apify: makeApifyStub() });
    const one = uniqueOwner('allsg');
    const two = uniqueOwner('allsg');
    const items = [
      post({ ...one, caption: 'no town named' }),
      post({ ...two, caption: 'also no town', locationName: null }),
    ];
    const runAll = await mkIgRun('All Singapore');
    await svc.materializeInstagramHashtagCandidates(runAll, items);
    expect(await DiscoveryCandidate.count({ where: { discoveryRunId: runAll.id } })).toBe(2);

    const runBlank = await mkIgRun(null);
    await svc.materializeInstagramHashtagCandidates(runBlank, items);
    expect(await DiscoveryCandidate.count({ where: { discoveryRunId: runBlank.id } })).toBe(2);
  });
});

describe('partner dedupe by handle', () => {
  test('an account whose handle matches an existing partner classifies existing_partner', async () => {
    const svc = makeDiscoveryService({ apify: makeApifyStub() });
    const owner = uniqueOwner('dupehandle');
    const { partner } = await partners.createPartner(
      { tradingName: `Handle Dup Nails ${igSeq}`, instagramHandle: owner.ownerUsername },
      admin.user,
    );
    const run = await DiscoveryRun.create({
      createdBy: admin.user.id, provider: 'apify_instagram_hashtag', status: 'running',
      area: 'All Singapore', requestedLimit: 10,
    });
    await svc.materializeInstagramHashtagCandidates(run, [post(owner)]);
    const cand = await DiscoveryCandidate.findOne({ where: { discoveryRunId: run.id } });
    expect(cand.dedupeStatus).toBe('existing_partner');
    expect(cand.matchedPartnerId).toBe(partner.id);
  });
});

describe('profile enrichment on an IG candidate', () => {
  test('enrichCandidates claims the handle, and applyEnrichment fills metrics + handle-keyed memory', async () => {
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const owner = uniqueOwner('enrichig');
    const run = await DiscoveryRun.create({
      createdBy: admin.user.id, provider: 'apify_instagram_hashtag', status: 'completed',
      area: 'All Singapore', requestedLimit: 10,
    });
    await svc.materializeInstagramHashtagCandidates(run, [post(owner)]);
    const cand = await DiscoveryCandidate.findOne({ where: { discoveryRunId: run.id } });

    apify.startRun.mockImplementation(async () => uniqueRunId());
    const enrichRun = await svc.enrichCandidates([cand.id], admin.user);
    expect(apify.startRun.mock.calls[0][0]).toBe('apify~instagram-profile-scraper');
    expect(apify.startRun.mock.calls[0][1]).toEqual({ usernames: [owner.ownerUsername] });

    await svc.applyEnrichment(enrichRun, [{
      username: owner.ownerUsername, followersCount: 4321,
      biography: 'Home-based nail studio — hello@enrich.sg', verified: false,
    }]);
    await cand.reload();
    expect(cand.enrichmentStatus).toBe('enriched');
    expect(cand.followersCount).toBe(4321);
    expect(cand.isVerified).toBe(false);
    expect(cand.email).toBe('hello@enrich.sg');

    const mem = await DiscoveryPlaceMemory.findByPk(`ig:${owner.ownerId}`);
    expect(mem.lastEnrichment).toMatchObject({
      handle: owner.ownerUsername, followersCount: 4321,
    });
  });
});

describe('shared search quota across providers', () => {
  test('IG runs spend from the same per-user daily search budget as Maps', async () => {
    process.env.DISCOVERY_MAX_RUNS_PER_USER_DAY = '2';
    const category = await seedIgCategory();
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const solo = await createTestUser({ role: 'admin' });
    apify.startRun.mockImplementation(async () => uniqueRunId());

    await svc.startDiscovery({ category, area: 'Tampines', limit: 5 }, solo.user);
    await svc.startDiscovery({ category, area: 'All Singapore', limit: 5, provider: 'instagram_hashtag' }, solo.user);
    await expect(svc.startDiscovery({ category, area: 'Bedok', limit: 5 }, solo.user))
      .rejects.toMatchObject({ statusCode: 429 });

    delete process.env.DISCOVERY_MAX_RUNS_PER_USER_DAY;
    const quota = await svc.getQuota(solo.user);
    expect(quota.used).toBe(2); // both providers counted
  });
});

describe('provider-default Maps path stays byte-identical', () => {
  test('omitted provider = legacy Maps input/actor/run shape even when the category has hashtags', async () => {
    const category = await seedIgCategory(['sgnails']); // IG-ready category must not leak into Maps
    const apify = makeApifyStub();
    const svc = makeDiscoveryService({ apify });
    const solo = await createTestUser({ role: 'admin' });
    apify.startRun.mockImplementation(async () => uniqueRunId());

    const run = await svc.startDiscovery({ category, area: 'Tampines', limit: 5 }, solo.user);

    const [actorId, input, opts] = apify.startRun.mock.calls[0];
    expect(actorId).toBe('compass~crawler-google-places');
    expect(input).toEqual({
      searchStringsArray: [category],
      locationQuery: 'Tampines, Singapore',
      maxCrawledPlacesPerSearch: 5,
      language: 'en',
      scrapeContacts: true,
    });
    expect(opts.webhookUrl).toContain('test-secret');
    expect(run.provider).toBe('apify_google_maps');
    // Maps snapshots its own terms (for the recent-searches UI) but the IG
    // hashtag/territory snapshot must never leak onto the Maps path.
    expect(run.rawPayload.searchTerms).toEqual([category]);
    expect(run.rawPayload.hashtags).toBeUndefined();
    expect(run.rawPayload.territory).toBeUndefined();

    const audit = await RedeemOpsAuditEvent.findOne({
      where: { action: 'discovery.run_started', entityId: run.id },
    });
    expect(audit.after.searchTerms).toEqual([category]);
    expect(audit.after.hashtags).toBeUndefined();
    expect(audit.after.provider).toBeUndefined();
  });
});
