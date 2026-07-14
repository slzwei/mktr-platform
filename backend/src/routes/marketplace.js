import express from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as marketplaceService from '../services/marketplaceService.js';

/**
 * PUBLIC marketplace read API — backs redeem.sg /explore, /offers/:slug and
 * /flow/:slug (docs/plans/redeem-marketplace-v2.md Phase 1).
 *
 * Read-only. Every response is a rebuilt DTO (design_config + ops) — never a
 * raw campaign row. Dark-launched behind MARKETPLACE_PUBLIC_API_ENABLED.
 */
export const meta = {
  path: '/api/marketplace',
  flag: 'MARKETPLACE_PUBLIC_API_ENABLED',
  flagDefault: 'false',
};

const listLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // browse-heavy surface; generous for humans, hostile to scrapers
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests — try again later.' },
});

const router = express.Router();

router.get('/campaigns', listLimiter, asyncHandler(async (req, res) => {
  const campaigns = await marketplaceService.listMarketplaceCampaigns();
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ success: true, data: { campaigns } });
}));

router.get('/campaigns/:slug', listLimiter, asyncHandler(async (req, res) => {
  const campaign = await marketplaceService.getMarketplaceCampaign(String(req.params.slug || ''));
  if (!campaign) {
    return res.status(404).json({ success: false, message: 'Campaign not found' });
  }
  // Detail is composed live (sold-out/paused must be immediate) — short edge cache only.
  res.set('Cache-Control', 'public, max-age=30');
  res.json({ success: true, data: { campaign } });
}));

export default router;
