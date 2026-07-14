/**
 * 066 — Draft visibility for cadences. `publishedAt` NULL = draft: listed and
 * enrollable only by its creator and admins (settings.manage); publishing
 * shares it team-wide. Every pre-existing row was team-wide by construction
 * (authoring used to be settings.manage-only), so they backfill as published
 * at their creation time. Guarded/idempotent like 052–065 and safe under
 * NODE_ENV=test's sync-first empty tables.
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE outreach_cadences ADD COLUMN IF NOT EXISTS "publishedAt" timestamptz'
  );
  await queryInterface.sequelize.query(
    'UPDATE outreach_cadences SET "publishedAt" = "createdAt" WHERE "publishedAt" IS NULL'
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE outreach_cadences DROP COLUMN IF EXISTS "publishedAt"'
  );
}
