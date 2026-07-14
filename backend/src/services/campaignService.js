import crypto from 'crypto';
import { Op } from 'sequelize';
import { Campaign, QrTag, Prospect, Commission, Device, CampaignMediaItem, CampaignAgentAssignment, DrawTermsVersion, sequelize } from '../models/index.js';
import { getTenantId } from '../middleware/tenant.js';
import { storageService } from './storage.js';
import { AppError } from '../middleware/errorHandler.js';
import { normalizeCustomerHostChoice } from '../utils/customerHost.js';
import { applyFeaturedDropPolicy } from '../utils/featuredDrop.js';
import { applyLuckyDrawPolicy } from '../utils/luckyDraw.js';
import { normalizeMarketplaceContent, applyMarketplacePolicy } from '../utils/marketplaceContent.js';
import { invalidateMarketplaceCache } from './marketplaceCache.js';

const SLUG_RE = /^[a-z0-9-]{3,80}$/;

// design_config keys owned by the marketplace normalizer — raw incoming values
// for these are replaced wholesale by their normalized versions (or dropped).
const MARKETPLACE_CONTENT_KEYS = [
  'name', 'category', 'offer_type', 'mode', 'qr_entry', 'age_range',
  'school_levels', 'dsa_related', 'showCapacity', 'availability', 'inclusions',
  'image_label', 'activation', 'sponsor', 'value_line', 'content_blocks',
];

/**
 * Clamp the security-sensitive keys of a design_config before persisting.
 * customerHost: enum clamp (never trust a raw host from client JSON).
 * featuredDrop: publication to the public redeem.sg homepage — admin-only to
 * change; non-admins keep whatever is already stored (see utils/featuredDrop.js).
 * luckyDraw: draw-campaign enforcement settings — admin-only, same policy
 * (see utils/luckyDraw.js and docs/plans/lucky-draw-10x.md §4.1).
 */
function clampDesignConfig(incoming, storedConfig, role) {
  if (!incoming || typeof incoming !== 'object') return incoming;
  const clamped = { ...incoming, customerHost: normalizeCustomerHostChoice(incoming.customerHost) };
  const featuredDrop = applyFeaturedDropPolicy({
    incoming: incoming.featuredDrop,
    stored: storedConfig?.featuredDrop,
    role,
  });
  if (featuredDrop === undefined) delete clamped.featuredDrop;
  else clamped.featuredDrop = featuredDrop;
  const luckyDraw = applyLuckyDrawPolicy({
    incoming: incoming.luckyDraw,
    stored: storedConfig?.luckyDraw,
    role,
  });
  if (luckyDraw === undefined) delete clamped.luckyDraw;
  else clamped.luckyDraw = luckyDraw;

  // Marketplace content keys: normalized wholesale (echoed on public
  // /offers pages — see utils/marketplaceContent.js). Raw values replaced.
  for (const key of MARKETPLACE_CONTENT_KEYS) delete clamped[key];
  Object.assign(clamped, normalizeMarketplaceContent(incoming));

  // marketplaceListed is the ONLY consumer-exposure switch — admin-only, like
  // featuredDrop (campaign PUT is open to agents, who can flip is_active).
  const listed = applyMarketplacePolicy({
    incoming: incoming.marketplaceListed,
    stored: storedConfig?.marketplaceListed,
    role,
  });
  if (listed === undefined) delete clamped.marketplaceListed;
  else clamped.marketplaceListed = listed;
  return clamped;
}

/**
 * Draw-terms versioning (docs/plans/lucky-draw-10x.md §4.6). For an enabled
 * lucky draw, pin the CURRENT designer T&C content as an append-only
 * draw_terms_versions row and stamp its id + hash into luckyDraw, so each
 * entrant's acceptance (consentMetadata.drawTerms) references immutable
 * content — editing termsContent later mints a NEW version instead of
 * rewriting what earlier entrants agreed to.
 *
 * Canonical bytes = the TRIMMED raw designer HTML (design_config.termsContent).
 * Idempotent: unchanged content re-resolves to the existing version row.
 * Exported for tests; `d` is a DI seam (defaults to the real model).
 */
