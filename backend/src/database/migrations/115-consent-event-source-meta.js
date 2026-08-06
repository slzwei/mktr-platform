/**
 * 115 — consent_events.source admits 'meta_lead_ad'
 * (docs/plans/meta-lead-ads-native-pipe.md §5).
 *
 * 080's chk_ce_source CHECK enforces the source list at the DATABASE level —
 * extending only the model validate left Meta consent writes silently
 * swallowed by the capture savepoint (proven by the integration suite).
 * Non-web channels must record under their true source, never lie as
 * 'signup'.
 */
export async function up(queryInterface) {
  // One transaction: an interruption between DROP and ADD must never leave
  // consent_events with no source constraint at all.
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.sequelize.query(
      'ALTER TABLE consent_events DROP CONSTRAINT IF EXISTS chk_ce_source',
      { transaction }
    );
    await queryInterface.sequelize.query(`
      ALTER TABLE consent_events ADD CONSTRAINT chk_ce_source
      CHECK (source IN ('signup','backfill','unsubscribe','admin','erasure','resubscribe','meta_lead_ad'))
    `, { transaction });
  });
}

export async function down() {
  // Deliberate no-op. consent_events is APPEND-ONLY legal evidence: deleting
  // 'meta_lead_ad' rows (or re-adding the narrow CHECK against them) would
  // destroy or violate recorded consent acts. The widened constraint is fully
  // compatible with pre-114 code, so a rollback simply keeps it.
}
