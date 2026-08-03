import { sequelize, Activation, RewardOffer, PartnerOrganisation } from '../../models/index.js';
import { AppError } from '../../middleware/appError.js';
import { logger } from '../../utils/logger.js';
import { makeInventoryService } from './inventoryService.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { getStoredLuckyDraw } from '../../utils/designConfigV2Clamp.js';
import { normalizeLuckyDraw } from '../../utils/luckyDraw.js';
import { sgtDayEndExclusiveMs } from '../../utils/sgtTime.js';

/**
 * drawBoostProvisioningService — the ×N boost rail is born WITH the draw
 * (docs/plans/draw-launch-integrity-scope.md PR-2; redesign per Codex R1
 * CX9–CX12; original design draw-boost-rail-auto-provision.md Phase 1).
 *
 * `ensureDrawBoostRail` is an ENSURE, not an assert (old-plan F2): called at
 * every path that arms a live draw (launch-state flip, activating update,
 * born-active create), it adopts a compatible existing rail or provisions a
 * fresh one, then hands back the activationId for the luckyDraw stamp. AI
 * "Write it for me" / create-everything land on the same campaignService
 * choke points, so this covers them with zero AI-layer changes.
 *
 * Why MODEL-LEVEL writes and not the ops services (Codex R1 CX9/CX10): the
 * service chain cannot express this operation — `createOffer` requires a
 * PARTNERED partner (the house partner is deliberately LOST, out of BD
 * pipelines), offers are born draft, and activations must walk
 * draft→preparing→active in separate self-committing transactions. This
 * service instead composes the SAME primitives the services use — the
 * inventory ledger (increaseCommitted/allocate, tx-aware) and the audit
 * trail — inside ONE transaction under a per-campaign advisory lock, and
 * documents the deliberate transition bypass in its audit rows.
 *
 * Idempotency (CX11): the per-campaign advisory lock serializes concurrent
 * ensures; `uq_act_live_campaign` (one LIVE activation per campaign) is the
 * DB backstop — a lost race re-reads and adopts the winner. The offer's
 * `internalRef = 'draw-boost:<campaignId>'` is the durable marker that lets
 * a retry after partial failure adopt its own orphan instead of duplicating
 * (internalRef has no unique index — the lock is what makes find-first safe).
 *
 * Fail-loud contract: an ACTIVE rail that cannot serve the boost (wrong
 * unlockPolicy — `on_capture` mints `auto_on_capture`, which is never boost
 * evidence; or an inactive offer) is a typed 422, never silently adopted and
 * never silently duplicated (the unique index forbids a second live row).
 */

const LIVE_STATUSES = ['preparing', 'active', 'paused'];
const DAY_MS = 24 * 60 * 60 * 1000;

export function provisioningConfig() {
  return {
    enabled: String(process.env.DRAW_BOOST_AUTOPROVISION_ENABLED ?? 'true').toLowerCase() !== 'false',
    entitlementsOn: String(process.env.REDEEM_OPS_ENTITLEMENTS_ENABLED || 'false').toLowerCase() === 'true',
    defaultAllocation: (() => {
      const n = Number(process.env.DRAW_BOOST_DEFAULT_ALLOCATION);
      return Number.isInteger(n) && n >= 100 && n <= 1_000_000 ? n : 10_000; // D1: effectively unlimited
    })(),
    housePartnerId: (process.env.REDEEM_HOUSE_PARTNER_ORG_ID || '').trim() || null,
  };
}

/** Reservation window sized to the boost deadline (old-plan F7): the pass
 * must outlive signup→boostClosesAt or expiry blocks the earned ×N. */
export function computeClaimExpiryDays(luckyDraw, now = Date.now()) {
  const anchor = luckyDraw?.boostClosesAt || luckyDraw?.closesAt || null;
  const endMs = anchor ? sgtDayEndExclusiveMs(anchor) : null;
  if (endMs === null) return 90;
  const days = Math.ceil((endMs - now) / DAY_MS) + 21;
  return Math.min(400, Math.max(30, days));
}

function typed422(message, code, data = {}) {
  const err = new AppError(message, 422);
  err.data = { code, ...data };
  return err;
}

