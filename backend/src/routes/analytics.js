import express from 'express';
import { makeLimiter } from '../middleware/rateLimiters.js';
import { validate, schemas } from '../middleware/validation.js';
import * as ctrl from '../controllers/analyticsController.js';

export const meta = {
  // Public routes (default-deny routing): browser tracking beacons from the public funnel
  public: ['POST /events', 'POST /referrals', 'POST /touch'],
  mounts: [
    { path: '/api/analytics' },
    { path: '/api/adtech/analytics', flag: 'ENABLE_DOMAIN_PREFIXES' },
  ],
};

const router = express.Router();

// Rate limit analytics endpoints (public, no auth) to prevent abuse
const analyticsLimit = makeLimiter({
  prefix: 'rl:analytics',
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many requests.',
});

// The touchpoint beacon gets its OWN bucket (ads-centralisation §4.3): a
// browse session legitimately emits several touches, and sharing the
// analytics bucket would let route-tracking starve the referral badge.
const touchLimit = makeLimiter({
  prefix: 'rl:touch',
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many requests.',
});

router.post('/events', analyticsLimit, ctrl.trackEvent);
router.post('/referrals', analyticsLimit, ctrl.trackReferral);
router.post('/touch', touchLimit, validate(schemas.analyticsTouch, { stripUnknown: true }), ctrl.trackTouch);

export default router;
