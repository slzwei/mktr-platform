import { Op } from 'sequelize';
import { Campaign, Activation, sequelize } from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { computeCampaignMetrics } from '../campaignService.js';
import { normalizeCustomerHostChoice, customerHostOrigin } from '../../utils/customerHost.js';

/**
 * The ONLY Redeem Ops file that reads MKTR campaign internals
 * (docs/redeem-ops/MKTR_INTEGRATION.md §1). Read-only, attribute-allowlisted —
 * design_config is NEVER returned wholesale (builder internals stay on mktr.sg);
 * only the customerHost choice is extracted to compute the public URL.
 */
const PROJECTION_ATTRS = ['id', 'name', 'status', 'type', 'is_active', 'design_config', 'createdAt'];

function toProjection(campaign, liveActivationByCampaign = new Map()) {
  const hostChoice = normalizeCustomerHostChoice(campaign.design_config?.customerHost);
  const origin = customerHostOrigin(hostChoice);
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    type: campaign.type,
    isActive: campaign.is_active,
    customerHost: hostChoice,
    publicUrl: `${origin}/LeadCapture?campaign_id=${campaign.id}`,
    mktrAdminUrl: `https://mktr.sg/admin/campaigns/${campaign.id}/workspace`,
    createdAt: campaign.createdAt,
    linkedActivationId: liveActivationByCampaign.get(campaign.id) || null,
  };
}

export function makeCampaignProjection(overrides = {}) {
  const d = { Campaign, Activation, sequelize, ...overrides };

  /** Search campaigns for the Activation link picker. */
  async function searchCampaigns(query = {}) {
    const where = {};
    if (query.search) where.name = { [Op.iLike]: `%${String(query.search).trim()}%` };
    if (query.status) where.status = String(query.status);
    else where.status = { [Op.ne]: 'archived' };

    const campaigns = await d.Campaign.findAll({
      where,
      attributes: PROJECTION_ATTRS,
      order: [['createdAt', 'DESC']],
      limit: Math.min(50, Math.max(1, parseInt(query.limit, 10) || 25)),
    });

    const live = await d.Activation.findAll({
      where: {
        campaignId: { [Op.in]: campaigns.map((c) => c.id) },
        status: { [Op.in]: ['preparing', 'active', 'paused'] },
      },
      attributes: ['id', 'campaignId'],
    });
    const liveMap = new Map(live.map((a) => [a.campaignId, a.id]));
    return campaigns.map((c) => toProjection(c, liveMap));
  }

  /** Read-only detail card for a linked campaign. */
  async function getCampaignReference(campaignId) {
    const campaign = await d.Campaign.findByPk(campaignId, { attributes: PROJECTION_ATTRS });
    if (!campaign) throw new AppError('Campaign not found', 404);
    return toProjection(campaign);
  }

  /** Acquisition metrics — ALWAYS MKTR's own numbers (computeCampaignMetrics), never re-counted. */
  async function getCampaignMetrics(campaignId) {
    const campaign = await d.Campaign.findByPk(campaignId, { attributes: ['id'] });
    if (!campaign) throw new AppError('Campaign not found', 404);
    return computeCampaignMetrics(campaignId);
  }

  return { searchCampaigns, getCampaignReference, getCampaignMetrics, toProjection };
}

const _default = makeCampaignProjection();
export default _default;
