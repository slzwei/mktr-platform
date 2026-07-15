import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import * as campaignService from '../services/campaignService.js';
import * as featuredDropsService from '../services/featuredDropsService.js';
import * as marketplaceService from '../services/marketplaceService.js';
import * as leadPackageService from '../services/leadPackageService.js';
import { loadCampaignReadiness } from '../services/campaignReadinessService.js';
import { loadQuizAnalytics } from '../services/quizAnalyticsService.js';

// Public (no auth): drops for the redeem.sg homepage. Strict whitelist DTO,
// 60s service cache + edge cache header. docs/plans/redeem-home-featured-drops.md
export const getFeaturedDrops = asyncHandler(async (req, res) => {
  const drops = await featuredDropsService.getFeaturedDrops();
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ success: true, data: { drops } });
});

// Authenticated designer support (docs/plans/redeem-marketplace-v2.md Phase 1):
// the composed marketplace DTO for ANY campaign (drafts/unlisted included —
// no publication gate) so the designer can preview what consumers would see,
// plus a slug-availability check. Both independent of the public feature flag.
export const getMarketplacePreview = asyncHandler(async (req, res) => {
  const preview = await marketplaceService.previewMarketplaceCampaign(req.params.id, { user: req.user });
  if (!preview) throw new AppError('Campaign not found or access denied', 404);
  res.json({ success: true, data: { campaign: preview } });
});

export const checkSlugAvailability = asyncHandler(async (req, res) => {
  const result = await marketplaceService.checkSlugAvailability(
    String(req.query.slug || ''),
    { excludeCampaignId: req.query.excludeCampaignId || undefined }
  );
  res.json({ success: true, data: result });
});

export const listCampaigns = asyncHandler(async (req, res) => {
  // TODO: extract tenantId instead of passing req
  const data = await campaignService.listCampaigns(req.user, req.query, req);

  res.json({ success: true, data });
});

// Admin campaign-detail composite (Phase B) — one round-trip for the rebuild.
export const getCampaignSummary = asyncHandler(async (req, res) => {
  const data = await campaignService.getCampaignSummary(req.params.id, req);
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

export const getCampaignReadiness = asyncHandler(async (req, res) => {
  const readiness = await loadCampaignReadiness(req.params.id);

  res.json({ success: true, data: { readiness } });
});

// --- Campaign Launch Workspace (admin, mounted under /api/admin/campaigns) ---

export const getDeliveryPool = asyncHandler(async (req, res) => {
  const data = await leadPackageService.getCampaignDeliveryPool(req.params.id);
  res.json({ success: true, data });
});

export const bulkAssignDeliveryPool = asyncHandler(async (req, res) => {
  const { packageId, agentIds } = req.body;
  const data = await leadPackageService.bulkAssignPackage({
    campaignId: req.params.id,
    packageId,
    agentIds,
  });
  res.status(201).json({ success: true, message: 'Package assigned to agents', data });
});

export const setLaunchState = asyncHandler(async (req, res) => {
  const { state, force } = req.body;
  if (!['active', 'paused'].includes(state)) {
    throw new AppError('state must be "active" or "paused"', 400);
  }

  // Readiness gate on activate: block go-live when the campaign would drop
  // leads (empty funded pool / webhook off), unless explicitly forced.
  if (state === 'active' && !force) {
    const readiness = await loadCampaignReadiness(req.params.id);
    if (readiness.applicable && !readiness.ready) {
      return res.status(409).json({
        success: false,
        message: 'Campaign is not ready to go live. Resolve the issues or force activation.',
        data: { readiness },
      });
    }
  }

  const campaign = await campaignService.setCampaignLaunchState(req.params.id, state, req);
  res.json({
    success: true,
    message: state === 'active' ? 'Campaign activated' : 'Campaign paused',
    data: { campaign },
  });
});

export const getCampaignQuizAnalytics = asyncHandler(async (req, res) => {
  const analytics = await loadQuizAnalytics(req.params.id);

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
