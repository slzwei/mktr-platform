import express from 'express';
import rateLimit from 'express-rate-limit';
import Joi from 'joi';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import * as aiController from '../controllers/aiController.js';
import { TEMPLATE_IDS } from '../utils/designConfigV2.js';

export const meta = { path: '/api/admin/ai' };

const router = express.Router();
router.use(authenticateToken, requireAdmin);

const aiGenerationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 10000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Studio PR 4: the 429 body carries retryAfterSec (under data — the api
  // client exposes only body.data on errors) so the Studio panel can count
  // down. Shared budget across every AI generation route, per CO-1.
  handler: (req, res) => {
    const resetTime = req.rateLimit?.resetTime instanceof Date ? req.rateLimit.resetTime.getTime() : null;
    const retryAfterSec = resetTime ? Math.max(1, Math.ceil((resetTime - Date.now()) / 1000)) : 60;
    res.status(429).json({
      success: false,
      message: 'Too many AI requests. Try again in a minute.',
      data: { retryAfterSec },
    });
  },
});

const settingsSchema = Joi.object({
  defaultProvider: Joi.string().valid('openai', 'anthropic').required(),
  openaiModel: Joi.string().trim().min(2).max(100).required(),
  anthropicModel: Joi.string().trim().min(2).max(100).required(),
  openaiApiKey: Joi.string().trim().min(20).max(500).allow('').optional(),
  anthropicApiKey: Joi.string().trim().min(20).max(500).allow('').optional(),
  clearOpenaiKey: Joi.boolean().default(false),
  clearAnthropicKey: Joi.boolean().default(false),
  globalGuardrails: Joi.string().allow('').max(8000).required(),
  workstylePreferences: Joi.string().allow('').max(8000).required(),
});

const briefSchema = Joi.object({
  provider: Joi.string().valid('openai', 'anthropic').optional(),
  topic: Joi.string().trim().min(3).max(1000).required(),
  audience: Joi.string().trim().allow('').max(1000).default(''),
  objective: Joi.string().trim().allow('').max(1000).default(''),
  mustInclude: Joi.string().trim().allow('').max(3000).default(''),
});

// New-campaign Details "Fill it for me" (workspace create flow, every type;
// 'lucky_draw' is the create-flow pseudo-type → draw fields included).
const detailsDraftSchema = Joi.object({
  type: Joi.string()
    .valid('lead_generation', 'quiz', 'guided_review', 'brand_awareness', 'product_promotion', 'event_marketing', 'lucky_draw')
    .default('lead_generation'),
  brief: Joi.string().trim().min(5).max(2000).required(),
});

// Campaign Studio copy assist (Studio PR 4, spec §05/CO-1). No provider field:
// the provider comes from admin AI Settings. Joi failures are 400s (house
// validate middleware); the semantic scope-not-allowed check is a service 422.
const copyDraftSchema = Joi.object({
  campaignId: Joi.string().uuid().required(),
  templateId: Joi.string().valid(...TEMPLATE_IDS).required(),
  mode: Joi.string().valid('copy', 'full').required(),
  scope: Joi.string().trim().max(80).allow(null).optional(),
  regen: Joi.number().integer().min(0).max(50).default(0),
  brief: Joi.object({
    topic: Joi.string().trim().min(3).max(1000).required(),
    audience: Joi.string().trim().allow('').max(1000).default(''),
    objective: Joi.string().trim().allow('').max(1000).default(''),
    mustInclude: Joi.string().trim().allow('').max(3000).default(''),
    tone: Joi.string().valid('Friendly', 'Formal', 'Urgent', 'Playful').default('Friendly'),
  }).required(),
});

router.get('/settings', aiController.getSettings);
router.put('/settings', validate(settingsSchema, { stripUnknown: true }), aiController.updateSettings);
router.post('/providers/:provider/test', aiGenerationLimiter, aiController.testProvider);
router.post('/guided-review/draft', aiGenerationLimiter, validate(briefSchema, { stripUnknown: true }), aiController.generateGuidedReview);
router.post('/copy-draft', aiGenerationLimiter, validate(copyDraftSchema, { stripUnknown: true }), aiController.generateCampaignCopy);
router.post('/details-draft', aiGenerationLimiter, validate(detailsDraftSchema, { stripUnknown: true }), aiController.generateCampaignDetails);

export default router;
