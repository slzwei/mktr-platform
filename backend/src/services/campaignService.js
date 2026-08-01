import crypto from 'crypto';
import { Op } from 'sequelize';
import { Campaign, QrTag, Prospect, CampaignAgentAssignment, DrawTermsVersion, Draw, sequelize } from '../models/index.js';
import { getTenantId } from '../middleware/tenant.js';
import { storageService } from './storage.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { normalizeCustomerHostChoice } from '../utils/customerHost.js';
import { sgtDayEndExclusiveMs } from '../utils/sgtTime.js';
import { applyFeaturedDropPolicy } from '../utils/featuredDrop.js';
import { applyLuckyDrawPolicy, normalizeLuckyDraw, totalPrizeQuantity } from '../utils/luckyDraw.js';
import { PASS_THEMES } from '../utils/drawTheme.js';
import { normalizeMarketplaceContent, applyMarketplacePolicy } from '../utils/marketplaceContent.js';
import { normalizeBrief, deriveArchetype, hasBrief } from '../utils/campaignBrief.js';
import { buildDrawTermsHtml } from '../utils/drawTermsTemplate.js';
import { checkDrawConsistency } from '../utils/drawConsistency.js';
import {
  classifyDesignConfigVersion,
  clampDesignConfigV2,
  designConfigV2WritesEnabled,
  getStoredTermsHtml,
  getStoredLuckyDraw,
} from '../utils/designConfigV2Clamp.js';
import { invalidateMarketplaceCache } from './marketplaceCache.js';
import { invalidateFeaturedDropsCache } from './featuredDropsService.js';
import { bustScoringConfigCache } from './scoringConfigCache.js';
import { refundCampaignCommitments } from './walletService.js';

/**
 * Boost-rail ensure hook (PR-2, draw-launch-integrity §5.1 / old-plan F2).
 * Lazy dynamic import: campaignService's static graph feeds many unit suites
 * that never touch draws — the redeemOps model surface must not enter it.
 */
async function ensureRail(args) {
  const mod = await import('./redeemOps/drawBoostProvisioningService.js');
  return mod.ensureDrawBoostRail(args);
}
/**
 * Draw-RECORD ensure hook — the engine row chances/freeze/seal run on, born
 * at the same arming moments as the rail so no operator ever runs the CLI
 * create step by hand. BEST-EFFORT unlike the rail: a missing record loses
 * nothing (evidence accrues independently; the boot reconciler retries), so
 * this never throws and never blocks a save or launch. Same lazy-import +
 * test-seam shape as ensureRail.
 */
let _ensureDrawRecord = null;
export function setEnsureDrawRecord(fn) {
  _ensureDrawRecord = typeof fn === 'function' ? fn : null;
}
async function ensureRecord(args) {
  try {
    if (_ensureDrawRecord) return await _ensureDrawRecord(args);
    const mod = await import('./luckyDrawService.js');
    return await mod.ensureDrawRecord(args);
  } catch (err) {
    logger.warn('[Campaign] draw-record ensure failed (reconciler will retry)', { error: err?.message });
    return { created: false, reason: 'failed' };
  }
}
/** Write the ensured activationId into the doc's stored luckyDraw (both doc
 * versions keep `luckyDraw` top-level — loss-ledger L5). No-op on null. */
function stampRailActivationId(designConfig, activationId) {
  if (!activationId || !designConfig || typeof designConfig !== 'object') return designConfig;
  if (!designConfig.luckyDraw || typeof designConfig.luckyDraw !== 'object') return designConfig;
  return { ...designConfig, luckyDraw: { ...designConfig.luckyDraw, activationId } };
}
const drawEnabledIn = (doc) => normalizeLuckyDraw(getStoredLuckyDraw(doc))?.enabled === true;

/**
 * Promise-consistency gate (PR-3, draw-launch-integrity §3 / Codex R1
 * CX15/CX16): HARD contradictions between the campaign's facts and its
 * pinned-at-save T&Cs (prize, age bounds) 422 the ARMING and fact-touching
 * saves — the iPad-vs-iPhone / 21-vs-25 incident becomes unshippable. SOFT
 * findings (unparseable/ambiguous clauses, marketing divergence) surface via
 * readiness only, never block. Remediation is always regeneration through
 * the terms flow (a new pinned version) — `fix: 'regenerate_terms'`.
 */
function assertDrawPromiseConsistency({ minAge, maxAge, designConfig }) {
  const ld = normalizeLuckyDraw(getStoredLuckyDraw(designConfig));
  if (ld?.enabled !== true) return;
  const content = designConfig?.content || {};
  const { hard } = checkDrawConsistency({
    minAge: Number.isInteger(minAge) ? minAge : null,
    maxAge: Number.isInteger(maxAge) ? maxAge : null,
    luckyDraw: ld,
    termsHtml: getStoredTermsHtml(designConfig),
    contentHeadline: content.headline ?? designConfig?.formHeadline ?? '',
    contentStory: content.story ?? designConfig?.storyText ?? '',
  });
  if (hard.length > 0) {
    const err = new AppError(hard[0].message, 422);
    err.data = { code: hard[0].code, fix: 'regenerate_terms', issues: hard };
    throw err;
  }
}

/** Material draw facts for the fact-touching-save detector (PR-3/CX16). */
const drawFactsOf = (doc) => {
  const ld = normalizeLuckyDraw(getStoredLuckyDraw(doc)) || {};
  return JSON.stringify([ld.enabled, ld.prize, ld.prizes, ld.closesAt, ld.boostClosesAt, ld.multiplier]);
};

const SLUG_RE = /^[a-z0-9-]{3,80}$/;

