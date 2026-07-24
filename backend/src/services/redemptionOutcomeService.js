/**
 * @file redemptionOutcomeService — turns a completed voucher redemption into a
 * server-side Meta CAPI conversion event (`VoucherRedeemed` by default).
 *
 * The strongest conversion signal in the funnel: anyone can submit a form for
 * a free voucher, but only a real, physically-present person burns one at the
 * partner counter. Feeding that back to Meta seeds the "people who actually
 * show up" pool (lookalikes, and later an optimization event).
 *
 * Mirrors leadOutcomeService's reliability doctrine:
 *   - Deterministic event_id `voucher_redeemed:{entitlementId}` — Meta-side
 *     dedup is the concurrency guard.
 *   - MARK ON SUCCESS: `prospect.sourceMetadata.capi.voucherRedeemed[entitlementId]`
 *     is written only after a confirmed send, so a never-sent event stays
 *     re-tryable. Keyed per entitlement because one prospect can redeem in
 *     several campaigns.
 *   - Callers fire on EVERY redemption resolution (fresh AND already-redeemed
 *     replays): a staff re-scan retries a send lost to a crash between the DB
 *     commit and the dispatch. The bootstrap sweep (sweepUnmarkedRedemptions)
 *     is the no-rescan safety net.
 *   - Bounded retry on transient (5xx/network) failures.
 *
 * Campaign scope (Codex R1 #1/#3): consent, the pixel override, and
 * custom_data.campaign_id all follow the ACTIVATION's campaign — manual
 * issuance deliberately allows an activation whose campaign differs from the
 * prospect's signup campaign. `activation.campaignId === undefined` means the
 * association was loaded without the column → reload; an explicit `null`
 * means the campaign link was severed (campaign deleted) → treat as unlinked
 * and let consent FAIL CLOSED to the global scope.
 *
 * action_source = 'physical_store'; the builder omits event_source_url for
 * non-website events. `reverse()` never re-emits (terminal cancel; a manual
 * re-issue mints a NEW entitlement id → a genuinely new event).
 */

import { Prospect, Campaign, Activation, RewardEntitlement } from '../models/index.js';
import { sendConversionEvent as metaSendConversionEvent } from './metaCapiService.js';
import { canMarketTo as ledgerCanMarketTo } from './consentService.js';
import { logger } from '../utils/logger.js';

