/**
 * 112 — meta_pages: Facebook Pages allowed to deliver Lead Ads leads
 * (docs/plans/meta-lead-ads-native-pipe.md §3.1).
 *
 * accessTokenEnc holds the AES-256-GCM envelope from metaPageTokens.js
 * (AAD = pageId) — never a plaintext token. An inactive row is a DENY: the
 * env-token fallback applies only to pages with no row at all.
 */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  if (!tables.includes('meta_pages')) {
    await queryInterface.createTable('meta_pages', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      pageId: { type: Sequelize.STRING(64), allowNull: false },
      name: { type: Sequelize.STRING(120), allowNull: true },
      accessTokenEnc: { type: Sequelize.TEXT, allowNull: false },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  }
  await queryInterface.sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_pages_page_id ON meta_pages ("pageId")'
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS meta_pages');
}