/**
 * Strip HTML tags from a user-supplied campaign name. The name is interpolated
 * into HTML-string surfaces that do NOT escape (agent lead-/package-assignment
 * emails in mailer.js) and into generated draw terms, so a stored
 * `<img onerror=…>` must die at the door. ONE sanitiser for every write path —
 * create, update, duplicate — a PUT must not reintroduce what POST strips.
 * Non-strings pass through untouched for Joi/model validation to reject.
 */
export function sanitizeCampaignName(value) {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : value;
}

/** Wallet commit price: null/'' clears; else a positive integer in cents. */
function normalizeLeadPriceCents(value) {
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100000000) {
    throw new AppError('leadPriceCents must be a positive integer (cents) or null', 422);
  }
  return n;
}

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
export function clampDesignConfig(incoming, storedConfig, role) {
  if (!incoming || typeof incoming !== 'object') return incoming;
  // design_config v2 (Campaign Studio) dispatch. Version-tagged documents are
  // REJECTED until DESIGN_CONFIG_V2_WRITES_ENABLED flips on (PR 2/3 make every
  // reader version-aware first) — accepting one early would let a hybrid
  // payload bypass the admin publication policy and break the live v1 readers.
  // Untagged documents take the v1 path below, byte-for-byte as before.
  const versionClass = classifyDesignConfigVersion(incoming);
  if (versionClass !== 'legacy') {
    if (versionClass !== 'v2' || !designConfigV2WritesEnabled()) {
      const err = new AppError(
        'This design_config version is not accepted yet. Campaign Studio (v2) documents are gated until rollout completes.',
        422
      );
      err.data = { code: 'DESIGN_CONFIG_VERSION_UNSUPPORTED' };
      throw err;
    }
    return clampDesignConfigV2(incoming, storedConfig, role);
  }
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
  // F9 (PR-2): a draw campaign's homepage card must not outlive its draw — an
  // endsAt-less featuredDrop inherits luckyDraw.closesAt. Explicit endsAt wins.
  if (clamped.featuredDrop?.enabled === true && !clamped.featuredDrop.endsAt
      && luckyDraw?.enabled === true && luckyDraw.closesAt) {
    clamped.featuredDrop = { ...clamped.featuredDrop, endsAt: luckyDraw.closesAt };
  }

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
export async function ensureDrawTermsVersion(designConfig, campaignId, userId, d = { DrawTermsVersion, Draw }) {
  const ld = designConfig?.luckyDraw;
  if (!ld || ld.enabled !== true) return designConfig;
  // An enabled draw without a close date would accept public entries forever
  // while createDraw refuses the config — never persistable (normalization
  // already dropped any malformed date, so absence here means absence/invalid).
  // PR 5: draw 422s carry typed codes (write-gate precedent) so the Studio can
  // classify without message-sniffing.
  if (!ld.closesAt) {
    const err = new AppError(
      'Lucky-draw campaigns need a valid luckyDraw.closesAt (YYYY-MM-DD) before they can be enabled.',
      422
    );
    err.data = { code: 'DRAW_CLOSES_AT_REQUIRED' };
    throw err;
  }
  // PR 5 (Codex plan F3): while a LIVE draw record exists, the doc close date
  // is LOCKED to the record's cutoff. Entry acceptance follows the DOC while
  // the pool freeze follows the RECORD — letting the doc drift would accept
  // entrants the frozen pool silently excludes. Intentional changes go
  // through ops (void + recreate the draw), never a designer save.
  const DrawModel = d.Draw ?? Draw;
  const liveDraw = await DrawModel.findOne({
    where: { campaignId, status: ['open', 'frozen', 'sealed', 'drawn'] },
    attributes: ['id', 'closesAt'],
  });
  if (liveDraw) {
    const docEndMs = sgtDayEndExclusiveMs(ld.closesAt);
    const recordMs = new Date(liveDraw.closesAt).getTime();
    if (docEndMs !== null && Number.isFinite(recordMs) && docEndMs !== recordMs) {
      const err = new AppError(
        'The draw close date is locked while a live draw record exists — void and recreate the draw (Redeem Ops → Draws) to change it.',
        422
      );
      err.data = { code: 'DRAW_CLOSES_AT_LOCKED' };
      throw err;
    }
  }
  // Version-aware terms read: v1 termsContent / v2 form.terms.html.
  const content = getStoredTermsHtml(designConfig).trim();
  if (!content) {
    const err = new AppError(
      'Lucky-draw campaigns need Terms & Conditions content (designer → Terms & Conditions) before they can be enabled.',
      422
    );
    err.data = { code: 'DRAW_TERMS_REQUIRED' };
    throw err;
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
  const [leads, conversions, scans] = await Promise.all([
    Prospect.count({ where: { campaignId } }),
    Prospect.count({ where: { campaignId, leadStatus: 'won' } }),
    QrTag.sum('scanCount', { where: { campaignId } }).then(v => v || 0),
  ]);

  return {
    leads,
    conversions,
    views: scans,
    clicks: scans,
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
    // The role scope lives inside Op.and — never as a bare where[Op.or] — so a
    // later filter that also needs an OR group (e.g. the search filter) cannot
    // overwrite it. Assigning the same symbol key twice silently drops the
    // first group, which leaked every campaign to any authenticated user.
    where[Op.and] = [
      ...(where[Op.and] || []),
      { [Op.or]: [{ createdBy: req.user.id }, { isPublic: true }] }
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
  const { page = 1, limit = 10, status, type, search, createdBy, period } = query;
  // Clamp pagination so malformed query params (?page=-1&limit=-5, ?page=abc)
  // don't reach Sequelize as a negative/NaN LIMIT/OFFSET, which throws → 500.
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 10), 200);
  const offset = (pageNum - 1) * limitNum;

  // Phase B: validated rolling window for leadsThisPeriod (additive — every
  // existing key keeps its all-time semantics). The start date is computed
  // server-side and interpolated as an ISO literal (never user input).
  const periodDays = { '7d': 7, '30d': 30, '90d': 90 }[period] || 30;
  const periodStartIso = new Date(Date.now() - periodDays * 24 * 3600e3).toISOString();

  const where = buildCampaignWhere(req);

  if (status) where.status = status;
  if (type) where.type = type;
  if (createdBy && user.role === 'admin') where.createdBy = createdBy;

  if (search) {
    const sanitizedSearch = String(search).slice(0, 100).replace(/%/g, '\\%').replace(/_/g, '\\_');
    // Append inside Op.and — the role scope from buildCampaignWhere is an OR
    // group too, and both must hold at once.
    where[Op.and] = [
      ...(where[Op.and] || []),
      {
        [Op.or]: [
          { name: { [Op.iLike]: `%${sanitizedSearch}%` } },
          { description: { [Op.iLike]: `%${sanitizedSearch}%` } }
        ]
      }
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
        // Phase B aggregates (admin rebuild): period leads + open wallet-commitment
        // demand. All cast ::int so they serialize as JSON numbers (pg returns
        // bigint COUNT/SUM as strings otherwise); int32 bounds are ample here
        // (committedValueCents caps at ~S$21M before overflow — far beyond scale).
        [sequelize.literal('(SELECT COUNT(*) FROM prospects WHERE prospects."campaignId" = "Campaign".id)::int'), 'leadsTotal'],
        [sequelize.literal(`(SELECT COUNT(*) FROM prospects WHERE prospects."campaignId" = "Campaign".id AND prospects."createdAt" >= '${periodStartIso}')::int`), 'leadsThisPeriod'],
        [sequelize.literal('(SELECT COALESCE(SUM(lpa."leadsRemaining"), 0)::int FROM lead_package_assignments lpa JOIN lead_packages lp ON lpa."leadPackageId" = lp.id WHERE lp."campaignId" = "Campaign".id AND lpa."source" = \'wallet\' AND lpa.status = \'active\')'), 'committedRemaining'],
        [sequelize.literal('(SELECT COALESCE(SUM(lpa."leadsRemaining" * lpa."unitPriceCents"), 0)::int FROM lead_package_assignments lpa JOIN lead_packages lp ON lpa."leadPackageId" = lp.id WHERE lp."campaignId" = "Campaign".id AND lpa."source" = \'wallet\' AND lpa.status = \'active\' AND lpa."unitPriceCents" IS NOT NULL)'), 'committedValueCents'],
      ]
    },
    include: [
      { association: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'] },
      { association: 'assignedAgents', attributes: ['id', 'firstName', 'lastName', 'email'] }
    ]
  });

  // Attach backward-compatible virtual fields
  const campaignsJson = campaigns.map(c => {
    const plain = c.toJSON();
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
        attributes: ['id', 'label', 'name', 'type', 'campaignId'],
      },
      {
        association: 'prospects',
        attributes: ['id', 'firstName', 'lastName', 'email', 'leadStatus', 'assignedAgentId'],
        include: [{ association: 'assignedAgent', attributes: ['id', 'firstName', 'lastName', 'email'] }]
      },
      { association: 'leadPackages', attributes: ['id', 'name', 'type', 'price', 'leadCount'] },
      { association: 'assignedAgents', attributes: ['id', 'firstName', 'lastName', 'email'] }
    ]
  });

  if (!campaign) throw new AppError('Campaign not found', 404);

  // Attach backward-compatible virtual fields
  const plain = campaign.toJSON();
  plain.assigned_agents = agentsToIdList(plain.assignedAgents);
  return plain;
}

