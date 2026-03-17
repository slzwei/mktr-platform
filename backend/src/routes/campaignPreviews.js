import express from 'express';
import { authenticateToken, requireAgentOrAdmin } from '../middleware/auth.js';
import * as ctrl from '../controllers/campaignPreviewController.js';

export const meta = {
  mounts: [
    { path: '/api/campaigns' },
    { path: '/api/previews' },
    { path: '/api/adtech/previews', flag: 'ENABLE_DOMAIN_PREFIXES' },
  ],
};

const router = express.Router();

// Create or refresh preview snapshot for a campaign (auth required)
router.post('/:id/preview', authenticateToken, requireAgentOrAdmin, ctrl.createOrRefreshPreview);

// Public: resolve slug to snapshot (no auth)
router.get('/slug/:slug', ctrl.resolveSlug);

// Public: minimal campaign data by ID for lead capture (no auth)
router.get('/public/:id', ctrl.getPublicCampaign);

export default router;
