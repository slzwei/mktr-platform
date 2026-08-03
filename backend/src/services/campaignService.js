import { Campaign, QrTag, CampaignAgentAssignment, User, sequelize } from '../models/index.js';
import { storageService } from './storage.js';
import { buildCampaignWhere, buildOwnerWhere } from './campaignScope.js';
import { AppError } from '../middleware/appError.js';
import { logger } from '../utils/logger.js';
import { normalizeCustomerHostChoice } from '../utils/customerHost.js';
import { sgtDayEndExclusiveMs } from '../utils/sgtTime.js';
import { applyFeaturedDropPolicy } from '../utils/featuredDrop.js';
import { applyLuckyDrawPolicy, normalizeLuckyDraw } from '../utils/luckyDraw.js';
import { PASS_THEMES } from '../utils/drawTheme.js';
import { normalizeMarketplaceContent, applyMarketplacePolicy } from '../utils/marketplaceContent.js';
import { normalizeBrief, deriveArchetype, hasBrief } from '../utils/campaignBrief.js';
import { DEFAULT_CAMPAIGN_TYPE } from '../utils/campaignTypes.js';
import { buildDrawTermsHtml } from '../utils/drawTermsTemplate.js';
import { SLUG_RE } from '../utils/slug.js';
import {
  classifyDesignConfigVersion,
  clampDesignConfigV2,
  designConfigV2WritesEnabled,
  getStoredTermsHtml,
  getStoredLuckyDraw,
} from '../utils/designConfigV2Clamp.js';
import {
  ensureRail,
  ensureRecord,
  setEnsureDrawRecord,
  stampRailActivationId,
  drawEnabledIn,
  assertDrawClosesAt,
  assertDrawTermsContent,
  assertDrawPromiseConsistency,
  drawFactsOf,
  assertDrawActivatable,
  ensureDrawTermsVersion,
} from './campaignDrawGuards.js';
import {
  computeCampaignMetrics,
  listCampaigns,
  getCampaign,
  getCampaignSummary,
  getCampaignAnalytics,
  updateCampaignMetrics,
} from './campaignReadService.js';
import { invalidateMarketplaceCache } from './marketplaceCache.js';
import { invalidateFeaturedDropsCache } from './featuredDropsService.js';
import { bustScoringConfigCache } from './scoringConfigCache.js';
import { refundCampaignCommitments } from './walletService.js';

