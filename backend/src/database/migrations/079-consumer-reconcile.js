/**
 * 079 — Consumer-spine backfill/reconcile (plan §2.4).
 *
 * Runs the SAME reconciler as scripts/rebuild-consumer-spine.js (shared module
 * — migration/script parity by construction): JS-normalizes phones with the
 * capture path's normalizePhone, ASSIGNS complete projections (never
 * increments), heals wrong links, unlinks call_bot rows, links entitlements
 * via prospect then phoneKey. Idempotent — re-running yields identical state,
 * and the runner's advisory lock serializes concurrent boots.
 *
 * ~135 prospects / 130 phones at ship time (2026-07-19 preflight).
 */
export async function up() {
  const { reconcileConsumerSpine } = await import('../../services/consumerService.js');
  const { logger } = await import('../../utils/logger.js');
  const stats = await reconcileConsumerSpine();
  logger.info('[079] consumer spine reconciled', stats);
}

export async function down(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);
  await q('UPDATE reward_entitlements SET "consumerId" = NULL WHERE "consumerId" IS NOT NULL');
  await q('UPDATE prospects SET "consumerId" = NULL WHERE "consumerId" IS NOT NULL');
  await q('DELETE FROM consumers');
}
