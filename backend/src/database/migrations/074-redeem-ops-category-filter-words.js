/**
 * 074 — Google Maps category-filter words for the Redeem Ops category taxonomy.
 *
 * The quality analog of 062's providerSearchTerms: admin-curated Google Maps
 * *category* names the Maps actor keeps (its native `categoryFilterWords` input).
 * Search terms decide WHAT Google is asked; these decide WHICH categories of the
 * answer are kept — dropping the off-vertical padding Google pads a niche query
 * with (a Korean restaurant surfacing on a "kids robotics" search, live 2026-07-16).
 *
 * Nullable with NO backfill and NO name fallback (unlike search terms): a CRM
 * category name is rarely a real Google category, and auto-applying one would
 * silently filter every existing category run and drop real partners. NULL/empty
 * means "no category filter" — the actor input stays byte-identical to before,
 * exactly like the opt-in minStars/skipClosed inputs. Guarded/idempotent like
 * 052–073 and safe under NODE_ENV=test's sync-first empty tables.
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE redeem_ops_categories ADD COLUMN IF NOT EXISTS "categoryFilterWords" text[]'
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE redeem_ops_categories DROP COLUMN IF EXISTS "categoryFilterWords"'
  );
}
