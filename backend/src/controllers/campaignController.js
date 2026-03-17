import { asyncHandler } from '../middleware/errorHandler.js';
import * as campaignService from '../services/campaignService.js';

export const listCampaigns = asyncHandler(async (req, res) => {
  // TODO: extract tenantId instead of passing req
  const data = await campaignService.listCampaigns(req.user, req.query, req);

  res.json({ success: true, data });
});

export const createCampaign = asyncHandler(async (req, res) => {
  const campaign = await campaignService.createCampaign(req.body, req.user);

  res.status(201).json({
    success: true,
    message: 'Campaign created successfully',
    data: { campaign }
  });
});

export const getCampaign = asyncHandler(async (req, res) => {
  // TODO: extract tenantId instead of passing req
  const campaign = await campaignService.getCampaign(req.params.id, req);

  res.json({ success: true, data: { campaign } });
});

export const updateCampaign = asyncHandler(async (req, res) => {
  // TODO: extract tenantId instead of passing req
  const campaign = await campaignService.updateCampaign(req.params.id, req.body, req);

  res.json({
    success: true,
    message: 'Campaign updated successfully',
    data: { campaign }
  });
});

export const deleteCampaign = asyncHandler(async (req, res) => {
  // TODO: extract tenantId instead of passing req
  await campaignService.archiveCampaign(req.params.id, req);

  res.json({ success: true, message: 'Campaign archived successfully' });
});

export const getCampaignAnalytics = asyncHandler(async (req, res) => {
  // TODO: extract tenantId instead of passing req
  const analytics = await campaignService.getCampaignAnalytics(req.params.id, req);

  res.json({ success: true, data: { analytics } });
});

export const updateCampaignMetrics = asyncHandler(async (req, res) => {
  // TODO: extract tenantId instead of passing req
  const campaign = await campaignService.updateCampaignMetrics(req.params.id, req.body.metrics, req);

  res.json({
    success: true,
    message: 'Campaign metrics updated successfully',
    data: { campaign }
  });
});

export const duplicateCampaign = asyncHandler(async (req, res) => {
  // TODO: extract tenantId instead of passing req
  const campaign = await campaignService.duplicateCampaign(req.params.id, req.body, req);

  res.status(201).json({
    success: true,
    message: 'Campaign duplicated successfully',
    data: { campaign }
  });
});

export const archiveCampaign = asyncHandler(async (req, res) => {
  // TODO: extract tenantId instead of passing req
  const campaign = await campaignService.archiveCampaign(req.params.id, req);

  res.json({
    success: true,
    message: 'Campaign archived successfully',
    data: { campaign }
  });
});

export const restoreCampaign = asyncHandler(async (req, res) => {
  // TODO: extract tenantId instead of passing req
  const campaign = await campaignService.restoreCampaign(req.params.id, req);

  res.json({
    success: true,
    message: 'Campaign restored successfully',
    data: { campaign }
  });
});

export const permanentlyDeleteCampaign = asyncHandler(async (req, res) => {
  // TODO: extract tenantId instead of passing req
  await campaignService.permanentlyDeleteCampaign(req.params.id, req);

  res.json({ success: true, message: 'Campaign permanently deleted' });
});
