import express from 'express';
import Joi from 'joi';
import rateLimit from 'express-rate-limit';
import * as contactController from '../controllers/contactController.js';

export const meta = {
  mounts: [
    { path: '/api/contact' },
    { path: '/api/admin/contact', flag: 'ENABLE_DOMAIN_PREFIXES' },
  ],
};

const router = express.Router();

// Rate limit contact form submissions
const contactLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
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

// Joi validation middleware
const validateContact = (req, res, next) => {
  const { error, value } = contactSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid contact submission',
      errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message }))
    });
  }
  req.body = value;
  next();
};

router.post('/', contactLimiter, validateContact, contactController.submitContact);

export default router;