/**
 * Fail-closed activation gate (docs/plans/lucky-draw-multi-prize-plan.md §3.5):
 * the draw engine resolves exactly ONE claimed winner per campaign
 * (luckyDrawService — a claimed attempt is terminal), so a campaign whose
 * structured prizes total more than one unit must not BE active: it would
 * collect entries under T&Cs the platform cannot honour. Enforced at the
 * service layer on every path that can leave a campaign active (create /
 * update / setCampaignLaunchState) plus createDraw — the launch `force` flag
 * only skips READINESS, never this. Phase 3 (multi-winner engine) removes it.
 */
export function assertDrawActivatable(designConfig) {
  const ld = normalizeLuckyDraw(getStoredLuckyDraw(designConfig));
  if (!ld || ld.enabled !== true) return;
  const total = totalPrizeQuantity(ld);
  if (total > 1) {
    const err = new AppError(
      `This draw promises ${total} prizes, but multi-winner draw execution isn't live yet — the campaign can stay a draft (or paused) but cannot be active.`,
      422
    );
    err.data = { code: 'DRAW_MULTI_PRIZE_UNSUPPORTED' };
    throw err;
  }
}

/**
 * Create a new campaign.
 */
export async function createCampaign(body, user) {
  const { name, min_age, max_age, start_date, end_date, is_active, assigned_agents, defaultAssignmentMode, enforceLeadQuota } = body;

  const safeName = sanitizeCampaignName(name);

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
  if (defaultAssignmentMode !== undefined) campaignData.defaultAssignmentMode = defaultAssignmentMode;
  if (enforceLeadQuota !== undefined) campaignData.enforceLeadQuota = enforceLeadQuota;
  if (body.metaPixelId !== undefined) campaignData.metaPixelId = body.metaPixelId || null;
  if (body.tiktokPixelId !== undefined) campaignData.tiktokPixelId = body.tiktokPixelId || null;
  // Wallet commit price — admin-only (campaign POST is open to agents; the
  // same silent-clamp policy as design_config's admin-gated keys).
  if (body.leadPriceCents !== undefined && user?.role === 'admin') {
    campaignData.leadPriceCents = normalizeLeadPriceCents(body.leadPriceCents);
  }
  // Allow design_config at creation time (mirrors updateCampaign) so a campaign
  // can be created with its designer config in one call, not create-then-update.
  if (body.design_config !== undefined) {
    campaignData.design_config = clampDesignConfig(body.design_config, undefined, user?.role);
  }

  // Campaign brief (docs/plans/campaign-brief.md §5/§7): objective + product
  // are REQUIRED at the API create door — four ~30s questions five systems
  // consume. Internal creators (Retell bootstrap, duplicateCampaign) call
  // Campaign.create directly and are exempt; pre-brief campaigns keep {}
  // forever (no backfill). archetype is derived from the clamped doc, never
  // taken from the payload.
  const briefResult = normalizeBrief(body.targetAudience);
  if (!briefResult.ok) throw new AppError(briefResult.error, 422);
  campaignData.targetAudience = {
    ...briefResult.brief,
    archetype: deriveArchetype(campaignData.design_config),
  };

  // Draw terms need the campaign id for the version row, but the requirements
  // must fail BEFORE the row exists — no half-created draw campaign. (A crash
  // between Campaign.create and the terms pin below still self-heals: the next
  // design_config save re-runs ensureDrawTermsVersion idempotently.)
  if (campaignData.design_config?.luckyDraw?.enabled === true) {
    if (!campaignData.design_config.luckyDraw.closesAt) {
      const err = new AppError(
        'Lucky-draw campaigns need a valid luckyDraw.closesAt (YYYY-MM-DD) before they can be enabled.',
        422
      );
      err.data = { code: 'DRAW_CLOSES_AT_REQUIRED' };
      throw err;
    }
    const terms = getStoredTermsHtml(campaignData.design_config).trim();
    if (!terms) {
      const err = new AppError(
        'Lucky-draw campaigns need Terms & Conditions content (designer → Terms & Conditions) before they can be enabled.',
        422
      );
      err.data = { code: 'DRAW_TERMS_REQUIRED' };
      throw err;
    }
  }
  // is_active DEFAULTS TO TRUE when omitted (above) — an API create of a
  // multi-prize draw must be an explicit draft (the workspace sends
  // is_active:false), never born active.
  if (campaignData.is_active) assertDrawActivatable(campaignData.design_config);
  // Born-active draws must not launch with self-contradicting promises
  // (PR-3): runs BEFORE the row exists — nothing to compensate.
  if (campaignData.is_active) {
    assertDrawPromiseConsistency({
      minAge: campaignData.min_age, maxAge: campaignData.max_age, designConfig: campaignData.design_config,
    });
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
  invalidateFeaturedDropsCache();

  if (campaignData.design_config?.luckyDraw?.enabled === true) {
    let withTerms = await ensureDrawTermsVersion(campaignData.design_config, campaign.id, user.id);
    // Born-active draw arms its boost rail NOW (old-plan F2: the campaign row
    // must exist first, so this is ensure-after-create with a compensating
    // revert — a failed rail never leaves a live draw promising an unissuable
    // pass; the campaign survives as a draft with the typed 422 explaining).
    if (campaignData.is_active) {
      try {
        const rail = await ensureRail({ campaign, designConfig: withTerms, user });
        withTerms = stampRailActivationId(withTerms, rail.activationId);
      } catch (err) {
        await campaign.update({ is_active: false, status: 'draft', design_config: withTerms }).catch((revertErr) => {
          // Both the rail AND the compensating demote failed: the campaign may
          // be live promising a pass that can never issue — the one state the
          // revert exists to prevent. Needs a human.
          logger.error('[Campaign] draw rail arming failed AND the demote-to-draft revert failed — campaign may be active without an armed rail', {
            campaignId: campaign.id, error: revertErr?.message || String(revertErr),
          });
        });
        throw err;
      }
    }
    await campaign.update({ design_config: withTerms });
    // Born-active draw gets its engine record too — after the doc (stamped
    // rail + pinned terms) is stored. Best-effort; the reconciler retries.
    if (campaignData.is_active) await ensureRecord({ campaignId: campaign.id, user });
  }

  // Write agent assignments to join table
  if (assigned_agents && Array.isArray(assigned_agents) && assigned_agents.length > 0) {
    await syncAgentAssignments(campaign.id, assigned_agents);
  }

  // Return with backward-compatible virtual fields for API compatibility
  const agentRows = await CampaignAgentAssignment.findAll({
    where: { campaignId: campaign.id },
    attributes: ['agentId']
  });
  const plain = campaign.toJSON();
  plain.assigned_agents = agentRows.map(r => r.agentId);
  return plain;
}

/**
 * Update a campaign.
 */
export async function updateCampaign(id, body, req) {
  const where = buildOwnerWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);

  const { name, type, min_age, max_age, start_date, end_date, is_active, assigned_agents, design_config, defaultAssignmentMode, enforceLeadQuota } = body;

  const updateData = {};
  if (name) updateData.name = sanitizeCampaignName(name);
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
      // Lock rule: once activated, an EXISTING slug can never change or clear
      // (its /offers URL may be printed/shared). Setting a slug for the first
      // time (null → value) stays allowed — no URL exists yet to break, and
      // legacy campaigns backfilled by migration 066 must still be able to
      // join the marketplace.
      if (stored !== null && campaign.firstActivatedAt) {
        throw new AppError('The marketplace slug is locked once a campaign has been activated.', 409);
      }
      if (incomingSlug !== null && !SLUG_RE.test(incomingSlug)) {
        throw new AppError('Slug must be 3-80 chars of lowercase letters, digits and hyphens.', 422);
      }
      updateData.slug = incomingSlug;
    }
  }
  let designRollbackApplied = false;
  if (design_config !== undefined) {
    // A Studio-saved (v2) document must never be overwritten by an untagged
    // v1 save — the v1 clamp would wholesale-replace the nested doc. The old
    // designer gets a read-only guard in the Studio PR; this is its server twin.
    //
    // PR 5 escape hatch: an ADMIN restoring a pre-migration v1 snapshot passes
    // `confirmDesignRollback: true` explicitly (the rollout runbook's rollback
    // path). It flows through the normal v1 clamp + draw invariants + cache
    // invalidation below — never a raw write. NOTE the admin-policy merge
    // semantics apply: a snapshot that OMITS an admin subtree (luckyDraw /
    // featuredDrop) preserves the STORED one — disable a post-migration draw
    // via ops first if the intent is full removal.
    const isDesignRollback =
      body.confirmDesignRollback === true &&
      req.user?.role === 'admin' &&
      classifyDesignConfigVersion(campaign.design_config) === 'v2' &&
      classifyDesignConfigVersion(design_config) === 'legacy';
    if (
      !isDesignRollback &&
      classifyDesignConfigVersion(campaign.design_config) === 'v2' &&
      classifyDesignConfigVersion(design_config) === 'legacy'
    ) {
      const err = new AppError(
        "This campaign's design was saved by Campaign Studio and cannot be overwritten by the classic designer. Reopen it in the Studio.",
        409
      );
      err.data = { code: 'DESIGN_CONFIG_VERSION_CONFLICT' };
      throw err;
    }
    // Clamp the per-campaign customer host to the enum (never trust a raw host
    // from client JSON) and gate featuredDrop/luckyDraw changes to admins;
    // preserve all other design keys untouched.
    updateData.design_config = clampDesignConfig(design_config, campaign.design_config, req.user?.role);
    // Enabled draws pin their T&C content as an immutable version (also catches
    // termsContent edits on saves that didn't touch luckyDraw itself — the
    // clamp preserved the stored luckyDraw, and unchanged content is a no-op).
    updateData.design_config = await ensureDrawTermsVersion(updateData.design_config, campaign.id, req.user?.id);
    designRollbackApplied = isDesignRollback;
  }
  if (defaultAssignmentMode !== undefined) updateData.defaultAssignmentMode = defaultAssignmentMode;
  if (enforceLeadQuota !== undefined) updateData.enforceLeadQuota = enforceLeadQuota;
  if (body.metaPixelId !== undefined) updateData.metaPixelId = body.metaPixelId || null;
  if (body.tiktokPixelId !== undefined) updateData.tiktokPixelId = body.tiktokPixelId || null;
  // Wallet commit price — admin-only silent clamp (non-admin edits never touch it).
  if (body.leadPriceCents !== undefined && req.user?.role === 'admin') {
    updateData.leadPriceCents = normalizeLeadPriceCents(body.leadPriceCents);
  }

  // Fail-closed: a campaign may not END UP active with a multi-prize draw —
  // whether this save flips is_active or edits the design under an active one.
  const willBeActive = is_active !== undefined ? is_active === true : campaign.is_active === true;
  if (willBeActive) {
    assertDrawActivatable(
      updateData.design_config !== undefined ? updateData.design_config : campaign.design_config
    );
  }

  // Boost-rail ensure (PR-2 §5.1) — BEFORE the flip commits (F2, fail-closed:
  // the 422 aborts the save, nothing to compensate). Scoped to the two arming
  // transitions ONLY — inactive→active with a draw, or the draw turning on
  // under an active campaign. Routine saves of a live draw campaign never
  // re-enter (a transient rail 422 must not block unrelated edits — CX16).
  let armedDraw = false;
  {
    const nextDoc = updateData.design_config !== undefined ? updateData.design_config : campaign.design_config;
    const becomingActive = willBeActive && campaign.is_active !== true;
    const drawTurningOn =
      willBeActive && drawEnabledIn(nextDoc) && !drawEnabledIn(campaign.design_config);
    const arming = (becomingActive && drawEnabledIn(nextDoc)) || drawTurningOn;
    armedDraw = arming;

    // Promise-consistency gate (PR-3/CX16): arming transitions AND active
    // saves that MODIFY a compared fact (ages, terms, material draw fields).
    // Unrelated saves of a live-but-drifted campaign pass — readiness owns
    // the standing complaint, the gate owns the change.
    if (willBeActive && drawEnabledIn(nextDoc)) {
      const ageChanged =
        (min_age !== undefined && Number(min_age) !== campaign.min_age) ||
        (max_age !== undefined && Number(max_age) !== campaign.max_age);
      const docChanged = updateData.design_config !== undefined;
      const termsChanged = docChanged
        && getStoredTermsHtml(updateData.design_config).trim() !== getStoredTermsHtml(campaign.design_config).trim();
      const factsChanged = docChanged && drawFactsOf(updateData.design_config) !== drawFactsOf(campaign.design_config);
      if (arming || ageChanged || termsChanged || factsChanged) {
        assertDrawPromiseConsistency({
          minAge: min_age !== undefined ? Number(min_age) : campaign.min_age,
          maxAge: max_age !== undefined ? Number(max_age) : campaign.max_age,
          designConfig: nextDoc,
        });
      }
    }

    if (arming) {
      const rail = await ensureRail({ campaign, designConfig: nextDoc, user: req.user });
      const stamped = stampRailActivationId(nextDoc, rail.activationId);
      if (stamped !== nextDoc) updateData.design_config = stamped;
    }
  }

  // Draw pass colourway — a NARROW, top-level field rather than a design_config
  // write, for two reasons. A Studio-saved (v2) campaign rejects an untagged
  // design_config outright (the conflict guard above), and passTheme is pure
  // display: routing it through the doc would make a palette change look like a
  // draw-fact edit and re-run the promise gate on a live campaign. Applied here,
  // AFTER every draw gate, so it can never block or alter a save.
  if (body.drawPassTheme !== undefined && req.user?.role === 'admin') {
    const nextDoc = updateData.design_config !== undefined ? updateData.design_config : campaign.design_config;
    // Spread the RAW stored draw (conservative — it is already normalized by the
    // save path) but decide on the normalized copy, so a hand-written row can't
    // fake `enabled`.
    const ld = getStoredLuckyDraw(nextDoc);
    if (drawEnabledIn(nextDoc)) {
      const theme = String(body.drawPassTheme || '').trim().toLowerCase();
      if (!PASS_THEMES.includes(theme)) {
        throw new AppError(`drawPassTheme must be one of: ${PASS_THEMES.join(', ')}.`, 422);
      }
      updateData.design_config = { ...nextDoc, luckyDraw: { ...ld, passTheme: theme } };
    }
  }

  // Campaign brief: a provided targetAudience must be a full valid brief
  // (there is no clearing door — omission means "leave it alone"), and the
  // derived archetype tracks the DOC (campaign-brief.md §4.4): recomputed on
  // every save that carries a brief or lands on a campaign that has one.
  // Pre-brief campaigns keep {} untouched — a blank brief never gets an
  // archetype stamped, so "no brief" stays unambiguous.
  if (body.targetAudience !== undefined) {
    const briefResult = normalizeBrief(body.targetAudience);
    if (!briefResult.ok) throw new AppError(briefResult.error, 422);
    updateData.targetAudience = briefResult.brief;
  }
  {
    const briefBase = updateData.targetAudience
      || (hasBrief(campaign.targetAudience) ? campaign.targetAudience : null);
    if (briefBase) {
      const nextDoc = updateData.design_config !== undefined ? updateData.design_config : campaign.design_config;
      const archetype = deriveArchetype(nextDoc);
      if (updateData.targetAudience || briefBase.archetype !== archetype) {
        updateData.targetAudience = { ...briefBase, archetype };
      }
    }
  }

  try {
    await campaign.update(updateData);
    // Draw record rides the arming moment, AFTER the doc (with its stamped
    // rail + pinned terms) is stored — best-effort; the reconciler retries.
    if (armedDraw) await ensureRecord({ campaignId: campaign.id, user: req.user });
  } catch (err) {
    if (err?.name === 'SequelizeUniqueConstraintError') {
      throw new AppError('That marketplace slug is already taken by another campaign.', 409);
    }
    throw err;
  }
  // Audit AFTER the row actually changed (Codex diff #4) — a clamp/draw-422 or
  // DB failure above must never leave a success-looking rollback entry.
  if (designRollbackApplied) {
    console.warn(
      `[design-rollback] admin ${req.user?.id} restored a v1 design_config over the stored v2 doc on campaign ${campaign.id}`
    );
  }
  invalidateMarketplaceCache();
  invalidateFeaturedDropsCache();

  // The SECOND resolution-input writer (per-campaign-lead-scoring.md §9). A
  // brief edit that changes `targetAudience.product` re-routes this campaign's
  // scoring config to a DIFFERENT product chain without any config row
  // changing, so a cached `campaign:<id>` entry holding the old inherited row
  // would keep scoring under it for up to a TTL. Cheap and whole-map, like the
  // config writer's own bust.
  if (updateData.targetAudience !== undefined) bustScoringConfigCache();

  // Sync agent assignments to join table when assigned_agents is provided
  if (assigned_agents !== undefined) {
    await syncAgentAssignments(id, assigned_agents || []);
  }

  // Return with backward-compatible virtual fields for API compatibility
  const agentRows = await CampaignAgentAssignment.findAll({
    where: { campaignId: id },
    attributes: ['agentId']
  });
  const plain = campaign.toJSON();
  plain.assigned_agents = agentRows.map(r => r.agentId);
  return plain;
}

