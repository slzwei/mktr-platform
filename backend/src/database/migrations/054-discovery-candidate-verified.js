/**
 * 054 — Discover: Instagram-verified flag on discovery candidates.
 *
 * The IG enrichment actor already returns `verified`; the normalizer surfaced it
 * but nothing stored it. Guarded ADD COLUMN IF NOT EXISTS (045–053 house pattern);
 * safe under NODE_ENV=test sync-first (the model defines the column, so sync
 * creates it and this becomes a no-op).
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE discovery_candidates ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN'
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE discovery_candidates DROP COLUMN IF EXISTS "isVerified"'
  );
}
