import express from 'express';
import Joi from 'joi';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { BRIEF_PRODUCT_IDS } from '../utils/campaignBrief.js';
import { SCORING_CONFIG_STATUSES } from '../utils/scoringConfigValidation.js';
import { getActiveScoringConfig, resolveScoringConfigStrict } from '../services/consumerScoringService.js';
import { DEFAULT_SCORING_CONFIG, DEFAULT_LEAD_COMPONENTS, normalizeConfig } from '../utils/consumerScoring.js';
import { sequelize } from '../models/index.js';
import {
  listScoringConfigs, getScoringConfig, createDraftConfig, approveScoringConfig,
  simulateConfig, proposeScoringConfig, scoringProgressForCampaign, MAX_DESCRIPTION_CHARS,
  SIMULATION_SAMPLE_MAX,
} from '../services/scoringConfigService.js';

/**
 * Scoring-config administration
 * (docs/plans/per-campaign-lead-scoring.md §8, §9; PR D).
 *
 * ADMIN ONLY, and DARK BY DEFAULT. These endpoints author the rules that score
 * every lead in the system, and /propose spends money at a provider.
 * `SCORING_CONFIG_ADMIN_ENABLED` is the switch; until it is 'true' the router
 * is never mounted (routes/index.js) and every path here 404s.
 *
 * THE ORDER IS THE POINT: propose (or draft) → simulate → approve. Nothing in
 * this file makes a config live except the explicit approve call — a draft is
 * invisible to the resolver by construction, which is what makes storing an AI
 * proposal safe in the first place.
 *
 * Joi here gives live requests loud 400s with field detail. The BINDING
 * validation is scoringConfigValidation.validateScoringConfig, re-run inside
 * the service on every write; `validate()` in this codebase checks req.body
 * only, so params and query are parsed explicitly below.
 */

export const meta = {
  path: '/api/admin/scoring-configs',
  flag: 'SCORING_CONFIG_ADMIN_ENABLED',
  flagDefault: 'false',
};

const router = express.Router();

router.use(authenticateToken, requireAdmin);

const uuid = Joi.string().uuid();
const productKey = Joi.string().valid(...BRIEF_PRODUCT_IDS);

const draftSchema = Joi.object({
  campaignId: uuid.allow(null),
  productKey: productKey.allow(null),
  // Deliberately a bare object: the config vocabulary lives in ONE place
  // (scoringConfigValidation), and a second, thinner schema here would drift
  // and start rejecting configs the scorer accepts. The one-scope rule is
  // likewise left to the service, which answers with a sentence rather than a
  // constraint name.
  config: Joi.object().required(),
  // The editor's door (§4.1): treat `config` as a patch composed server-side
  // onto the currently-winning RAW document.
  composeOnResolved: Joi.boolean(),
});

const approveSchema = Joi.object({
  // REQUIRED integer ≥ 0 — 0 is the legitimate "house default was live"
  // baseline (round-3 B3). The optimistic-concurrency half of §4.5.
  expectedLiveVersion: Joi.number().integer().min(0).required(),
});

const simulateSchema = Joi.object({
  compareTo: Joi.string().valid('stored', 'resolved'),
  sampleMax: Joi.number().integer().min(1).max(SIMULATION_SAMPLE_MAX),
});

const proposeSchema = Joi.object({
  campaignId: uuid.allow(null),
  productKey: productKey.allow(null),
  description: Joi.string().allow('').max(MAX_DESCRIPTION_CHARS),
});

/** `version` is the primary key; a non-integer is a 400, not a 404 hunt. */
function versionOf(req) {
  const n = Number(req.params.version);
  if (!Number.isInteger(n) || n < 1) throw new AppError('version must be a positive integer.', 400);
  return n;
}

/** UUID shape enforced at the boundary — an invalid id is a 400 sentence,
 *  never a Postgres cast error five layers down (round-2 B8). */
function uuidQuery(req, name) {
  const v = req.query[name];
  if (v === undefined || v === null || v === '') return null;
  const { error } = uuid.validate(v);
  if (error) throw new AppError(`${name} must be a UUID.`, 400);
  return v;
}

/** Everything authored so far, newest first — scope-filterable (§4.6). */
router.get('/', asyncHandler(async (req, res) => {
  const { status, limit, productKey: pk, global } = req.query;
  if (status && !SCORING_CONFIG_STATUSES.includes(status)) {
    throw new AppError(`status must be one of: ${SCORING_CONFIG_STATUSES.join(', ')}.`, 400);
  }
  if (pk && !BRIEF_PRODUCT_IDS.includes(pk)) {
    throw new AppError(`productKey must be one of: ${BRIEF_PRODUCT_IDS.join(', ')}.`, 400);
  }
  const rows = await listScoringConfigs({
    status: status || null,
    limit: Number(limit) || 50,
    campaignId: uuidQuery(req, 'campaignId'),
    productKey: pk || null,
    global: global === '1' || global === 'true',
  });
  res.json({ success: true, data: rows });
}));

