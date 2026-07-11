import { Op, QueryTypes } from 'sequelize';
import crypto from 'crypto';
import { DiscoveryRun, DiscoveryCandidate, DiscoveryPlaceMemory, PartnerOrganisation, sequelize } from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { makePartnerService } from './partnerService.js';
import { makeCategoryService } from './categoryService.js';
import { makeDedupeService } from './dedupeService.js';
import { makeApifyClient } from './discovery/apifyClient.js';
import { normalizeMapsItem, normalizeInstagramItem, isSingaporeMapsItem } from './discovery/normalizers.js';
import { normalizeBusinessName, normalizeDomain, normalizeHandle } from './normalizers.js';
import { normalizePhone } from '../prospectHelpers.js';

const TERMINAL = ['completed', 'failed', 'aborted', 'timed_out'];

function cfg() {
  return {
    enabled: process.env.DISCOVERY_ENABLED === 'true',
    mapsActor: process.env.APIFY_MAPS_ACTOR_ID || 'compass~crawler-google-places',
    // MUST be the PROFILE scraper — apify~instagram-scraper (its sibling) has no
    // `usernames` input (wants directUrls), so every enrichment run came back
    // empty and all targets were marked failed (live incident, 2026-07-12).
    igActor: process.env.APIFY_INSTAGRAM_ACTOR_ID || 'apify~instagram-profile-scraper',
    webhookSecret: process.env.DISCOVERY_WEBHOOK_SECRET || '',
    webhookBase: process.env.DISCOVERY_WEBHOOK_BASE_URL || 'https://api.mktr.sg',
    // 500 ≈ one whole-Singapore sweep of a dense category (nail/hair/café) in a
    // single search (~$3.50) — town-by-town splitting isn't needed at SG scale.
    maxResultsPerRun: Number(process.env.DISCOVERY_MAX_RESULTS_PER_RUN || 500),
    maxRunsPerDay: Number(process.env.DISCOVERY_MAX_RUNS_PER_DAY || 25),
    maxRunsPerUserDay: Number(process.env.DISCOVERY_MAX_RUNS_PER_USER_DAY || 5),
    // Enrichment caps count PROFILES (each IG handle scraped is one paid unit),
    // not runs — a run-count cap left per-call size unbounded.
    enrichMaxPerDay: Number(process.env.DISCOVERY_ENRICH_MAX_PER_DAY || 500),
    enrichMaxPerUserDay: Number(process.env.DISCOVERY_ENRICH_MAX_PER_USER_DAY || 200),
    costPerResultUsd: Number(process.env.DISCOVERY_COST_PER_RESULT_USD || 0.007),
    reconcileStuckMinutes: Number(process.env.DISCOVERY_RECONCILE_STUCK_MINUTES || 10),
    candidateTtlDays: Number(process.env.DISCOVERY_CANDIDATE_TTL_DAYS ?? 90),
  };
}

/** Runs that never reached Apify (start failed / crashed pre-providerRunId) cost
 *  nothing — they don't burn anyone's daily budget. */
const COUNTS_TOWARD_QUOTA = {
  [Op.not]: { [Op.and]: [{ status: 'failed' }, { providerRunId: null }] },
};

