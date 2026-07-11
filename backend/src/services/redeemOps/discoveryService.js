import { Op } from 'sequelize';
import crypto from 'crypto';
import { DiscoveryRun, DiscoveryCandidate, PartnerOrganisation, sequelize } from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { makePartnerService } from './partnerService.js';
import { makeApifyClient } from './discovery/apifyClient.js';
import { normalizeMapsItem, normalizeInstagramItem } from './discovery/normalizers.js';
import { normalizeBusinessName, normalizeDomain, normalizeHandle } from './normalizers.js';
import { normalizePhone } from '../prospectHelpers.js';

const TERMINAL = ['completed', 'failed', 'aborted', 'timed_out'];

function cfg() {
  return {
    enabled: process.env.DISCOVERY_ENABLED === 'true',
    mapsActor: process.env.APIFY_MAPS_ACTOR_ID || 'compass~crawler-google-places',
    igActor: process.env.APIFY_INSTAGRAM_ACTOR_ID || 'apify~instagram-scraper',
    webhookSecret: process.env.DISCOVERY_WEBHOOK_SECRET || '',
    webhookBase: process.env.DISCOVERY_WEBHOOK_BASE_URL || 'https://api.mktr.sg',
    maxResultsPerRun: Number(process.env.DISCOVERY_MAX_RESULTS_PER_RUN || 120),
    maxRunsPerDay: Number(process.env.DISCOVERY_MAX_RUNS_PER_DAY || 25),
    maxRunsPerUserDay: Number(process.env.DISCOVERY_MAX_RUNS_PER_USER_DAY || 5),
    enrichMaxPerDay: Number(process.env.DISCOVERY_ENRICH_MAX_PER_DAY || 50),
    costPerResultUsd: Number(process.env.DISCOVERY_COST_PER_RESULT_USD || 0.007),
    reconcileStuckMinutes: Number(process.env.DISCOVERY_RECONCILE_STUCK_MINUTES || 10),
  };
}

export function makeDiscoveryService(overrides = {}) {
  const d = {
    DiscoveryRun, DiscoveryCandidate, PartnerOrganisation, sequelize, logger,
    apify: makeApifyClient(),
    partners: makePartnerService(),
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

  async function assertQuota(user) {
    const c = cfg();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const base = { provider: 'apify_google_maps', createdAt: { [Op.gte]: since } };
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
    await assertQuota(user);
    const c = cfg();
    const requestedLimit = Math.min(Math.max(Number(limit) || 60, 1), c.maxResultsPerRun);

    const run = await d.DiscoveryRun.create({
      createdBy: user.id, provider: 'apify_google_maps',
      category: String(category).trim(), area: String(area).trim(),
      requestedLimit, status: 'pending',
      estimatedCostUsd: Number((requestedLimit * c.costPerResultUsd).toFixed(4)),
    });

    try {
      const input = {
        searchStringsArray: [`${category} ${area}`],
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
    const rows = items.map(normalizeMapsItem).filter((r) => r && r.name);
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
   * Batched dedupe: one set-based query against live partners (NOT 120×findDuplicates).
   * Marks exact hits existing_partner + matchedPartnerId; everything else stays 'new'.
   * (createPartner runs the full fuzzy dedupe again at add-time, so a missed fuzzy
   * match here is still caught before a partner is created.)
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

    const or = [];
    if (phones.length) or.push({ primaryPhone: { [Op.in]: phones } });
    if (domains.length) or.push({ websiteDomain: { [Op.in]: domains } });
    if (handles.length) or.push({ instagramHandle: { [Op.in]: handles } });
    if (names.length) or.push({ normalizedName: { [Op.in]: names } });

    const partners = await d.PartnerOrganisation.findAll({
      where: { mergedIntoId: null, archivedAt: null, [Op.or]: or },
      attributes: ['id', 'primaryPhone', 'websiteDomain', 'instagramHandle', 'normalizedName'],
    });
    if (partners.length === 0) return;

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
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const enrichedToday = await d.DiscoveryRun.count({ where: { provider: 'apify_instagram', createdAt: { [Op.gte]: since } } });
    if (enrichedToday >= c.enrichMaxPerDay) throw new AppError('Daily enrichment limit reached', 429);

    const candidates = await d.DiscoveryCandidate.findAll({
      where: { id: { [Op.in]: candidateIds }, instagramHandle: { [Op.ne]: null } },
    });
    const handles = [...new Set(candidates.map((x) => x.instagramHandle).filter(Boolean))];
    if (handles.length === 0) throw new AppError('None of the selected candidates have an Instagram handle', 400);

    const run = await d.DiscoveryRun.create({
      createdBy: user.id, provider: 'apify_instagram', status: 'pending',
      requestedLimit: handles.length, rawPayload: { targetCandidateIds: candidates.map((x) => x.id) },
    });
    await d.DiscoveryCandidate.update({ enrichmentStatus: 'pending' }, { where: { id: { [Op.in]: candidates.map((x) => x.id) } } });

    try {
      const input = { usernames: handles, resultsType: 'details', resultsLimit: 1 };
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
      if (p.bio && !cand.bio) patch.bio = p.bio;
      if (p.email && !cand.email) patch.email = p.email;
      await cand.update(patch);
    }
  }

  // ── Convert candidates → partners (bulk) ───────────────────────────────
  async function addToPartners(candidateIds, user, requestId = null) {
    assertEnabled();
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      throw new AppError('candidateIds is required', 400);
    }
    const candidates = await d.DiscoveryCandidate.findAll({
      where: { id: { [Op.in]: candidateIds }, status: 'pending' },
      include: [{ model: d.DiscoveryRun, as: 'run', attributes: ['category'] }],
    });
    const results = { added: 0, skipped: 0, failed: 0, errors: [] };
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
          // Exact duplicate surfaced at add-time — mark it as such, don't create.
          await cand.update({ dedupeStatus: 'existing_partner' });
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

  async function dismissCandidate(candidateId, _user) {
    const cand = await d.DiscoveryCandidate.findByPk(candidateId);
    if (!cand) throw new AppError('Candidate not found', 404);
    if (cand.status === 'pending') await cand.update({ status: 'dismissed' });
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
    if (!cfg().enabled) return { checked: 0 };
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
    return { checked: stuck.length };
  }

  return {
    startDiscovery, processRun, processByProviderRunId, enrichCandidates, addToPartners,
    dismissCandidate, listRuns, getRunWithCandidates, reconcileStuckRuns, verifyWebhookSecret,
    classifyAgainstPartners, materializeCandidates, applyEnrichment,
  };
}

const _default = makeDiscoveryService();
export default _default;