export async function ensureDrawTermsVersion(designConfig, campaignId, userId, d = { DrawTermsVersion }) {
  const ld = designConfig?.luckyDraw;
  if (!ld || ld.enabled !== true) return designConfig;
  // An enabled draw without a close date would accept public entries forever
  // while createDraw refuses the config — never persistable (normalization
  // already dropped any malformed date, so absence here means absence/invalid).
  if (!ld.closesAt) {
    throw new AppError(
      'Lucky-draw campaigns need a valid luckyDraw.closesAt (YYYY-MM-DD) before they can be enabled.',
      422
    );
  }
  const content = typeof designConfig.termsContent === 'string' ? designConfig.termsContent.trim() : '';
  if (!content) {
    throw new AppError(
      'Lucky-draw campaigns need Terms & Conditions content (designer → Terms & Conditions) before they can be enabled.',
      422
    );
  }
  const contentSha256 = crypto.createHash('sha256').update(content).digest('hex');
  let row = await d.DrawTermsVersion.findOne({
    where: { campaignId, contentSha256 },
    order: [['version', 'DESC']],
  });
  if (!row) {
    const latest = await d.DrawTermsVersion.max('version', { where: { campaignId } });
    try {
      row = await d.DrawTermsVersion.create({
        campaignId,
        version: (Number.isInteger(latest) ? latest : 0) + 1,
        content,
        contentSha256,
        createdBy: userId,
      });
    } catch (err) {
      // Concurrent save minted the same version number — the content row we
      // need either exists now (same hash) or the retry below surfaces the error.
      row = await d.DrawTermsVersion.findOne({ where: { campaignId, contentSha256 } });
      if (!row) throw err;
    }
  }
  return { ...designConfig, luckyDraw: { ...ld, termsVersionId: row.id, termsHash: contentSha256 } };
}

/**
 * Compute campaign metrics from real data (no JSON blob).
 * Replaces the old read-modify-write `campaign.metrics` pattern that had a race condition.
 */
export async function computeCampaignMetrics(campaignId) {
  const [leads, conversions, scans, revenue] = await Promise.all([
    Prospect.count({ where: { campaignId } }),
    Prospect.count({ where: { campaignId, leadStatus: 'won' } }),
    QrTag.sum('scanCount', { where: { campaignId } }).then(v => v || 0),
    Commission.sum('amount', { where: { campaignId, status: 'paid' } }).then(v => v || 0),
  ]);

  return {
    leads,
    conversions,
    views: scans,
    clicks: scans,
    revenue,
    referrals: 0,
  };
}

/**
 * Build tenant-aware WHERE clause for campaigns, scoped by user role.
 */
function buildCampaignWhere(req, extra = {}) {
  const where = { ...extra };

  try {
    const hasTenantId = !!Campaign.rawAttributes.tenant_id;
    if (hasTenantId) {
      where.tenant_id = getTenantId(req);
    }
  } catch (_) { /* skip in dev */ }

  if (req.user.role !== 'admin') {
    where[Op.or] = [
      { createdBy: req.user.id },
      { isPublic: true }
    ];
  }

  return where;
}

function buildOwnerWhere(req, extra = {}) {
  const where = { ...extra };

  try {
    const hasTenantId = !!Campaign.rawAttributes.tenant_id;
    if (hasTenantId) {
      where.tenant_id = getTenantId(req);
    }
  } catch (_) { /* tenant column may not exist */ }

  if (req.user.role !== 'admin') {
    where.createdBy = req.user.id;
  }

  return where;
}

/**
 * List campaigns with pagination, filtering, and role-based scoping.
 */