export function makeDrawBoostProvisioningService(overrides = {}) {
  const d = {
    sequelize,
    Activation,
    RewardOffer,
    PartnerOrganisation,
    inventory: makeInventoryService(),
    audit: makeRedeemOpsAuditService(),
    logger,
    now: () => Date.now(),
    ...overrides,
  };

  async function resolveHousePartner(t, cfg) {
    if (cfg.housePartnerId) {
      const byId = await d.PartnerOrganisation.findByPk(cfg.housePartnerId, { transaction: t });
      if (byId) return byId;
      d.logger.warn('[DrawBoost] REDEEM_HOUSE_PARTNER_ORG_ID does not resolve — falling back to legalName lookup', {
        housePartnerId: cfg.housePartnerId,
      });
    }
    return d.PartnerOrganisation.findOne({
      where: { legalName: 'MKTR PTE. LTD.' },
      order: [['createdAt', 'ASC']],
      transaction: t,
    });
  }

  /** Validate an existing live activation as a usable boost rail. Throws typed
   * 422 on an unusable-but-live rail (the unique index forbids a second). */
  async function validateRail(activation, t) {
    if (activation.unlockPolicy !== 'agent_unlock') {
      throw typed422(
        `Campaign already has a live activation (${activation.id}) with unlockPolicy='${activation.unlockPolicy}' — ` +
          "'on_capture' issuance never counts as ×N boost evidence, and one live activation per campaign is enforced. " +
          'Cancel/complete it (Redeem Ops → Activations) or change its policy, then relaunch.',
        'DRAW_BOOST_RAIL_CONFLICT',
        { activationId: activation.id, unlockPolicy: activation.unlockPolicy }
      );
    }
    const offer = await d.RewardOffer.findByPk(activation.rewardOfferId, { transaction: t });
    if (!offer || offer.status !== 'active') {
      throw typed422(
        `The live activation's reward offer is ${offer ? offer.status : 'missing'} — reactivate it (Redeem Ops → Rewards) before launching the draw.`,
        'DRAW_BOOST_RAIL_CONFLICT',
        { activationId: activation.id, offerStatus: offer?.status || null }
      );
    }
    return offer;
  }

  /**
   * Ensure the campaign has an ACTIVE agent_unlock rail; returns
   * { activationId, outcome } — caller stamps luckyDraw.activationId.
   * Throws typed 422s; NEVER partially provisions (single tx).
   */
  async function ensureDrawBoostRail({ campaign, designConfig = null, user = null, transaction = null }) {
    const cfg = provisioningConfig();
    if (!cfg.enabled) {
      d.logger.warn('[DrawBoost] auto-provision disabled by kill switch — rail not ensured', { campaignId: campaign.id });
      return { activationId: null, outcome: 'disabled' };
    }
    if (!cfg.entitlementsOn) {
      throw typed422(
        'The reward-entitlement engine is OFF on this server (REDEEM_OPS_ENTITLEMENTS_ENABLED) — a draw would promise an entry pass nothing can issue. Enable it, or disable the lucky draw.',
        'DRAW_BOOST_RAIL_UNAVAILABLE'
      );
    }

    const doc = designConfig || campaign.design_config;
    const ld = normalizeLuckyDraw(getStoredLuckyDraw(doc));

    const provision = async (t) => {
      await d.sequelize.query(`SELECT pg_advisory_xact_lock(hashtext(:k))`, {
        replacements: { k: `draw-boost:${campaign.id}` },
        transaction: t,
      });

      const live = await d.Activation.findOne({
        where: { campaignId: campaign.id, status: LIVE_STATUSES },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (live) {
        if (live.status === 'paused') {
          throw typed422(
            `Campaign's boost rail (activation ${live.id}) is PAUSED — an operator paused it deliberately. Resume it (Redeem Ops → Activations) or cancel it, then relaunch.`,
            'DRAW_BOOST_RAIL_CONFLICT',
            { activationId: live.id, status: 'paused' }
          );
        }
        await validateRail(live, t);
        if (live.status === 'preparing') {
          await live.update({ status: 'active' }, { transaction: t });
          await d.audit.recordAuditEvent({
            actorUser: user, action: 'draw_boost.rail_promoted', entityType: 'activation',
            entityId: live.id, before: { status: 'preparing' }, after: { status: 'active' },
            reason: 'draw launch auto-promotion', transaction: t,
          });
          d.logger.info('[DrawBoost] preparing rail promoted to active at launch', { campaignId: campaign.id, activationId: live.id });
          return { activationId: live.id, outcome: 'promoted' };
        }
        return { activationId: live.id, outcome: 'adopted' };
      }

      // ── Fresh provisioning ──
      if (!user?.id) {
        // createdBy is NOT NULL on both rows; every launch path carries a user.
        throw typed422('Draw rail provisioning needs an acting user.', 'DRAW_BOOST_RAIL_UNAVAILABLE');
      }
      const partner = await resolveHousePartner(t, cfg);
      if (!partner) {
        throw typed422(
          'No house partner exists to own the auto-provisioned review offer — set REDEEM_HOUSE_PARTNER_ORG_ID (or create the MKTR PTE. LTD. partner in Redeem Ops) and relaunch.',
          'DRAW_BOOST_HOUSE_PARTNER_MISSING'
        );
      }

      const internalRef = `draw-boost:${campaign.id}`.slice(0, 64);
      let offer = await d.RewardOffer.findOne({ where: { internalRef }, transaction: t });
      const claimExpiryDays = computeClaimExpiryDays(ld, d.now());
      if (!offer) {
        offer = await d.RewardOffer.create(
          {
            partnerOrganisationId: partner.id,
            title: `Complimentary financial review (20 min) — ${campaign.name}`.slice(0, 160),
            publicTitle: `${campaign.name} Entry Pass`.slice(0, 160),
            internalRef,
            rewardType: 'free_service',
            fundingSource: 'mktr',
            status: 'active',
            claimExpiryDays,
            createdBy: user.id,
          },
          { transaction: t }
        );
        await d.inventory.increaseCommitted({
          offerId: offer.id, quantity: cfg.defaultAllocation, actorUser: user,
          reason: 'draw-boost auto-provision', transaction: t,
        });
      } else {
        // Orphan adoption (a prior attempt created the offer, then failed
        // before its activation) — reactivate if needed and only top up the
        // committed stock it is actually short of.
        if (offer.status !== 'active') await offer.update({ status: 'active' }, { transaction: t });
        const headroom = offer.committedQuantity - offer.allocatedQuantity;
        if (headroom < cfg.defaultAllocation) {
          await d.inventory.increaseCommitted({
            offerId: offer.id, quantity: cfg.defaultAllocation - Math.max(0, headroom), actorUser: user,
            reason: 'draw-boost auto-provision (orphan headroom)', transaction: t,
          });
        }
      }
      await d.inventory.allocate({
        offerId: offer.id, activationId: null, quantity: cfg.defaultAllocation, actorUser: user,
        reason: 'draw-boost auto-provision', transaction: t,
      });

      let activation;
      try {
        activation = await d.Activation.create(
          {
            partnerOrganisationId: partner.id,
            rewardOfferId: offer.id,
            campaignId: campaign.id,
            campaignNameSnapshot: campaign.name,
            allocatedQuantity: cfg.defaultAllocation,
            unlockPolicy: 'agent_unlock',
            status: 'active', // deliberate transition bypass — audited below
            createdBy: user.id,
          },
          { transaction: t }
        );
      } catch (err) {
        if (err?.name === 'SequelizeUniqueConstraintError' || err?.original?.constraint === 'uq_act_live_campaign') {
          // Lost the cross-instance race despite the lock (other DB session) —
          // adopt the winner if it is a valid rail.
          const winner = await d.Activation.findOne({
            where: { campaignId: campaign.id, status: LIVE_STATUSES }, transaction: t,
          });
          if (winner) {
            await validateRail(winner, t);
            return { activationId: winner.id, outcome: 'adopted' };
          }
        }
        throw err;
      }

      await d.audit.recordAuditEvent({
        actorUser: user, action: 'draw_boost.rail_provisioned', entityType: 'activation',
        entityId: activation.id,
        after: {
          offerId: offer.id, internalRef, allocation: cfg.defaultAllocation, claimExpiryDays,
          note: 'model-level provisioning (service chain requires PARTNERED partner + staged transitions — bypass documented in drawBoostProvisioningService.js)',
        },
        transaction: t,
      });
      d.logger.info('[DrawBoost] rail provisioned', {
        campaignId: campaign.id, activationId: activation.id, offerId: offer.id, allocation: cfg.defaultAllocation,
      });
      return { activationId: activation.id, outcome: 'provisioned' };
    };

    // H1: when the caller passes its transaction, the rail joins it — the rail
    // must commit WITH the campaign save that arms it, never in a transaction
    // of its own that survives the save failing (slug 409 → live rail +
    // allocated stock on a campaign that never activated). The advisory xact
    // lock then holds until the CALLER commits, which also covers the save.
    // Standalone callers keep the self-contained transaction.
    return transaction ? provision(transaction) : d.sequelize.transaction(provision);
  }

  /**
   * 15-min sweep hook (D1 "effectively unlimited"): any ACTIVE agent_unlock
   * activation on a draw-enabled campaign whose remaining allocation falls
   * under 20% of the default is topped up by one default block — committed
   * AND allocated through the ledger, per-activation advisory-locked so
   * cross-instance sweeps can't double-run (CX12). Never throws.
   */
  async function topUpDrawBoostAllocations() {
    const cfg = provisioningConfig();
    if (!cfg.enabled || !cfg.entitlementsOn) return { toppedUp: 0 };
    const threshold = Math.floor(cfg.defaultAllocation * 0.2);
    let toppedUp = 0;
    try {
      const [rows] = await d.sequelize.query(
        `SELECT a.id FROM activations a
           JOIN campaigns c ON c.id = a."campaignId"
          WHERE a.status = 'active' AND a."unlockPolicy" = 'agent_unlock'
            AND (a."allocatedQuantity" - a."issuedCount") < :threshold
            AND COALESCE(c.design_config::jsonb->'luckyDraw'->>'enabled','false') = 'true'
          LIMIT 20`,
        { replacements: { threshold } }
      );
      for (const row of rows || []) {
        try {
          await d.sequelize.transaction(async (t) => {
            await d.sequelize.query(`SELECT pg_advisory_xact_lock(hashtext(:k))`, {
              replacements: { k: `draw-boost-topup:${row.id}` }, transaction: t,
            });
            const activation = await d.Activation.findByPk(row.id, { transaction: t, lock: t.LOCK.UPDATE });
            if (!activation || activation.status !== 'active') return;
            if (activation.allocatedQuantity - activation.issuedCount >= threshold) return; // re-check under lock
            await d.inventory.increaseCommitted({
              offerId: activation.rewardOfferId, quantity: cfg.defaultAllocation,
              actorType: 'system', reason: 'draw-boost auto-top-up', transaction: t,
            });
            await d.inventory.allocate({
              offerId: activation.rewardOfferId, activationId: activation.id, quantity: cfg.defaultAllocation,
              actorType: 'system', reason: 'draw-boost auto-top-up', transaction: t,
            });
            await activation.update(
              { allocatedQuantity: activation.allocatedQuantity + cfg.defaultAllocation },
              { transaction: t }
            );
            await d.audit.recordAuditEvent({
              actorUser: null, actorType: 'system', action: 'draw_boost.auto_top_up',
              entityType: 'activation', entityId: activation.id,
              after: { delta: cfg.defaultAllocation, allocatedQuantity: activation.allocatedQuantity + cfg.defaultAllocation },
              transaction: t,
            });
            toppedUp += 1;
          });
        } catch (err) {
          d.logger.warn('[DrawBoost] top-up failed for one activation (next sweep retries)', {
            activationId: row.id, error: err?.message || String(err),
          });
        }
      }
      if (toppedUp > 0) d.logger.info('[DrawBoost] auto-top-up complete', { toppedUp });
    } catch (err) {
      d.logger.warn('[DrawBoost] top-up scan failed (non-fatal)', { error: err?.message || String(err) });
    }
    return { toppedUp };
  }

  return { ensureDrawBoostRail, topUpDrawBoostAllocations };
}

const _default = makeDrawBoostProvisioningService();
export const ensureDrawBoostRail = (...a) => _default.ensureDrawBoostRail(...a);
export const topUpDrawBoostAllocations = (...a) => _default.topUpDrawBoostAllocations(...a);
export default _default;
