/**
 * Lucky draw Phase 1 — versioned draw T&Cs (docs/plans/lucky-draw-10x.md §4.6).
 * Append-only, mirroring reward_terms_versions (048). Guarded createTable +
 * always-run IF NOT EXISTS indexes (045/046/047 pattern).
 */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  const UUID = Sequelize.UUID;

  if (!tables.includes('draw_terms_versions')) {
    await queryInterface.createTable('draw_terms_versions', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      campaignId: { type: UUID, allowNull: false, references: { model: 'campaigns', key: 'id' }, onDelete: 'CASCADE' },
      version: { type: Sequelize.INTEGER, allowNull: false },
      content: { type: Sequelize.TEXT, allowNull: false },
      contentSha256: { type: Sequelize.STRING(64), allowNull: false },
      createdBy: { type: UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  }

  const idx = (sql) => queryInterface.sequelize.query(sql);
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_dtv_campaign_version ON draw_terms_versions ("campaignId", version)');
  await idx('CREATE INDEX IF NOT EXISTS idx_dtv_campaign_hash ON draw_terms_versions ("campaignId", "contentSha256")');
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS draw_terms_versions CASCADE');
}
