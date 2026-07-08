import { RedeemOpsAuditEvent } from '../../models/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Append-only audit writer for the Redeem Ops module (docs/redeem-ops/PERMISSION_MATRIX.md §4).
 * DI factory (house pattern) so services/tests can inject fakes.
 */
export function makeRedeemOpsAuditService(overrides = {}) {
  const d = { RedeemOpsAuditEvent, logger, ...overrides };

  /**
   * Record one audit event.
   *
   * Pass `transaction` when the audit row must be atomic with the mutation it
   * describes (role grants, merges, overrides) — a failure then rolls back the
   * whole mutation. Without a transaction the write is best-effort: it logs and
   * returns null rather than failing the caller.
   *
   * @param {object} evt
   * @param {object|null} [evt.actorUser]  req.user (id read off it)
   * @param {string} [evt.actorType]       staff|agent|partner_user|consumer|system
   * @param {string} evt.action            dot-namespaced, e.g. access.role_granted
   * @param {string} evt.entityType
   * @param {string|null} [evt.entityId]
   * @param {object|null} [evt.before]
   * @param {object|null} [evt.after]
   * @param {string|null} [evt.reason]
   * @param {string|null} [evt.requestId]
   * @param {import('sequelize').Transaction|null} [evt.transaction]
   */
  async function recordAuditEvent({
    actorUser = null,
    actorType = 'staff',
    action,
    entityType,
    entityId = null,
    before = null,
    after = null,
    reason = null,
    requestId = null,
    transaction = null,
  }) {
    try {
      return await d.RedeemOpsAuditEvent.create(
        {
          actorUserId: actorUser?.id || null,
          actorType,
          action,
          entityType,
          entityId,
          before,
          after,
          reason,
          requestId,
        },
        { transaction }
      );
    } catch (err) {
      if (transaction) throw err; // atomic with a mutation — surface so it rolls back
      d.logger.error('redeem_ops.audit.write_failed', {
        action,
        entityType,
        entityId,
        error: err?.message || String(err),
      });
      return null;
    }
  }

  return { recordAuditEvent };
}

const _default = makeRedeemOpsAuditService();
export const recordAuditEvent = _default.recordAuditEvent;
