import express from 'express';
import { authenticateToken, requireAgentOrAdmin } from '../middleware/auth.js';
import * as ctrl from '../controllers/campaignPreviewController.js';
import { uuidParamGuard } from '../middleware/uuidParam.js';

export const meta = {
  mounts: [
    { path: '/api/campaigns' },
    { path: '/api/previews' },
    { path: '/api/adtech/previews', flag: 'ENABLE_DOMAIN_PREFIXES' },
  ],
};

const router = express.Router();

// Malformed :id → clean 404 (teardown PR; shared guard). /slug/:slug is a
// separate param name and stays unguarded (slugs are not uuids).
router.param('id', uuidParamGuard('Campaign'));

// Create or refresh preview snapshot for a campaign (auth required)
router.post('/:id/preview', authenticateToken, requireAgentOrAdmin, ctrl.createOrRefreshPreview);

// Public: resolve slug to snapshot (no auth)
router.get('/slug/:slug', ctrl.resolveSlug);

// Public: minimal campaign data by ID for lead capture (no auth)
router.get('/public/:id', ctrl.getPublicCampaign);

export default router;
