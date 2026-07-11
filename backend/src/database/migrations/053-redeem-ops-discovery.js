/**
 * Redeem Ops — Discover tool: async business-prospecting via Apify
 * (spec: ~/.claude/plans/redeem-ops-discover-tool.md).
 *
 * discovery_runs = one Apify search job (start → terminal webhook → materialize).
 * discovery_candidates = businesses found by a run, deduped against partners and
 * one-click-addable to the pipeline. Guarded + always-run IF NOT EXISTS indexes
 * (045–052 pattern); safe under NODE_ENV=test sync-first.
 */
export async function up(queryInterface, Sequelize) {
  const q = async (sql) => queryInterface.sequelize.query(sql);
  const tables = await queryInterface.showAllTables();
  const UUID = Sequelize.UUID;
  const ts = () => ({
    createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
  });

  if (!tables.includes('discovery_runs')) {
    await queryInterface.createTable('discovery_runs', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      createdBy: { type: UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      provider: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'apify_google_maps' },
      category: { type: Sequelize.STRING(64) },
      area: { type: Sequelize.STRING(120) },
      requestedLimit: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 60 },
      // pending → running → processing → completed | failed | aborted | timed_out
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
      providerRunId: { type: Sequelize.STRING(64) },
      providerDatasetId: { type: Sequelize.STRING(64) },
      resultCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      estimatedCostUsd: { type: Sequelize.DECIMAL(10, 4) },
      actualCostUsd: { type: Sequelize.DECIMAL(10, 4) },
      error: { type: Sequelize.TEXT },
      rawPayload: { type: Sequelize.JSONB },
      startedAt: { type: Sequelize.DATE },
      completedAt: { type: Sequelize.DATE },
      ...ts(),
    });
  }

  if (!tables.includes('discovery_candidates')) {
    await queryInterface.createTable('discovery_candidates', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      discoveryRunId: { type: UUID, allowNull: false, references: { model: 'discovery_runs', key: 'id' }, onDelete: 'CASCADE' },
      externalPlaceId: { type: Sequelize.STRING(128) },
      name: { type: Sequelize.STRING(200) },
      primaryPhone: { type: Sequelize.STRING(32) },
      website: { type: Sequelize.STRING(255) },
      websiteDomain: { type: Sequelize.STRING(160) },
      instagramHandle: { type: Sequelize.STRING(64) },
      address: { type: Sequelize.STRING(255) },
      area: { type: Sequelize.STRING(64) },
      rating: { type: Sequelize.DECIMAL(2, 1) },
      reviewsCount: { type: Sequelize.INTEGER },
      sourceUrl: { type: Sequelize.STRING(500) },
      // new | possible_duplicate | existing_partner
      dedupeStatus: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'new' },
      matchedPartnerId: { type: UUID, references: { model: 'partner_organisations', key: 'id' }, onDelete: 'SET NULL' },
      // pending | added | dismissed
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'pending' },
      addedPartnerId: { type: UUID, references: { model: 'partner_organisations', key: 'id' }, onDelete: 'SET NULL' },
      // none | pending | enriched | failed
      enrichmentStatus: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'none' },
      followersCount: { type: Sequelize.INTEGER },
      email: { type: Sequelize.STRING(160) },
      bio: { type: Sequelize.TEXT },
      enrichedAt: { type: Sequelize.DATE },
      enrichmentSource: { type: Sequelize.STRING(32) },
      rawPayload: { type: Sequelize.JSONB },
      ...ts(),
    });
  }

  // Idempotency: one Apify run row per provider run id; one candidate row per
  // (run, place) so re-materializing a dataset (duplicate webhook) is a no-op.
  await q('CREATE UNIQUE INDEX IF NOT EXISTS uq_discovery_runs_provider_run_id ON discovery_runs ("providerRunId") WHERE "providerRunId" IS NOT NULL');
  await q('CREATE UNIQUE INDEX IF NOT EXISTS uq_discovery_candidates_run_place ON discovery_candidates ("discoveryRunId", "externalPlaceId") WHERE "externalPlaceId" IS NOT NULL');
  // Reconciliation sweep scans non-terminal runs by age.
  await q('CREATE INDEX IF NOT EXISTS idx_discovery_runs_status ON discovery_runs (status, "startedAt")');
  // Per-user daily quota counts a user's recent runs.
  await q('CREATE INDEX IF NOT EXISTS idx_discovery_runs_creator ON discovery_runs ("createdBy", "createdAt")');
  await q('CREATE INDEX IF NOT EXISTS idx_discovery_candidates_run ON discovery_candidates ("discoveryRunId", status)');
}

export async function down(queryInterface) {
  const q = async (sql) => queryInterface.sequelize.query(sql);
  await q('DROP TABLE IF EXISTS discovery_candidates');
  await q('DROP TABLE IF EXISTS discovery_runs');
}
