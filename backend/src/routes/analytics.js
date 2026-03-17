import express from 'express';
import * as ctrl from '../controllers/analyticsController.js';

export const meta = {
  mounts: [
    { path: '/api/analytics' },
    { path: '/api/adtech/analytics', flag: 'ENABLE_DOMAIN_PREFIXES' },
  ],
};

const router = express.Router();

router.post('/events', ctrl.trackEvent);
router.post('/referrals', ctrl.trackReferral);

export default router;
