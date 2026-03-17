/**
 * Add columns across devices, vehicles, and prospects tables.
 * Also backfill devices.campaignIds from the legacy campaignId column.
 */
export async function up(queryInterface, sequelize) {
  const dialect = sequelize.getDialect();
  const isSqlite = dialect === 'sqlite';
  const jsonType = isSqlite ? 'TEXT' : 'JSON';

  // --- devices ---
  await queryInterface.addColumn('devices', 'campaignIds', {
    type: jsonType,
    allowNull: true,
    defaultValue: isSqlite ? '[]' : '[]'
  }).catch(() => {});

  // --- vehicles ---
  await queryInterface.addColumn('vehicles', 'volume', {
    type: 'INTEGER',
    allowNull: false,
    defaultValue: 0
  }).catch(() => {});

  // --- prospects ---
  await queryInterface.addColumn('prospects', 'retellCallId', {
    type: 'VARCHAR(255)',
    allowNull: true
  }).catch(() => {});

  // --- Data migration: backfill campaignIds from legacy campaignId ---
  if (isSqlite) {
    await sequelize.query(`
      UPDATE devices
      SET campaignIds = json_array(campaignId)
      WHERE campaignId IS NOT NULL
        AND (campaignIds IS NULL OR campaignIds = '[]')
    `).catch(() => {});
  } else {
    await sequelize.query(`
      UPDATE devices
      SET "campaignIds" = CASE
        WHEN "campaignId" IS NOT NULL THEN json_build_array("campaignId")
        ELSE '[]'::json
      END
      WHERE "campaignIds" IS NULL OR "campaignIds"::text = '[]'
    `).catch(() => {});
  }
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('prospects', 'retellCallId').catch(() => {});
  await queryInterface.removeColumn('vehicles', 'volume').catch(() => {});
  await queryInterface.removeColumn('devices', 'campaignIds').catch(() => {});
}
