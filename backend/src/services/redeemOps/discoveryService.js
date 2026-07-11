import { Op, QueryTypes } from 'sequelize';
import crypto from 'crypto';
import { DiscoveryRun, DiscoveryCandidate, PartnerOrganisation, sequelize } from '../../models/index.js';
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
    maxResultsPerRun: Number(process.env.DISCOVERY_MAX_RESULTS_PER_RUN || 120),
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
    DiscoveryRun, DiscoveryCandidate, PartnerOrganisation, sequelize, logger,
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
    await classifyAgainstPartners(candidates);
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

    // Server-side eligibility — never trust the UI's filtering for a paid action:
    // only never-enriched or previously-failed candidates are billable again.
    // 'pending' (a run is already in flight) and 'enriched' are excluded, which
    // makes double-submits and re-enrichment no-ops by construction.
    const candidates = await d.DiscoveryCandidate.findAll({
      where: {
        id: { [Op.in]: candidateIds },
        instagramHandle: { [Op.ne]: null },
        enrichmentStatus: { [Op.in]: ['none', 'failed'] },
      },
    });
    const handles = [...new Set(candidates.map((x) => x.instagramHandle).filter(Boolean))];
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

    const run = await d.DiscoveryRun.create({
      createdBy: user.id, provider: 'apify_instagram', status: 'pending',
      requestedLimit: handles.length, rawPayload: { targetCandidateIds: candidates.map((x) => x.id) },
    });
    await d.DiscoveryCandidate.update({ enrichmentStatus: 'pending' }, { where: { id: { [Op.in]: candidates.map((x) => x.id) } } });

    try {
      // instagram-profile-scraper contract: `usernames` only (one dataset item per
      // profile — username/followersCount/biography/verified, matching the
      // normalizer). resultsType/resultsLimit belong to the OTHER actor.
      const input = { usernames: handles };
      const started = await d.apify.startRun(c.igActor, input, { webhookUrl: webhookUrl() });
      await run.update({ providerRunId: started.runId, status: 'running', startedAt: new Date() });
    } catch (err) {
      await run.update({ status: 'failed', error: String(err.message).slice(0, 500) });
      await d.DiscoveryCandidate.update({ enrichmentStatus: 'failed' }, { where: { id: { [Op.in]: candidates.map((x) => x.id) } } });
      throw new AppError(`Could not start enrichment: ${err.message}`, 502);
    }
    await d.audit.recordAuditEvent({
      actorUser: user, action: 'discovery.enrich_started', entityType: 'discovery_run',
      entityId: run.id, after: { count: handles.length }, requestId,
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
      await cand.update(patch);
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
        await cand.update({ status: 'added', addedPartnerId: partner.id });
        results.added += 1;
      } catch (err) {
        if (err.statusCode === 409 || err.status === 409) {
          // Exact duplicate surfaced at add-time — mark it AND keep the link so
          // the UI badge can still open the existing partner.
          await cand.update({
            dedupeStatus: 'existing_partner',
            matchedPartnerId: err.data?.duplicates?.exact?.[0]?.partner?.id ?? cand.matchedPartnerId,
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
   *  moves pending→dismissed, restore only dismissed→pending; anything else no-ops. */
  async function dismissCandidate(candidateId, _user) {
    const cand = await d.DiscoveryCandidate.findByPk(candidateId);
    if (!cand) throw new AppError('Candidate not found', 404);
    if (cand.status === 'pending') await cand.update({ status: 'dismissed' });
    return cand;
  }

  async function restoreCandidate(candidateId, _user) {
    const cand = await d.DiscoveryCandidate.findByPk(candidateId);
    if (!cand) throw new AppError('Candidate not found', 404);
    if (cand.status === 'dismissed') await cand.update({ status: 'pending' });
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
    const candidates = await d.DiscoveryCandidate.findAll({
      where: { discoveryRunId: runId, status: { [Op.ne]: 'dismissed' } },
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
   * Two-step by run ids (Sequelize can't join-scope bulk destroy/update).
   */
  async function purgeExpiredCandidates() {
    const c = cfg();
    if (!c.candidateTtlDays || c.candidateTtlDays <= 0) return { deleted: 0, stripped: 0 };
    const cutoff = new Date(Date.now() - c.candidateTtlDays * 24 * 60 * 60 * 1000);
    const expiredRuns = await d.DiscoveryRun.findAll({
      where: { completedAt: { [Op.lt]: cutoff } },
      attributes: ['id'], limit: 200,
    });
    if (expiredRuns.length === 0) return { deleted: 0, stripped: 0 };
    const runIds = expiredRuns.map((r) => r.id);

    const deleted = await d.DiscoveryCandidate.destroy({
      where: { discoveryRunId: { [Op.in]: runIds }, status: { [Op.in]: ['pending', 'dismissed'] } },
    });
    const [stripped] = await d.DiscoveryCandidate.update(
      { rawPayload: null, bio: null, email: null, primaryPhone: null, address: null },
      {
        where: {
          discoveryRunId: { [Op.in]: runIds }, status: 'added',
          // Skip rows already stripped so repeat sweeps stay cheap + idempotent.
          [Op.or]: [
            { rawPayload: { [Op.ne]: null } }, { bio: { [Op.ne]: null } },
            { email: { [Op.ne]: null } }, { primaryPhone: { [Op.ne]: null } },
            { address: { [Op.ne]: null } },
          ],
        },
      },
    );
    if (deleted > 0 || stripped > 0) {
      d.logger.info('discovery.purge', { deleted, stripped, ttlDays: c.candidateTtlDays });
    }
    return { deleted, stripped };
  }

  return {
    startDiscovery, processRun, processByProviderRunId, enrichCandidates, addToPartners,
    dismissCandidate, restoreCandidate, listRuns, getRunWithCandidates, getQuota,
    reconcileStuckRuns, purgeExpiredCandidates,
    verifyWebhookSecret, classifyAgainstPartners, materializeCandidates, applyEnrichment,
  };
}

const _default = makeDiscoveryService();
export default _default;
