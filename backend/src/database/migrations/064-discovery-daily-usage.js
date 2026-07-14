/**
 * 064 — Atomic per-user Singapore-day Discover usage counters.
 *
 * The feature remains dark behind DISCOVERY_RESULT_QUOTA_ENABLED. Guarded and
 * idempotent; NODE_ENV=test sync() creates this table before migrations run.
 */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  if (tables.includes('discovery_daily_usage')) return;

  await queryInterface.createTable('discovery_daily_usage', {
    userId: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
    sgDate: { type: Sequelize.DATEONLY, allowNull: false, primaryKey: true },
    resultsUsed: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
    profilesUsed: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
    createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
  });
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS discovery_daily_usage');
}
