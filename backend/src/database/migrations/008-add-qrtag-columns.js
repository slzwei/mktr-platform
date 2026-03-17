/**
 * Add analytics and agent contact columns to qr_tags.
 *
 * Columns already handled by migration 004 (skipped here):
 *   agentAssignmentMode, agentGroupId, agentGroupAgentIds, roundRobinIndex
 */
export async function up(queryInterface, sequelize) {
  const dialect = sequelize.getDialect();
  const isSqlite = dialect === 'sqlite';
  const jsonType = isSqlite ? 'TEXT' : 'JSON';

  await queryInterface.addColumn('qr_tags', 'scanCount', {
    type: 'INTEGER',
    allowNull: false,
    defaultValue: 0
  }).catch(() => {});

  await queryInterface.addColumn('qr_tags', 'uniqueScanCount', {
    type: 'INTEGER',
    allowNull: false,
    defaultValue: 0
  }).catch(() => {});

  await queryInterface.addColumn('qr_tags', 'lastScanned', {
    type: 'TIMESTAMP WITH TIME ZONE',
    allowNull: true
  }).catch(() => {});

  await queryInterface.addColumn('qr_tags', 'analytics', {
    type: jsonType,
    allowNull: true,
    defaultValue: isSqlite ? '{}' : '{}'
  }).catch(() => {});

  await queryInterface.addColumn('qr_tags', 'assignedAgentPhone', {
    type: 'VARCHAR(255)',
    allowNull: true
  }).catch(() => {});

  await queryInterface.addColumn('qr_tags', 'assignedAgentEmail', {
    type: 'VARCHAR(255)',
    allowNull: true
  }).catch(() => {});

  await queryInterface.addColumn('qr_tags', 'assignedAgentName', {
    type: 'VARCHAR(255)',
    allowNull: true
  }).catch(() => {});
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('qr_tags', 'assignedAgentName').catch(() => {});
  await queryInterface.removeColumn('qr_tags', 'assignedAgentEmail').catch(() => {});
  await queryInterface.removeColumn('qr_tags', 'assignedAgentPhone').catch(() => {});
  await queryInterface.removeColumn('qr_tags', 'analytics').catch(() => {});
  await queryInterface.removeColumn('qr_tags', 'lastScanned').catch(() => {});
  await queryInterface.removeColumn('qr_tags', 'uniqueScanCount').catch(() => {});
  await queryInterface.removeColumn('qr_tags', 'scanCount').catch(() => {});
}
