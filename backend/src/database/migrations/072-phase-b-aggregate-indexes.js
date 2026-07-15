/**
 * 072 — Composite indexes behind the Phase B admin aggregates.
 *
 * The campaign/agent list endpoints run correlated per-row counts on
 * (campaignId, createdAt) and (assignedAgentId, createdAt), and the
 * attention rail scans open wallet commitments — none of which the existing
 * single-column indexes serve well at 200-row admin pages. All additive.
 * camelCase DDL. Guarded/idempotent.
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_prospects_campaign_created ON prospects ("campaignId", "createdAt")'
  );
  await queryInterface.sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_prospects_agent_created ON prospects ("assignedAgentId", "createdAt")'
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_lpa_open_wallet
       ON lead_package_assignments ("leadPackageId", "agentId")
       WHERE "source" = 'wallet' AND "status" = 'active' AND "leadsRemaining" > 0`
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_prospects_campaign_created');
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_prospects_agent_created');
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_lpa_open_wallet');
}
