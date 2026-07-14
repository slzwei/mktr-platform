import {
  Activation, RewardOffer, PartnerOrganisation, Campaign, sequelize,
} from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { makeInventoryService } from './inventoryService.js';
import { invalidateMarketplaceCache } from '../marketplaceCache.js';

const ACTIVATION_STATUSES = ['draft', 'preparing', 'active', 'paused', 'completed', 'cancelled'];
const LIVE_STATUSES = ['preparing', 'active', 'paused'];
const STATUS_TRANSITIONS = {
  draft: ['preparing', 'cancelled'],
  preparing: ['active', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};
const UNLOCK_POLICIES = ['on_capture', 'agent_unlock'];

/**
 * Activations (docs/redeem-ops/ERD.md §3.15, brief §25): the operational bridge
 * between a partner's Reward Offer and ONE canonical MKTR campaign. Owns
 * allocation + status + unlock policy; owns NOTHING of the campaign itself —
 * linking validates against `campaigns` read-only, and the partial unique index
 * (one LIVE activation per campaign) is the DB-level backstop.
 */
export function makeActivationService(overrides = {}) {
  const d = {
    Activation, RewardOffer, PartnerOrganisation, Campaign, sequelize, logger,
    audit: makeRedeemOpsAuditService(),
    inventory: makeInventoryService(),
    ...overrides,
  };

  const INCLUDES = [
    { model: PartnerOrganisation, as: 'partner', attributes: ['id', 'tradingName', 'legalName', 'brandName'] },
    { model: RewardOffer, as: 'rewardOffer', attributes: ['id', 'title', 'rewardType', 'committedQuantity', 'allocatedQuantity', 'issuedQuantity', 'redeemedQuantity', 'claimExpiryDays', 'redemptionExpiryDays', 'status'] },
  ];

  async function listActivations(query = {}) {
    const where = {};
    if (query.status && ACTIVATION_STATUSES.includes(query.status)) where.status = query.status;
    if (query.partnerOrganisationId) where.partnerOrganisationId = String(query.partnerOrganisationId);
    return d.Activation.findAll({ where, include: INCLUDES, order: [['createdAt', 'DESC']], limit: 200 });
  }

  async function getActivation(id) {
    const activation = await d.Activation.findByPk(id, { include: INCLUDES });
    if (!activation) throw new AppError('Activation not found', 404);
    return activation;
  }

  async function createActivation(body, user, requestId = null) {
    const offer = await d.RewardOffer.findByPk(body.rewardOfferId);
    if (!offer) throw new AppError('Reward offer not found', 404);
    if (body.unlockPolicy && !UNLOCK_POLICIES.includes(body.unlockPolicy)) {
      throw new AppError('Unknown unlockPolicy', 400);
    }

    return d.sequelize.transaction(async (t) => {
      const activation = await d.Activation.create(
        {
          partnerOrganisationId: offer.partnerOrganisationId,
          rewardOfferId: offer.id,
          allocatedQuantity: 0,
          unlockPolicy: body.unlockPolicy || 'agent_unlock',
          startDate: body.startDate || null,
          endDate: body.endDate || null,
          internalNotes: body.internalNotes || null,
          createdBy: user.id,
        },
        { transaction: t }
      );
      const qty = parseInt(body.allocatedQuantity, 10) || 0;
      if (qty > 0) {
        await d.inventory.allocate({
          offerId: offer.id, activationId: activation.id, quantity: qty,
          actorUser: user, reason: 'initial allocation', transaction: t,
        });
        await activation.update({ allocatedQuantity: qty }, { transaction: t });
      }
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'activation.created', entityType: 'activation',
        entityId: activation.id,
        after: { rewardOfferId: offer.id, allocatedQuantity: qty },
        requestId, transaction: t,
      });
      return activation;
    });
  }

  /** Link (or unlink with campaignId=null) the canonical MKTR campaign. */
  async function linkCampaign(id, campaignId, user, requestId = null) {
    const activation = await getActivation(id);

    if (campaignId === null) {
      const before = { campaignId: activation.campaignId };
      await d.sequelize.transaction(async (t) => {
        await activation.update({ campaignId: null, campaignNameSnapshot: null }, { transaction: t });
        await d.audit.recordAuditEvent({
          actorUser: user, action: 'activation.campaign_unlinked', entityType: 'activation',
          entityId: id, before, requestId, transaction: t,
        });
      });
      return activation;
    }

    const campaign = await d.Campaign.findByPk(campaignId, { attributes: ['id', 'name', 'status'] });
    if (!campaign) throw new AppError('Campaign not found', 404);
    if (campaign.status === 'archived') {
      throw new AppError('Cannot link an archived campaign', 400);
    }

    const before = { campaignId: activation.campaignId };
    try {
      await d.sequelize.transaction(async (t) => {
        await activation.update(
          { campaignId: campaign.id, campaignNameSnapshot: campaign.name },
          { transaction: t }
        );
        await d.audit.recordAuditEvent({
          actorUser: user, action: 'activation.campaign_linked', entityType: 'activation',
          entityId: id, before, after: { campaignId: campaign.id, campaignName: campaign.name },
          requestId, transaction: t,
        });
      });
    } catch (err) {
      if (err?.name === 'SequelizeUniqueConstraintError' || err?.original?.constraint === 'uq_act_live_campaign') {
        throw new AppError('Another live activation is already linked to this campaign', 409);
      }
      throw err;
    }
    return activation;
  }

  /** Change ± allocation through the inventory ledger (never a bare counter write). */
  async function changeAllocation(id, delta, user, reason = null, requestId = null) {
    if (!Number.isInteger(delta) || delta === 0) throw new AppError('delta must be a non-zero integer', 400);
    const activation = await getActivation(id);

    return d.sequelize.transaction(async (t) => {
      if (delta > 0) {
        await d.inventory.allocate({
          offerId: activation.rewardOfferId, activationId: id, quantity: delta,
          actorUser: user, reason, transaction: t,
        });
      } else {
        const q = -delta;
        if (activation.allocatedQuantity - q < activation.issuedCount) {
          throw new AppError('Cannot reduce allocation below what has been issued', 409);
        }
        await d.inventory.deallocate({
          offerId: activation.rewardOfferId, activationId: id, quantity: q,
          actorUser: user, reason, transaction: t,
        });
      }
      await activation.update(
        { allocatedQuantity: activation.allocatedQuantity + delta },
        { transaction: t }
      );
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'activation.allocation_changed', entityType: 'activation',
        entityId: id, after: { delta, allocatedQuantity: activation.allocatedQuantity },
        reason, requestId, transaction: t,
      });
      return activation;
    });
  }

  async function setStatus(id, status, user, requestId = null) {
    if (!ACTIVATION_STATUSES.includes(status)) throw new AppError('Unknown status', 400);
    const activation = await getActivation(id);
    const from = activation.status;
    if (from === status) return activation;
    if (!(STATUS_TRANSITIONS[from] || []).includes(status)) {
      throw new AppError(`Cannot move activation from ${from} to ${status}`, 400);
    }
    // Going LIVE requires a linked campaign and a live reward offer
    if (LIVE_STATUSES.includes(status) && !activation.campaignId && status !== 'preparing') {
      throw new AppError('Link an MKTR campaign before activating', 400);
    }

    try {
      await d.sequelize.transaction(async (t) => {
        await activation.update({ status }, { transaction: t });
        await d.audit.recordAuditEvent({
          actorUser: user, action: 'activation.status_changed', entityType: 'activation',
          entityId: id, before: { status: from }, after: { status }, requestId, transaction: t,
        });
      });
    } catch (err) {
      if (err?.name === 'SequelizeUniqueConstraintError' || err?.original?.constraint === 'uq_act_live_campaign') {
        throw new AppError('Another live activation is already linked to this campaign', 409);
      }
      throw err;
    }
    return activation;
  }

  /** Record the renewal outcome (brief §29 partner renewal) — audited. */
  async function setRenewal(id, renewalOutcome, user, requestId = null) {
    if (!['renewed', 'not_renewed', 'pending'].includes(renewalOutcome)) {
      throw new AppError('renewalOutcome must be renewed | not_renewed | pending', 400);
    }
    const activation = await getActivation(id);
    const before = { renewalOutcome: activation.renewalOutcome };
    await d.sequelize.transaction(async (t) => {
      await activation.update({ renewalOutcome }, { transaction: t });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'activation.renewal_recorded', entityType: 'activation',
        entityId: id, before, after: { renewalOutcome }, requestId, transaction: t,
      });
    });
    return activation;
  }

  // Marketplace read cache: activation changes alter public offer state
  // (capacity, live window) — bust on every mutation so admin actions show
  // within one request (docs/plans/redeem-marketplace-v2.md Phase 1).
  const service = { listActivations, getActivation, createActivation, linkCampaign, changeAllocation, setStatus, setRenewal };
  for (const k of ['createActivation', 'linkCampaign', 'changeAllocation', 'setStatus', 'setRenewal']) {
    const fn = service[k];
    service[k] = async (...args) => {
      const result = await fn(...args);
      invalidateMarketplaceCache();
      return result;
    };
  }
  return service;
}

const _default = makeActivationService();
export default _default;
