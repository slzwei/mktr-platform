/** Admin-managed AI provider credentials and global authoring guidance. */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  if (tables.includes('ai_settings')) return;
  await queryInterface.createTable('ai_settings', {
    id: { type: Sequelize.STRING(32), primaryKey: true, allowNull: false },
    defaultProvider: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'openai' },
    openaiModel: { type: Sequelize.STRING(100), allowNull: false, defaultValue: 'gpt-5.6-terra' },
    anthropicModel: { type: Sequelize.STRING(100), allowNull: false, defaultValue: 'claude-sonnet-4-6' },
    openaiKeyEncrypted: { type: Sequelize.TEXT },
    openaiKeyHint: { type: Sequelize.STRING(12) },
    anthropicKeyEncrypted: { type: Sequelize.TEXT },
    anthropicKeyHint: { type: Sequelize.STRING(12) },
    globalGuardrails: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
    workstylePreferences: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
    updatedBy: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
    createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
  });
}

export async function down(queryInterface) {
  await queryInterface.dropTable('ai_settings');
}
