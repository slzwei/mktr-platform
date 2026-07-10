import { PartnerOrganisation, PartnerAssignmentEvent, PartnerStageEvent, User, sequelize } from '../../models/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { makeRedeemOpsAuditService } from './auditService.js';

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
    audit: makeRedeemOpsAuditService(), ...overrides,
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
      return partner;
    });
  }

  return { claimPartner, claimPartnerTx, releasePartner, assignPartner };
}

const _default = makeClaimService();
export const claimPartner = _default.claimPartner;
export const releasePartner = _default.releasePartner;
export const assignPartner = _default.assignPartner;
