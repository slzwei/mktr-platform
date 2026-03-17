export async function up(queryInterface) {
  // Drop FK constraint first (try both possible naming conventions)
  await queryInterface.removeConstraint('campaigns', 'campaigns_agentGroupId_fkey').catch(() => {});
  await queryInterface.removeConstraint('campaigns', 'campaigns_agentGroupId_agent_groups_fk').catch(() => {});

  // Drop columns
  await queryInterface.removeColumn('campaigns', 'agentAssignmentMode').catch(() => {});
  await queryInterface.removeColumn('campaigns', 'agentGroupId').catch(() => {});
  await queryInterface.removeColumn('campaigns', 'agentGroupAgentIds').catch(() => {});
  await queryInterface.removeColumn('campaigns', 'roundRobinIndex').catch(() => {});
  await queryInterface.removeColumn('campaigns', 'designAssets').catch(() => {});
}

export async function down(queryInterface, Sequelize) {
  // Recreate columns with original defaults
  await queryInterface.addColumn('campaigns', 'agentAssignmentMode', { type: Sequelize.DataTypes.STRING, defaultValue: 'round_robin' }).catch(() => {});
  await queryInterface.addColumn('campaigns', 'agentGroupId', { type: Sequelize.DataTypes.UUID }).catch(() => {});
  await queryInterface.addColumn('campaigns', 'agentGroupAgentIds', { type: Sequelize.DataTypes.JSON, defaultValue: [] }).catch(() => {});
  await queryInterface.addColumn('campaigns', 'roundRobinIndex', { type: Sequelize.DataTypes.INTEGER, defaultValue: 0 }).catch(() => {});
  await queryInterface.addColumn('campaigns', 'designAssets', { type: Sequelize.DataTypes.JSON, defaultValue: [] }).catch(() => {});
}
