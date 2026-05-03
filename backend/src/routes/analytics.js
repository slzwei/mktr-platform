import express from 'express';
import rateLimit from 'express-rate-limit';
import * as ctrl from '../controllers/analyticsController.js';

export const meta = {
  mounts: [
    { path: '/api/analytics' },
    { path: '/api/adtech/analytics', flag: 'ENABLE_DOMAIN_PREFIXES' },
  ],
};

const router = express.Router();

// Rate limit analytics endpoints (public, no auth) to prevent abuse
const analyticsLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many requests.',
});

router.post('/events', analyticsLimit, ctrl.trackEvent);
router.post('/referrals', analyticsLimit, ctrl.trackReferral);

export default router;
