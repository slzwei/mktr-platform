import { Op } from 'sequelize';
import {
  RewardEntitlement, Redemption, RedemptionEvent, RewardOffer, Activation,
  PartnerOrganisation, PartnerLocation, Prospect, User, sequelize,
} from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { makeInventoryService } from './inventoryService.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { hashToken } from './tokens.js';

/**
 * Redemption (docs/redeem-ops/ERD.md §3.17–3.18, brief §27). Server-validated,
 * transaction-safe, idempotent:
 *  - a QR/code is only a POINTER — the server decides validity;
 *  - reservation-pass tokens are REJECTED here (meeting QR ≠ voucher);
 *  - issued→redeemed is a conditional UPDATE + UNIQUE redemptions.entitlementId,
 *    so double redemption is impossible even under concurrent verifies;
 *  - replays get a typed "already redeemed" (200-shaped, idempotent).
 */
export function makeRedemptionService(overrides = {}) {
  const d = {
    RewardEntitlement, Redemption, RedemptionEvent, RewardOffer, Activation,
    PartnerOrganisation, PartnerLocation, Prospect, User, sequelize, logger,
    inventory: makeInventoryService(),
    audit: makeRedeemOpsAuditService(),
    ...overrides,
  };

  async function writeEvent(t, evt) {
    return d.RedemptionEvent.create(
      {
        entitlementId: evt.entitlementId,
        redemptionId: evt.redemptionId || null,
        type: evt.type,
        metadata: evt.metadata || null,
        actorType: evt.actorType || 'staff',
        actorUserId: evt.actorUserId || null,
      },
      { transaction: t }
    );
  }

  /**
   * Resolve a counter-presented token. Accepts the voucher token always, and the
   * presentation token ONLY once the entitlement is unlocked (status='issued'+):
   * post-unlock the consumer's stable /r link renders a scannable QR of their own
   * presentation token, and the STATE MACHINE — not the token string — is the
   * redemption gate. Pre-unlock, a presentation token at the counter is the
   * classic mistake and gets a typed rejection.
   */
  async function findByVoucherToken(token) {
    if (!token || typeof token !== 'string') return null;
    const hash = hashToken(token.trim());
    const entitlement = await d.RewardEntitlement.findOne({
      where: { [Op.or]: [{ tokenHash: hash }, { presentationTokenHash: hash }] },
      include: [
        { model: d.RewardOffer, as: 'rewardOffer', attributes: ['id', 'title', 'publicTitle', 'partnerOrganisationId'] },
        { model: d.Activation, as: 'activation', attributes: ['id', 'campaignNameSnapshot', 'partnerOrganisationId'] },
        { model: d.Prospect, as: 'prospect', attributes: ['id', 'firstName', 'lastName', 'phone'] },
      ],
    });
    if (!entitlement) return null;
    entitlement._matchedViaPresentation = entitlement.presentationTokenHash === hash && entitlement.tokenHash !== hash;
    return entitlement;
  }

  /** Verify a voucher (idempotent read + audited attempt). */
  async function verify(token, actor, { actorType = 'staff' } = {}) {
    const entitlement = await findByVoucherToken(token);
    if (!entitlement) {
      throw new AppError('Voucher not found', 404);
    }
    if (entitlement._matchedViaPresentation && entitlement.status === 'eligible') {
      await writeEvent(null, {
        entitlementId: entitlement.id, type: 'rejected', actorType,
        actorUserId: actor?.id || null, metadata: { reason: 'reservation_pass_at_counter' },
      });
      throw new AppError('This is a reservation pass, not a voucher — the reward unlocks at the financial review.', 422);
    }

    await writeEvent(null, {
      entitlementId: entitlement.id, type: 'verify_attempt', actorType,
      actorUserId: actor?.id || null,
    });

    const expired = entitlement.expiresAt && new Date(entitlement.expiresAt) < new Date();
    return {
      entitlement,
      valid: entitlement.status === 'issued' && !expired,
      state: entitlement.status === 'issued' && expired ? 'expired' : entitlement.status,
      reward: {
        title: entitlement.rewardOffer?.publicTitle || entitlement.rewardOffer?.title,
        tokenHint: entitlement.tokenHint,
        expiresAt: entitlement.expiresAt,
      },
      // Fulfilment-context identity (redemptions.verify capability unmasks)
      holder: entitlement.prospect
        ? { firstName: entitlement.prospect.firstName, lastName: entitlement.prospect.lastName, phone: entitlement.prospect.phone }
        : null,
    };
  }

  /** Complete a redemption — exactly once. */
  async function complete(token, { locationId = null, method = 'code', notes = null } = {}, actor, { actorType = 'staff' } = {}) {
    const entitlement = await findByVoucherToken(token);
    if (!entitlement) throw new AppError('Voucher not found', 404);
    if (entitlement._matchedViaPresentation && entitlement.status === 'eligible') {
      throw new AppError('This is a reservation pass, not a voucher — the reward unlocks at the financial review.', 422);
    }

    if (entitlement.status === 'redeemed') {
      const existing = await d.Redemption.findOne({ where: { entitlementId: entitlement.id } });
      return { redemption: existing, entitlement, already: true };
    }
    if (entitlement.status !== 'issued') {
      throw new AppError(`Voucher is ${entitlement.status}`, 409);
    }
    if (entitlement.expiresAt && new Date(entitlement.expiresAt) < new Date()) {
      throw new AppError('Voucher has expired', 409);
    }
    if (locationId) {
      const location = await d.PartnerLocation.findByPk(locationId);
      if (!location || location.partnerOrganisationId !== entitlement.activation.partnerOrganisationId) {
        throw new AppError('Location does not belong to this reward’s partner', 400);
      }
    }

    try {
      const redemption = await d.sequelize.transaction(async (t) => {
        // Conditional state transition — the concurrency gate
        const [count] = await d.RewardEntitlement.update(
          { status: 'redeemed' },
          { where: { id: entitlement.id, status: 'issued' }, transaction: t }
        );
        if (count === 0) {
          throw Object.assign(new Error('already'), { _already: true });
        }
        const created = await d.Redemption.create(
          {
            entitlementId: entitlement.id,
            rewardOfferId: entitlement.rewardOfferId,
            activationId: entitlement.activationId,
            partnerOrganisationId: entitlement.activation.partnerOrganisationId,
            locationId,
            method,
            actorType,
            actorUserId: actor?.id || null,
            notes,
          },
          { transaction: t }
        );
        await d.inventory.recordRedeemed({
          offerId: entitlement.rewardOfferId, activationId: entitlement.activationId,
          entitlementId: entitlement.id, redemptionId: created.id,
          actorType, actorUser: actor, transaction: t,
        });
        await d.sequelize.query(
          `UPDATE activations SET "redeemedCount" = "redeemedCount" + 1, "updatedAt" = NOW()
            WHERE id = :id`,
          { replacements: { id: entitlement.activationId }, transaction: t }
        );
        await writeEvent(t, {
          entitlementId: entitlement.id, redemptionId: created.id, type: 'redeemed',
          actorType, actorUserId: actor?.id || null, metadata: { method, locationId },
        });
        return created;
      });
      return { redemption, entitlement, already: false };
    } catch (err) {
      if (err?._already) {
        const existing = await d.Redemption.findOne({ where: { entitlementId: entitlement.id } });
        return { redemption: existing, entitlement, already: true };
      }
      if (err?.name === 'SequelizeUniqueConstraintError') {
        const existing = await d.Redemption.findOne({ where: { entitlementId: entitlement.id } });
        return { redemption: existing, entitlement, already: true };
      }
      throw err;
    }
  }

  /** Authorized manual exception — reverse a completed redemption (TERMINAL for the entitlement). */
  async function reverse(redemptionId, user, reason, requestId = null) {
    if (!reason || !String(reason).trim()) throw new AppError('A reason is required', 400);
    const redemption = await d.Redemption.findByPk(redemptionId);
    if (!redemption) throw new AppError('Redemption not found', 404);
    if (redemption.status === 'reversed') return redemption;

    await d.sequelize.transaction(async (t) => {
      await redemption.update({ status: 'reversed', notes: [redemption.notes, `REVERSED: ${reason}`].filter(Boolean).join('\n') }, { transaction: t });
      // Terminal for the entitlement (ERD.md §3.17): cancel it; re-fulfilment = manual re-issue.
      await d.RewardEntitlement.update(
        { status: 'cancelled' },
        { where: { id: redemption.entitlementId }, transaction: t }
      );
      await writeEvent(t, {
        entitlementId: redemption.entitlementId, redemptionId, type: 'reversed',
        actorType: 'staff', actorUserId: user.id, metadata: { reason },
      });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'redemption.overridden', entityType: 'redemption',
        entityId: redemptionId, reason, requestId, transaction: t,
      });
    });
    return redemption;
  }

  async function listRedemptions(query = {}) {
    const where = {};
    if (query.partnerOrganisationId) where.partnerOrganisationId = String(query.partnerOrganisationId);
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
    const { rows, count } = await d.Redemption.findAndCountAll({
      where,
      include: [
        { model: d.RewardOffer, as: 'rewardOffer', attributes: ['id', 'title'] },
        { model: d.PartnerOrganisation, as: 'partner', attributes: ['id', 'tradingName', 'legalName'] },
        { model: d.User, as: 'actor', attributes: ['id', 'fullName'] },
      ],
      order: [['redeemedAt', 'DESC']],
      limit, offset: (page - 1) * limit,
    });
    return { redemptions: rows, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } };
  }

  return { verify, complete, reverse, listRedemptions, findByVoucherToken };
}

const _default = makeRedemptionService();
export default _default;
