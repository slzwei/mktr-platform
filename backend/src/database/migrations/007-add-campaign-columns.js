/**
 * Add missing columns to the campaigns table:
 * commission amounts, ad_playlist, and agent assignment fields.
 *
 * NOTE: defaultAssignmentMode is skipped — already added by migration 004.
 */
export async function up(queryInterface, sequelize) {
  const dialect = sequelize.getDialect();
  const isSqlite = dialect === 'sqlite';
  const jsonType = isSqlite ? 'TEXT' : 'JSON';

  await queryInterface.addColumn('campaigns', 'commission_amount_driver', {
    type: 'DECIMAL(10,2)',
    allowNull: true
  }).catch(() => {});

  await queryInterface.addColumn('campaigns', 'commission_amount_fleet', {
    type: 'DECIMAL(10,2)',
    allowNull: true
  }).catch(() => {});

  await queryInterface.addColumn('campaigns', 'ad_playlist', {
    type: jsonType,
    allowNull: true,
    defaultValue: isSqlite ? '[]' : '[]'
  }).catch(() => {});

  await queryInterface.addColumn('campaigns', 'agentAssignmentMode', {
    type: 'VARCHAR(255)',
    allowNull: true,
    defaultValue: 'round_robin'
  }).catch(() => {});

  await queryInterface.addColumn('campaigns', 'agentGroupId', {
    type: 'UUID',
    allowNull: true
  }).catch(() => {});

  await queryInterface.addColumn('campaigns', 'agentGroupAgentIds', {
    type: isSqlite ? 'TEXT' : 'JSON',
    allowNull: true,
    defaultValue: isSqlite ? '[]' : '[]'
  }).catch(() => {});

  await queryInterface.addColumn('campaigns', 'roundRobinIndex', {
    type: 'INTEGER',
    allowNull: false,
    defaultValue: 0
  }).catch(() => {});

  // NOTE: defaultAssignmentMode already added in migration 004.
  // Re-add here as a no-op safety net (catch swallows the duplicate error).
  await queryInterface.addColumn('campaigns', 'defaultAssignmentMode', {
    type: 'VARCHAR(255)',
    allowNull: false,
    defaultValue: 'direct'
  }).catch(() => {});
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('campaigns', 'defaultAssignmentMode').catch(() => {});
  await queryInterface.removeColumn('campaigns', 'roundRobinIndex').catch(() => {});
  await queryInterface.removeColumn('campaigns', 'agentGroupAgentIds').catch(() => {});
  await queryInterface.removeColumn('campaigns', 'agentGroupId').catch(() => {});
  await queryInterface.removeColumn('campaigns', 'agentAssignmentMode').catch(() => {});
  await queryInterface.removeColumn('campaigns', 'ad_playlist').catch(() => {});
  await queryInterface.removeColumn('campaigns', 'commission_amount_fleet').catch(() => {});
  await queryInterface.removeColumn('campaigns', 'commission_amount_driver').catch(() => {});
}
