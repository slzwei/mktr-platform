import express from 'express';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import * as waitlistController from '../controllers/waitlistController.js';

// Auto-discovered + mounted by routes/index.js via this meta export.
export const meta = {
  path: '/api/waitlist',
};

const router = express.Router();

// Rate limit waitlist submissions (mirror the contact form: 5/min/IP)
const waitlistLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
});

const waitlistSchema = Joi.object({
  email: Joi.string().email().max(254).required(),
  name: Joi.string().max(200).allow('', null),
  phone: Joi.string().max(50).allow('', null),
  source: Joi.string().max(100).allow('', null),
});

const validateWaitlist = (req, res, next) => {
  const { error, value } = waitlistSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid waitlist submission',
      errors: error.details.map((d) => ({ field: d.path.join('.'), message: d.message })),
    });
  }
  req.body = value;
  next();
};

router.post('/', waitlistLimiter, validateWaitlist, waitlistController.submitWaitlist);

export default router;
