import express from 'express';
import { makeLimiter } from '../middleware/rateLimiters.js';
import * as trackerController from '../controllers/trackerController.js';

export const meta = {
  priority: -1,
  mounts: [
    { path: '/api/qrcodes' },
    { path: '/api/leadgen/qrcodes', flag: 'ENABLE_DOMAIN_PREFIXES' },
  ],
};

const router = express.Router();

const limiter = makeLimiter({
  prefix: 'rl:tracker',
  windowMs: 60 * 1000,
  limit: 120
});

router.get('/track/:slug', limiter, trackerController.trackSlug);

// Resolve current session attribution -> campaign/qrTag for SPA to load design
router.get('/session', trackerController.getSession);

export default router;
