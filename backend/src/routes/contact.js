import express from 'express';
import Joi from 'joi';
import { makeLimiter } from '../middleware/rateLimiters.js';
import { validate } from '../middleware/validation.js';
import * as contactController from '../controllers/contactController.js';

export const meta = {
  // Public routes (default-deny routing): public contact form
  public: ['POST /'],
  mounts: [
    { path: '/api/contact' },
    { path: '/api/admin/contact', flag: 'ENABLE_DOMAIN_PREFIXES' },
  ],
};

const router = express.Router();

// Rate limit contact form submissions
const contactLimiter = makeLimiter({
  prefix: 'rl:contact',
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many contact submissions, try again later' }
});

const contactSchema = Joi.object({
  name: Joi.string().min(2).max(200).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().max(50).allow('', null),
  company: Joi.string().max(200).allow('', null),
  userType: Joi.string()
    .valid('advertiser', 'phv_driver', 'fleet_owner', 'salesperson')
    .allow('', null),
  message: Joi.string().min(10).max(5000).required()
});

// Shared validate() (P4-6 — this file used to carry its own copy);
// stripUnknown keeps the old behaviour of persisting only whitelisted keys.
router.post('/', contactLimiter, validate(contactSchema, { stripUnknown: true }), contactController.submitContact);

export default router;