export async function listCampaigns(user, query, req) {
  const { page = 1, limit = 10, status, type, search, createdBy } = query;
  // Clamp pagination so malformed query params (?page=-1&limit=-5, ?page=abc)
  // don't reach Sequelize as a negative/NaN LIMIT/OFFSET, which throws → 500.
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 10), 200);
  const offset = (pageNum - 1) * limitNum;

  const where = buildCampaignWhere(req);

  if (status) where.status = status;
  if (type) where.type = type;
  if (createdBy && user.role === 'admin') where.createdBy = createdBy;

  if (search) {
    const sanitizedSearch = String(search).slice(0, 100).replace(/%/g, '\\%').replace(/_/g, '\\_');
    where[Op.or] = [
      { name: { [Op.iLike]: `%${sanitizedSearch}%` } },
      { description: { [Op.iLike]: `%${sanitizedSearch}%` } }
    ];
  }

  const { count, rows: campaigns } = await Campaign.findAndCountAll({
    where,
    limit: limitNum,
    offset,
    order: [['createdAt', 'DESC']],
    attributes: {
      include: [
        [sequelize.literal('(SELECT COUNT(*) FROM prospects WHERE prospects."campaignId" = "Campaign".id)'), 'prospectCount'],
        [sequelize.literal('(SELECT COUNT(*) FROM qr_tags WHERE qr_tags."campaignId" = "Campaign".id)'), 'qrTagCount'],
        [sequelize.literal('(SELECT COALESCE(SUM("scanCount"), 0) FROM qr_tags WHERE qr_tags."campaignId" = "Campaign".id)'), 'totalScans'],
      ]
    },
    include: [
      { association: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'] },
      { association: 'mediaItems', attributes: ['id', 'mediaType', 'url', 'durationSecs', 'sortOrder'] },
      { association: 'assignedAgents', attributes: ['id', 'firstName', 'lastName', 'email'] }
    ]
  });

  // Attach backward-compatible virtual fields
  const campaignsJson = campaigns.map(c => {
    const plain = c.toJSON();
    plain.ad_playlist = mediaItemsToPlaylist(plain.mediaItems);
    plain.assigned_agents = agentsToIdList(plain.assignedAgents);
    return plain;
  });

  return {
    campaigns: campaignsJson,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(count / limitNum),
      totalItems: count,
      itemsPerPage: limitNum
    }
  };
}

/**
 * Get a single campaign by ID with full associations.
 */