export function redemptionEventName() {
  return process.env.META_EVENT_REDEEMED || 'VoucherRedeemed';
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const defaultDeps = {
  models: { Prospect, Campaign, Activation, RewardEntitlement },
  sendConversionEvent: metaSendConversionEvent,
  canMarketTo: ledgerCanMarketTo,
  logger,
  sleep: realSleep,
  retries: 2, // total attempts = retries + 1
  retryBaseMs: 250,
};

export function makeRedemptionOutcomeService(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };
  const m = { ...defaultDeps.models, ...(overrides.models || {}) };

  /** Bounded transient retry — identical contract to leadOutcomeService. */
  async function dispatchWithRetry(prospect, ctx, options) {
    let result;
    for (let attempt = 0; attempt <= d.retries; attempt++) {
      result = await d.sendConversionEvent(prospect, ctx, options);
      if (result?.sent) return result;
      if (result?.reason === 'guarded' || result?.reason === 'no_pixel_id') return result;
      const transient = result?.error != null || (typeof result?.status === 'number' && result.status >= 500);
      if (!transient) return result;
      if (attempt < d.retries) await d.sleep(d.retryBaseMs * 2 ** attempt);
    }
    return result;
  }

  /**
   * Process one redeemed entitlement. Never throws — redemption must never
   * fail or slow because ad reporting hiccuped.
   *
   * @param {object} args { entitlement } — a RewardEntitlement instance (or
   *   plain object) with id/prospectId/activationId; `activation` association
   *   optional (reloaded when campaignId wasn't selected).
   * @returns {Promise<{dispatched?: string, duplicate?: boolean, skipped?: string, failed?: string}>}
   */
  async function processRedemption({ entitlement } = {}) {
    try {
      if (!entitlement?.id) return { skipped: 'no_entitlement' };
      if (!entitlement.prospectId) return { skipped: 'no_prospect' };

      const prospect = await m.Prospect.findByPk(entitlement.prospectId);
      if (!prospect) return { skipped: 'prospect_missing' };

      const markerMap = prospect.sourceMetadata?.capi?.voucherRedeemed || {};
      if (markerMap[entitlement.id]) return { duplicate: true };

      // Activation campaign — undefined ⇒ association loaded without the
      // column (or not loaded): reload. Explicit null ⇒ unlinked; keep null.
      let activationCampaignId = entitlement.activation?.campaignId;
      if (activationCampaignId === undefined) {
        const activation = entitlement.activationId
          ? await m.Activation.findByPk(entitlement.activationId)
          : null;
        activationCampaignId = activation ? activation.campaignId : null;
      }

      // em/ph/fn/ln/country gate — ledger truth at send time, scoped to the
      // activation's campaign. FAIL CLOSED on lookup error: event still fires
      // on browser/session identifiers alone.
      let marketingConsent = false;
      try {
        marketingConsent =
          (await d.canMarketTo({
            consumerId: prospect.consumerId || null,
            phone: prospect.phone || null,
            channel: 'all',
            campaignId: activationCampaignId || null,
          })) === true;
      } catch (err) {
        d.logger.warn(
          { entitlement_id: entitlement.id, error: err?.message || String(err) },
          '[redemption-capi] canMarketTo failed — omitting contact PII (fail-closed)'
        );
      }

      let pixelIdOverride;
      if (activationCampaignId) {
        const campaign = await m.Campaign.findByPk(activationCampaignId);
        pixelIdOverride = campaign?.metaPixelId || undefined;
      }

      const eventName = redemptionEventName();
      const ctx = {
        eventId: `voucher_redeemed:${entitlement.id}`,
        actionSource: 'physical_store',
        marketingConsent,
        ...(activationCampaignId ? { campaignIdOverride: activationCampaignId } : {}),
        ...(pixelIdOverride ? { pixelIdOverride } : {}),
      };

      const result = await dispatchWithRetry(prospect, ctx, { eventName });

      if (result?.sent) {
        const capi = { ...(prospect.sourceMetadata?.capi || {}) };
        capi.voucherRedeemed = { ...(capi.voucherRedeemed || {}), [entitlement.id]: new Date().toISOString() };
        prospect.sourceMetadata = { ...(prospect.sourceMetadata || {}), capi };
        if (typeof prospect.changed === 'function') prospect.changed('sourceMetadata', true);
        await prospect.save();
        d.logger.info(
          { entitlement_id: entitlement.id, prospect_id: prospect.id, event_name: eventName },
          '[redemption-capi] dispatched'
        );
        return { dispatched: eventName };
      }

      // Not marked → the next replay / sweep retries. `guarded` = CAPI off or
      // ineligible origin; `no_pixel_id` = no pixel configured — both benign.
      if (result?.reason !== 'guarded' && result?.reason !== 'no_pixel_id') {
        d.logger.warn(
          { entitlement_id: entitlement.id, prospect_id: prospect.id, reason: result?.reason, status: result?.status },
          '[redemption-capi] dispatch not sent (left re-tryable)'
        );
      }
      return { failed: eventName, reason: result?.reason || result?.status };
    } catch (err) {
      d.logger.error(
        { entitlement_id: entitlement?.id, error: err?.message || String(err) },
        '[redemption-capi] processRedemption threw'
      );
      return { failed: redemptionEventName(), reason: 'exception' };
    }
  }

  /**
   * Safety net for sends lost between the redemption commit and the dispatch
   * (process death) when no staff re-scan ever happens. Small table scan —
   * redeemed entitlements with a prospect — filtered in JS by marker because
   * the marker lives inside the prospect's JSON column.
   *
   * Wired by database/bootstrap.js on an interval when META_CAPI_ENABLED.
   */
  async function sweepUnmarkedRedemptions({ limit = 200 } = {}) {
    const rows = await m.RewardEntitlement.findAll({
      where: { status: 'redeemed' },
      attributes: ['id', 'prospectId', 'activationId'],
      order: [['updatedAt', 'DESC']],
      limit,
    });
    let attempted = 0;
    let dispatched = 0;
    for (const entitlement of rows) {
      if (!entitlement.prospectId) continue;
      const result = await processRedemption({ entitlement });
      if (result.duplicate || result.skipped) continue;
      attempted += 1;
      if (result.dispatched) dispatched += 1;
    }
    if (attempted > 0) {
      d.logger.info({ attempted, dispatched, scanned: rows.length }, '[redemption-capi] sweep done');
    }
    return { scanned: rows.length, attempted, dispatched };
  }

  return { processRedemption, sweepUnmarkedRedemptions };
}

const _default = makeRedemptionOutcomeService();
export default _default;
export const { processRedemption, sweepUnmarkedRedemptions } = _default;
