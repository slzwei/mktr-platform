/**
 * 068 — Per-campaign lead price for agent-wallet commitments.
 *
 * `leadPriceCents` INTEGER NULL: the admin-set price external (mktr-leads)
 * agents pay per lead when committing wallet credits to this campaign.
 * NULL = campaign is not commit-able (hidden from the wallet catalog).
 * Deliberately independent of `externalEligible` (the inert ExternalAgent
 * buyer-pool flag) — see docs/plans/agent-wallet-commitments.md.
 * camelCase DDL (sequelize underscored:false). Guarded/idempotent.
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS "leadPriceCents" INTEGER'
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('ALTER TABLE campaigns DROP COLUMN IF EXISTS "leadPriceCents"');
}
