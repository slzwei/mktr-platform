import crypto from 'crypto';
import { Campaign, CampaignPreview } from '../models/index.js';
import { buildPublicDesignConfig } from '../utils/publicDesignConfig.js';

function generateSlug() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Create or refresh a preview snapshot for a campaign.
 * Returns { slug, url, previewId }.
 */
export async function createOrRefreshPreview(campaignId, user) {
  const where = { id: campaignId };
  if (user.role !== 'admin') {
    where.createdBy = user.id;
  }
  const campaign = await Campaign.findOne({ where });

  if (!campaign) {
    const err = new Error('Campaign not found or access denied');
    err.statusCode = 404;
    throw err;
  }

  const slug = generateSlug();

  const snapshot = {
    id: campaign.id,
    name: campaign.name,
    type: campaign.type,
    min_age: campaign.min_age,
    max_age: campaign.max_age,
    is_active: true,
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

  return { slug, url: `/p/${slug}`, previewId: preview.id };
}

/**
 * Resolve a slug to a campaign snapshot.
 * Returns { snapshot, campaignId }.
 */
export async function resolveSlug(slug) {
  const preview = await CampaignPreview.findOne({ where: { slug } });
  if (!preview) {
    const err = new Error('Preview not found');
    err.statusCode = 404;
    throw err;
  }

  // Fetch the latest campaign data to ensure design is up-to-date
  const campaign = await Campaign.findByPk(preview.campaignId);

  let snapshot = preview.snapshot;
  if (campaign) {
    snapshot = {
      ...snapshot,
      // Public endpoint: whitelist-rebuild, never the raw JSONB (it carries
      // internal luckyDraw activation/terms ids).
      design_config: buildPublicDesignConfig(campaign.design_config),
      name: campaign.name,
      type: campaign.type,
      min_age: campaign.min_age,
      max_age: campaign.max_age,
      is_active: true
    };
  } else if (snapshot && typeof snapshot === 'object' && snapshot.design_config) {
    snapshot = { ...snapshot, design_config: buildPublicDesignConfig(snapshot.design_config) };
  }

  return { snapshot, campaignId: preview.campaignId };
}

/**
 * Get minimal public campaign data by ID.
 * Returns the campaign with limited attributes.
 */
export async function getPublicCampaign(id) {
  // min_age / max_age are exposed publicly because the LeadCapture form's
  // inline DOB validator (`getAgeValidationError`) reads them to gate
  // out-of-range birthdates client-side. The backend also re-checks on
  // submit in prospectService to prevent bypass.
  const campaign = await Campaign.findByPk(id, {
    attributes: ['id', 'name', 'type', 'design_config', 'is_active', 'metaPixelId', 'tiktokPixelId', 'min_age', 'max_age']
  });

  if (!campaign) {
    const err = new Error('Campaign not found');
    err.statusCode = 404;
    throw err;
  }

  // design_config is an unconstrained JSONB that also carries INTERNAL state
  // (luckyDraw activation/terms ids, future keys). This endpoint is public —
  // rebuild through the whitelist, never dump the raw column.
  const plain = campaign.toJSON();
  plain.design_config = buildPublicDesignConfig(plain.design_config);
  return plain;
}
