/**
 * 069 — Discriminators for wallet-backed commitments on the package rails.
 *
 * A wallet commitment is a normal LeadPackageAssignment under a hidden
 * per-campaign "wallet" LeadPackage, so routing/charging/drain-down are
 * untouched (docs/plans/agent-wallet-commitments.md). This migration adds:
 *  - lead_packages.kind          'catalog' | 'wallet' (hidden container)
 *  - one-wallet-package-per-campaign UNIQUE partial index (the race guard
 *    behind walletService.commit's find-or-create + retry)
 *  - lead_package_assignments.source        'package' | 'wallet'
 *  - lead_package_assignments.unitPriceCents per-lead snapshot at commit
 *    time (takedown refunds = leadsRemaining × unitPriceCents)
 * camelCase DDL. Guarded/idempotent.
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    "ALTER TABLE lead_packages ADD COLUMN IF NOT EXISTS \"kind\" VARCHAR(16) NOT NULL DEFAULT 'catalog'"
  );
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_packages_wallet_campaign
       ON lead_packages ("campaignId") WHERE "kind" = 'wallet'`
  );
  await queryInterface.sequelize.query(
    "ALTER TABLE lead_package_assignments ADD COLUMN IF NOT EXISTS \"source\" VARCHAR(16) NOT NULL DEFAULT 'package'"
  );
  await queryInterface.sequelize.query(
    'ALTER TABLE lead_package_assignments ADD COLUMN IF NOT EXISTS "unitPriceCents" INTEGER'
  );
  // Wallet commitments must always be refundable: positive per-lead snapshot.
  await queryInterface.sequelize.query(`
    DO $$ BEGIN
      ALTER TABLE lead_package_assignments
        ADD CONSTRAINT chk_lpa_wallet_unit_price
        CHECK ("source" <> 'wallet' OR ("unitPriceCents" IS NOT NULL AND "unitPriceCents" > 0));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('ALTER TABLE lead_package_assignments DROP CONSTRAINT IF EXISTS chk_lpa_wallet_unit_price');
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS uq_lead_packages_wallet_campaign');
  await queryInterface.sequelize.query('ALTER TABLE lead_packages DROP COLUMN IF EXISTS "kind"');
  await queryInterface.sequelize.query('ALTER TABLE lead_package_assignments DROP COLUMN IF EXISTS "source"');
  await queryInterface.sequelize.query('ALTER TABLE lead_package_assignments DROP COLUMN IF EXISTS "unitPriceCents"');
}
