/**
 * Drop the now-redundant JSON columns that were replaced by the
 * agent_group_members join table (created in migration 023).
 *
 * - agent_groups.agents       (JSON array of {phone,email,name,lyfeId})
 * - agent_groups.agentCount   (denormalized count)
 * - qr_tags.agentGroupAgentIds (JSON array of phone strings)
 *
 * IMPORTANT: Deploy the updated service code BEFORE running this migration.
 * The services no longer read/write these columns.
 */
export async function up(queryInterface) {
  await queryInterface.removeColumn('agent_groups', 'agents').catch(() => {});
  await queryInterface.removeColumn('agent_groups', 'agentCount').catch(() => {});
  await queryInterface.removeColumn('qr_tags', 'agentGroupAgentIds').catch(() => {});
}

export async function down(queryInterface, Sequelize) {
  await queryInterface.addColumn('agent_groups', 'agents', {
    type: Sequelize.DataTypes.JSON,
    allowNull: false,
    defaultValue: []
  }).catch(() => {});

  await queryInterface.addColumn('agent_groups', 'agentCount', {
    type: Sequelize.DataTypes.INTEGER,
    defaultValue: 0
  }).catch(() => {});

  await queryInterface.addColumn('qr_tags', 'agentGroupAgentIds', {
    type: Sequelize.DataTypes.JSON,
    allowNull: true,
    defaultValue: []
  }).catch(() => {});
}