export async function getCampaign(id, req) {
  const where = buildCampaignWhere(req, { id });

  const campaign = await Campaign.findOne({
    where,
    include: [
      { association: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'] },
      {
        association: 'qrTags',
        attributes: ['id', 'label', 'name', 'type', 'campaignId', 'carId'],
        include: [{ association: 'car', attributes: ['id', 'make', 'model', 'plate_number'] }]
      },
      {
        association: 'prospects',
        attributes: ['id', 'firstName', 'lastName', 'email', 'leadStatus', 'assignedAgentId'],
        include: [{ association: 'assignedAgent', attributes: ['id', 'firstName', 'lastName', 'email'] }]
      },
      { association: 'leadPackages', attributes: ['id', 'name', 'type', 'price', 'leadCount'] },
      { association: 'mediaItems', attributes: ['id', 'mediaType', 'url', 'durationSecs', 'sortOrder'] },
      { association: 'assignedAgents', attributes: ['id', 'firstName', 'lastName', 'email'] }
    ]
  });

  if (!campaign) throw new AppError('Campaign not found', 404);

  // Attach backward-compatible virtual fields
  const plain = campaign.toJSON();
  plain.ad_playlist = mediaItemsToPlaylist(plain.mediaItems);
  plain.assigned_agents = agentsToIdList(plain.assignedAgents);
  return plain;
}

/**
 * Create a new campaign.
 */
export async function createCampaign(body, user) {
  const { name, min_age, max_age, start_date, end_date, is_active, assigned_agents, commission_amount_driver, commission_amount_fleet, defaultAssignmentMode, ad_playlist, enforceLeadQuota } = body;

  // Defense-in-depth: strip HTML tags from the name so a stored payload like
  // `<img src=x onerror=...>` can't ride along into any surface that renders it
  // unescaped (e.g. PDF/email templates), independent of frontend escaping.
  const safeName = typeof name === 'string' ? name.replace(/<[^>]*>/g, '').trim() : name;

  const campaignData = {
    name: safeName,
    min_age: min_age || 18,
    max_age: max_age || 65,
    start_date,
    end_date,
    is_active: is_active !== undefined ? is_active : true,
    createdBy: user.id,
    status: is_active ? 'active' : 'draft',
    type: body.type || 'lead_generation'
  };
  if (campaignData.is_active) campaignData.firstActivatedAt = new Date();
  if (body.slug !== undefined && body.slug !== null && body.slug !== '') {
    const slug = String(body.slug).trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      throw new AppError('Slug must be 3-80 chars of lowercase letters, digits and hyphens.', 422);
    }
    campaignData.slug = slug;
  }
  if (commission_amount_driver !== undefined) campaignData.commission_amount_driver = commission_amount_driver;
  if (commission_amount_fleet !== undefined) campaignData.commission_amount_fleet = commission_amount_fleet;
  if (defaultAssignmentMode !== undefined) campaignData.defaultAssignmentMode = defaultAssignmentMode;
  if (enforceLeadQuota !== undefined) campaignData.enforceLeadQuota = enforceLeadQuota;
  if (body.metaPixelId !== undefined) campaignData.metaPixelId = body.metaPixelId || null;
  if (body.tiktokPixelId !== undefined) campaignData.tiktokPixelId = body.tiktokPixelId || null;
  // Allow design_config at creation time (mirrors updateCampaign) so a campaign
  // can be created with its designer config in one call, not create-then-update.
  if (body.design_config !== undefined) {
    campaignData.design_config = clampDesignConfig(body.design_config, undefined, user?.role);
  }

  // Draw terms need the campaign id for the version row, but the requirements
  // must fail BEFORE the row exists — no half-created draw campaign. (A crash
  // between Campaign.create and the terms pin below still self-heals: the next
  // design_config save re-runs ensureDrawTermsVersion idempotently.)
  if (campaignData.design_config?.luckyDraw?.enabled === true) {
    if (!campaignData.design_config.luckyDraw.closesAt) {
      throw new AppError(
        'Lucky-draw campaigns need a valid luckyDraw.closesAt (YYYY-MM-DD) before they can be enabled.',
        422
      );
    }
    const terms = typeof campaignData.design_config.termsContent === 'string'
      ? campaignData.design_config.termsContent.trim() : '';
    if (!terms) {
      throw new AppError(
        'Lucky-draw campaigns need Terms & Conditions content (designer → Terms & Conditions) before they can be enabled.',
        422
      );
    }
  }

  let campaign;
  try {
    campaign = await Campaign.create(campaignData);
  } catch (err) {
    if (err?.name === 'SequelizeUniqueConstraintError') {
      throw new AppError('That marketplace slug is already taken by another campaign.', 409);
    }
    throw err;
  }
  invalidateMarketplaceCache();

  if (campaignData.design_config?.luckyDraw?.enabled === true) {
    const withTerms = await ensureDrawTermsVersion(campaignData.design_config, campaign.id, user.id);
    await campaign.update({ design_config: withTerms });
  }

  // Write agent assignments to join table
  if (assigned_agents && Array.isArray(assigned_agents) && assigned_agents.length > 0) {
    await syncAgentAssignments(campaign.id, assigned_agents);
  }

  // Write media items to normalized table
  if (ad_playlist && Array.isArray(ad_playlist) && ad_playlist.length > 0) {
    await syncMediaItems(campaign.id, ad_playlist);
  }

  // Return with backward-compatible virtual fields for API compatibility
  const mediaItems = await CampaignMediaItem.findAll({
    where: { campaignId: campaign.id },
    order: [['sortOrder', 'ASC']]
  });
  const agentRows = await CampaignAgentAssignment.findAll({
    where: { campaignId: campaign.id },
    attributes: ['agentId']
  });
  const plain = campaign.toJSON();
  plain.mediaItems = mediaItems.map(m => m.toJSON());
  plain.ad_playlist = mediaItemsToPlaylist(plain.mediaItems);
  plain.assigned_agents = agentRows.map(r => r.agentId);
  return plain;
}

/**
 * Update a campaign. Triggers device fan-out if content changed.
 */
