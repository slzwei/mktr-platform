/**
 * 081 — Consent-ledger backfill (PR B, plan §3.1).
 *
 * Re-derives person-level consent events from what capture already stored on
 * prospects: the consent_contact/consent_terms booleans (ONLY where the key
 * exists — absent ≠ false; Retell/Meta never send them) and the
 * consentMetadata evidence blocks (with their real embedded timestamps).
 * `version: 'legacy-backfill'` marks boolean-derived rows.
 *
 * Idempotent: the uq_ce_backfill partial unique + ON CONFLICT DO NOTHING make
 * reruns no-ops. Shares backfillConsentEvents() with any future healing run
 * (heal order: spine reconciler first, then this).
 */
export async function up() {
  const { backfillConsentEvents } = await import('../../services/consentService.js');
  const { logger } = await import('../../utils/logger.js');
  const stats = await backfillConsentEvents();
  logger.info('[081] consent ledger backfilled', stats);
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(
    `DELETE FROM consent_events WHERE source = 'backfill'`
  );
}
