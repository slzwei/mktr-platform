import { Op } from 'sequelize';
import {
  RewardEntitlement, RedemptionEvent, Activation, RewardOffer, PartnerOrganisation,
  Prospect, User, sequelize,
} from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { makeInventoryService } from './inventoryService.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { mintToken, hashToken, tokenHintOf } from './tokens.js';

const DEFAULT_RESERVATION_DAYS = 30;
const DEFAULT_REDEMPTION_DAYS = 90;

/**
 * Reward entitlements (docs/redeem-ops/MKTR_INTEGRATION.md §2, ERD.md §3.16).
 *
 * Issuance is at-least-once (capture hook + reconciliation sweep) made
 * exactly-once by the partial unique (activationId, prospectId) anchor.
 * Preconditions (anti-farming): server-stamped phone verification on the
 * prospect, not quarantined, activation ACTIVE with allocation remaining.
 *
 * unlockPolicy='agent_unlock' (default): capture creates a locked RESERVATION
 * (presentation-pass token only); the lead's assigned consultant unlocks at the
 * physical meeting (scan or button) which mints the voucher token.
 */
export function makeEntitlementService(overrides = {}) {
  const d = {
    RewardEntitlement, RedemptionEvent, Activation, RewardOffer, PartnerOrganisation,
    Prospect, User, sequelize, logger,
    inventory: makeInventoryService(),
    audit: makeRedeemOpsAuditService(),
    notifyUnlock: null, // injected by fulfilment wiring (email/SMS) — null-safe
    ...overrides,
  };

  async function writeEvent(t, evt) {
    return d.RedemptionEvent.create(
      {
        entitlementId: evt.entitlementId,
        redemptionId: evt.redemptionId || null,
        type: evt.type,
        metadata: evt.metadata || null,
        actorType: evt.actorType || 'system',
        actorUserId: evt.actorUserId || null,
      },
      { transaction: t }
    );
  }

  function verificationStampOf(prospect) {
    return prospect?.sourceMetadata?.phoneVerifiedAt || null;
  }

  /**
   * Issue (reserve) for a captured lead. Returns the entitlement or null with a
   * reason — NEVER throws into the capture path (the hook wraps it anyway).
   */
  async function issueForProspect(prospect, { via = 'hook' } = {}) {
    try {
      if (!prospect?.campaignId) return { entitlement: null, reason: 'no_campaign' };
      if (prospect.quarantinedAt) return { entitlement: null, reason: 'quarantined' };
      if (!verificationStampOf(prospect)) return { entitlement: null, reason: 'phone_not_verified' };

      const activation = await d.Activation.findOne({
        where: { campaignId: prospect.campaignId, status: 'active' },
        include: [{ model: d.RewardOffer, as: 'rewardOffer' }],
      });
      if (!activation) return { entitlement: null, reason: 'no_active_activation' };

      const existing = await d.RewardEntitlement.findOne({
        where: { activationId: activation.id, prospectId: prospect.id },
      });
      if (existing) return { entitlement: existing, reason: 'duplicate' };

      const offer = activation.rewardOffer;
      const onCapture = activation.unlockPolicy === 'on_capture';
      const reservationDays = offer.claimExpiryDays || DEFAULT_RESERVATION_DAYS;
      const redemptionDays = offer.redemptionExpiryDays || DEFAULT_REDEMPTION_DAYS;

      const presentation = mintToken();
      const voucher = onCapture ? mintToken() : null;

      const entitlement = await d.sequelize.transaction(async (t) => {
        // Activation-level guard: issuedCount < allocatedQuantity (single statement)
        const [rows] = await d.sequelize.query(
          `UPDATE activations
              SET "issuedCount" = "issuedCount" + 1, "updatedAt" = NOW()
            WHERE id = :id AND "issuedCount" < "allocatedQuantity" AND status = 'active'
            RETURNING id`,
          { replacements: { id: activation.id }, transaction: t }
        );
        if (!Array.isArray(rows) || rows.length === 0) {
          throw Object.assign(new Error('allocation_exhausted'), { _soft: true });
        }
        // Offer-level counter + ledger
        await d.inventory.recordIssued({
          offerId: offer.id, activationId: activation.id, transaction: t,
        });

        const created = await d.RewardEntitlement.create(
          {
            rewardOfferId: offer.id,
            activationId: activation.id,
            prospectId: prospect.id,
            status: onCapture ? 'issued' : 'eligible',
            unlockedAt: onCapture ? new Date() : null,
            unlockedVia: onCapture ? 'auto_on_capture' : null,
            expiresAt: new Date(Date.now() + (onCapture ? redemptionDays : reservationDays) * 24 * 3600 * 1000),
            presentationTokenHash: presentation.hash,
            tokenHash: voucher ? voucher.hash : null,
            tokenHint: voucher ? tokenHintOf(voucher.raw) : null,
            issuedVia: via,
          },
          { transaction: t }
        );
        await writeEvent(t, { entitlementId: created.id, type: 'reserved', metadata: { via, unlockPolicy: activation.unlockPolicy } });
        if (onCapture) {
          await writeEvent(t, { entitlementId: created.id, type: 'unlocked', metadata: { via: 'auto_on_capture' } });
        }
        return created;
      });

      // Raw tokens returned ONCE for delivery (email/link); only hashes persist.
      return {
        entitlement,
        reason: null,
        presentationToken: presentation.raw,
        voucherToken: voucher ? voucher.raw : null,
      };
    } catch (err) {
      if (err?._soft) return { entitlement: null, reason: err.message };
      if (err?.name === 'SequelizeUniqueConstraintError') {
        const existing = await d.RewardEntitlement.findOne({
          where: { prospectId: prospect.id },
          order: [['createdAt', 'DESC']],
        });
        return { entitlement: existing, reason: 'duplicate' };
      }
      throw err;
    }
  }

  /**
   * Consultant unlock at the physical meeting (MKTR_INTEGRATION.md §2).
   * `by` = { presentationToken } (scan — proves presence) or { prospectId } (button).
   * The acting agent must be the lead's assigned consultant (admin override allowed).
   * Idempotent: an already-unlocked entitlement returns { already: true }.
   */
  async function unlockEntitlement(by, agentUser, via = 'agent_scan') {
    let entitlement;
    if (by.presentationToken) {
      entitlement = await d.RewardEntitlement.findOne({
        where: { presentationTokenHash: hashToken(by.presentationToken) },
      });
    } else if (by.prospectId) {
      entitlement = await d.RewardEntitlement.findOne({
        where: { prospectId: by.prospectId, status: { [Op.in]: ['eligible', 'issued'] } },
        order: [['createdAt', 'DESC']],
      });
    }
    if (!entitlement) throw new AppError('Entitlement not found', 404);

    if (['issued', 'redeemed'].includes(entitlement.status)) {
      return { entitlement, already: true, voucherToken: null };
    }
    if (entitlement.status !== 'eligible') {
      throw new AppError(`Entitlement is ${entitlement.status}`, 409);
    }

    // Assigned-consultant binding (admin override audited via unlockedVia='manual')
    const prospect = entitlement.prospectId ? await d.Prospect.findByPk(entitlement.prospectId) : null;
    const isAdmin = agentUser.role === 'admin';
    if (!isAdmin) {
      if (!prospect || prospect.assignedAgentId !== agentUser.id) {
        throw new AppError('Only the assigned consultant can unlock this reward', 403);
      }
    }

    const offer = await d.RewardOffer.findByPk(entitlement.rewardOfferId);
    const redemptionDays = offer?.redemptionExpiryDays || DEFAULT_REDEMPTION_DAYS;
    const voucher = mintToken();

    const result = await d.sequelize.transaction(async (t) => {
      const [count] = await d.RewardEntitlement.update(
        {
          status: 'issued',
          unlockedAt: new Date(),
          unlockedByUserId: agentUser.id,
          unlockedVia: isAdmin && !prospect ? 'manual' : via,
          tokenHash: voucher.hash,
          tokenHint: tokenHintOf(voucher.raw),
          expiresAt: new Date(Date.now() + redemptionDays * 24 * 3600 * 1000),
        },
        {
          where: {
            id: entitlement.id,
            status: 'eligible', // conditional transition — replay-safe
            [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }],
          },
          transaction: t,
        }
      );
      if (count === 0) {
        throw new AppError('Reservation expired or already unlocked', 409);
      }
      await writeEvent(t, {
        entitlementId: entitlement.id, type: 'unlocked',
        actorType: 'agent', actorUserId: agentUser.id, metadata: { via },
      });
      return true;
    });

    await entitlement.reload();
    if (result && typeof d.notifyUnlock === 'function') {
      // Fire-and-forget consumer notification (voucher email w/ QR + link)
      Promise.resolve(d.notifyUnlock({ entitlement, prospect, voucherToken: voucher.raw }))
        .catch((err) => d.logger.error('redeem_ops.unlock.notify_failed', { error: err?.message }));
    }
    return { entitlement, already: false, voucherToken: voucher.raw };
  }

  /** Manual issue by redemption_ops (requires an existing lead). */
  async function issueManual({ activationId, prospectId }, user, requestId = null) {
    const activation = await d.Activation.findByPk(activationId, {
      include: [{ model: d.RewardOffer, as: 'rewardOffer' }],
    });
    if (!activation) throw new AppError('Activation not found', 404);
    const prospect = await d.Prospect.findByPk(prospectId);
    if (!prospect) throw new AppError('Lead not found', 404);

    const result = await issueForProspect(
      { ...prospect.toJSON(), sourceMetadata: { ...(prospect.sourceMetadata || {}), phoneVerifiedAt: prospect.sourceMetadata?.phoneVerifiedAt || new Date().toISOString() } },
      { via: 'manual' }
    );
    if (!result.entitlement) throw new AppError(`Cannot issue: ${result.reason}`, 409);
    await d.audit.recordAuditEvent({
      actorUser: user, action: 'entitlement.issued_manual', entityType: 'reward_entitlement',
      entityId: result.entitlement.id, after: { activationId, prospectId }, requestId,
    });
    return result;
  }

  async function cancelEntitlement(id, user, reason, requestId = null) {
    if (!reason || !String(reason).trim()) throw new AppError('A reason is required', 400);
    const entitlement = await d.RewardEntitlement.findByPk(id);
    if (!entitlement) throw new AppError('Entitlement not found', 404);
    if (!['eligible', 'issued'].includes(entitlement.status)) {
      throw new AppError(`Entitlement is ${entitlement.status}`, 409);
    }
    await d.sequelize.transaction(async (t) => {
      const [count] = await d.RewardEntitlement.update(
        { status: 'cancelled' },
        { where: { id, status: { [Op.in]: ['eligible', 'issued'] } }, transaction: t }
      );
      if (count === 0) throw new AppError('Entitlement changed state — retry', 409);
      await d.inventory.reverseIssued({
        offerId: entitlement.rewardOfferId, activationId: entitlement.activationId,
        entitlementId: id, type: 'cancelled', actorType: 'staff', reason, transaction: t,
      });
      await d.sequelize.query(
        `UPDATE activations SET "issuedCount" = "issuedCount" - 1, "updatedAt" = NOW()
          WHERE id = :id AND "issuedCount" > 0`,
        { replacements: { id: entitlement.activationId }, transaction: t }
      );
      await writeEvent(t, {
        entitlementId: id, type: 'manual_override', actorType: 'staff', actorUserId: user.id,
        metadata: { action: 'cancelled', reason },
      });
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'entitlement.cancelled', entityType: 'reward_entitlement',
        entityId: id, reason, requestId, transaction: t,
      });
    });
    await entitlement.reload();
    return entitlement;
  }

  /** Reservation-expiry sweep — expired reservations return inventory to the pool. */
  async function expireReservations() {
    const stale = await d.RewardEntitlement.findAll({
      where: { status: 'eligible', expiresAt: { [Op.lt]: new Date() } },
      limit: 200,
    });
    let expired = 0;
    for (const ent of stale) {
      try {
        await d.sequelize.transaction(async (t) => {
          const [count] = await d.RewardEntitlement.update(
            { status: 'expired' },
            { where: { id: ent.id, status: 'eligible' }, transaction: t }
          );
          if (count === 0) return;
          await d.inventory.reverseIssued({
            offerId: ent.rewardOfferId, activationId: ent.activationId,
            entitlementId: ent.id, type: 'expired', transaction: t,
          });
          await d.sequelize.query(
            `UPDATE activations SET "issuedCount" = "issuedCount" - 1, "updatedAt" = NOW()
              WHERE id = :id AND "issuedCount" > 0`,
            { replacements: { id: ent.activationId }, transaction: t }
          );
          await writeEvent(t, { entitlementId: ent.id, type: 'expired' });
          expired += 1;
        });
      } catch (err) {
        d.logger.warn('redeem_ops.entitlement.expire_failed', { id: ent.id, error: err?.message });
      }
    }
    if (expired > 0) d.logger.info('redeem_ops.entitlements.expired', { expired });
    return expired;
  }

  /**
   * Reconciliation sweep (at-least-once backstop for the capture hook): recent
   * verified, unquarantined leads on ACTIVE activation campaigns lacking an
   * entitlement get one. The unique anchor dedupes against hook races.
   */
  async function reconcileMissedLeads({ sinceHours = 48 } = {}) {
    const activations = await d.Activation.findAll({
      where: { status: 'active', campaignId: { [Op.ne]: null } },
      attributes: ['id', 'campaignId'],
    });
    let issued = 0;
    for (const activation of activations) {
      const prospects = await d.Prospect.findAll({
        where: {
          campaignId: activation.campaignId,
          quarantinedAt: null,
          createdAt: { [Op.gt]: new Date(Date.now() - sinceHours * 3600 * 1000) },
          id: {
            [Op.notIn]: d.sequelize.literal(
              `(SELECT "prospectId" FROM reward_entitlements WHERE "activationId" = '${activation.id}' AND "prospectId" IS NOT NULL)`
            ),
          },
        },
        limit: 100,
      });
      for (const prospect of prospects) {
        const r = await issueForProspect(prospect, { via: 'sweep' }).catch(() => null);
        if (r?.entitlement && r.reason === null) issued += 1;
      }
    }
    if (issued > 0) d.logger.info('redeem_ops.entitlements.reconciled', { issued });
    return issued;
  }

  /** Ops listing (staff view — lead PII via JOIN at read time, never copied). */
  async function listEntitlements(query = {}) {
    const where = {};
    if (query.activationId) where.activationId = String(query.activationId);
    if (query.status) where.status = String(query.status);
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
    const { rows, count } = await d.RewardEntitlement.findAndCountAll({
      where,
      include: [
        { model: d.Prospect, as: 'prospect', attributes: ['id', 'firstName', 'lastName', 'phone'] },
        { model: d.RewardOffer, as: 'rewardOffer', attributes: ['id', 'title'] },
        { model: d.Activation, as: 'activation', attributes: ['id', 'campaignNameSnapshot'] },
      ],
      order: [['createdAt', 'DESC']],
      limit, offset: (page - 1) * limit,
    });
    // Mask phones by default (redemptions.verify unmasks at the console)
    const masked = rows.map((r) => {
      const j = r.toJSON();
      if (j.prospect?.phone) j.prospect.phone = `••••${String(j.prospect.phone).slice(-4)}`;
      return j;
    });
    return { entitlements: masked, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } };
  }

  return {
    issueForProspect, unlockEntitlement, issueManual, cancelEntitlement,
    expireReservations, reconcileMissedLeads, listEntitlements, verificationStampOf,
  };
}

const _default = makeEntitlementService();
export default _default;
