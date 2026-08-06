/**
 * 114 — meta_leadgen_events: durable inbox for Meta leadgen webhooks
 * (docs/plans/meta-lead-ads-native-pipe.md §2.2).
 *
 * UNIQUE leadgenId is the PERMANENT protocol dedupe (not the TTL'd
 * idempotency_keys — its hourly purge would eventually re-admit replays).
 * prospectId is a plain UUID on purpose: audit rows outlive their subjects.
 */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  if (!tables.includes('meta_leadgen_events')) {
    await queryInterface.createTable('meta_leadgen_events', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      leadgenId: { type: Sequelize.STRING(64), allowNull: false },
      pageId: { type: Sequelize.STRING(64), allowNull: true },
      formId: { type: Sequelize.STRING(64), allowNull: true },
      createdTime: { type: Sequelize.BIGINT, allowNull: true },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'pending' },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      nextAttemptAt: { type: Sequelize.DATE, allowNull: true },
      lastError: { type: Sequelize.TEXT, allowNull: true },
      prospectId: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  }
  const idx = (sql) => queryInterface.sequelize.query(sql);
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_leadgen_events_leadgen_id ON meta_leadgen_events ("leadgenId")');
  await idx('CREATE INDEX IF NOT EXISTS idx_mle_status_next ON meta_leadgen_events (status, "nextAttemptAt")');
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS meta_leadgen_events');
}