/**
 * Admin campaign-detail composite (Phase B): one round-trip for the rebuild's
 * detail screen — campaign row + 30d SGT lead series + open wallet commitments
 * + latest leads + QR tags. Read-only aggregation over existing data.
 */
export async function getCampaignSummary(id, req) {
  const where = buildOwnerWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);

  const { getLeadSeries } = await import('./dashboardService.js');
  const { LeadPackageAssignment, Prospect: ProspectModel, QrTag: QrTagModel } = await import('../models/index.js');

  const [series, commitmentRows, recent, qrTags] = await Promise.all([
    getLeadSeries('30d', { campaignId: id }),
    LeadPackageAssignment.findAll({
      where: { source: 'wallet', status: 'active', leadsRemaining: { [Op.gt]: 0 } },
      include: [
        { association: 'package', attributes: [], where: { campaignId: id }, required: true },
        { association: 'agent', attributes: ['id', 'firstName', 'lastName', 'fullName', 'email'] },
      ],
      order: [['purchaseDate', 'ASC']],
    }),
    ProspectModel.findAll({
      where: { campaignId: id },
      attributes: ['id', 'firstName', 'lastName', 'leadStatus', 'leadSource', 'quarantinedAt', 'quarantineReason', 'assignedAgentId', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit: 6,
    }),
    QrTagModel.findAll({
      where: { campaignId: id },
      attributes: ['id', 'name', 'scanCount', 'uniqueScanCount', 'lastScanned', 'active'],
      order: [['scanCount', 'DESC']],
    }),
  ]);

  const commitments = commitmentRows.map((r) => ({
    assignmentId: r.id,
    agentId: r.agent?.id ?? r.agentId,
    agent: r.agent ? (r.agent.fullName || `${r.agent.firstName || ''} ${r.agent.lastName || ''}`.trim() || r.agent.email) : null,
    remaining: r.leadsRemaining,
    unitPriceCents: r.unitPriceCents,
    valueCents: Number.isInteger(r.unitPriceCents) ? r.leadsRemaining * r.unitPriceCents : null,
  }));

  return {
    campaign: campaign.toJSON(),
    series,
    commitments,
    committedRemaining: commitments.reduce((s, c) => s + c.remaining, 0),
    committedValueCents: commitments.reduce((s, c) => s + (c.valueCents || 0), 0),
    recent,
    qrTags,
  };
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
  // Fail-closed: this is the path `force` reaches (the controller only skips
  // readiness on force) — the multi-prize gate must hold here regardless.
  if (state === 'active') assertDrawActivatable(campaign.design_config);

  // Boost-rail ensure (PR-2 §5.1) — BEFORE the flip (F2). `force` skips
  // readiness, never this: an armed draw with no rail is the exact silent
  // failure this exists to prevent. The promise-consistency gate (PR-3) rides
  // the same arming moment — a contradiction-carrying draw cannot launch.
  let stampedDoc = null;
  if (state === 'active' && drawEnabledIn(campaign.design_config)) {
    assertDrawPromiseConsistency({
      minAge: campaign.min_age, maxAge: campaign.max_age, designConfig: campaign.design_config,
    });
    const rail = await ensureRail({ campaign, designConfig: campaign.design_config, user: req.user });
    const stamped = stampRailActivationId(campaign.design_config, rail.activationId);
    if (stamped !== campaign.design_config) stampedDoc = stamped;
  }

  const isActive = state === 'active';
  await campaign.update({
    is_active: isActive,
    status: isActive ? 'active' : 'paused',
    ...(stampedDoc ? { design_config: stampedDoc } : {}),
    ...(isActive && !campaign.firstActivatedAt ? { firstActivatedAt: new Date() } : {}),
  });
  // The engine record is born with the launch (best-effort — a record hiccup
  // must never un-launch a campaign; the boot reconciler retries).
  if (isActive && drawEnabledIn(campaign.design_config)) {
    await ensureRecord({ campaignId: campaign.id, user: req.user });
  }
  invalidateMarketplaceCache();
  invalidateFeaturedDropsCache();

  return campaign.toJSON();
}

