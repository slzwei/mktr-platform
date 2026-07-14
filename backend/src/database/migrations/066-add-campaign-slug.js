/**
 * 066 — Marketplace campaign slug + first-activation anchor.
 *
 * `slug` is the consumer-facing URL handle for /offers/:slug and /flow/:slug
 * ONLY (QR tags and previews keep their own slug namespaces). Nullable —
 * existing campaigns are not marketplace-addressable until an admin authors
 * one. Partial unique index (also mirrored on the model — sync({force:true})
 * in test boot clobbers migration indexes otherwise, see lucky-draw lesson).
 *
 * `firstActivatedAt` is the durable "ever activated" anchor: campaignService
 * stamps it the first time is_active flips true, and slug becomes immutable
 * from then on. Guarded/idempotent like 052–065.
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS "slug" VARCHAR(80)'
  );
  await queryInterface.sequelize.query(
    'ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS "firstActivatedAt" TIMESTAMP WITH TIME ZONE'
  );
  await queryInterface.sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_campaigns_slug ON campaigns ("slug") WHERE "slug" IS NOT NULL'
  );
  // Backfill: campaigns already live when this migration runs get their
  // activation anchor immediately — otherwise a legacy active campaign could
  // set AND repeatedly change a live marketplace slug (the lock only fires
  // when firstActivatedAt is present). Guarded on NULL → idempotent.
  await queryInterface.sequelize.query(
    `UPDATE campaigns
       SET "firstActivatedAt" = COALESCE("updatedAt", now())
     WHERE "firstActivatedAt" IS NULL AND is_active = true AND status = 'active'`
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS uq_campaigns_slug');
  await queryInterface.sequelize.query('ALTER TABLE campaigns DROP COLUMN IF EXISTS "slug"');
  await queryInterface.sequelize.query('ALTER TABLE campaigns DROP COLUMN IF EXISTS "firstActivatedAt"');
}
