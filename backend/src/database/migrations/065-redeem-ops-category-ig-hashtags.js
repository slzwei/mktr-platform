/**
 * 065 — Instagram hashtags for the Redeem Ops category taxonomy (IG-discovery pilot).
 *
 * The IG analog of 062's providerSearchTerms: admin-curated hashtags the
 * Instagram hashtag provider fires for a category. Nullable with NO backfill —
 * unlike search terms there is no safe name fallback (a category name is not a
 * hashtag), so null means "no IG tags curated yet" and
 * resolveCategoryForInstagram refuses the search (422). Guarded/idempotent like
 * 052–064 and safe under NODE_ENV=test's sync-first empty tables.
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE redeem_ops_categories ADD COLUMN IF NOT EXISTS "igHashtags" text[]'
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE redeem_ops_categories DROP COLUMN IF EXISTS "igHashtags"'
  );
}
