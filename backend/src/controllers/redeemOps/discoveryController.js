import Joi from 'joi';
import { asyncHandler, AppError } from '../../middleware/errorHandler.js';
import discoveryService from '../../services/redeemOps/discoveryService.js';
import { logger } from '../../utils/logger.js';

const startSchema = Joi.object({
  category: Joi.string().min(1).max(64).required(),
  area: Joi.string().min(1).max(120).required(),
  limit: Joi.number().integer().min(1).max(500),
});
const idsSchema = Joi.object({
  candidateIds: Joi.array().items(Joi.string().uuid()).min(1).required(),
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
  res.json({ success: true, data: { runs, quota } });
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

/** POST /discovery/runs/:id/add — bulk-add selected candidates as partners. */
export const addToPartners = asyncHandler(async (req, res) => {
  const { error, value } = idsSchema.validate(req.body, { abortEarly: false });
  if (error) throw new AppError(error.details.map((x) => x.message).join(', '), 400);
  const results = await discoveryService.addToPartners(value.candidateIds, req.user, req.id);
  res.json({ success: true, data: results });
});

/** PATCH /discovery/candidates/:id — dismiss. */
export const dismissCandidate = asyncHandler(async (req, res) => {
  await discoveryService.dismissCandidate(req.params.id, req.user);
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