export async function updateCampaign(id, body, req) {
  const where = buildOwnerWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);

  const { name, type, min_age, max_age, start_date, end_date, is_active, assigned_agents, design_config, commission_amount_driver, commission_amount_fleet, defaultAssignmentMode, ad_playlist, enforceLeadQuota } = body;

  const updateData = {};
  if (name) updateData.name = name;
  if (type !== undefined) updateData.type = type;
  if (min_age !== undefined) updateData.min_age = min_age;
  if (max_age !== undefined) updateData.max_age = max_age;
  if (start_date) updateData.start_date = start_date;
  if (end_date) updateData.end_date = end_date;
  if (is_active !== undefined) {
    updateData.is_active = is_active;
    updateData.status = is_active ? 'active' : 'draft';
    // Durable "ever activated" anchor — locks the marketplace slug (066).
    if (is_active && !campaign.firstActivatedAt) updateData.firstActivatedAt = new Date();
  }
  if (body.slug !== undefined) {
    const incomingSlug = body.slug === null || body.slug === ''
      ? null
      : String(body.slug).trim().toLowerCase();
    const stored = campaign.slug || null;
    if (incomingSlug !== stored) {
      if (campaign.firstActivatedAt) {
        throw new AppError('The marketplace slug is locked once a campaign has been activated.', 409);
      }
      if (incomingSlug !== null && !SLUG_RE.test(incomingSlug)) {
        throw new AppError('Slug must be 3-80 chars of lowercase letters, digits and hyphens.', 422);
      }
      updateData.slug = incomingSlug;
    }
  }
  if (design_config !== undefined) {
    // Clamp the per-campaign customer host to the enum (never trust a raw host
    // from client JSON) and gate featuredDrop/luckyDraw changes to admins;
    // preserve all other design keys untouched.
    updateData.design_config = clampDesignConfig(design_config, campaign.design_config, req.user?.role);
    // Enabled draws pin their T&C content as an immutable version (also catches
    // termsContent edits on saves that didn't touch luckyDraw itself — the
    // clamp preserved the stored luckyDraw, and unchanged content is a no-op).
    updateData.design_config = await ensureDrawTermsVersion(updateData.design_config, campaign.id, req.user?.id);
  }
  if (commission_amount_driver !== undefined) updateData.commission_amount_driver = commission_amount_driver;
  if (commission_amount_fleet !== undefined) updateData.commission_amount_fleet = commission_amount_fleet;
  if (defaultAssignmentMode !== undefined) updateData.defaultAssignmentMode = defaultAssignmentMode;
  if (enforceLeadQuota !== undefined) updateData.enforceLeadQuota = enforceLeadQuota;
  if (body.metaPixelId !== undefined) updateData.metaPixelId = body.metaPixelId || null;
  if (body.tiktokPixelId !== undefined) updateData.tiktokPixelId = body.tiktokPixelId || null;

  try {
    await campaign.update(updateData);
  } catch (err) {
    if (err?.name === 'SequelizeUniqueConstraintError') {
      throw new AppError('That marketplace slug is already taken by another campaign.', 409);
    }
    throw err;
  }
  invalidateMarketplaceCache();

  // Sync agent assignments to join table when assigned_agents is provided
  if (assigned_agents !== undefined) {
    await syncAgentAssignments(id, assigned_agents || []);
  }

  // Sync media items to normalized table when ad_playlist is provided
  if (ad_playlist !== undefined) {
    await syncMediaItems(id, ad_playlist || []);
  }

  // Fan-out: notify devices assigned to this campaign
  await notifyDevices(id);

  // Return with backward-compatible virtual fields for API compatibility
  const mediaItems = await CampaignMediaItem.findAll({
    where: { campaignId: id },
    order: [['sortOrder', 'ASC']]
  });
  const agentRows = await CampaignAgentAssignment.findAll({
    where: { campaignId: id },
    attributes: ['agentId']
  });
  const plain = campaign.toJSON();
  plain.mediaItems = mediaItems.map(m => m.toJSON());
  plain.ad_playlist = mediaItemsToPlaylist(plain.mediaItems);
  plain.assigned_agents = agentRows.map(r => r.agentId);
  return plain;
}

/**
 * Set a campaign's launch state to 'active' or 'paused'.
 *
 * Dedicated path (NOT updateCampaign) so we never trip its is_active→draft
 * mapping: pausing sets status='paused' (not 'draft'). Rejects archived
 * campaigns (status changes there go through restore/archive), and fans out a
 * device manifest refresh exactly like updateCampaign — PHV tablets only serve
 * status:'active' campaigns, so activate/pause must re-notify devices.
 * Readiness gating (block activate when not ready) is enforced by the caller
 * (controller) so it can return the readiness payload on a 409.
 */
