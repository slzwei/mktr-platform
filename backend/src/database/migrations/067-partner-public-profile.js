/**
 * 067 — Consumer-facing partner profile fields for the marketplace.
 *
 * The existing PartnerOrganisation fields are CRM-internal (notes, pipeline)
 * and must never surface publicly, so the marketplace gets three dedicated
 * columns: publicBlurb (consumer copy), verifiedAt (verification stamp —
 * null = unverified; admin-set only), partnerSince (display year).
 * camelCase DDL (sequelize underscored:false). Guarded/idempotent.
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE partner_organisations ADD COLUMN IF NOT EXISTS "publicBlurb" TEXT'
  );
  await queryInterface.sequelize.query(
    'ALTER TABLE partner_organisations ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP WITH TIME ZONE'
  );
  await queryInterface.sequelize.query(
    'ALTER TABLE partner_organisations ADD COLUMN IF NOT EXISTS "partnerSince" SMALLINT'
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('ALTER TABLE partner_organisations DROP COLUMN IF EXISTS "publicBlurb"');
  await queryInterface.sequelize.query('ALTER TABLE partner_organisations DROP COLUMN IF EXISTS "verifiedAt"');
  await queryInterface.sequelize.query('ALTER TABLE partner_organisations DROP COLUMN IF EXISTS "partnerSince"');
}
