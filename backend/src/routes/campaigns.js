import express from 'express';
import { authenticateToken, requireAgentOrAdmin, requireAdmin } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import * as campaignController from '../controllers/campaignController.js';

export const meta = {
  mounts: [
    { path: '/api/campaigns' },
    { path: '/api/adtech/campaigns', flag: 'ENABLE_DOMAIN_PREFIXES' },
  ],
};

const router = express.Router();

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
 *               type: { type: string, enum: [lead_generation, brand_awareness, product_promotion, event_marketing] }
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
router.get('/:id', authenticateToken, campaignController.getCampaign);

// Update campaign
router.put('/:id', authenticateToken, requireAgentOrAdmin, validate(schemas.campaignUpdate), campaignController.updateCampaign);

// Delete campaign (archive)
router.delete('/:id', authenticateToken, requireAgentOrAdmin, campaignController.deleteCampaign);

// Get campaign analytics
router.get('/:id/analytics', authenticateToken, campaignController.getCampaignAnalytics);

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