export async function setCampaignLaunchState(id, state, req) {
  if (!['active', 'paused'].includes(state)) {
    throw new AppError('Invalid launch state', 400);
  }
  const where = buildOwnerWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);
  if (campaign.status === 'archived') {
    throw new AppError('Archived campaigns cannot be activated or paused. Restore it first.', 400);
  }

  const isActive = state === 'active';
  await campaign.update({
    is_active: isActive,
    status: isActive ? 'active' : 'paused',
    ...(isActive && !campaign.firstActivatedAt ? { firstActivatedAt: new Date() } : {}),
  });
  invalidateMarketplaceCache();

  // Fan-out: refresh device manifests (same as updateCampaign content changes).
  await notifyDevices(id);

  return campaign.toJSON();
}

/**
 * Soft-delete (archive) a campaign.
 */
export async function archiveCampaign(id, req) {
  const where = buildOwnerWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);

  if (campaign.status === 'archived') {
    throw new AppError('Campaign is already archived', 400);
  }

  await campaign.update({ status: 'archived' });
  await detachCarQrTags(id);
  return campaign;
}

/**
 * Restore a campaign from archived state.
 */
export async function restoreCampaign(id, req) {
  const where = buildOwnerWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);

  if (campaign.status !== 'archived') {
    throw new AppError('Campaign is not archived', 400);
  }

  await campaign.update({ status: 'draft' });
  return campaign;
}

/**
 * Permanently delete an archived campaign and its storage assets.
 * SET NULL FK rules handle child cleanup (qr_tags, prospects, commissions, etc.) automatically.
 */
export async function permanentlyDeleteCampaign(id, req) {
  const where = buildOwnerWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);

  if (campaign.status !== 'archived') {
    throw new AppError('Campaign must be archived before permanent deletion', 400);
  }

  // Block deletion if campaign has pending/approved commissions
  const commissionCount = await Commission.count({
    where: { campaignId: id, status: { [Op.in]: ['pending', 'approved'] } }
  });
  if (commissionCount > 0) {
    throw new AppError('Cannot delete campaign with pending/approved commissions', 409);
  }

  await deleteStorageAssets(campaign);
  await campaign.destroy();
}

/**
 * Duplicate a campaign (reset metrics).
 */
export async function duplicateCampaign(id, body, req) {
  const where = buildCampaignWhere(req, { id });
  const original = await Campaign.findOne({ where });
  if (!original) throw new AppError('Campaign not found or access denied', 404);

  const { metrics: _discardedMetrics, ...rest } = original.toJSON();
  // Never clone homepage publication: a duplicate of a featured campaign must
  // not silently appear on redeem.sg when it is later activated. Never clone
  // luckyDraw either — its dates, activation, and terms version are all
  // campaign-specific (docs/plans/lucky-draw-10x.md §4.1); a duplicate must be
  // deliberately re-enabled as its own draw.
  const dupDesign = (() => {
    if (!rest.design_config || typeof rest.design_config !== 'object') return rest.design_config;
    // marketplaceListed never clones either — a duplicate of a listed campaign
    // must not silently appear on the public marketplace when activated.
    const { luckyDraw: _neverCloneDraw, marketplaceListed: _neverCloneListing, ...base } = rest.design_config;
    return {
      ...base,
      ...(rest.design_config.featuredDrop && typeof rest.design_config.featuredDrop === 'object'
        ? { featuredDrop: { ...rest.design_config.featuredDrop, enabled: false } }
        : {}),
    };
  })();
  const copy = await Campaign.create({
    ...rest,
    design_config: dupDesign,
    id: undefined,
    name: body.name || `${original.name} (Copy)`,
    status: 'draft',
    createdBy: req.user.id,
    spentAmount: 0,
    // slug is unique and locked to the original; firstActivatedAt is the
    // original's activation history — a copy starts with neither.
    slug: null,
    firstActivatedAt: null,
    createdAt: undefined,
    updatedAt: undefined
  });

  // Duplicate agent assignments from the original campaign
  const originalAgents = await CampaignAgentAssignment.findAll({
    where: { campaignId: id },
    attributes: ['agentId']
  });
  if (originalAgents.length > 0) {
    await CampaignAgentAssignment.bulkCreate(
      originalAgents.map(a => ({ campaignId: copy.id, agentId: a.agentId }))
    );
  }

  // Duplicate media items from the original campaign
  const originalMedia = await CampaignMediaItem.findAll({
    where: { campaignId: id },
    order: [['sortOrder', 'ASC']]
  });
  if (originalMedia.length > 0) {
    await CampaignMediaItem.bulkCreate(
      originalMedia.map(m => ({
        campaignId: copy.id,
        mediaType: m.mediaType,
        url: m.url,
        durationSecs: m.durationSecs,
        sortOrder: m.sortOrder
      }))
    );
  }

  // Return with backward-compatible virtual fields
  const mediaItems = await CampaignMediaItem.findAll({
    where: { campaignId: copy.id },
    order: [['sortOrder', 'ASC']]
  });
  const agentRows = await CampaignAgentAssignment.findAll({
    where: { campaignId: copy.id },
    attributes: ['agentId']
  });
  const plain = copy.toJSON();
  plain.mediaItems = mediaItems.map(m => m.toJSON());
  plain.ad_playlist = mediaItemsToPlaylist(plain.mediaItems);
  plain.assigned_agents = agentRows.map(r => r.agentId);
  return plain;
}

