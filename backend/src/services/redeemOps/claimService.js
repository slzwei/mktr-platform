import { PartnerOrganisation, PartnerAssignmentEvent, PartnerStageEvent, User, sequelize } from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { fireCadenceHook } from './cadenceHooks.js';
import { normaliseBulkIds } from './bulkIds.js';

/**
 * Business claiming / ownership (docs/redeem-ops/ERD.md §4.1, brief §15).
 *
 * The claim is ONE conditional UPDATE (house pattern: deductExternalLeadBalance) —
 * two simultaneous claimers can never both win, regardless of instance count.
 * 0 rows updated → typed 409 telling the loser who has it. History rows
 * (assignment + stage events) and the audit entry commit atomically with the claim.
 */
export function makeClaimService(overrides = {}) {
  const d = {
    PartnerOrganisation, PartnerAssignmentEvent, PartnerStageEvent, User, sequelize, logger,
    audit: makeRedeemOpsAuditService(), fireCadenceHook, ...overrides,
  };

  async function conflictPayload(partnerId) {
    const row = await d.PartnerOrganisation.findByPk(partnerId, {
      attributes: ['id', 'availability', 'pipelineStage', 'ownerUserId', 'archivedAt', 'mergedIntoId'],
      include: [{ model: d.User, as: 'owner', attributes: ['id', 'fullName'] }],
    });
    return row ? {
      availability: row.availability,
      pipelineStage: row.pipelineStage,
      claimedBy: row.owner ? { id: row.owner.id, fullName: row.owner.fullName } : null,
      archived: !!row.archivedAt,
      merged: !!row.mergedIntoId,
    } : null;
  }

  /**
   * The atomic claim WITHIN a caller-owned transaction. Returns the updated row
   * or null when the conditional UPDATE matched nothing (already owned /
   * restricted / archived / merged). Shared by the direct claim endpoint and
   * the Phase 3 pool claim-next loop.
   */
  async function claimPartnerTx(partnerId, user, t, via = 'claim') {
    const [rows] = await d.sequelize.query(
      `UPDATE partner_organisations
          SET "ownerUserId" = :userId,
              "claimedAt" = NOW(),
              availability = 'owned',
              "updatedAt" = NOW()
        WHERE id = :partnerId
          AND "ownerUserId" IS NULL
          AND availability = 'available'
          AND "archivedAt" IS NULL
          AND "mergedIntoId" IS NULL
        RETURNING id, "pipelineStage"`,
      { replacements: { partnerId, userId: user.id }, transaction: t }
    );
    if (!Array.isArray(rows) || rows.length === 0) return null;

    await d.PartnerAssignmentEvent.create(
      { partnerOrganisationId: partnerId, kind: 'claim', toUserId: user.id, actorUserId: user.id, reason: via === 'claim' ? null : via },
      { transaction: t }
    );
    // Ownership is not pipeline progress (5-stage model): claiming records an
    // assignment event + audit only; the stage stays where the deal is.
    await d.audit.recordAuditEvent({
      actorUser: user, action: 'partner.claimed', entityType: 'partner_organisation',
      entityId: partnerId, reason: via === 'claim' ? null : via, transaction: t,
    });
    return rows[0];
  }

  /** Atomic claim: available + unowned + live → owned by `user`. 409 with state on loss. */
  async function claimPartner(partnerId, user, requestId = null) {
    return d.sequelize.transaction(async (t) => {
      const claimed = await claimPartnerTx(partnerId, user, t);
      if (!claimed) {
        const state = await conflictPayload(partnerId);
        if (!state) throw new AppError('Partner not found', 404);
        const err = new AppError(
          state.claimedBy
            ? 'This business has just been claimed by another team member.'
            : 'This business is not available to claim.',
          409
        );
        err.data = state;
        throw err;
      }
      return claimed;
    });
  }

  /**
   * Claim many at once (the Partners list's multi-select).
   *
   * Each row gets its OWN transaction, deliberately. Bulk claiming is
   * partially-successful by nature — someone else may have taken one of them a
   * second ago — and a single shared transaction would roll back nine good
   * claims because of one lost race. The per-row conditional UPDATE is still
   * the same atomic gate, so nothing here can double-claim.
   *
   * Reports per row rather than throwing, so the console can say "claimed 7,
   * 3 already taken" and name who took them. An unexpected error on one row is
   * caught and reported as a failure, never allowed to abandon the rest.
   */
  async function claimPartnersBulk(partnerIds, user, requestId = null) {
    const ids = normaliseBulkIds(partnerIds, 'claim');

    const claimed = [];
    const failed = [];
    for (const partnerId of ids) {
      try {
        const row = await d.sequelize.transaction((t) => claimPartnerTx(partnerId, user, t, 'bulk_claim'));
        if (row) {
          claimed.push(partnerId);
          continue;
        }
        const state = await conflictPayload(partnerId);
        failed.push({
          id: partnerId,
          reason: !state ? 'not_found'
            : state.claimedBy ? 'already_claimed'
              : state.archived ? 'archived'
                : state.merged ? 'merged' : 'unavailable',
          claimedBy: state?.claimedBy || null,
        });
      } catch (err) {
        d.logger.warn('redeem_ops.partner.bulk_claim_row_failed', { partnerId, error: err?.message });
        failed.push({ id: partnerId, reason: 'error', claimedBy: null });
      }
    }
    d.logger.info('redeem_ops.partner.bulk_claimed', {
      requestId, actorUserId: user.id, requested: ids.length, claimed: claimed.length,
    });
    return { claimed, failed };
  }

  /** Owner releases their claim back to the pool (row-level own check here). */
  async function releasePartner(partnerId, user, reason = null, requestId = null) {
    return d.sequelize.transaction(async (t) => {
      const [rows] = await d.sequelize.query(
        `UPDATE partner_organisations
            SET "ownerUserId" = NULL,
                availability = 'available',
                "atRiskFlag" = FALSE,
                "updatedAt" = NOW()
          WHERE id = :partnerId
            AND "ownerUserId" = :userId
            AND "archivedAt" IS NULL
            AND "mergedIntoId" IS NULL
          RETURNING id`,
        { replacements: { partnerId, userId: user.id }, transaction: t }
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new AppError('You can only release a business you currently own.', 403);
      }
      await d.PartnerAssignmentEvent.create(
        { partnerOrganisationId: partnerId, kind: 'release', fromUserId: user.id, actorUserId: user.id, reason },
        { transaction: t }
      );
      await d.audit.recordAuditEvent({
        actorUser: user, action: 'partner.released', entityType: 'partner_organisation',
        entityId: partnerId, reason, requestId, transaction: t,
      });
      await d.fireCadenceHook('onRelease', { partnerId, user, transaction: t });
      return rows[0];
    });
  }

  /**
   * Release many at once. Same per-row-transaction reasoning as the bulk claim:
   * a rep handing back an estate will have rows that moved on since the page
   * loaded, and one 403 must not undo the releases that were legitimate.
   *
   * The row-level gate is unchanged (`ownerUserId = :userId`), so this can only
   * ever release the caller's OWN rows — a manager clearing someone else's book
   * still has to reassign, exactly as on the detail page.
   */
  async function releasePartnersBulk(partnerIds, user, reason = null, requestId = null) {
    const ids = normaliseBulkIds(partnerIds, 'release');
    const released = [];
    const failed = [];
    for (const partnerId of ids) {
      try {
        await releasePartner(partnerId, user, reason, requestId);
        released.push(partnerId);
      } catch (err) {
        if (err?.statusCode === 403) {
          // releasePartner cannot tell "gone" from "not yours" — its UPDATE
          // matches neither — so read the state to report the real reason.
          const state = await conflictPayload(partnerId);
          failed.push({
            id: partnerId,
            reason: !state ? 'not_found'
              : state.claimedBy ? 'owned_by_other'
                : state.archived ? 'archived'
                  : state.merged ? 'merged' : 'not_owned',
            claimedBy: state?.claimedBy || null,
          });
        } else {
          d.logger.warn('redeem_ops.partner.bulk_release_row_failed', { partnerId, error: err?.message });
          failed.push({ id: partnerId, reason: 'error', claimedBy: null });
        }
      }
    }
    d.logger.info('redeem_ops.partner.bulk_released', {
      requestId, actorUserId: user.id, requested: ids.length, released: released.length,
    });
    return { released, failed };
  }

  /**
   * The assignee rule, shared by the single-row assign and the bulk one so a
   * batch can reject a bad target ONCE, before any row is written, instead of
   * failing every row with the same message.
   */
  async function assertAssignableUser(toUserId) {
    const target = await d.User.findByPk(toUserId);
    if (!target || !target.isActive || !(target.role === 'redeem_ops' || target.role === 'admin' || target.redeemOpsRole)) {
      throw new AppError('Assignee must be an active Redeem Ops staff member', 400);
    }
    return target;
  }

  /** Manager assign/reassign to any active staff member (capability-gated at the route). */
  async function assignPartner(partnerId, toUserId, actor, reason = null, requestId = null) {
    await assertAssignableUser(toUserId);
    return d.sequelize.transaction(async (t) => {
      const partner = await d.PartnerOrganisation.findByPk(partnerId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!partner || partner.archivedAt || partner.mergedIntoId) {
        throw new AppError('Partner not found', 404);
      }
      const fromUserId = partner.ownerUserId;
      await partner.update(
        {
          ownerUserId: toUserId,
          availability: 'owned',
          claimedAt: partner.claimedAt || new Date(),
          atRiskFlag: false,
        },
        { transaction: t }
      );
      await d.PartnerAssignmentEvent.create(
        {
          partnerOrganisationId: partnerId,
          kind: fromUserId ? 'reassign' : 'assign',
          fromUserId, toUserId, actorUserId: actor.id, reason,
        },
        { transaction: t }
      );
      await d.audit.recordAuditEvent({
        actorUser: actor, action: 'partner.reassigned', entityType: 'partner_organisation',
        entityId: partnerId, before: { ownerUserId: fromUserId }, after: { ownerUserId: toUserId },
        reason, requestId, transaction: t,
      });
      await d.fireCadenceHook('onReassign', { partner, fromUserId, toUserId, actor, transaction: t });
      return partner;
    });
  }

  /**
   * Hand many businesses to one person — the manager's move when a rep leaves
   * or a territory changes hands. The assignee is validated once up front (a
   * bad target is the manager's mistake, not the rows'), then each row is its
   * own transaction like every other bulk action.
   */
  async function assignPartnersBulk(partnerIds, toUserId, actor, reason = null, requestId = null) {
    const ids = normaliseBulkIds(partnerIds, 'assign');
    await assertAssignableUser(toUserId);
    const assigned = [];
    const failed = [];
    for (const partnerId of ids) {
      try {
        await assignPartner(partnerId, toUserId, actor, reason, requestId);
        assigned.push(partnerId);
      } catch (err) {
        const notFound = err?.statusCode === 404;
        if (!notFound) {
          d.logger.warn('redeem_ops.partner.bulk_assign_row_failed', { partnerId, error: err?.message });
        }
        failed.push({ id: partnerId, reason: notFound ? 'not_found' : 'error', claimedBy: null });
      }
    }
    d.logger.info('redeem_ops.partner.bulk_assigned', {
      requestId, actorUserId: actor.id, toUserId, requested: ids.length, assigned: assigned.length,
    });
    return { assigned, failed };
  }

  return {
    claimPartner, claimPartnerTx, claimPartnersBulk,
    releasePartner, releasePartnersBulk,
    assignPartner, assignPartnersBulk, assertAssignableUser,
  };
}

const _default = makeClaimService();
export const claimPartner = _default.claimPartner;
export const claimPartnersBulk = _default.claimPartnersBulk;
export const releasePartner = _default.releasePartner;
export const releasePartnersBulk = _default.releasePartnersBulk;
export const assignPartner = _default.assignPartner;
export const assignPartnersBulk = _default.assignPartnersBulk;
