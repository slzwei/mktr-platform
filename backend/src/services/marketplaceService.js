/**
 * Marketplace read model — the public campaign list/detail behind
 * GET /api/marketplace/campaigns[/:slug] (redeem.sg consumer marketplace).
 * Design: docs/plans/redeem-marketplace-v2.md.
 *
 * Every campaign is served as exactly two layers:
 *   design_config — designer-authored copy, REBUILT field-by-field via
 *     normalizeMarketplaceContent + an explicit passthrough of the public
 *     flow keys. Raw design_config is never spread into a response
 *     (luckyDraw carries internal activation/terms ids; quiz/customerHost/
 *     internal keys must not leak).
 *   ops — derived, read-only, composed from Redeem Ops entities:
 *     Activation (capacity/dates) ⋈ RewardOffer (value/windows/status)
 *     ⋈ PartnerOrganisation (public profile) ⋈ RewardOfferLocation
 *     (offer-specific branches) + the open Draw row (boost tier).
 *
 * Publication gate (list AND detail — no unlisted semantics): admin-set
 * design_config.marketplaceListed AND slug AND is_active AND status='active'
 * AND redeem customer host AND a supported campaign type AND resolvable ops.
 * marketplaceListed is the only exposure switch because campaign PUT is open
 * to agents (they can flip is_active, so is_active must never publish).
 */

import { Op } from 'sequelize';
import {
  Campaign, Activation, RewardOffer, PartnerOrganisation, PartnerLocation,
  RewardOfferLocation, Draw,
} from '../models/index.js';
import {
  normalizeMarketplaceContent, MARKETPLACE_CAMPAIGN_TYPES,
} from '../utils/marketplaceContent.js';
import { publicLuckyDraw } from '../utils/publicDesignConfig.js';
import { normalizeCustomerHostChoice } from '../utils/customerHost.js';
import { getMarketplaceCacheState, setMarketplaceCacheState } from './marketplaceCache.js';
import { logger } from '../utils/logger.js';

const TTL_MS = 60_000;
// Stale-on-error is bounded: offers are inventory-backed (unlike the
// editorial featured-drops cards), so a paused/sold-out offer must not stay
// visible indefinitely behind a broken refresh.
const MAX_STALE_MS = 5 * 60_000;

let inflight = null;

// Cache state + write-side invalidation live in marketplaceCache.js (model-free)
// so writer services can bust it without importing this read model.
export { invalidateMarketplaceCache } from './marketplaceCache.js';

const LIVE_ACTIVATION_STATUSES = ['active'];

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function minDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a) <= new Date(b) ? a : b;
}

/**
 * Compose the ops layer for one campaign from its live Activation chain.
 * Returns null when the chain is not resolvable/serviceable (no live
 * activation, offer not active, outside validity) — gate treats null as
 * not listable. `now` injectable for tests.
 */
export async function composeOps(campaignId, { now = new Date() } = {}) {
  const activations = await Activation.findAll({
    where: { campaignId, status: { [Op.in]: LIVE_ACTIVATION_STATUSES } },
    include: [
      {
        model: RewardOffer,
        as: 'rewardOffer',
        attributes: [
          'id', 'status', 'retailValue', 'validityStart', 'validityEnd',
          'claimExpiryDays', 'redemptionExpiryDays',
        ],
        include: [
          {
            model: PartnerOrganisation,
            as: 'partner',
            attributes: ['id', 'brandName', 'tradingName', 'publicBlurb', 'verifiedAt', 'partnerSince'],
          },
          {
            model: RewardOfferLocation,
            as: 'offerLocations',
            include: [{ model: PartnerLocation, as: 'location', attributes: ['name', 'area', 'isActive'] }],
          },
        ],
      },
    ],
  });

  if (activations.length === 0) return null;
  if (activations.length > 1) {
    // A partial unique index enforces one live activation per campaign —
    // more than one is data corruption, not a selection problem.
    logger.error({ campaignId, count: activations.length }, 'marketplace.multiple_live_activations');
    return null;
  }

  const activation = activations[0];
  const offer = activation.rewardOffer;
  if (!offer || offer.status !== 'active') return null;
  if (offer.validityStart && now < new Date(offer.validityStart)) return null;
  if (offer.validityEnd && now > new Date(offer.validityEnd)) return null;
  if (activation.startDate && now < new Date(activation.startDate)) return null;
  if (activation.endDate && now > new Date(activation.endDate)) return null;

  const partner = offer.partner;
  const locations = (offer.offerLocations || [])
    .map((ol) => ol.location)
    .filter((l) => l && l.isActive !== false)
    .map((l) => ({ name: l.name || null, area: l.area || null }));

  const total = activation.allocatedQuantity || 0;
  const remaining = Math.max(0, total - (activation.issuedCount || 0));

  const ops = {
    partner: partner
      ? {
          name: partner.brandName || partner.tradingName || null,
          verified: !!partner.verifiedAt,
          since: partner.partnerSince || null,
          blurb: partner.publicBlurb || null,
          locations,
        }
      : null,
    capacity: { total, remaining },
    expiry: minDate(activation.endDate, offer.validityEnd),
    retail_value: toNumber(offer.retailValue),
    claim_expiry_days: offer.claimExpiryDays ?? null,
    redemption_expiry_days: offer.redemptionExpiryDays ?? null,
    draw: null,
  };

  const draw = await Draw.findOne({
    where: { campaignId, status: 'open' },
    attributes: ['closesAt', 'boostClosesAt', 'multiplier', 'status'],
  });
  if (draw) {
    ops.draw = {
      closesAt: draw.closesAt,
      boostClosesAt: draw.boostClosesAt,
      multiplier: draw.multiplier,
    };
  }

  return ops;
}