/**
 * Get campaign analytics (QR + prospect funnel).
 */
export async function getCampaignAnalytics(id, req) {
  const where = buildCampaignWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);

  const qrTags = await QrTag.findAll({
    where: { campaignId: id },
    attributes: ['id', 'name', 'scanCount', 'uniqueScanCount', 'lastScanned', 'analytics']
  });

  const prospectStats = await Prospect.findAll({
    where: { campaignId: id },
    attributes: [
      'leadStatus',
      [sequelize.fn('COUNT', sequelize.col('leadStatus')), 'count']
    ],
    group: ['leadStatus']
  });

  const totalProspects = await Prospect.count({ where: { campaignId: id } });
  const qualifiedProspects = await Prospect.count({
    where: { campaignId: id, leadStatus: ['qualified', 'proposal_sent', 'negotiating', 'won'] }
  });
  const convertedProspects = await Prospect.count({
    where: { campaignId: id, leadStatus: 'won' }
  });

  const metrics = await computeCampaignMetrics(id);

  return {
    campaign: {
      metrics,
      totalQrTags: qrTags.length,
      totalScans: qrTags.reduce((sum, tag) => sum + tag.scanCount, 0),
      totalUniqueScans: qrTags.reduce((sum, tag) => sum + tag.uniqueScanCount, 0)
    },
    prospects: {
      total: totalProspects,
      qualified: qualifiedProspects,
      converted: convertedProspects,
      conversionRate: totalProspects > 0 ? (convertedProspects / totalProspects * 100).toFixed(2) : 0,
      byStatus: prospectStats.map(stat => ({
        status: stat.leadStatus,
        count: parseInt(stat.dataValues.count)
      }))
    },
    qrTags: qrTags.map(tag => ({
      id: tag.id,
      name: tag.name,
      scanCount: tag.scanCount,
      uniqueScanCount: tag.uniqueScanCount,
      lastScanned: tag.lastScanned,
      conversionRate: tag.scanCount > 0
        ? ((tag.analytics?.conversions || 0) / tag.scanCount * 100).toFixed(2) : 0
    }))
  };
}

/**
 * Get computed campaign metrics (read-only).
 * Replaces the old read-modify-write updateCampaignMetrics that had a race condition.
 * The PATCH endpoint is kept for backward compatibility but is now a no-op write —
 * it returns the computed metrics from real data.
 */
export async function updateCampaignMetrics(id, _metrics, req) {
  const where = buildOwnerWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);

  // Attach computed metrics so the response format stays the same
  const computed = await computeCampaignMetrics(id);
  const plain = campaign.toJSON();
  plain.metrics = computed;
  return plain;
}

// ---- Internal helpers ----

async function detachCarQrTags(campaignId) {
  try {
    await QrTag.update({ campaignId: null }, { where: { campaignId, type: 'car' } });
  } catch (_) { /* non-fatal */ }
}

