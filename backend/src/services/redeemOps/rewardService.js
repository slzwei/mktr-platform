import { Op } from 'sequelize';
import {
  RewardOffer, RewardTermsVersion, RewardOfferLocation, RewardInventoryEvent,
  PartnerOrganisation, PartnerLocation, User, sequelize,
} from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { makeInventoryService } from './inventoryService.js';
import { makeCategoryService } from './categoryService.js';
import { REWARD_TYPES } from './constants.js';

const OFFER_STATUSES = ['draft', 'active', 'paused', 'ended'];
const FULFILMENT_METHODS = ['unique_code', 'qr', 'partner_verification', 'manual_booking', 'external_link', 'physical_voucher'];

/** Reward offers + versioned terms (docs/redeem-ops/ERD.md §3.11–3.13, brief §23). */
export function makeRewardService(overrides = {}) {
  const d = {
    RewardOffer, RewardTermsVersion, RewardOfferLocation, RewardInventoryEvent,
    PartnerOrganisation, PartnerLocation, User, sequelize, logger,
    audit: makeRedeemOpsAuditService(),
    inventory: makeInventoryService(),
    categories: makeCategoryService(),
    ...overrides,
  };

  const EDITABLE = [
    'title', 'publicTitle', 'internalRef', 'description', 'category', 'rewardType',
    'retailValue', 'fulfilmentCost', 'fundingSource', 'validityStart', 'validityEnd',
    'claimExpiryDays', 'redemptionExpiryDays', 'fulfilmentMethod', 'externalBookingUrl',
  ];

  function validateEnumFields(body) {
    if (body.rewardType && !REWARD_TYPES.includes(body.rewardType)) throw new AppError('Unknown rewardType', 400);
    if (body.fulfilmentMethod && !FULFILMENT_METHODS.includes(body.fulfilmentMethod)) throw new AppError('Unknown fulfilmentMethod', 400);
  }

  async function listOffers(query = {}) {
    const where = {};
    if (query.partnerOrganisationId) where.partnerOrganisationId = String(query.partnerOrganisationId);
    if (query.status && OFFER_STATUSES.includes(query.status)) where.status = query.status;
    const offers = await d.RewardOffer.findAll({
      where,
      include: [{ model: d.PartnerOrganisation, as: 'partner', attributes: ['id', 'tradingName', 'legalName', 'brandName'] }],
      order: [['createdAt', 'DESC']],
      limit: 200,
    });
    return offers;
  }

  async function getOffer(id) {
    const offer = await d.RewardOffer.findByPk(id, {
      include: [
        { model: d.PartnerOrganisation, as: 'partner', attributes: ['id', 'tradingName', 'legalName', 'brandName'] },
        { model: d.RewardOfferLocation, as: 'offerLocations', include: [{ model: d.PartnerLocation, as: 'location' }] },
      ],
    });
    if (!offer) throw new AppError('Reward offer not found', 404);
    const terms = await d.RewardTermsVersion.findAll({
      where: { rewardOfferId: id },
      order: [['version', 'DESC']],
      limit: 5,
    });
    return { offer, terms };
  }

  async function createOffer(body, user, requestId = null) {
    if (!body.title || !String(body.title).trim()) throw new AppError('Title is required', 400);
    if (!body.partnerOrganisationId) throw new AppError('partnerOrganisationId is required', 400);
    validateEnumFields(body);
    const partner = await d.PartnerOrganisation.findByPk(body.partnerOrganisationId);
    if (!partner || partner.mergedIntoId) throw new AppError('Partner not found', 404);

    const committed = Number.isInteger(body.committedQuantity) && body.committedQuantity > 0
      ? body.committedQuantity : 0;

    // Explicit category is validated; the partner.category fallback is copied
    // as-is even if retired — a known name that must never block offer creation.
    const category = (await d.categories.resolveCategoryName(body.category))
      ?? partner.category ?? null;

    return d.sequelize.transaction(async (t) => {
      const offer = await d.RewardOffer.create(
        {
          partnerOrganisationId: body.partnerOrganisationId,
          title: String(body.title).trim(),
          publicTitle: body.publicTitle || null,
          internalRef: body.internalRef || null,
          description: body.description || null,
          category,
          rewardType: body.rewardType || 'free_service',
          retailValue: body.retailValue ?? null,
          fulfilmentCost: body.fulfilmentCost ?? null,
          fundingSource: body.fundingSource || 'partner',
          committedQuantity: committed,
          validityStart: body.validityStart || null,
          validityEnd: body.validityEnd || null,
          claimExpiryDays: body.claimExpiryDays ?? null,
          redemptionExpiryDays: body.redemptionExpiryDays ?? null,
          fulfilmentMethod: body.fulfilmentMethod || 'partner_verification',
          externalBookingUrl: body.externalBookingUrl || null,
          createdBy: user.id,
        },
        { transaction: t }
      );
      if (committed > 0) {
        await d.inventory.writeLedger(t, {
          rewardOfferId: offer.id, type: 'committed', quantity: committed, actorUser: user,
          reason: 'initial commitment',
        });
      }
      if (body.terms) {
        await d.RewardTermsVersion.create(
          { rewardOfferId: offer.id, version: 1, structured: body.terms.structured || {}, freeText: body.terms.freeText || null, createdBy: user.id },
          { transaction: t }
        );
        await offer.update({ currentTermsVersion: 1 }, { transaction: t });
      }
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'reward.created', entityType: 'reward_offer', entityId: offer.id,
        after: { title: offer.title, partnerOrganisationId: offer.partnerOrganisationId, committedQuantity: committed },
        requestId, transaction: t,
      });
      return offer;
    });
  }

  async function updateOffer(id, body, user, requestId = null) {
    const offer = await d.RewardOffer.findByPk(id);
    if (!offer) throw new AppError('Reward offer not found', 404);
    validateEnumFields(body);
    const updates = {};
    for (const f of EDITABLE) if (body[f] !== undefined) updates[f] = body[f];
    if (updates.category !== undefined) {
      updates.category = await d.categories.resolveCategoryName(updates.category, {
        currentValue: offer.category,
      });
    }
    const before = {};
    for (const k of Object.keys(updates)) before[k] = offer.get(k);

    await d.sequelize.transaction(async (t) => {
      await offer.update(updates, { transaction: t });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'reward.edited', entityType: 'reward_offer', entityId: id,
        before, after: updates, requestId, transaction: t,
      });
    });
    return offer;
  }

  async function setOfferStatus(id, status, user, requestId = null) {
    if (!OFFER_STATUSES.includes(status)) throw new AppError('Unknown status', 400);
    const offer = await d.RewardOffer.findByPk(id);
    if (!offer) throw new AppError('Reward offer not found', 404);
    const before = offer.status;
    await d.sequelize.transaction(async (t) => {
      await offer.update({ status }, { transaction: t });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'reward.status_changed', entityType: 'reward_offer', entityId: id,
        before: { status: before }, after: { status }, requestId, transaction: t,
      });
    });
    return offer;
  }

  /** Append a new terms version and point the offer at it. */
  async function addTermsVersion(id, body, user, requestId = null) {
    const offer = await d.RewardOffer.findByPk(id);
    if (!offer) throw new AppError('Reward offer not found', 404);
    return d.sequelize.transaction(async (t) => {
      const version = offer.currentTermsVersion + 1;
      const terms = await d.RewardTermsVersion.create(
        {
          rewardOfferId: id, version,
          structured: body.structured || {}, freeText: body.freeText || null, createdBy: user.id,
        },
        { transaction: t }
      );
      await offer.update({ currentTermsVersion: version }, { transaction: t });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'terms.versioned', entityType: 'reward_offer', entityId: id,
        after: { version }, requestId, transaction: t,
      });
      return terms;
    });
  }

  /** Replace the participating-locations set (must belong to the offer's partner). */
  async function setLocations(id, partnerLocationIds, _user) {
    const offer = await d.RewardOffer.findByPk(id);
    if (!offer) throw new AppError('Reward offer not found', 404);
    const locations = await d.PartnerLocation.findAll({
      where: { id: { [Op.in]: partnerLocationIds || [] }, partnerOrganisationId: offer.partnerOrganisationId },
    });
    if ((partnerLocationIds || []).length !== locations.length) {
      throw new AppError('All locations must belong to the reward’s partner', 400);
    }
    return d.sequelize.transaction(async (t) => {
      await d.RewardOfferLocation.destroy({ where: { rewardOfferId: id }, transaction: t });
      for (const loc of locations) {
        await d.RewardOfferLocation.create({ rewardOfferId: id, partnerLocationId: loc.id }, { transaction: t });
      }
      return locations;
    });
  }

  /** Manual inventory movements from the UI (committed_increase|committed_decrease|manual_adjustment). */
  async function adjustInventory(id, { type, quantity, reason }, user, requestId = null) {
    if (!reason || !String(reason).trim()) throw new AppError('A reason is required for inventory changes', 400);
    const offer = await d.RewardOffer.findByPk(id);
    if (!offer) throw new AppError('Reward offer not found', 404);

    let result;
    if (type === 'committed_increase') {
      result = await d.inventory.increaseCommitted({ offerId: id, quantity, actorUser: user, reason });
    } else if (type === 'committed_decrease') {
      result = await d.inventory.decreaseCommitted({ offerId: id, quantity, actorUser: user, reason });
    } else {
      throw new AppError('Unknown inventory adjustment type', 400);
    }
    await d.audit.recordAuditEvent({
      actorUser: user, action: 'inventory.adjusted', entityType: 'reward_offer', entityId: id,
      after: { type, quantity }, reason, requestId,
    });
    return result;
  }

  async function getLedger(id, query = {}) {
    const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));
    const events = await d.RewardInventoryEvent.findAll({
      where: { rewardOfferId: id },
      include: [{ model: d.User, as: 'actor', attributes: ['id', 'fullName'] }],
      order: [['createdAt', 'DESC']],
      limit,
    });
    return events;
  }

  return {
    listOffers, getOffer, createOffer, updateOffer, setOfferStatus,
    addTermsVersion, setLocations, adjustInventory, getLedger,
  };
}

const _default = makeRewardService();
export default _default;
