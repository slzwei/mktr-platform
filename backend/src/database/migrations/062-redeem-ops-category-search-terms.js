/**
 * 062 — Provider-specific search terms for the Redeem Ops category taxonomy.
 *
 * The category name remains the stable CRM classification while Discover can
 * use a category's aliases as Google Maps search strings. Guarded/idempotent
 * like 052–056 and safe under NODE_ENV=test's sync-first empty tables.
 */
export async function up(queryInterface) {
  const q = async (sql) => queryInterface.sequelize.query(sql);
  await q('ALTER TABLE redeem_ops_categories ADD COLUMN IF NOT EXISTS "providerSearchTerms" text[]');
  await q(`UPDATE redeem_ops_categories
              SET "providerSearchTerms" = ARRAY[name]
            WHERE "providerSearchTerms" IS NULL`);
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE redeem_ops_categories DROP COLUMN IF EXISTS "providerSearchTerms"'
  );
}
