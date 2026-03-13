/**
 * Move agent assignment config from Campaign to QrTag.
 * Each QR code independently decides how leads are routed.
 * Campaign keeps a defaultAssignmentMode for UX convenience.
 */
export async function up(queryInterface, sequelize) {
  const dialect = sequelize.getDialect();
  const isSqlite = dialect === 'sqlite';

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
    type: isSqlite ? 'TEXT' : 'JSONB',
    allowNull: true,
    defaultValue: isSqlite ? '[]' : '[]'
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
  if (isSqlite) {
    // SQLite doesn't support UPDATE...FROM, use subquery
    await sequelize.query(`
      UPDATE qr_tags SET
        agentAssignmentMode = COALESCE(
          (SELECT c.agentAssignmentMode FROM campaigns c WHERE c.id = qr_tags.campaignId),
          'direct'
        ),
        agentGroupId = (SELECT c.agentGroupId FROM campaigns c WHERE c.id = qr_tags.campaignId),
        agentGroupAgentIds = COALESCE(
          (SELECT c.agentGroupAgentIds FROM campaigns c WHERE c.id = qr_tags.campaignId),
          '[]'
        )
      WHERE campaignId IS NOT NULL
    `).catch(() => {});
  } else {
    // Postgres: UPDATE...FROM
    await sequelize.query(`
      UPDATE qr_tags SET
        "agentAssignmentMode" = c."agentAssignmentMode",
        "agentGroupId" = c."agentGroupId",
        "agentGroupAgentIds" = COALESCE(c."agentGroupAgentIds", '[]'::jsonb)
      FROM campaigns c
      WHERE qr_tags."campaignId" = c.id
    `).catch(() => {});
  }

  // 5. Backfill campaign defaultAssignmentMode from existing agentAssignmentMode
  await sequelize.query(`
    UPDATE campaigns SET "defaultAssignmentMode" = "agentAssignmentMode"
    WHERE "agentAssignmentMode" IS NOT NULL
  `).catch(() => {});
}
