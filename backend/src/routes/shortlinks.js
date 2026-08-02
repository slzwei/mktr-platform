import express from 'express';
import { makeLimiter } from '../middleware/rateLimiters.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import * as shortlinkController from '../controllers/shortlinkController.js';

export const meta = {
  mounts: [
    { path: '/api/shortlinks' },
    { path: '/share' },
  ],
};

const router = express.Router();

const shareLimiter = makeLimiter({
  prefix: 'rl:shortlink-share',
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many requests, try again later' }
});

// Public: create a share shortlink (rate-limited, share purpose only)
router.post('/public/share', shareLimiter, shortlinkController.createShareLink);

// Admin-only: mint a new short link
router.post('/', authenticateToken, requireAdmin, shortlinkController.createAdminLink);

// Public redirect: /share/:slug -> target
router.get('/:slug', shortlinkController.redirectSlug);

// Admin list/manage APIs (mounted under /api/shortlinks)
router.get('/', authenticateToken, requireAdmin, shortlinkController.listLinks);
router.patch('/:id', authenticateToken, requireAdmin, shortlinkController.updateLink);
router.get('/:id/clicks', authenticateToken, requireAdmin, shortlinkController.getClicks);
router.delete('/:id', authenticateToken, requireAdmin, shortlinkController.deleteLink);

export default router;
