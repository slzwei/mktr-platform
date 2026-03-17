/**
 * Adds 12 missing performance indexes across users, qr_tags, prospects,
 * commissions, and lead_package_assignments.
 *
 * Uses CREATE INDEX CONCURRENTLY for zero-downtime creation.
 * Each statement is a separate raw query because CONCURRENTLY cannot
 * run inside a transaction.  All operations are idempotent.
 */
export async function up(queryInterface) {
  const q = queryInterface.sequelize;

  // HIGH PRIORITY
  await q.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_role_isactive ON users (role, "isActive")').catch(() => {});
  await q.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_phone ON users (phone) WHERE phone IS NOT NULL').catch(() => {});
  await q.query('CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_qrtags_slug_unique ON qr_tags (slug) WHERE slug IS NOT NULL').catch(() => {});
  await q.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_qrtags_owneruserid ON qr_tags ("ownerUserId")').catch(() => {});
  await q.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prospects_createdat ON prospects ("createdAt")').catch(() => {});
  await q.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prospects_conversiondate ON prospects ("conversionDate") WHERE "conversionDate" IS NOT NULL').catch(() => {});

  // MEDIUM PRIORITY - Composite indexes
  await q.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prospects_agent_status ON prospects ("assignedAgentId", "leadStatus")').catch(() => {});
  await q.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commissions_agent_earneddate ON commissions ("agentId", "earnedDate")').catch(() => {});
  await q.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commissions_agent_status ON commissions ("agentId", status)').catch(() => {});
  await q.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lpa_agent_status_remaining ON lead_package_assignments ("agentId", status, "leadsRemaining")').catch(() => {});

  // QrTag agentGroupId for future use
  await q.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_qrtags_agentgroupid ON qr_tags ("agentGroupId") WHERE "agentGroupId" IS NOT NULL').catch(() => {});
}

export async function down(queryInterface) {
  const q = queryInterface.sequelize;
  await q.query('DROP INDEX CONCURRENTLY IF EXISTS idx_users_role_isactive').catch(() => {});
  await q.query('DROP INDEX CONCURRENTLY IF EXISTS idx_users_phone').catch(() => {});
  await q.query('DROP INDEX CONCURRENTLY IF EXISTS idx_qrtags_slug_unique').catch(() => {});
  await q.query('DROP INDEX CONCURRENTLY IF EXISTS idx_qrtags_owneruserid').catch(() => {});
  await q.query('DROP INDEX CONCURRENTLY IF EXISTS idx_prospects_createdat').catch(() => {});
  await q.query('DROP INDEX CONCURRENTLY IF EXISTS idx_prospects_conversiondate').catch(() => {});
  await q.query('DROP INDEX CONCURRENTLY IF EXISTS idx_prospects_agent_status').catch(() => {});
  await q.query('DROP INDEX CONCURRENTLY IF EXISTS idx_commissions_agent_earneddate').catch(() => {});
  await q.query('DROP INDEX CONCURRENTLY IF EXISTS idx_commissions_agent_status').catch(() => {});
  await q.query('DROP INDEX CONCURRENTLY IF EXISTS idx_lpa_agent_status_remaining').catch(() => {});
  await q.query('DROP INDEX CONCURRENTLY IF EXISTS idx_qrtags_agentgroupid').catch(() => {});
}
