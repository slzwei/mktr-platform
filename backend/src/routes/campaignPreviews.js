import express from 'express';
import crypto from 'crypto';
import { Campaign, CampaignPreview } from '../models/index.js';
import { authenticateToken, requireAgentOrAdmin } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

function generateSlug() {
  return crypto.randomBytes(16).toString('hex');
}

// Create or refresh preview snapshot for a campaign
router.post('/:id/preview', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const where = { id };
  if (req.user.role !== 'admin') {
    where.createdBy = req.user.id;
  }
  const campaign = await Campaign.findOne({ where });

  if (!campaign) {
    throw new AppError('Campaign not found or access denied', 404);
  }

  // Best practice: always create a fresh slug to avoid stale caches and ensure unique links
  const slug = generateSlug();

  const snapshot = {
    id: campaign.id,
    name: campaign.name,
    min_age: campaign.min_age,
    max_age: campaign.max_age,
    is_active: true, // Preview should render regardless of campaign active flag
    design_config: campaign.design_config || {},
    createdAt: new Date().toISOString()
  };

  const [preview, created] = await CampaignPreview.findOrCreate({
    where: { campaignId: campaign.id },
    defaults: { campaignId: campaign.id, slug, snapshot }
  });

  if (!created) {
    await preview.update({ slug, snapshot });
  }

  res.status(201).json({
    success: true,
    data: {
      slug: slug,
      url: `/p/${slug}`,
      previewId: preview.id
    }
  });
}));

// Public: resolve slug to snapshot
router.get('/slug/:slug', asyncHandler(async (req, res) => {
  // Ensure previews are not indexed
  res.set('X-Robots-Tag', 'noindex, nofollow');

  const { slug } = req.params;
  const preview = await CampaignPreview.findOne({ where: { slug } });
  if (!preview) {
    throw new AppError('Preview not found', 404);
  }

  // Fetch the latest campaign data to ensure design is up-to-date
  // This solves the issue where users save in Designer but don't click "Preview" to refresh the snapshot
  const campaign = await Campaign.findByPk(preview.campaignId);

  let snapshot = preview.snapshot;
  if (campaign) {
    snapshot = {
      ...snapshot,
      // Create a specific preview snapshot that ALWAYS uses the latest design
      design_config: campaign.design_config || {},
      name: campaign.name,
      min_age: campaign.min_age,
      max_age: campaign.max_age,
      is_active: true
    };
  }

  res.json({ success: true, data: { snapshot, campaignId: preview.campaignId } });
}));

export default router;



// Public: minimal campaign data by ID for lead capture (no auth)
router.get('/public/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const campaign = await Campaign.findByPk(id, {
    attributes: ['id', 'name', 'design_config', 'is_active']
  });

  if (!campaign) {
    throw new AppError('Campaign not found', 404);
  }

  res.json({ success: true, data: { campaign } });
}));

