import { asyncHandler } from '../middleware/errorHandler.js';
import * as campaignPreviewService from '../services/campaignPreviewService.js';

export const createOrRefreshPreview = asyncHandler(async (req, res) => {
  const data = await campaignPreviewService.createOrRefreshPreview(req.params.id, req.user);
  res.status(201).json({ success: true, data });
});

export const resolveSlug = asyncHandler(async (req, res) => {
  // Ensure previews are not indexed
  res.set('X-Robots-Tag', 'noindex, nofollow');
  const data = await campaignPreviewService.resolveSlug(req.params.slug);
  res.json({ success: true, data });
});

export const getPublicCampaign = asyncHandler(async (req, res) => {
  const campaign = await campaignPreviewService.getPublicCampaign(req.params.id);
  res.json({ success: true, data: { campaign } });
});