/**
 * What a given scope resolves to RIGHT NOW, and which tier won. This is the
 * answer to "why did this lead score like that" without re-deriving the
 * resolution by hand.
 *
 * `?strict=1` is the EDITOR's variant (§4.2): direct DB (no cache in either
 * direction), 5xx on read failure instead of silent defaults, and the payload
 * grows the activation metadata the panel captions (activatedAt, actorName)
 * plus `houseDefault` — the server-owned ghost/reset values (round-2 B12).
 */
router.get('/resolve', asyncHandler(async (req, res) => {
  const campaignId = uuidQuery(req, 'campaignId');
  const { productKey: pk = null, strict } = req.query;
  if (campaignId && pk) {
    throw new AppError('Resolve one scope at a time: campaignId or productKey, not both.', 400);
  }
  if (pk && !BRIEF_PRODUCT_IDS.includes(pk)) {
    throw new AppError(`productKey must be one of: ${BRIEF_PRODUCT_IDS.join(', ')}.`, 400);
  }
  if (strict === '1' || strict === 'true') {
    const resolved = await resolveScoringConfigStrict({ campaignId, productKey: pk });
    let actorName = null;
    if (resolved.actorUserId) {
      const [[u]] = await sequelize.query(
        `SELECT NULLIF(TRIM(COALESCE("firstName", '') || ' ' || COALESCE("lastName", '')), '') AS name
           FROM users WHERE id = :id`,
        { replacements: { id: resolved.actorUserId } }
      );
      actorName = u?.name || null;
    }
    res.json({
      success: true,
      data: {
        version: resolved.version,
        scope: resolved.scope,
        // leadComponents defaulted the way normalizeLeadConfig defaults them
        // for the scorer — the editor's ghosts must show what actually scores,
        // and DEFAULT_SCORING_CONFIG carries no leadComponents key.
        config: {
          ...resolved.config,
          leadComponents: { ...DEFAULT_LEAD_COMPONENTS, ...(resolved.config.leadComponents || {}) },
        },
        raw: resolved.raw,
        activatedAt: resolved.activatedAt,
        actorName,
        houseDefault: {
          ...normalizeConfig(DEFAULT_SCORING_CONFIG),
          leadComponents: DEFAULT_LEAD_COMPONENTS,
        },
      },
    });
    return;
  }
  const resolved = await getActiveScoringConfig({ campaignId, productKey: pk });
  res.json({ success: true, data: resolved });
}));

/**
 * Regrade progress for one campaign (§4.8). REGISTERED BEFORE /:version —
 * Express would otherwise read "progress" as a version number (round-3 B3).
 */
router.get('/progress', asyncHandler(async (req, res) => {
  const campaignId = uuidQuery(req, 'campaignId');
  if (!campaignId) throw new AppError('campaignId is required.', 400);
  res.json({ success: true, data: await scoringProgressForCampaign(campaignId) });
}));

router.get('/:version', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getScoringConfig(versionOf(req)) });
}));

/** Hand-authored draft. Same validation path as the AI's output — there is no
 *  door into this table that skips the semantic invariants. */
router.post('/', validate(draftSchema), asyncHandler(async (req, res) => {
  const draft = await createDraftConfig({
    config: req.body.config,
    campaignId: req.body.campaignId || null,
    productKey: req.body.productKey || null,
    actorUserId: req.user?.id || null,
    composeOnResolved: req.body.composeOnResolved === true,
  });
  res.status(201).json({ success: true, data: draft });
}));

/**
 * AI authoring. Returns the stored DRAFT, the model's rationale, and a
 * simulation of what approving it would do — so the approver never has to ask
 * for the distribution separately.
 */
router.post('/propose', validate(proposeSchema), asyncHandler(async (req, res) => {
  const result = await proposeScoringConfig({
    campaignId: req.body.campaignId || null,
    productKey: req.body.productKey || null,
    description: req.body.description || '',
    actorUserId: req.user?.id || null,
  });
  res.status(201).json({ success: true, data: result });
}));

/**
 * The distribution diff for an existing draft, against the population that
 * draft's own scope governs. Writes nothing. `compareTo:'resolved'` re-scores
 * the current config beside the draft at one fixed now (§4.3) so the delta is
 * the config's doing, not drift.
 */
router.post('/:version/simulate', validate(simulateSchema), asyncHandler(async (req, res) => {
  const row = await getScoringConfig(versionOf(req));
  const simulation = await simulateConfig({
    config: row.configJson,
    campaignId: row.campaignId,
    productKey: row.productKey,
    compareTo: req.body?.compareTo || 'stored',
    ...(req.body?.sampleMax ? { sampleMax: req.body.sampleMax } : {}),
  });
  res.json({ success: true, data: simulation });
}));

/**
 * The only door that makes a config live. The no-op branch (§4.6) answers 200
 * with `{ noOp: true, live, candidateVersion }` — the UI must say "already
 * live — nothing changed", never imply an activation or a regrade.
 */
router.post('/:version/approve', validate(approveSchema), asyncHandler(async (req, res) => {
  const approved = await approveScoringConfig(versionOf(req), {
    actorUserId: req.user?.id || null,
    expectedLiveVersion: req.body.expectedLiveVersion,
  });
  res.json({ success: true, data: approved });
}));

export default router;