async function deleteStorageAssets(campaign) {
  if (!storageService.isEnabled()) return;

  const mediaItems = await CampaignMediaItem.findAll({
    where: { campaignId: campaign.id },
    attributes: ['url']
  });
  if (mediaItems.length === 0) return;

  const deletePromises = mediaItems.map(async (item) => {
    if (!item.url) return;
    try {
      const urlObj = new URL(item.url);
      const key = urlObj.pathname.substring(1);
      if (key && key.length > 1) await storageService.deleteObject(key);
    } catch (_) { /* continue */ }
  });
  await Promise.allSettled(deletePromises);
}

/**
 * Sync media items from an ad_playlist array to the campaign_media_items table.
 * Replaces all existing rows for the campaign (delete + re-insert in a transaction).
 */
/**
 * Sync agent assignments to the join table.
 * Accepts an array of agent IDs (UUIDs) or objects with { id }.
 * Handles both shapes for backward compatibility with the old JSON column.
 */
async function syncAgentAssignments(campaignId, agents) {
  if (!Array.isArray(agents)) return;

  // Normalize: extract UUID from either string or { id } object
  const agentIds = agents
    .map(a => (typeof a === 'string' ? a : a?.id))
    .filter(id => id && typeof id === 'string' && id.length > 0);

  // Deduplicate
  const uniqueIds = [...new Set(agentIds)];

  await sequelize.transaction(async (t) => {
    await CampaignAgentAssignment.destroy({ where: { campaignId }, transaction: t });

    if (uniqueIds.length > 0) {
      await CampaignAgentAssignment.bulkCreate(
        uniqueIds.map(agentId => ({ campaignId, agentId })),
        { transaction: t }
      );
    }
  });
}

/**
 * Convert assignedAgents association (User objects from join) to a flat array of UUIDs
 * for backward-compatible API responses.
 */
function agentsToIdList(assignedAgents) {
  if (!assignedAgents || !Array.isArray(assignedAgents)) return [];
  return assignedAgents.map(a => a.id);
}

async function syncMediaItems(campaignId, playlist) {
  if (!Array.isArray(playlist)) return;

  await sequelize.transaction(async (t) => {
    // Remove existing rows
    await CampaignMediaItem.destroy({ where: { campaignId }, transaction: t });

    // Insert new rows
    if (playlist.length > 0) {
      const rows = playlist
        .filter(item => item && item.url)
        .map((item, idx) => ({
          campaignId,
          mediaType: item.type || 'video',
          url: item.url,
          durationSecs: normalizeDuration(item.duration),
          sortOrder: idx
        }));

      if (rows.length > 0) {
        await CampaignMediaItem.bulkCreate(rows, { transaction: t });
      }
    }
  });
}

/**
 * Convert duration from frontend format (may be milliseconds or seconds) to seconds.
 */
function normalizeDuration(duration) {
  if (duration == null) return null;
  const num = parseInt(duration, 10);
  if (isNaN(num)) return null;
  // Frontend sends milliseconds (e.g. 10000 for 10s); normalize to seconds
  return num > 1000 ? Math.round(num / 1000) : num;
}

/**
 * Convert normalized mediaItems rows back to the legacy ad_playlist JSON shape
 * so existing frontend code continues to work without changes.
 */
function mediaItemsToPlaylist(mediaItems) {
  if (!mediaItems || !Array.isArray(mediaItems)) return [];
  return mediaItems
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map(m => ({
      id: m.id,
      type: m.mediaType,
      url: m.url,
      duration: m.durationSecs != null ? m.durationSecs * 1000 : 0
    }));
}

async function notifyDevices(campaignId) {
  try {
    const { pushService } = await import('./pushService.js');
    const affectedDevices = await Device.findAll({
      where: {
        [Op.or]: [
          { campaignId },
          { campaignIds: { [Op.contains]: [campaignId] } }
        ]
      },
      attributes: ['id']
    });

    affectedDevices.forEach(d => {
      pushService.sendEvent(d.id, 'REFRESH_MANIFEST', {
        timestamp: Date.now(),
        reason: 'campaign_content_update'
      });
    });
  } catch (_) { /* non-fatal */ }
}
