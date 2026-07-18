import express from 'express';
import { authenticateToken, requireAgentOrAdmin, requireAdmin } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import * as campaignController from '../controllers/campaignController.js';
import { uuidParamGuard } from '../middleware/uuidParam.js';

export const meta = {
  mounts: [
    { path: '/api/campaigns' },
    { path: '/api/adtech/campaigns', flag: 'ENABLE_DOMAIN_PREFIXES' },
  ],
};

const router = express.Router();

// Malformed :id → clean 404 (teardown PR; shared guard — see middleware/uuidParam.js).
router.param('id', uuidParamGuard('Campaign'));

/**
 * @openapi
 * /campaigns/featured-drops:
 *   get:
 *     tags: [Campaigns]
 *     summary: Public list of campaigns featured on the redeem.sg homepage
 *     responses:
 *       200:
 *         description: Featured drops (whitelisted display fields only)
 */
// PUBLIC — no auth. Declared before any /:id route so it can't be shadowed
// into the authenticated getCampaign handler. Lives here (single mount)
// rather than in campaignPreviews.js, whose router is mounted at multiple
// paths and would create /api/previews/featured-drops aliases.
router.get('/featured-drops', campaignController.getFeaturedDrops);

// Authenticated designer support — declared before /:id so "slug-availability"
// can't be captured as a campaign id. Flag-independent (the designer must be
// able to stage marketplace content before the public API is enabled).
router.get('/slug-availability', authenticateToken, campaignController.checkSlugAvailability);
router.get('/:id/marketplace-preview', authenticateToken, campaignController.getMarketplacePreview);

/**
 * @openapi
 * /campaigns:
 *   get:
 *     tags: [Campaigns]
 *     summary: List campaigns (filtered by user role)
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, archived] }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: List of campaigns
 */
router.get('/', authenticateToken, campaignController.listCampaigns);

/**
 * @openapi
 * /campaigns:
 *   post:
 *     tags: [Campaigns]
 *     summary: Create a new campaign
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, type]
 *             properties:
 *               name: { type: string }
 *               type: { type: string, enum: [lead_generation, brand_awareness, product_promotion, event_marketing, quiz, guided_review] }
 *               start_date: { type: string, format: date }
 *               end_date: { type: string, format: date }
 *               is_active: { type: boolean }
 *     responses:
 *       201:
 *         description: Campaign created
 *       403:
 *         description: Agent or admin role required
 */
router.post('/', authenticateToken, requireAgentOrAdmin, validate(schemas.campaignCreate), campaignController.createCampaign);

// Get campaign by ID
// Admin campaign-detail composite (Phase B rebuild) — read-only aggregation
router.get('/:id/summary', authenticateToken, requireAdmin, campaignController.getCampaignSummary);

router.get('/:id', authenticateToken, campaignController.getCampaign);

// Update campaign
router.put('/:id', authenticateToken, requireAgentOrAdmin, validate(schemas.campaignUpdate), campaignController.updateCampaign);

// Delete campaign (archive)
router.delete('/:id', authenticateToken, requireAgentOrAdmin, campaignController.deleteCampaign);

// Get campaign analytics
router.get('/:id/analytics', authenticateToken, campaignController.getCampaignAnalytics);

// Get campaign go-live readiness (assignable agent pool + webhook + quiz config).
// Admin-only since PR 5: the payload now carries infra env-presence booleans
// (OTP creds) and every in-repo consumer (Studio, launch tab, legacy designer
// banner) is an admin surface anyway.
router.get('/:id/readiness', authenticateToken, requireAdmin, campaignController.getCampaignReadiness);

// Get quiz results analytics (profile + lead-score mix over submitted leads)
router.get('/:id/quiz-analytics', authenticateToken, campaignController.getCampaignQuizAnalytics);

// Update campaign metrics
router.patch('/:id/metrics', authenticateToken, requireAgentOrAdmin, campaignController.updateCampaignMetrics);

// Duplicate campaign
router.post('/:id/duplicate', authenticateToken, requireAgentOrAdmin, campaignController.duplicateCampaign);

// Archive campaign
router.patch('/:id/archive', authenticateToken, requireAgentOrAdmin, campaignController.archiveCampaign);

// Restore campaign from archive
router.patch('/:id/restore', authenticateToken, requireAgentOrAdmin, campaignController.restoreCampaign);

// Permanently delete campaign
router.delete('/:id/permanent', authenticateToken, requireAdmin, campaignController.permanentlyDeleteCampaign);

export default router;
