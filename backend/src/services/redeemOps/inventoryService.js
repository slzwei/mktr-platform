import { RewardOffer, RewardInventoryEvent, sequelize } from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';

/**
 * Reward inventory (docs/redeem-ops/ERD.md §3.11/§3.14/§4.3, brief §24).
 *
 * Every quantity movement is TWO writes in ONE transaction:
 *   (a) a guarded conditional UPDATE on the reward_offers counters — the
 *       oversubscription gate (0 rows = typed 409; house pattern:
 *       deductExternalLeadBalance), and
 *   (b) an append-only reward_inventory_events ledger row — the audit truth.
 *
 * Invariants enforced by the guards: committed ≥ allocated ≥ issued ≥ redeemed,
 * and no counter ever goes negative. reconcile() asserts ledger ⇄ counters.
 */
export function makeInventoryService(overrides = {}) {
  const d = { RewardOffer, RewardInventoryEvent, sequelize, logger, ...overrides };

  async function writeLedger(t, evt) {
    return d.RewardInventoryEvent.create(
      {
        rewardOfferId: evt.rewardOfferId,
        activationId: evt.activationId || null,
        entitlementId: evt.entitlementId || null,
        redemptionId: evt.redemptionId || null,
        type: evt.type,
        quantity: evt.quantity,
        actorType: evt.actorType || 'staff',
        actorUserId: evt.actorUser?.id || evt.actorUserId || null,
        reason: evt.reason || null,
      },
      { transaction: t }
    );
  }

  /**
   * Run `guardSql` (a conditional UPDATE ... RETURNING) + ledger row atomically.
   * Uses the caller's transaction when given, else owns one.
   */
  async function guardedMove({ offerId, quantity, guardSql, ledger, transaction = null, failMessage }) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new AppError('quantity must be a positive integer', 400);
    }
    const run = async (t) => {
      const [rows] = await d.sequelize.query(guardSql, {
        replacements: { offerId, q: quantity },
        transaction: t,
      });
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new AppError(failMessage, 409);
      }
      await writeLedger(t, { ...ledger, rewardOfferId: offerId, quantity });
      return rows[0];
    };
    if (transaction) return run(transaction);
    return d.sequelize.transaction(run);
  }

  /** Increase total committed supply (partner promised more). */
  function increaseCommitted({ offerId, quantity, actorUser, reason, transaction }) {
    return guardedMove({
      offerId, quantity, transaction,
      guardSql: `UPDATE reward_offers
                    SET "committedQuantity" = "committedQuantity" + :q, "updatedAt" = NOW()
                  WHERE id = :offerId
                  RETURNING id, "committedQuantity"`,
      ledger: { type: 'increased', actorUser, reason },
      failMessage: 'Reward offer not found',
    });
  }

  /** Decrease committed supply — never below what is already allocated. */
  function decreaseCommitted({ offerId, quantity, actorUser, reason, transaction }) {
    return guardedMove({
      offerId, quantity, transaction,
      guardSql: `UPDATE reward_offers
                    SET "committedQuantity" = "committedQuantity" - :q, "updatedAt" = NOW()
                  WHERE id = :offerId
                    AND "committedQuantity" - :q >= "allocatedQuantity"
                  RETURNING id, "committedQuantity"`,
      ledger: { type: 'decreased', actorUser, reason },
      failMessage: 'Cannot reduce committed supply below what is already allocated',
    });
  }

  /** Allocate supply to an Activation — the oversubscription gate. */
  function allocate({ offerId, activationId, quantity, actorUser, reason, transaction }) {
    return guardedMove({
      offerId, quantity, transaction,
      guardSql: `UPDATE reward_offers
                    SET "allocatedQuantity" = "allocatedQuantity" + :q, "updatedAt" = NOW()
                  WHERE id = :offerId
                    AND "committedQuantity" - "allocatedQuantity" >= :q
                  RETURNING id, "allocatedQuantity"`,
      ledger: { type: 'allocated', activationId, actorUser, reason },
      failMessage: 'Not enough committed supply remaining to allocate',
    });
  }

  /** Return allocation to the pool — never below what is already issued. */
  function deallocate({ offerId, activationId, quantity, actorUser, reason, transaction }) {
    return guardedMove({
      offerId, quantity, transaction,
      guardSql: `UPDATE reward_offers
                    SET "allocatedQuantity" = "allocatedQuantity" - :q, "updatedAt" = NOW()
                  WHERE id = :offerId
                    AND "allocatedQuantity" - :q >= "issuedQuantity"
                  RETURNING id, "allocatedQuantity"`,
      ledger: { type: 'deallocated', activationId, actorUser, reason },
      failMessage: 'Cannot deallocate below what has already been issued',
    });
  }

  /** Phase 6: entitlement issued (reservation) consumes allocated supply. */
  function recordIssued({ offerId, activationId, entitlementId, actorType = 'system', transaction }) {
    return guardedMove({
      offerId, quantity: 1, transaction,
      // status = 'active' (PR C): a paused/ended offer must not issue even in
      // the race window after the service's pre-check passed (TOCTOU).
      guardSql: `UPDATE reward_offers
                    SET "issuedQuantity" = "issuedQuantity" + 1, "updatedAt" = NOW()
                  WHERE id = :offerId
                    AND status = 'active'
                    AND "allocatedQuantity" - "issuedQuantity" >= 1
                  RETURNING id, "issuedQuantity"`,
      ledger: { type: 'issued', activationId, entitlementId, actorType },
      failMessage: 'Reward offer is not active or its allocation is exhausted',
    });
  }

  /** Phase 6: expired/cancelled reservation returns a unit to the pool. */
  function reverseIssued({ offerId, activationId, entitlementId, type = 'expired', actorType = 'system', reason, transaction }) {
    return guardedMove({
      offerId, quantity: 1, transaction,
      guardSql: `UPDATE reward_offers
                    SET "issuedQuantity" = "issuedQuantity" - 1, "updatedAt" = NOW()
                  WHERE id = :offerId
                    AND "issuedQuantity" - 1 >= "redeemedQuantity"
                  RETURNING id, "issuedQuantity"`,
      ledger: { type, activationId, entitlementId, actorType, reason },
      failMessage: 'Cannot reverse an issuance that was already redeemed',
    });
  }

  /** Phase 6: completed redemption. */
  function recordRedeemed({ offerId, activationId, entitlementId, redemptionId, actorType = 'staff', actorUser, transaction }) {
    return guardedMove({
      offerId, quantity: 1, transaction,
      guardSql: `UPDATE reward_offers
                    SET "redeemedQuantity" = "redeemedQuantity" + 1, "updatedAt" = NOW()
                  WHERE id = :offerId
                    AND "issuedQuantity" - "redeemedQuantity" >= 1
                  RETURNING id, "redeemedQuantity"`,
      ledger: { type: 'redeemed', activationId, entitlementId, redemptionId, actorType, actorUser },
      failMessage: 'No issued units available to redeem',
    });
  }

  /** Ledger ⇄ counter reconciliation (test-time assertion; future cron). */
  async function reconcile(offerId) {
    const offer = await d.RewardOffer.findByPk(offerId);
    if (!offer) throw new AppError('Reward offer not found', 404);
    const events = await d.RewardInventoryEvent.findAll({ where: { rewardOfferId: offerId } });
    const sum = (types) => events.filter((e) => types.includes(e.type)).reduce((n, e) => n + e.quantity, 0);
    const derived = {
      committedQuantity: sum(['committed', 'increased']) - sum(['decreased']),
      allocatedQuantity: sum(['allocated']) - sum(['deallocated']),
      issuedQuantity: sum(['issued']) - sum(['expired', 'cancelled', 'issue_reversed']),
      redeemedQuantity: sum(['redeemed']),
    };
    const actual = {
      committedQuantity: offer.committedQuantity,
      allocatedQuantity: offer.allocatedQuantity,
      issuedQuantity: offer.issuedQuantity,
      redeemedQuantity: offer.redeemedQuantity,
    };
    const consistent = Object.keys(derived).every((k) => derived[k] === actual[k]);
    return { consistent, derived, actual };
  }

  return {
    increaseCommitted, decreaseCommitted, allocate, deallocate,
    recordIssued, reverseIssued, recordRedeemed, reconcile, writeLedger,
  };
}

const _default = makeInventoryService();
export default _default;
