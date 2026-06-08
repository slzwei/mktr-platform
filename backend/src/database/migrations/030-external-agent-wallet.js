/**
 * Migration 029 — external-agent wallet + campaign eligibility.
 *
 *  - external_agents.leadBalance: GLOBAL prepaid balance (one balance spent
 *    across whichever campaigns the agent is added to). Decremented by 1 per
 *    delivered external lead, atomically, in deductExternalLeadBalance().
 *  - external_campaign_agents: which campaigns an external buyer participates
 *    in. A campaign MAY mix internal Lyfe agents and external buyers; the
 *    unified round-robin (systemAgent.resolveLeadAssignment) rotates across
 *    both pools. Unique (externalAgentId, campaignId).
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn('external_agents', 'leadBalance', {
    type: Sequelize.DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  }).catch(() => {});

  await queryInterface.createTable('external_campaign_agents', {
    id: { type: Sequelize.DataTypes.UUID, primaryKey: true, defaultValue: Sequelize.DataTypes.UUIDV4 },
    externalAgentId: { type: Sequelize.DataTypes.UUID, allowNull: false, references: { model: 'external_agents', key: 'id' }, onDelete: 'CASCADE' },
    campaignId: { type: Sequelize.DataTypes.UUID, allowNull: false, references: { model: 'campaigns', key: 'id' }, onDelete: 'CASCADE' },
    isActive: { type: Sequelize.DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    updatedAt: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
  }).catch(() => {});

  await queryInterface.addIndex('external_campaign_agents', ['campaignId'], { name: 'idx_eca_campaign' }).catch(() => {});
  await queryInterface.addIndex('external_campaign_agents', ['externalAgentId'], { name: 'idx_eca_external_agent' }).catch(() => {});
  await queryInterface.addIndex('external_campaign_agents', ['externalAgentId', 'campaignId'], { unique: true, name: 'idx_eca_unique' }).catch(() => {});
}

export async function down(queryInterface) {
  await queryInterface.dropTable('external_campaign_agents').catch(() => {});
  await queryInterface.removeColumn('external_agents', 'leadBalance').catch(() => {});
}
