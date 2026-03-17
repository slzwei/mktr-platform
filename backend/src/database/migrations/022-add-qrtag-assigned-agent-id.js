export async function up(queryInterface, Sequelize) {
  // Add the FK column
  await queryInterface.addColumn('qr_tags', 'assignedAgentId', {
    type: Sequelize.DataTypes.UUID,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL'
  }).catch(() => {});

  await queryInterface.addIndex('qr_tags', ['assignedAgentId'], { name: 'idx_qrtags_assignedagentid' }).catch(() => {});

  // Backfill from assignedAgentPhone
  await queryInterface.sequelize.query(`
    UPDATE qr_tags qt
    SET "assignedAgentId" = u.id
    FROM users u
    WHERE u.phone = qt."assignedAgentPhone"
      AND u.role = 'agent'
      AND u."isActive" = true
      AND qt."assignedAgentPhone" IS NOT NULL
      AND qt."assignedAgentId" IS NULL
  `).catch(() => {});
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('qr_tags', 'assignedAgentId').catch(() => {});
}
