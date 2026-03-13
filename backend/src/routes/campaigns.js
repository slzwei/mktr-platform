import express from 'express';
import { authenticateToken, requireAgentOrAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as campaignService from '../services/campaignService.js';

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
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const data = await campaignService.listCampaigns(req.user, req.query, req);

  res.json({ success: true, data });
}));

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
router.post('/', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const campaign = await campaignService.createCampaign(req.body, req.user);

  res.status(201).json({
    success: true,
    message: 'Campaign created successfully',
    data: { campaign }
  });
}));

// Get campaign by ID
router.get('/:id', authenticateToken, asyncHandler(async (req, res) => {
  const campaign = await campaignService.getCampaign(req.params.id, req);

  res.json({ success: true, data: { campaign } });
}));

// Update campaign
router.put('/:id', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const campaign = await campaignService.updateCampaign(req.params.id, req.body, req);

  res.json({
    success: true,
    message: 'Campaign updated successfully',
    data: { campaign }
  });
}));

// Delete campaign (archive)
router.delete('/:id', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  await campaignService.archiveCampaign(req.params.id, req);

  res.json({ success: true, message: 'Campaign archived successfully' });
}));

// Get campaign analytics
router.get('/:id/analytics', authenticateToken, asyncHandler(async (req, res) => {
  const analytics = await campaignService.getCampaignAnalytics(req.params.id, req);

  res.json({ success: true, data: { analytics } });
}));

// Update campaign metrics
router.patch('/:id/metrics', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const campaign = await campaignService.updateCampaignMetrics(req.params.id, req.body.metrics, req);

  res.json({
    success: true,
    message: 'Campaign metrics updated successfully',
    data: { campaign }
  });
}));

// Duplicate campaign
router.post('/:id/duplicate', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const campaign = await campaignService.duplicateCampaign(req.params.id, req.body, req);

  res.status(201).json({
    success: true,
    message: 'Campaign duplicated successfully',
    data: { campaign }
  });
}));

// Archive campaign
router.patch('/:id/archive', authenticateToken, asyncHandler(async (req, res) => {
  const campaign = await campaignService.archiveCampaign(req.params.id, req);

  res.json({
    success: true,
    message: 'Campaign archived successfully',
    data: { campaign }
  });
}));

// Restore campaign from archive
router.patch('/:id/restore', authenticateToken, asyncHandler(async (req, res) => {
  const campaign = await campaignService.restoreCampaign(req.params.id, req);

  res.json({
    success: true,
    message: 'Campaign restored successfully',
    data: { campaign }
  });
}));

// Permanently delete campaign
router.delete('/:id/permanent', authenticateToken, asyncHandler(async (req, res) => {
  await campaignService.permanentlyDeleteCampaign(req.params.id, req);

  res.json({ success: true, message: 'Campaign permanently deleted' });
}));

export default router;