export function makeDiscoveryService(overrides = {}) {
  const d = {
    DiscoveryRun, DiscoveryCandidate, DiscoveryPlaceMemory, PartnerOrganisation, sequelize, logger,
    apify: makeApifyClient(),
    partners: makePartnerService(),
    categories: makeCategoryService(),
    dedupe: makeDedupeService(),
    audit: makeRedeemOpsAuditService(),
    ...overrides,
  };

  function assertEnabled() {
    if (!cfg().enabled) throw new AppError('Discover is not enabled', 503);
  }

  /** Constant-time webhook-secret check (Apify does not sign — see apifyClient). */
  function verifyWebhookSecret(candidate) {
    const secret = cfg().webhookSecret;
    if (!secret) return false;
    const a = Buffer.from(String(candidate || ''));
    const b = Buffer.from(secret);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // NOTE: check-then-create quotas are advisory (TOCTOU under concurrency) —
  // accepted residual: single backend instance, tiny ops team, small overshoot.
  async function assertQuota(user) {
    const c = cfg();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const base = { provider: 'apify_google_maps', createdAt: { [Op.gte]: since }, ...COUNTS_TOWARD_QUOTA };
    const [mine, all] = await Promise.all([
      d.DiscoveryRun.count({ where: { ...base, createdBy: user.id } }),
      d.DiscoveryRun.count({ where: base }),
    ]);
    if (mine >= c.maxRunsPerUserDay) {
      throw new AppError(`Daily search limit reached (${c.maxRunsPerUserDay}/day per user)`, 429);
    }
    if (all >= c.maxRunsPerDay) {
      throw new AppError('Team daily search limit reached — try again tomorrow', 429);
    }
  }

  /** Per-user search budget for the day (drives the UI's usage chip). */
  async function getQuota(user) {
    const c = cfg();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const used = await d.DiscoveryRun.count({
      where: {
        provider: 'apify_google_maps', createdBy: user.id,
        createdAt: { [Op.gte]: since }, ...COUNTS_TOWARD_QUOTA,
      },
    });
    return {
      used, limit: c.maxRunsPerUserDay,
      remaining: Math.max(0, c.maxRunsPerUserDay - used),
      costPerResultUsd: c.costPerResultUsd, // lets the UI show "≈ $x.xx" pre-search
    };
  }

  function webhookUrl() {
    const c = cfg();
    if (!c.webhookSecret) return undefined;
    return `${c.webhookBase.replace(/\/$/, '')}/api/redeem-ops/discovery/webhook/${encodeURIComponent(c.webhookSecret)}`;
  }

  // ── Start a discovery search ───────────────────────────────────────────
  async function startDiscovery({ category, area, limit }, user, requestId = null) {
    assertEnabled();
    if (!category || !String(category).trim()) throw new AppError('Category is required', 400);
    if (!area || !String(area).trim()) throw new AppError('Area is required', 400);
    // Fail fast on an unknown/inactive category (422) BEFORE any run row or Apify
    // spend — otherwise every add-to-pipeline would fail after the money was paid.
    // Stores the taxonomy's canonical casing so add-time createPartner re-validation
    // can only fail on the (rare) delete-category-mid-run race.
    const canonicalCategory = await d.categories.resolveCategoryName(String(category).trim());
    await assertQuota(user);
    const c = cfg();
    const requestedLimit = Math.min(Math.max(Number(limit) || 60, 1), c.maxResultsPerRun);

    const run = await d.DiscoveryRun.create({
      createdBy: user.id, provider: 'apify_google_maps',
      category: canonicalCategory, area: String(area).trim(),
      requestedLimit, status: 'pending',
      estimatedCostUsd: Number((requestedLimit * c.costPerResultUsd).toFixed(4)),
    });

    try {
      // Geo-anchored search: the area goes in locationQuery (the actor geocodes
      // it and crawls that polygon), NOT concatenated into the search string —
      // "Beauty Tampines" as free text let the crawler pad the result budget
      // with global brand matches (Sephora New York/Oshawa/Edmonton, 2026-07-12).
      const locationQuery = /\bsingapore\b/i.test(run.area) ? run.area : `${run.area}, Singapore`;
      const input = {
        searchStringsArray: [canonicalCategory],
        locationQuery,
        maxCrawledPlacesPerSearch: requestedLimit,
        language: 'en',
        scrapeContacts: true, // enables the instagrams/social arrays
      };
      const started = await d.apify.startRun(c.mapsActor, input, { webhookUrl: webhookUrl() });
      await run.update({ providerRunId: started.runId, providerDatasetId: started.datasetId || null, status: 'running', startedAt: new Date() });
    } catch (err) {
      await run.update({ status: 'failed', error: String(err.message).slice(0, 500) });
      throw new AppError(`Could not start search: ${err.message}`, 502);
    }

    await d.audit.recordAuditEvent({
      actorUser: user, action: 'discovery.run_started', entityType: 'discovery_run',
      entityId: run.id, after: { category: run.category, area: run.area, requestedLimit }, requestId,
    });
    return run;
  }

  // ── Terminal-state processing (webhook or reconcile) ───────────────────
  /** Idempotent: safe to call repeatedly. Materialization dedupes on (run, place). */
  async function processRun(runId) {
    const run = await d.DiscoveryRun.findByPk(runId);
    if (!run || TERMINAL.includes(run.status) || !run.providerRunId) return;

    const info = await d.apify.getRun(run.providerRunId);
    if (!info.terminalStatus) return; // not done yet — a later webhook/sweep handles it

    if (info.terminalStatus !== 'completed') {
      // Candidates FIRST, run-terminal LAST (same ordering as the success path):
      // if the reset crashes, the run stays non-terminal and reconcile retries the
      // repair — marking the run terminal first would strand candidates at
      // 'pending' forever (processRun early-returns on terminal runs).
      if (run.provider === 'apify_instagram') {
        const targetIds = run.rawPayload?.targetCandidateIds || [];
        if (targetIds.length > 0) {
          await d.DiscoveryCandidate.update(
            { enrichmentStatus: 'failed' },
            { where: { id: { [Op.in]: targetIds }, enrichmentStatus: 'pending' } },
          );
        }
      }
      await run.update({
        status: info.terminalStatus, completedAt: new Date(),
        actualCostUsd: info.usageTotalUsd, error: `Apify run ${info.status}`,
      });
      return;
    }

    const items = await d.apify.getDatasetItems(info.datasetId, { limit: run.requestedLimit });
    if (run.provider === 'apify_instagram') {
      await applyEnrichment(run, items);
    } else {
      await materializeCandidates(run, items);
    }
    await run.update({
      status: 'completed', completedAt: new Date(), providerDatasetId: info.datasetId,
      actualCostUsd: info.usageTotalUsd, resultCount: items.length,
    });
  }

  async function materializeCandidates(run, items) {
    // Singapore-only: foreign-labelled items never become candidates (geo guard).
    const rows = items.filter(isSingaporeMapsItem).map(normalizeMapsItem).filter((r) => r && r.name);
    if (rows.length === 0) return;
    // Idempotent insert — the (discoveryRunId, externalPlaceId) unique index makes
    // a duplicate webhook / reconcile a no-op.
    await d.DiscoveryCandidate.bulkCreate(
      rows.map((r) => ({ ...r, discoveryRunId: run.id })),
      { ignoreDuplicates: true }
    );
    const candidates = await d.DiscoveryCandidate.findAll({ where: { discoveryRunId: run.id } });
    const memoryResolved = await applyPlaceMemory(run, candidates);
    // Memory-resolved rows (remembered partner / remembered dismissal) must NOT
    // be reclassified — the fuzzy pass would downgrade a remembered
    // existing_partner to possible_duplicate (Codex F3).
    await classifyAgainstPartners(candidates.filter((c) => !memoryResolved.has(c.id) && c.dedupeStatus === 'new'));
  }

  // ── Cross-run place memory (migration 056; plan: discover-cross-run-memory v2) ──
  /** The ONLY producer of memory.lastEnrichment — a strict whitelist keyed to the
   *  IG identity the metrics belong to. Scraped contact data (phone/email/bio)
   *  stays OUT of the memory table by construction. */
  function buildMemoryEnrichment(cand) {
    const handle = normalizeHandle(cand.instagramHandle);
    if (!handle) return null;
    const out = { handle };
    if (cand.followersCount != null) out.followersCount = cand.followersCount;
    if (cand.isVerified != null) out.isVerified = cand.isVerified;
    if (cand.enrichedAt) out.enrichedAt = cand.enrichedAt;
    return out.followersCount == null && out.isVerified == null ? null : out;
  }

  /**
   * Exactly-once sighting upsert + birth rules (precedence: added > dismissed >
   * seen). ONE INSERT..ON CONFLICT over the batch's DEDUPLICATED place ids
   * (dupes in one VALUES list would raise "cannot affect row a second time");
   * birth state derives from the SAME statement's RETURNING — timesSeen > 1 is
   * the seen-before signal, and the lastSeenRunId CASE keeps a duplicate
   * webhook/reconcile re-materialization of the SAME run from inflating counts
   * or falsely marking rows (Codex F1/F2). Returns resolved candidate ids
   * (excluded from classification).
   */
  async function applyPlaceMemory(run, candidates) {
    const withPlace = candidates.filter((c) => c.externalPlaceId);
    if (withPlace.length === 0) return new Set();
    const placeIds = [...new Set(withPlace.map((c) => c.externalPlaceId))];

    const memRows = await d.sequelize.query(
      `INSERT INTO discovery_place_memory
         ("externalPlaceId", "timesSeen", "firstSeenAt", "lastSeenAt", "lastSeenRunId", "createdAt", "updatedAt")
       SELECT unnest(ARRAY[:placeIds]::varchar[]), 1, NOW(), NOW(), :runId, NOW(), NOW()
       ON CONFLICT ("externalPlaceId") DO UPDATE SET
         "timesSeen"     = CASE WHEN discovery_place_memory."lastSeenRunId" = EXCLUDED."lastSeenRunId"
                                THEN discovery_place_memory."timesSeen"
                                ELSE discovery_place_memory."timesSeen" + 1 END,
         "lastSeenAt"    = NOW(),
         "lastSeenRunId" = EXCLUDED."lastSeenRunId",
         "updatedAt"     = NOW()
       RETURNING "externalPlaceId", "timesSeen", "firstSeenAt", "dismissedAt", "addedPartnerId", "lastEnrichment"`,
      { replacements: { placeIds, runId: run.id }, type: QueryTypes.SELECT },
    );
    const memByPlace = new Map(memRows.map((m) => [m.externalPlaceId, m]));

    // Resolve remembered partners to their LIVE survivor: merge keeps the loser
    // row with mergedIntoId set (FK SET NULL fires only on hard delete — Codex
    // F9), so follow the chain; archived/dead ends fall through to seen-before.
    const rememberedIds = [...new Set(memRows.map((m) => m.addedPartnerId).filter(Boolean))];
    const liveByRemembered = new Map();
    if (rememberedIds.length > 0) {
      const partners = await d.PartnerOrganisation.findAll({
        where: { id: { [Op.in]: rememberedIds } },
        attributes: ['id', 'mergedIntoId', 'archivedAt'],
      });
      for (const p of partners) {
        let cur = p;
        let hops = 0;
        while (cur?.mergedIntoId && hops < 5) {
           
          cur = await d.PartnerOrganisation.findByPk(cur.mergedIntoId, { attributes: ['id', 'mergedIntoId', 'archivedAt'] });
          hops += 1;
        }
        if (cur && !cur.mergedIntoId && !cur.archivedAt) liveByRemembered.set(p.id, cur.id);
      }
    }

    const resolved = new Set();
    for (const cand of withPlace) {
      const mem = memByPlace.get(cand.externalPlaceId);
      if (!mem) continue;
      const patch = {};
      const liveAdded = mem.addedPartnerId ? liveByRemembered.get(mem.addedPartnerId) : null;
      if (liveAdded) {
        patch.dedupeStatus = 'existing_partner';
        patch.matchedPartnerId = liveAdded;
        resolved.add(cand.id);
      } else if (mem.dismissedAt) {
        patch.status = 'dismissed';
        resolved.add(cand.id);
      }
      if (mem.timesSeen > 1) patch.previouslySeenAt = mem.firstSeenAt;
      // Enrichment cache — applied only when the cached metrics belong to the
      // SAME IG identity the new sighting carries (Codex F4), and marked
      // 'cached' so it is never re-billable by default (Codex F11).
      const cache = mem.lastEnrichment;
      if (cache?.handle && cache.handle === normalizeHandle(cand.instagramHandle)
          && cand.enrichmentStatus === 'none' && cand.followersCount == null) {
        if (cache.followersCount != null) patch.followersCount = cache.followersCount;
        if (cache.isVerified != null) patch.isVerified = cache.isVerified;
        patch.enrichmentStatus = 'cached';
      }
      // Per-row instance updates (≤500, background path) — consistent with the
      // classifier; bucketed VALUES updates are the known lever if this ever
      // needs to be faster.
       
      if (Object.keys(patch).length > 0) await cand.update(patch);
    }
    return resolved;
  }

  /** Latest-intent memory write for a place (no-op when placeId is null or the
   *  memory row was erased). NOT an upsert on purpose: memory rows are born at
   *  materialization; an erased row staying erased is the erasure contract. */
  async function writePlaceMemory(externalPlaceId, patch, transaction) {
    if (!externalPlaceId) return;
    await d.DiscoveryPlaceMemory.update(patch, { where: { externalPlaceId }, transaction });
  }

  /**
   * Batched dedupe: one set-based exact query against live partners (NOT
   * 120×findDuplicates) → existing_partner, then ONE batched pg_trgm fuzzy-name
   * pass over the still-unmatched → possible_duplicate (spec §2.4). NOTE:
   * createPartner only BLOCKS exact duplicates at add-time (potential matches are
   * advisory there), so this fuzzy pass is the only near-match warning the
   * operator gets — it must run whether or not the exact pass hit anything.
   */
  async function classifyAgainstPartners(candidates) {
    const keyed = candidates.map((cand) => ({
      cand,
      phone: normalizePhone(cand.primaryPhone) || null,
      domain: cand.websiteDomain || normalizeDomain(cand.website),
      handle: normalizeHandle(cand.instagramHandle),
      name: normalizeBusinessName(cand.name),
    }));
    const phones = [...new Set(keyed.map((k) => k.phone).filter(Boolean))];
    const domains = [...new Set(keyed.map((k) => k.domain).filter(Boolean))];
    const handles = [...new Set(keyed.map((k) => k.handle).filter(Boolean))];
    const names = [...new Set(keyed.map((k) => k.name).filter(Boolean))];
    if (!phones.length && !domains.length && !handles.length && !names.length) return;

    // ── Exact pass ──
    const or = [];
    if (phones.length) or.push({ primaryPhone: { [Op.in]: phones } });
    if (domains.length) or.push({ websiteDomain: { [Op.in]: domains } });
    if (handles.length) or.push({ instagramHandle: { [Op.in]: handles } });
    if (names.length) or.push({ normalizedName: { [Op.in]: names } });

    const partners = await d.PartnerOrganisation.findAll({
      where: { mergedIntoId: null, archivedAt: null, [Op.or]: or },
      attributes: ['id', 'primaryPhone', 'websiteDomain', 'instagramHandle', 'normalizedName'],
    });

    const exactMatched = new Set();
    if (partners.length > 0) {
      const byPhone = new Map(), byDomain = new Map(), byHandle = new Map(), byName = new Map();
      for (const p of partners) {
        if (p.primaryPhone) byPhone.set(p.primaryPhone, p.id);
        if (p.websiteDomain) byDomain.set(p.websiteDomain, p.id);
        if (p.instagramHandle) byHandle.set(p.instagramHandle, p.id);
        if (p.normalizedName) byName.set(p.normalizedName, p.id);
      }
      for (const k of keyed) {
        const match = (k.phone && byPhone.get(k.phone)) || (k.domain && byDomain.get(k.domain))
          || (k.handle && byHandle.get(k.handle)) || (k.name && byName.get(k.name));
        if (match) {
          await k.cand.update({ dedupeStatus: 'existing_partner', matchedPartnerId: match });
          exactMatched.add(k.cand.id);
        }
      }
    }

    // ── Fuzzy pass (ALWAYS runs — no-exact-hits is its main case) ──
    await fuzzyClassify(keyed.filter((k) => !exactMatched.has(k.cand.id) && k.name));
  }

  /** Batched pg_trgm near-name pass → possible_duplicate. Skips silently when the
   *  extension is unavailable (same non-fatal posture as dedupeService/migration 046
   *  — this is a triage hint, not a gate). */
  async function fuzzyClassify(keyed) {
    if (keyed.length === 0) return;
    if (!(await d.dedupe.trgmAvailable())) return;
    const names = [...new Set(keyed.map((k) => k.name))];
    const rows = await d.sequelize.query(
      `SELECT DISTINCT ON (k.name) k.name AS probe_name, p.id AS partner_id
         FROM unnest(ARRAY[:names]::text[]) AS k(name)
         JOIN partner_organisations p
           ON p."mergedIntoId" IS NULL AND p."archivedAt" IS NULL
          AND p."normalizedName" IS NOT NULL AND p."normalizedName" <> k.name
          AND similarity(p."normalizedName", k.name) >= 0.55
        ORDER BY k.name, similarity(p."normalizedName", k.name) DESC`,
      { replacements: { names }, type: QueryTypes.SELECT },
    );
    if (rows.length === 0) return;
    const byName = new Map(rows.map((r) => [r.probe_name, r.partner_id]));
    for (const k of keyed) {
      const partnerId = byName.get(k.name);
      if (partnerId) {
        await k.cand.update({ dedupeStatus: 'possible_duplicate', matchedPartnerId: partnerId });
      }
    }
  }

  // ── On-demand Instagram enrichment (separate async run) ────────────────
  async function enrichCandidates(candidateIds, user, requestId = null) {
    assertEnabled();
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      throw new AppError('candidateIds is required', 400);
    }
    const c = cfg();

    // Server-side eligibility — never trust the UI's filtering for a paid
    // action: only PENDING candidates with a handle that were never enriched or
    // previously failed are billable. 'pending'-enrichment (in flight),
    // 'enriched' and 'cached' (carried from place memory) are excluded, and so
    // are dismissed/added rows lingering in a stale UI selection (Codex F12).
    const ELIGIBLE = {
      id: { [Op.in]: candidateIds },
      status: 'pending',
      instagramHandle: { [Op.ne]: null },
      enrichmentStatus: { [Op.in]: ['none', 'failed'] },
    };
    // Advisory quota pre-check against the requested ids; the atomic claim
    // below decides what actually gets billed (TOCTOU accepted, as elsewhere).
    const prospective = await d.DiscoveryCandidate.findAll({ where: ELIGIBLE, attributes: ['id', 'instagramHandle'] });
    const handles = [...new Set(prospective.map((x) => x.instagramHandle).filter(Boolean))];
    if (handles.length === 0) {
      throw new AppError('Nothing to enrich — no un-enriched Instagram handles in the selection', 400);
    }

    // Quotas count PROFILES (requestedLimit = handle count per run), excluding
    // runs that never reached Apify. SUM(int) can surface as a bigint string.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const igBase = { provider: 'apify_instagram', createdAt: { [Op.gte]: since }, ...COUNTS_TOWARD_QUOTA };
    const [globalUsedRaw, userUsedRaw] = await Promise.all([
      d.DiscoveryRun.sum('requestedLimit', { where: igBase }),
      d.DiscoveryRun.sum('requestedLimit', { where: { ...igBase, createdBy: user.id } }),
    ]);
    const globalUsed = Number(globalUsedRaw) || 0;
    const userUsed = Number(userUsedRaw) || 0;
    if (userUsed + handles.length > c.enrichMaxPerUserDay) {
      const left = Math.max(0, c.enrichMaxPerUserDay - userUsed);
      throw new AppError(`Daily enrichment limit reached — ${left} profile${left === 1 ? '' : 's'} left today for you`, 429);
    }
    if (globalUsed + handles.length > c.enrichMaxPerDay) {
      const left = Math.max(0, c.enrichMaxPerDay - globalUsed);
      throw new AppError(`Team enrichment limit reached — ${left} profile${left === 1 ? '' : 's'} left today`, 429);
    }

    // Run row FIRST, then the atomic claim: a crash between claim and Apify
    // start leaves a pending run with NULL providerRunId — exactly the shape the
    // stranded-run sweep repairs (targets reset to 'failed').
    const run = await d.DiscoveryRun.create({
      createdBy: user.id, provider: 'apify_instagram', status: 'pending', requestedLimit: 0,
    });
    // Atomic claim — the ONLY transition into enrichment-'pending'. A concurrent
    // duplicate submit claims zero rows and 400s: no double-paid run (Codex F12).
    const [claimed] = await d.sequelize.query(
      `UPDATE discovery_candidates
          SET "enrichmentStatus" = 'pending', "updatedAt" = NOW()
        WHERE id IN (:ids) AND status = 'pending'
          AND "instagramHandle" IS NOT NULL
          AND "enrichmentStatus" IN ('none', 'failed')
        RETURNING id, "instagramHandle"`,
      { replacements: { ids: candidateIds } },
    );
    if (claimed.length === 0) {
      await run.update({ status: 'failed', error: 'nothing eligible to enrich (raced or already handled)' });
      throw new AppError('Nothing to enrich — no un-enriched Instagram handles in the selection', 400);
    }
    const claimedIds = claimed.map((x) => x.id);
    const claimedHandles = [...new Set(claimed.map((x) => x.instagramHandle))];
    await run.update({ requestedLimit: claimedHandles.length, rawPayload: { targetCandidateIds: claimedIds } });

    try {
      // instagram-profile-scraper contract: `usernames` only (one dataset item per
      // profile — username/followersCount/biography/verified, matching the
      // normalizer). resultsType/resultsLimit belong to the OTHER actor.
      const input = { usernames: claimedHandles };
      const started = await d.apify.startRun(c.igActor, input, { webhookUrl: webhookUrl() });
      await run.update({ providerRunId: started.runId, status: 'running', startedAt: new Date() });
    } catch (err) {
      await run.update({ status: 'failed', error: String(err.message).slice(0, 500) });
      await d.DiscoveryCandidate.update({ enrichmentStatus: 'failed' }, { where: { id: { [Op.in]: claimedIds } } });
      throw new AppError(`Could not start enrichment: ${err.message}`, 502);
    }
    await d.audit.recordAuditEvent({
      actorUser: user, action: 'discovery.enrich_started', entityType: 'discovery_run',
      entityId: run.id, after: { count: claimedHandles.length }, requestId,
    });
    return run;
  }

  /** Map IG profiles back to the run's target candidates by handle; fill-blanks only. */
  async function applyEnrichment(run, items) {
    const targetIds = run.rawPayload?.targetCandidateIds || [];
    if (targetIds.length === 0) return;
    const profiles = items.map(normalizeInstagramItem).filter((p) => p && p.instagramHandle);
    const byHandle = new Map(profiles.map((p) => [p.instagramHandle.toLowerCase(), p]));
    const candidates = await d.DiscoveryCandidate.findAll({ where: { id: { [Op.in]: targetIds } } });
    for (const cand of candidates) {
      const p = cand.instagramHandle && byHandle.get(cand.instagramHandle.toLowerCase());
      if (!p) { await cand.update({ enrichmentStatus: 'failed' }); continue; }
      const patch = { enrichmentStatus: 'enriched', enrichedAt: new Date(), enrichmentSource: 'apify_instagram' };
      // Fill-blanks / upgrade only — never blindly overwrite a confident value.
      if (p.followersCount != null) patch.followersCount = p.followersCount;
      if (p.isVerified != null) patch.isVerified = p.isVerified;
      if (p.bio && !cand.bio) patch.bio = p.bio;
      if (p.email && !cand.email) patch.email = p.email;
      // Candidate + memory move together (Codex F10); the cache is built from the
      // post-update effective values (Codex F5).
      await d.sequelize.transaction(async (t) => {
        await cand.update(patch, { transaction: t });
        await writePlaceMemory(cand.externalPlaceId, { lastEnrichment: buildMemoryEnrichment(cand) }, t);
      });
    }
  }

  // ── Convert candidates → partners (bulk, scoped to one run) ────────────
  async function addToPartners(runId, candidateIds, user, requestId = null) {
    assertEnabled();
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      throw new AppError('candidateIds is required', 400);
    }
    const candidates = await d.DiscoveryCandidate.findAll({
      where: { id: { [Op.in]: candidateIds }, discoveryRunId: runId, status: 'pending' },
      include: [{ model: d.DiscoveryRun, as: 'run', attributes: ['category'] }],
    });
    // Soft-report ids that didn't come back (other run / already added or
    // dismissed / nonexistent) — NOT a 400: a candidate legitimately changes
    // status between the UI render and the click.
    const results = {
      added: 0, skipped: 0, failed: 0, errors: [],
      notFound: candidateIds.length - candidates.length,
    };
    for (const cand of candidates) {
      if (cand.dedupeStatus === 'existing_partner') { results.skipped += 1; continue; }
      try {
        const { partner } = await d.partners.createPartner({
          tradingName: cand.name,
          primaryPhone: normalizePhone(cand.primaryPhone) || null,
          website: cand.website || null,
          instagramHandle: cand.instagramHandle || null,
          primaryEmail: cand.email || null,
          category: cand.run?.category || null,
          source: 'discovery',
        }, user, requestId);
        await d.sequelize.transaction(async (t) => {
          await cand.update({ status: 'added', addedPartnerId: partner.id }, { transaction: t });
          // Adding expresses intent — it also overrides any old dismissal.
          await writePlaceMemory(cand.externalPlaceId, { addedPartnerId: partner.id, dismissedAt: null }, t);
        });
        results.added += 1;
      } catch (err) {
        if (err.statusCode === 409 || err.status === 409) {
          // Exact duplicate surfaced at add-time — mark it AND keep the link so
          // the UI badge can still open the existing partner.
          const matchedId = err.data?.duplicates?.exact?.[0]?.partner?.id ?? cand.matchedPartnerId;
          await d.sequelize.transaction(async (t) => {
            await cand.update({ dedupeStatus: 'existing_partner', matchedPartnerId: matchedId }, { transaction: t });
            // The partner exists — repair memory so future births link instantly.
            if (matchedId) await writePlaceMemory(cand.externalPlaceId, { addedPartnerId: matchedId, dismissedAt: null }, t);
          });
          results.skipped += 1;
        } else {
          results.failed += 1;
          if (results.errors.length < 5) results.errors.push(`${cand.name || 'Row'}: ${err.message}`);
        }
      }
    }
    return results;
  }

  /** Resolve an Apify webhook (providerRunId → our run) then process idempotently. */
  async function processByProviderRunId(providerRunId) {
    if (!providerRunId) return;
    const run = await d.DiscoveryRun.findOne({ where: { providerRunId } });
    if (run) await processRun(run.id);
  }

  /** Symmetric + idempotent status flips (double-click/undo safe): dismiss only
   *  moves pending→dismissed, restore only dismissed→pending; anything else
   *  no-ops. Memory records the LATEST human action on the place, whichever
   *  run's copy was touched; other runs' copies keep their local row status —
   *  only FUTURE births consult memory (plan §5, Codex F6/F10). */
  async function dismissCandidate(candidateId, _user) {
    const cand = await d.DiscoveryCandidate.findByPk(candidateId);
    if (!cand) throw new AppError('Candidate not found', 404);
    if (cand.status === 'pending') {
      await d.sequelize.transaction(async (t) => {
        await cand.update({ status: 'dismissed' }, { transaction: t });
        await writePlaceMemory(cand.externalPlaceId, { dismissedAt: new Date() }, t);
      });
    }
    return cand;
  }

  async function restoreCandidate(candidateId, _user) {
    const cand = await d.DiscoveryCandidate.findByPk(candidateId);
    if (!cand) throw new AppError('Candidate not found', 404);
    if (cand.status === 'dismissed') {
      await d.sequelize.transaction(async (t) => {
        await cand.update({ status: 'pending' }, { transaction: t });
        await writePlaceMemory(cand.externalPlaceId, { dismissedAt: null }, t);
      });
    }
    return cand;
  }

  // ── Reads for the UI ───────────────────────────────────────────────────
  async function listRuns({ limit = 20 } = {}) {
    return d.DiscoveryRun.findAll({
      where: { provider: 'apify_google_maps' },
      order: [['createdAt', 'DESC']], limit,
    });
  }

  async function getRunWithCandidates(runId) {
    const run = await d.DiscoveryRun.findByPk(runId);
    if (!run) throw new AppError('Run not found', 404);
    // Dismissed rows are INCLUDED — the client hides them behind a Hidden(N)
    // segment with per-row Restore, so a memory auto-dismissal is always
    // reachable/undoable (Codex F7).
    const candidates = await d.DiscoveryCandidate.findAll({
      where: { discoveryRunId: runId },
      order: [
        d.sequelize.literal('"followersCount" DESC NULLS LAST'),
        d.sequelize.literal('"reviewsCount" DESC NULLS LAST'),
      ],
    });
    return { run, candidates };
  }

  // ── Reconciliation: re-drive runs whose webhook never landed ───────────
  async function reconcileStuckRuns() {
    if (!cfg().enabled) return { checked: 0, stranded: 0 };
    const cutoff = new Date(Date.now() - cfg().reconcileStuckMinutes * 60 * 1000);
    const stuck = await d.DiscoveryRun.findAll({
      where: {
        status: { [Op.in]: ['pending', 'running'] },
        providerRunId: { [Op.ne]: null },
        startedAt: { [Op.lt]: cutoff },
      },
      limit: 25,
    });
    for (const run of stuck) {
      try { await processRun(run.id); }
      catch (err) { d.logger.error('discovery.reconcile.failed', { runId: run.id, error: err.message }); }
    }

    // Stranded starts: crashed between DiscoveryRun.create and the post-startRun
    // update, so there's no providerRunId to reconcile against — without this
    // sweep they sit 'pending' forever (and, once failed, stop counting toward
    // quota via COUNTS_TOWARD_QUOTA). Candidates first, run last (same crash-safe
    // ordering as processRun).
    const stranded = await d.DiscoveryRun.findAll({
      where: { status: 'pending', providerRunId: null, createdAt: { [Op.lt]: cutoff } },
      limit: 25,
    });
    for (const run of stranded) {
      try {
        if (run.provider === 'apify_instagram') {
          const targetIds = run.rawPayload?.targetCandidateIds || [];
          if (targetIds.length > 0) {
            await d.DiscoveryCandidate.update(
              { enrichmentStatus: 'failed' },
              { where: { id: { [Op.in]: targetIds }, enrichmentStatus: 'pending' } },
            );
          }
        }
        await run.update({
          status: 'failed', completedAt: new Date(),
          error: 'never started — no provider run id recorded',
        });
      } catch (err) {
        d.logger.error('discovery.reconcile.stranded_failed', { runId: run.id, error: err.message });
      }
    }
    return { checked: stuck.length, stranded: stranded.length };
  }

  // ── Retention purge (PDPA posture, spec §6) ────────────────────────────
  /**
   * Scraped candidate data expires after DISCOVERY_CANDIDATE_TTL_DAYS (0 = off).
   * pending/dismissed rows are deleted outright. 'added' rows are the provenance
   * chain (run → candidate → addedPartnerId), so the row survives but the
   * contact-ish PII is stripped (rawPayload, bio, email, primaryPhone, address);
   * the partner record owns the live contact data. name/website/handle/sourceUrl/
   * rating stay — public business facts that keep the provenance row legible.
   *
   * Direct set-based statements over candidates joined to expired runs — the old
   * expired-run batch (LIMIT 200, no order, no processed marker) could starve:
   * already-purged runs stayed eligible and re-occupied every batch (Codex F13).
   *
   * discovery_place_memory rows are NOT purged: they hold no scraped contact
   * data by construction (buildMemoryEnrichment whitelist); erasure requests
   * are honored by deleting the memory row for a place id.
   */
  async function purgeExpiredCandidates() {
    const c = cfg();
    if (!c.candidateTtlDays || c.candidateTtlDays <= 0) return { deleted: 0, stripped: 0 };
    const cutoff = new Date(Date.now() - c.candidateTtlDays * 24 * 60 * 60 * 1000);

    const [, delMeta] = await d.sequelize.query(
      `DELETE FROM discovery_candidates c
        USING discovery_runs r
        WHERE c."discoveryRunId" = r.id
          AND r."completedAt" < :cutoff
          AND c.status IN ('pending', 'dismissed')`,
      { replacements: { cutoff } },
    );
    const [, stripMeta] = await d.sequelize.query(
      `UPDATE discovery_candidates c
          SET "rawPayload" = NULL, bio = NULL, email = NULL,
              "primaryPhone" = NULL, address = NULL, "updatedAt" = NOW()
         FROM discovery_runs r
        WHERE c."discoveryRunId" = r.id
          AND r."completedAt" < :cutoff
          AND c.status = 'added'
          AND (c."rawPayload" IS NOT NULL OR c.bio IS NOT NULL OR c.email IS NOT NULL
               OR c."primaryPhone" IS NOT NULL OR c.address IS NOT NULL)`,
      { replacements: { cutoff } },
    );
    const deleted = Number(delMeta?.rowCount ?? 0);
    const stripped = Number(stripMeta?.rowCount ?? 0);
    if (deleted > 0 || stripped > 0) {
      const memoryRows = await d.DiscoveryPlaceMemory.count();
      d.logger.info('discovery.purge', { deleted, stripped, memoryRows, ttlDays: c.candidateTtlDays });
    }
    return { deleted, stripped };
  }

  return {
    startDiscovery, processRun, processByProviderRunId, enrichCandidates, addToPartners,
    dismissCandidate, restoreCandidate, listRuns, getRunWithCandidates, getQuota,
    reconcileStuckRuns, purgeExpiredCandidates,
    verifyWebhookSecret, classifyAgainstPartners, materializeCandidates, applyEnrichment,
    applyPlaceMemory, buildMemoryEnrichment,
  };
}

const _default = makeDiscoveryService();
export default _default;
