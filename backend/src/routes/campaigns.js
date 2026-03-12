import express from 'express';
import { authenticateToken, requireAgentOrAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as campaignService from '../services/campaignService.js';

const router = express.Router();

// Get all campaigns
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const data = await campaignService.listCampaigns(req.user, req.query, req);

  res.json({ success: true, data });
}));

// Create new campaign
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
