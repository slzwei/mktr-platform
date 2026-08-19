import { Op } from 'sequelize';
import { sequelize, Prospect } from '../models/index.js';
import { phoneVerificationIsCurrent } from './consumerService.js';
import { contactGrantAllows } from './contactConsent.js';

/**
 * The audience eligibility engine (ads-centralisation §5.1) — ONE selection +
 * filtering path for every additive audience sync (Meta redeemed-exclusion,
 * Google Customer Match, TikTok in P5). It is an ADDITIONS filter plus a
 * policy registry — NOT a snapshot-diff reconciler (§5.4): stale membership
 * is handled event-driven by the removal outbox (unsubscribe, erasure,
 * identifier edits), with the lists' finite membership durations as defence.
 *
 * CONTRACT: loadEligibilityContext returns a COMPLETE snapshot or THROWS.
 * Callers abort their run on a throw — substituting an empty map for a
 * failed ledger read would upload people whose withdrawals we were blind to,
 * so it is forbidden (the Meta/Google services' existing catch-and-alert
 * paths are the abort).
 */

/**
 * Per-platform policy. Meta's grant requirement is env-driven at ACCESS time
 * (`REDEEMED_AUDIENCE_REQUIRE_CONSENT` — deprecated-but-honoured, see the
 * env.example note): a getter keeps call-time semantics. checkErased=true on
 * Meta is the ONE intended behaviour diff from its legacy filter (§5.2) —
 * erased skeletons have no identifiers left, but the guard is now explicit
 * rather than incidental.
 */
export const AUDIENCE_POLICIES = {
  get meta() {
    return {
      scope: 'global',
      requireConsent: process.env.REDEEMED_AUDIENCE_REQUIRE_CONSENT !== 'false',
      requireVerifiedBinding: false,
      checkErased: true,
    };
  },
  google: { scope: 'campaign', requireConsent: true, requireVerifiedBinding: true, checkErased: true },
  tiktok: { scope: 'global', requireConsent: true, requireVerifiedBinding: true, checkErased: true },
};

/**
 * Load the complete eligibility snapshot:
 *  - suppressedPhones: every phone with an active marketing suppression;
 *  - grantMap: the campaign-scoped verified-contact grant map — ONLY when the
 *    policy requires consent (parity with the legacy Meta behaviour: the
 *    REQUIRE_CONSENT=false escape hatch skips the grant read entirely);
 *  - editSuppressedProspectIds: prospects with a NON-TERMINAL `edit:` removal
 *    row (§5.1 identifier-edit convergence) — the person stays OUT of
 *    additive selection until their edit-removal settles, so a re-add with
 *    the new identifiers can never race the removal of the old ones.
 * Throws on any partial read.
 */
export async function loadEligibilityContext({ requireConsent }) {
  const { getSuppressedPhoneSet, getMarketableGrantMap } = await import('./consentService.js');
  const suppressedPhones = await getSuppressedPhoneSet();
  const grantMap = requireConsent ? await getMarketableGrantMap() : null;
  const [rows] = await sequelize.query(
    `SELECT DISTINCT "subjectProspectId" FROM audience_removals
      WHERE "subjectProspectId" IS NOT NULL
        AND "sourceKey" LIKE 'edit:%'
        AND state NOT IN ('confirmed','manually_resolved')`
  );
  const editSuppressedProspectIds = new Set((rows || []).map((r) => r.subjectProspectId));
  return { suppressedPhones, grantMap, editSuppressedProspectIds };
}

/**
 * Select the candidate population for a destination. Non-bot always;
 * attributes are pinned to [id, email, phone, campaignId, sourceMetadata] —
 * `id` feeds the edit-suppression anti-join, sourceMetadata the erased +
 * verified-binding checks.
 */
export async function selectAudiencePopulation({ scope, campaignId } = {}, deps = {}) {
  const ProspectModel = deps.Prospect || Prospect;
  const where = { leadSource: { [Op.ne]: 'call_bot' } };
  if (scope === 'campaign') {
    if (!campaignId) return [];
    where.campaignId = campaignId;
  }
  return ProspectModel.findAll({
    attributes: ['id', 'email', 'phone', 'campaignId', 'sourceMetadata'],
    where,
    raw: true,
  });
}

/**
 * The one filter, fixed order (§5.1): erased → edit-suppressed →
 * verified-binding → grant → suppression. Pure — identifier shaping (which
 * key formats, synthetic-email drops, hashing) stays with each destination's
 * service.
 */
export function filterEligible(rows, ctx, policy) {
  const out = [];
  for (const p of rows || []) {
    if (policy.checkErased && p?.sourceMetadata?.erased === true) continue;
    if (ctx.editSuppressedProspectIds && p?.id && ctx.editSuppressedProspectIds.has(p.id)) continue;
    if (policy.requireVerifiedBinding && !phoneVerificationIsCurrent(p)) continue;
    if (policy.requireConsent && !contactGrantAllows(ctx.grantMap?.get(p?.phone), p?.campaignId || null)) continue;
    if (ctx.suppressedPhones && p?.phone && ctx.suppressedPhones.has(p.phone)) continue;
    out.push(p);
  }
  return out;
}