// Draw guards moved to campaignDrawGuards.js (P4-4); re-exported so existing
// importers (tests, the controller's namespace import) keep their path.
export { ensureDrawTermsVersion, assertDrawActivatable, setEnsureDrawRecord };
// Read side moved to campaignReadService.js — re-exported so existing
// importers (controllers, tests) keep their path.
export {
  computeCampaignMetrics, listCampaigns, getCampaign,
  getCampaignSummary, getCampaignAnalytics, updateCampaignMetrics,
};

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
    type: body.type || DEFAULT_CAMPAIGN_TYPE
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
    assertDrawClosesAt(campaignData.design_config.luckyDraw);
    assertDrawTermsContent(campaignData.design_config);
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

  // H5: the campaign row and its agent links are ONE create — a ghost or
  // ineligible assigned_agents id aborts the whole thing with a 422 instead of
  // committing the campaign and then dying on the join-table FK (an orphan
  // campaign behind a 500).
  let campaign;
  try {
    campaign = await sequelize.transaction(async (t) => {
      const row = await Campaign.create(campaignData, { transaction: t });
      if (assigned_agents && Array.isArray(assigned_agents) && assigned_agents.length > 0) {
        await syncAgentAssignments(row.id, assigned_agents, t);
      }
      return row;
    });
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

    // The ensureRail call itself rides the write transaction below (H1) so the
    // rail can never outlive a failed save.
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

  // H1 + H5: the arming rail, the campaign row, and the agent links commit or
  // fail as ONE transaction. Pre-fix, ensureRail committed independently first
  // (a slug-conflict 409 then left a live rail + allocated stock on a campaign
  // that never activated), and syncAgentAssignments committed separately after
  // (an assignment failure left a half-applied save).
  try {
    await sequelize.transaction(async (t) => {
      if (armedDraw) {
        const nextDoc = updateData.design_config !== undefined ? updateData.design_config : campaign.design_config;
        const rail = await ensureRail({ campaign, designConfig: nextDoc, user: req.user, transaction: t });
        const stamped = stampRailActivationId(nextDoc, rail.activationId);
        if (stamped !== nextDoc) updateData.design_config = stamped;
      }
      await campaign.update(updateData, { transaction: t });
      if (assigned_agents !== undefined) {
        await syncAgentAssignments(id, assigned_agents || [], t);
      }
    });
  } catch (err) {
    if (err?.name === 'SequelizeUniqueConstraintError') {
      throw new AppError('That marketplace slug is already taken by another campaign.', 409);
    }
    throw err;
  }
  // Draw record rides the arming moment, AFTER the committed doc (with its
  // stamped rail + pinned terms) is durable — best-effort by contract
  // (ensureRecord never throws); the reconciler retries.
  if (armedDraw) await ensureRecord({ campaignId: campaign.id, user: req.user });
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
  const isActive = state === 'active';
  // H1: rail ensure + launch flip commit as ONE transaction — a failed flip
  // must never leave the rail's activation + allocated stock behind.
  await sequelize.transaction(async (t) => {
    let stampedDoc = null;
    if (isActive && drawEnabledIn(campaign.design_config)) {
      assertDrawPromiseConsistency({
        minAge: campaign.min_age, maxAge: campaign.max_age, designConfig: campaign.design_config,
      });
      const rail = await ensureRail({ campaign, designConfig: campaign.design_config, user: req.user, transaction: t });
      const stamped = stampRailActivationId(campaign.design_config, rail.activationId);
      if (stamped !== campaign.design_config) stampedDoc = stamped;
    }
    await campaign.update({
      is_active: isActive,
      status: isActive ? 'active' : 'paused',
      ...(stampedDoc ? { design_config: stampedDoc } : {}),
      ...(isActive && !campaign.firstActivatedAt ? { firstActivatedAt: new Date() } : {}),
    }, { transaction: t });
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
 *
 * H5: Joi checks UUID *syntax* only, so the ids are resolved to real users
 * here — a ghost id 422s instead of dying on the join-table FK. Newly ADDED
 * agents must be active; an id already on the campaign may stay through
 * deactivation, so a routine save that resends the stored list keeps working.
 * Runs on the caller's transaction when given one (the campaign write and its
 * agent links must commit or fail together); standalone calls open their own.
 */
async function syncAgentAssignments(campaignId, agents, transaction = null) {
  if (!Array.isArray(agents)) return;

  // Normalize: extract UUID from either string or { id } object
  const agentIds = agents
    .map(a => (typeof a === 'string' ? a : a?.id))
    .filter(id => id && typeof id === 'string' && id.length > 0);

  // Deduplicate
  const uniqueIds = [...new Set(agentIds)];

  const run = async (t) => {
    if (uniqueIds.length > 0) {
      const existingRows = await CampaignAgentAssignment.findAll({
        where: { campaignId }, attributes: ['agentId'], transaction: t, raw: true,
      });
      const alreadyAssigned = new Set(existingRows.map(r => r.agentId));
      const users = await User.findAll({
        where: { id: uniqueIds }, attributes: ['id', 'isActive'], transaction: t, raw: true,
      });
      const byId = new Map(users.map(u => [u.id, u]));
      const rejected = uniqueIds.filter(id => {
        const u = byId.get(id);
        return !u || (u.isActive !== true && !alreadyAssigned.has(id));
      });
      if (rejected.length > 0) {
        throw new AppError(
          `assigned_agents contains unknown or inactive users: ${rejected.join(', ')}`,
          422
        );
      }
    }

    await CampaignAgentAssignment.destroy({ where: { campaignId }, transaction: t });

    if (uniqueIds.length > 0) {
      await CampaignAgentAssignment.bulkCreate(
        uniqueIds.map(agentId => ({ campaignId, agentId })),
        { transaction: t }
      );
    }
  };

  return transaction ? run(transaction) : sequelize.transaction(run);
}