/**
 * Soft-delete (archive) a campaign. Transactional: the campaign row is locked,
 * open wallet commitments are refunded (takedown refund — the ONLY refund path,
 * see walletService), and the status flips, all-or-nothing. A concurrent
 * archive either loses the row lock and sees 'archived' (400) or the unique
 * per-assignment refund index blocks the double-credit. QR detach stays
 * post-commit (best-effort side effect, as before). NOTE: if a 'completed'
 * status transition is ever added, it MUST route through this same
 * refund-then-flip transaction — 'completed' is takedown too (product
 * decision 5 in docs/plans/agent-wallet-commitments.md).
 */
export async function archiveCampaign(id, req) {
  const where = buildOwnerWhere(req, { id });
  const campaign = await sequelize.transaction(async (t) => {
    const row = await Campaign.findOne({ where, transaction: t, lock: t.LOCK.UPDATE });
    if (!row) throw new AppError('Campaign not found or access denied', 404);
    if (row.status === 'archived') {
      throw new AppError('Campaign is already archived', 400);
    }

    await refundCampaignCommitments(id, { reason: 'campaign_archived', transaction: t });
    await row.update({ status: 'archived' }, { transaction: t });
    return row;
  });

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

  // The old pending/approved-commission delete gate is retired with the
  // commission domain: commissions.campaignId is ON DELETE SET NULL (migration
  // 014), so historical rows survive the delete with the ref nulled, and the
  // wallet ledger — the live financial record — is likewise SET NULL and
  // append-only. Nothing financial blocks a permanent campaign delete.
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

  const rest = original.toJSON();
  // Sanitise the DERIVED default too: a pre-fix row whose stored name carries
  // markup must not re-propagate it through duplication (or into the copy's
  // generated draw terms below).
  const copyName = sanitizeCampaignName(body.name || `${original.name} (Copy)`);
  // An OPEN draw (SGT close date still in the future) carries onto the copy —
  // ADMIN duplicates only, matching applyLuckyDrawPolicy (luckyDraw is an
  // admin-only key; anyone else keeps the historical strip). What carries is
  // the SHAPE — prizes, dates, multiplier, colourway — never the original's
  // operational stamps: activationId (the copy's rail is provisioned at ITS
  // launch), termsVersionId/termsHash (the copy mints its OWN terms v1 after
  // create, naming the copy). A CLOSED or dateless draw does not carry at
  // all: draw dates are create-time-only in every editor, so a copy born
  // with a past close date could never be edited into a launchable draw.
  const origDraw = req.user?.role === 'admin'
    ? normalizeLuckyDraw(getStoredLuckyDraw(rest.design_config))
    : undefined;
  const origDrawCloseMs = origDraw?.enabled === true ? sgtDayEndExclusiveMs(origDraw.closesAt) : null;
  const carryDraw = origDrawCloseMs !== null && origDrawCloseMs > Date.now();
  // Never clone homepage publication: a duplicate of a featured campaign must
  // not silently appear on redeem.sg when it is later activated. luckyDraw is
  // stripped by default (dates, activation, and terms version are all
  // campaign-specific — docs/plans/lucky-draw-10x.md §4.1) and re-added below
  // only under the carryDraw rules above.
  const dupDesign = (() => {
    if (!rest.design_config || typeof rest.design_config !== 'object') return rest.design_config;
    // marketplaceListed never clones either — a duplicate of a listed campaign
    // must not silently appear on the public marketplace when activated.
    const { luckyDraw: _neverCloneDraw, marketplaceListed: _neverCloneListing, ...base } = rest.design_config;
    const copy = {
      ...base,
      ...(rest.design_config.featuredDrop && typeof rest.design_config.featuredDrop === 'object'
        ? { featuredDrop: { ...rest.design_config.featuredDrop, enabled: false } }
        : {}),
    };
    // v2 (Campaign Studio) docs keep publication state under distribution.* —
    // the same never-clone rules apply at those paths.
    if (classifyDesignConfigVersion(copy) === 'v2' && copy.distribution && typeof copy.distribution === 'object') {
      const distribution = { ...copy.distribution };
      if (distribution.featuredDrop && typeof distribution.featuredDrop === 'object') {
        distribution.featuredDrop = { ...distribution.featuredDrop, enabled: false };
      }
      if (distribution.marketplace && typeof distribution.marketplace === 'object') {
        const { listed: _neverCloneV2Listing, ...marketplace } = distribution.marketplace;
        distribution.marketplace = marketplace;
      }
      copy.distribution = distribution;
    }
    if (carryDraw) {
      // Whitelisted, normalized shape only — the stamps named above can never
      // ride along, whatever the stored row accumulated.
      const carried = {};
      for (const key of ['enabled', 'prizes', 'prize', 'winners', 'closesAt', 'boostClosesAt', 'drawOn', 'multiplier', 'passTheme', 'bookingUrl']) {
        if (origDraw[key] !== undefined) carried[key] = origDraw[key];
      }
      copy.luckyDraw = carried;
      // The copy's terms state the COPY's name and facts — cloning the
      // original's terms verbatim would pin a T&C naming a different
      // campaign. Same deterministic template as the workspace create flow
      // (backend twin); minAge/maxAge/verification come from the cloned row
      // so the rebuilt terms can never contradict the copy's own gates.
      const isV2 = classifyDesignConfigVersion(copy) === 'v2';
      const termsHtml = buildDrawTermsHtml({
        campaignName: copyName,
        prizes: origDraw.prizes,
        prize: origDraw.prize,
        closesAt: origDraw.closesAt,
        boostClosesAt: origDraw.boostClosesAt,
        multiplier: origDraw.multiplier,
        minAge: Number(rest.min_age) || 18,
        maxAge: Number(rest.max_age) || null,
        verification: (isV2 ? copy.form?.verification : copy.otpChannel) === 'whatsapp' ? 'whatsapp' : 'sms',
      });
      if (isV2) {
        const form = copy.form && typeof copy.form === 'object' ? copy.form : {};
        const terms = form.terms && typeof form.terms === 'object' ? form.terms : {};
        copy.form = { ...form, terms: { ...terms, html: termsHtml } };
      } else {
        copy.termsContent = termsHtml;
      }
    }
    return copy;
  })();
  // A versioned (v2 Studio) duplicate goes through the SAME write gate as
  // create/update — the never-clone transform above is not a substitute for it.
  // Renderer dispatch is version-driven, not flag-gated, so a v2 doc minted here
  // would be immediately customer-facing: while DESIGN_CONFIG_V2_WRITES_ENABLED
  // is off this throws 422 (a duplicate must never propagate v2 rows behind the
  // flag), and when on it re-clamps at the v2 paths. Legacy (v1) duplicates keep
  // their verbatim transform above — clamping them would drop the disabled
  // featuredDrop for non-admins (applyFeaturedDropPolicy returns stored), a
  // behavior change the v1 clamp golden does not cover.
  const dupDesignFinal =
    dupDesign && typeof dupDesign === 'object' && classifyDesignConfigVersion(dupDesign) !== 'legacy'
      ? clampDesignConfig(dupDesign, undefined, req.user?.role)
      : dupDesign;
  const copy = await Campaign.create({
    ...rest,
    design_config: dupDesignFinal,
    id: undefined,
    name: copyName,
    status: 'draft',
    createdBy: req.user.id,
    spentAmount: 0,
    // slug is unique and locked to the original; firstActivatedAt is the
    // original's activation history — a copy starts with neither.
    slug: null,
    firstActivatedAt: null,
    // Never clone the wallet commit price: it is admin-only policy, and a
    // non-admin duplicating a priced public campaign must not mint a new
    // commit-able campaign (an admin re-prices the copy deliberately).
    leadPriceCents: null,
    createdAt: undefined,
    updatedAt: undefined
  });

  // A carried draw pins the COPY's own terms v1 — the version row needs the
  // new campaign id, so this mirrors createCampaign's ensure-after-create
  // ordering (a crash between create and this pin self-heals: the next
  // design_config save re-runs ensureDrawTermsVersion idempotently).
  if (carryDraw) {
    const withTerms = await ensureDrawTermsVersion(dupDesignFinal, copy.id, req.user.id);
    await copy.update({ design_config: withTerms });
  }

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

  // Return with backward-compatible virtual fields
  const agentRows = await CampaignAgentAssignment.findAll({
    where: { campaignId: copy.id },
    attributes: ['agentId']
  });
  const plain = copy.toJSON();
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

  // Historical tablet-era media rows: the CampaignMediaItem model is retired
  // but the table (and its uploaded files) remain — raw SQL keeps the
  // permanent-delete storage cleanup working for old campaigns.
  const [mediaItems] = await sequelize.query(
    'SELECT url FROM campaign_media_items WHERE "campaignId" = :campaignId',
    { replacements: { campaignId: campaign.id } }
  );
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

