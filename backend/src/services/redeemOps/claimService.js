import { PartnerOrganisation, PartnerAssignmentEvent, PartnerStageEvent, User, sequelize } from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { makeRedeemOpsAuditService } from './auditService.js';
import { fireCadenceHook } from './cadenceHooks.js';

// Multi-select cap. Each row is its own transaction, so a huge batch would hold
// a request open for a long time; the console's page size is well under this.
const BULK_CLAIM_MAX = 100;

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
    const ids = [...new Set((partnerIds || []).map(String))];
    if (!ids.length) throw new AppError('Select at least one business to claim', 400);
    if (ids.length > BULK_CLAIM_MAX) {
      throw new AppError(`Claim up to ${BULK_CLAIM_MAX} businesses at a time`, 400);
    }

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

  /** Manager assign/reassign to any active staff member (capability-gated at the route). */
  async function assignPartner(partnerId, toUserId, actor, reason = null, requestId = null) {
    const target = await d.User.findByPk(toUserId);
    if (!target || !target.isActive || !(target.role === 'redeem_ops' || target.role === 'admin' || target.redeemOpsRole)) {
      throw new AppError('Assignee must be an active Redeem Ops staff member', 400);
    }
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

  return { claimPartner, claimPartnerTx, claimPartnersBulk, releasePartner, assignPartner };
}

const _default = makeClaimService();
export const claimPartner = _default.claimPartner;
export const claimPartnersBulk = _default.claimPartnersBulk;
export const releasePartner = _default.releasePartner;
export const assignPartner = _default.assignPartner;