/**
 * Rebuild the PUBLIC design_config: normalized marketplace content + the
 * public flow keys, never a raw spread. luckyDraw is sanitized to display
 * fields only (internal activation/terms ids stripped).
 */
export function buildPublicDesignConfig(raw) {
  const dc = raw || {};
  const out = normalizeMarketplaceContent(dc);

  // Flow/production keys the consumer flow renders from — passthrough of
  // known-safe primitives only.
  if (dc.sgPrOnly === true) out.sgPrOnly = true;
  if (dc.excludeAdvisors === true) out.excludeAdvisors = true;
  if (dc.dncCheckAtSubmit === true) out.dncCheckAtSubmit = true;
  out.otpChannel = dc.otpChannel === 'whatsapp' ? 'whatsapp' : 'sms';
  if (typeof dc.themeColor === 'string') out.themeColor = dc.themeColor.slice(0, 32);
  if (typeof dc.termsContent === 'string') out.termsContent = dc.termsContent;
  if (Array.isArray(dc.fieldOrder)) out.fieldOrder = dc.fieldOrder;
  if (dc.visibleFields && typeof dc.visibleFields === 'object') out.visibleFields = dc.visibleFields;
  if (dc.requiredFields && typeof dc.requiredFields === 'object') out.requiredFields = dc.requiredFields;

  // Display-safe draw view — internal activation/terms ids are NEVER public.
  const ld = publicLuckyDraw(dc.luckyDraw);
  if (ld) out.luckyDraw = ld;

  return out;
}

/** Static publication gate (no ops query) — exported for the QR tracker's
 * qr_entry branch, which must never send traffic to an unpublished detail page. */
export function passesStaticGate(campaign) {
  if (!campaign.slug) return false;
  if (campaign.is_active !== true || campaign.status !== 'active') return false;
  const dc = campaign.design_config || {};
  if (dc.marketplaceListed !== true) return false;
  if (normalizeCustomerHostChoice(dc.customerHost) !== 'redeem') return false;
  const type = campaign.type || 'lead_generation';
  if (!MARKETPLACE_CAMPAIGN_TYPES.includes(type)) return false;
  return true;
}

const CAMPAIGN_ATTRS = [
  'id', 'slug', 'name', 'type', 'status', 'is_active', 'min_age', 'max_age',
  'metaPixelId', 'tiktokPixelId', 'design_config',
];

function toDto(campaign, ops) {
  return {
    id: campaign.id,
    slug: campaign.slug,
    name: campaign.name,
    min_age: campaign.min_age ?? null,
    max_age: campaign.max_age ?? null,
    metaPixelId: campaign.metaPixelId || null,
    tiktokPixelId: campaign.tiktokPixelId || null,
    design_config: buildPublicDesignConfig(campaign.design_config),
    ops,
  };
}

