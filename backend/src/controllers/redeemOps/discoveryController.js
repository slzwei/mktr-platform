import Joi from 'joi';
import { asyncHandler, AppError } from '../../middleware/errorHandler.js';
import discoveryService, { cfg } from '../../services/redeemOps/discoveryService.js';
import discoveryAiService from '../../services/redeemOps/discoveryAiService.js';
import { logger } from '../../utils/logger.js';

const startSchema = Joi.object({
  category: Joi.string().max(64).allow(''), // optional — ad-hoc terms/hashtags can stand in
  area: Joi.string().min(1).max(120).required(),
  limit: Joi.number().integer().min(1).max(500), // sanity bound; service clamps to DISCOVERY_MAX_RESULTS_PER_RUN
  // Mechanism pick; omitted = Maps. The IG pilot additionally needs DISCOVERY_IG_ENABLED.
  provider: Joi.string().valid('google_maps', 'instagram_hashtag'),
  // Ad-hoc, type-and-go overrides of the category's saved terms/hashtags.
  searchTerms: Joi.array().items(Joi.string().min(1).max(64)).max(20), // Maps override
  hashtags: Joi.array().items(Joi.string().min(1).max(64)).max(20), // Instagram override
  // Maps quality inputs (actor-native — filter before paying). Empty/absent = no filter.
  minStars: Joi.string().valid('', 'three', 'threeAndHalf', 'four', 'fourAndHalf'),
  skipClosed: Joi.boolean(),
  // Ad-hoc Google Maps category allowlist (actor `categoryFilterWords`) — keeps
  // only places whose category matches, overriding the category's saved words.
  categoryFilterWords: Joi.array().items(Joi.string().min(1).max(64)).max(20),
});
const idsSchema = Joi.object({
  // .max(500): each id can become a PAID scrape — sanity-bound to one full run's
  // worth; the real spend limiter is the profile quota (per-user + team per day),
  // which rejects over-budget calls with the remaining count in the message.
  candidateIds: Joi.array().items(Joi.string().uuid()).min(1).max(500).required(),
});
const candidatePatchSchema = Joi.object({
  // Empty body = dismiss, preserving the pre-restore client contract.
  action: Joi.string().valid('dismiss', 'restore').default('dismiss'),
});
const suggestSchema = Joi.object({
  description: Joi.string().trim().min(3).max(500).required(),
  // Same mechanism enum the start endpoint uses — picks terms vs hashtags output.
  provider: Joi.string().valid('google_maps', 'instagram_hashtag').default('google_maps'),
  // Bounded because it is serialized into the LLM prompt (mirrors startSchema's cap).
  area: Joi.string().trim().max(120).allow(''),
});

/** POST /discovery/runs — start an Apify search. */
export const startDiscovery = asyncHandler(async (req, res) => {
  const { error, value } = startSchema.validate(req.body, { abortEarly: false });
  if (error) throw new AppError(error.details.map((x) => x.message).join(', '), 400);
  const run = await discoveryService.startDiscovery(value, req.user, req.id);
  res.status(202).json({ success: true, data: { run } });
});

/** GET /discovery/runs — recent searches + the caller's remaining daily budget. */
export const listRuns = asyncHandler(async (req, res) => {
  const [runs, quota] = await Promise.all([
    discoveryService.listRuns({ limit: Math.min(Number(req.query.limit) || 20, 50) }),
    discoveryService.getQuota(req.user),
  ]);
  // igEnabled drives the Discover Provider toggle: the Instagram option only
  // appears when the pilot flag is on (else the toggle would 503 on submit).
  const c = cfg();
  res.json({
    success: true,
    data: {
      runs,
      quota,
      igEnabled: c.igEnabled,
      // Drives the AI-assist row on Discover; both flags must be on, matching
      // what the suggest endpoint will actually allow.
      aiEnabled: c.enabled && c.aiTermsEnabled,
    },
  });
});

/** POST /discovery/suggest-terms — free-text description → AI-suggested search
 *  terms (Maps) or hashtags (IG). Populates the input only; never starts a run. */
export const suggestTerms = asyncHandler(async (req, res) => {
  const { error, value } = suggestSchema.validate(req.body, { abortEarly: false });
  if (error) throw new AppError(error.details.map((x) => x.message).join(', '), 400);
  const { terms, categories } = await discoveryAiService.suggestTerms(value, req.user, req.id);
  res.json({ success: true, data: { terms, categories } });
});

/** GET /discovery/runs/:id — status + candidates (frontend polls this). */
export const getRun = asyncHandler(async (req, res) => {
  const { run, candidates } = await discoveryService.getRunWithCandidates(req.params.id);
  res.json({ success: true, data: { run, candidates } });
});

/** POST /discovery/candidates/enrich — on-demand Instagram enrichment. */
export const enrichCandidates = asyncHandler(async (req, res) => {
  const { error, value } = idsSchema.validate(req.body, { abortEarly: false });
  if (error) throw new AppError(error.details.map((x) => x.message).join(', '), 400);
  const run = await discoveryService.enrichCandidates(value.candidateIds, req.user, req.id);
  res.status(202).json({ success: true, data: { run } });
});

/** POST /discovery/runs/:id/add — bulk-add selected candidates as partners (scoped to the run). */
export const addToPartners = asyncHandler(async (req, res) => {
  const { error, value } = idsSchema.validate(req.body, { abortEarly: false });
  if (error) throw new AppError(error.details.map((x) => x.message).join(', '), 400);
  const results = await discoveryService.addToPartners(req.params.id, value.candidateIds, req.user, req.id);
  res.json({ success: true, data: results });
});

/** PATCH /discovery/candidates/:id — dismiss (default, matches the old empty-body call) or restore. */
export const dismissCandidate = asyncHandler(async (req, res) => {
  const { error, value } = candidatePatchSchema.validate(req.body || {}, { abortEarly: false });
  if (error) throw new AppError(error.details.map((x) => x.message).join(', '), 400);
  if (value.action === 'restore') {
    await discoveryService.restoreCandidate(req.params.id, req.user);
  } else {
    await discoveryService.dismissCandidate(req.params.id, req.user);
  }
  res.json({ success: true });
});

/**
 * POST /discovery/webhook/:secret — Apify terminal-event callback.
 * Auth = URL secret only (Apify doesn't sign). We ack fast, then re-fetch the run
 * from Apify and process idempotently in the background; reconciliation covers any miss.
 */
export const webhook = asyncHandler(async (req, res) => {
  if (!discoveryService.verifyWebhookSecret(req.params.secret)) {
    throw new AppError('Invalid webhook secret', 401);
  }
  const providerRunId = req.body?.eventData?.actorRunId || req.body?.resource?.id || null;
  res.json({ success: true }); // ack immediately so Apify doesn't retry-storm
  if (providerRunId) {
    discoveryService.processByProviderRunId(providerRunId)
      .catch((err) => logger.error('discovery.webhook.process_failed', { providerRunId, error: err.message }));
  }
});
