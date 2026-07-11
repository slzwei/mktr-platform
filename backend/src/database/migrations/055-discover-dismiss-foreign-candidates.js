/**
 * 055 — Discover: retro-dismiss non-Singapore candidates.
 *
 * Before the locationQuery geo fix, "Beauty Tampines" as a raw search string let
 * the Maps crawler pad results with global brand matches (Sephora New York /
 * Oshawa / Edmonton — live search, 2026-07-12). Materialization now drops
 * foreign-labelled items (isSingaporeMapsItem); this one-time pass hides the
 * already-stored junk the same way a user dismissal would. Unknown country is
 * left alone (absence ≠ foreign). Idempotent plain UPDATE; safe under
 * NODE_ENV=test sync-first (table exists, usually empty).
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    UPDATE discovery_candidates
       SET status = 'dismissed'
     WHERE status = 'pending'
       AND UPPER(COALESCE("rawPayload"->>'countryCode', 'SG')) <> 'SG'
  `);
}

export async function down() {
  // Irreversible by design — dismissed-by-migration rows are indistinguishable
  // from user-dismissed ones, and restoring foreign junk has no value.
}