async function fetchAll(now) {
  const campaigns = await Campaign.findAll({
    where: { slug: { [Op.ne]: null }, is_active: true, status: 'active' },
    attributes: CAMPAIGN_ATTRS,
  });

  const out = [];
  for (const campaign of campaigns) {
    if (!passesStaticGate(campaign)) continue;
    const ops = await composeOps(campaign.id, { now: new Date(now) });
    if (!ops) continue;
    // Sold-out / fully issued offers drop off the list; the detail endpoint
    // re-composes live so a direct link shows the sold-out state instead.
    if (ops.capacity.total > 0 && ops.capacity.remaining <= 0) continue;
    out.push(toDto(campaign, ops));
  }

  // Deterministic ordering: featured first, then soonest expiry, then slug.
  out.sort((a, b) => {
    const af = a.design_config.featuredDrop ? 0 : 1;
    const bf = b.design_config.featuredDrop ? 0 : 1;
    if (af !== bf) return af - bf;
    const ae = a.ops.expiry ? new Date(a.ops.expiry).getTime() : Infinity;
    const be = b.ops.expiry ? new Date(b.ops.expiry).getTime() : Infinity;
    if (ae !== be) return ae - be;
    return String(a.slug).localeCompare(String(b.slug));
  });
  return out;
}

/** Public list — 60s TTL, coalesced, stale-on-error bounded to MAX_STALE_MS. */
export async function listMarketplaceCampaigns({ now = Date.now() } = {}) {
  const cache = getMarketplaceCacheState();
  if (cache.data && now - cache.ts < TTL_MS) return cache.data;
  if (inflight) return inflight;
  inflight = fetchAll(now)
    .then((data) => {
      setMarketplaceCacheState(data, now);
      return data;
    })
    .catch((err) => {
      logger.error({ err: err?.message }, 'marketplace.refresh_failed');
      const stale = getMarketplaceCacheState();
      if (stale.data && now - stale.ts < MAX_STALE_MS) return stale.data;
      throw err;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Public detail by slug — always composed live (no cache) so state changes
 * (sold out, paused) are immediate. Returns null when the campaign fails the
 * publication gate entirely; returns a DTO with ops:null when the campaign is
 * listed but its ops chain is currently unserviceable (front-end renders the
 * ended/sold-out state).
 */
export async function getMarketplaceCampaign(slug, { now = new Date() } = {}) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{3,80}$/.test(slug)) return null;
  const campaign = await Campaign.findOne({ where: { slug }, attributes: CAMPAIGN_ATTRS });
  if (!campaign || !passesStaticGate(campaign)) return null;
  const ops = await composeOps(campaign.id, { now });
  return toDto(campaign, ops);
}

/**
 * Authenticated designer preview — same DTO composition WITHOUT the
 * publication gate (drafts, unlisted, pre-slug campaigns all preview).
 * Routed behind authenticateToken; never mounted publicly.
 */
export async function previewMarketplaceCampaign(campaignId, { now = new Date() } = {}) {
  const campaign = await Campaign.findByPk(campaignId, { attributes: CAMPAIGN_ATTRS });
  if (!campaign) return null;
  const ops = await composeOps(campaign.id, { now });
  const dto = toDto(campaign, ops);
  dto.gate = {
    listed: passesStaticGate(campaign) && !!ops,
    slug: !!campaign.slug,
    active: campaign.is_active === true && campaign.status === 'active',
    marketplaceListed: campaign.design_config?.marketplaceListed === true,
    redeemHost: normalizeCustomerHostChoice(campaign.design_config?.customerHost) === 'redeem',
    supportedType: MARKETPLACE_CAMPAIGN_TYPES.includes(campaign.type || 'lead_generation'),
    opsResolvable: !!ops,
  };
  return dto;
}

/** Slug availability for the designer (authenticated). */
export async function checkSlugAvailability(slug, { excludeCampaignId } = {}) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{3,80}$/.test(slug)) {
    return { valid: false, available: false };
  }
  const where = { slug };
  if (excludeCampaignId) where.id = { [Op.ne]: excludeCampaignId };
  const existing = await Campaign.findOne({ where, attributes: ['id'] });
  return { valid: true, available: !existing };
}

/** Test hook — module cache is process state; reset between cases. */
export function __resetMarketplaceCache() {
  setMarketplaceCacheState(null, 0);
  inflight = null;
}
