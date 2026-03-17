/**
 * Move agent assignment config from Campaign to QrTag.
 * Each QR code independently decides how leads are routed.
 * Campaign keeps a defaultAssignmentMode for UX convenience.
 */
export async function up(queryInterface, sequelize) {
  // 1. Add assignment columns to qr_tags
  await queryInterface.addColumn('qr_tags', 'agentAssignmentMode', {
    type: 'VARCHAR(255)',
    allowNull: false,
    defaultValue: 'direct'
  }).catch(() => {});

  await queryInterface.addColumn('qr_tags', 'agentGroupId', {
    type: 'UUID',
    allowNull: true
  }).catch(() => {});

  await queryInterface.addColumn('qr_tags', 'agentGroupAgentIds', {
    type: 'JSONB',
    allowNull: true,
    defaultValue: '[]'
  }).catch(() => {});

  await queryInterface.addColumn('qr_tags', 'roundRobinIndex', {
    type: 'INTEGER',
    allowNull: false,
    defaultValue: 0
  }).catch(() => {});

  // 2. Add defaultAssignmentMode to campaigns
  await queryInterface.addColumn('campaigns', 'defaultAssignmentMode', {
    type: 'VARCHAR(255)',
    allowNull: false,
    defaultValue: 'direct'
  }).catch(() => {});

  // 3. Add index on agentGroupId in qr_tags
  await queryInterface.addIndex('qr_tags', ['agentGroupId'], {
    name: 'idx_qrtags_agent_group'
  }).catch(() => {});

  // 4. Backfill existing QR tags from their parent campaign
  await sequelize.query(`
    UPDATE qr_tags SET
      "agentAssignmentMode" = c."agentAssignmentMode",
      "agentGroupId" = c."agentGroupId",
      "agentGroupAgentIds" = COALESCE(c."agentGroupAgentIds", '[]'::jsonb)
    FROM campaigns c
    WHERE qr_tags."campaignId" = c.id
  `).catch(() => {});

  // 5. Backfill campaign defaultAssignmentMode from existing agentAssignmentMode
  await sequelize.query(`
    UPDATE campaigns SET "defaultAssignmentMode" = "agentAssignmentMode"
    WHERE "agentAssignmentMode" IS NOT NULL
  `).catch(() => {});
}
