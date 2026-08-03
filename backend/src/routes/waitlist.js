import express from 'express';
import Joi from 'joi';
import { makeLimiter } from '../middleware/rateLimiters.js';
import { validate } from '../middleware/validation.js';
import * as waitlistController from '../controllers/waitlistController.js';

// Auto-discovered + mounted by routes/index.js via this meta export.
export const meta = {
  // Public routes (default-deny routing): public waitlist form
  public: ['POST /'],
  path: '/api/waitlist',
};

const router = express.Router();

// Rate limit waitlist submissions (mirror the contact form: 5/min/IP)
const waitlistLimiter = makeLimiter({
  prefix: 'rl:waitlist',
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many requests, please try again later' },
});

const waitlistSchema = Joi.object({
  email: Joi.string().email().max(254).required(),
  name: Joi.string().max(200).allow('', null),
  phone: Joi.string().max(50).allow('', null),
  source: Joi.string().max(100).allow('', null),
});

// Shared validate() (P4-6 — this file used to carry its own copy);
// stripUnknown keeps the old behaviour of persisting only whitelisted keys.
router.post('/', waitlistLimiter, validate(waitlistSchema, { stripUnknown: true }), waitlistController.submitWaitlist);

export default router;
