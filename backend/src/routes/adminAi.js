import express from 'express';
import rateLimit from 'express-rate-limit';
import Joi from 'joi';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import * as aiController from '../controllers/aiController.js';

export const meta = { path: '/api/admin/ai' };

const router = express.Router();
router.use(authenticateToken, requireAdmin);

const aiGenerationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 10000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many AI requests. Try again in a minute.' },
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

router.get('/settings', aiController.getSettings);
router.put('/settings', validate(settingsSchema, { stripUnknown: true }), aiController.updateSettings);
router.post('/providers/:provider/test', aiGenerationLimiter, aiController.testProvider);
router.post('/guided-review/draft', aiGenerationLimiter, validate(briefSchema, { stripUnknown: true }), aiController.generateGuidedReview);

export default router;
