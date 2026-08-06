/**
 * 113 — meta_form_mappings: instant form → campaign (+ optional QR) routing
 * (docs/plans/meta-lead-ads-native-pipe.md §3.2).
 *
 * campaignId RESTRICTs deletion (a campaign with live form routing must not
 * vanish under it); qrTagId SET NULLs (losing a QR demotes the form to
 * campaign-ring routing, which ingest handles).
 */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  if (!tables.includes('meta_form_mappings')) {
    await queryInterface.createTable('meta_form_mappings', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      formId: { type: Sequelize.STRING(64), allowNull: false },
      formName: { type: Sequelize.STRING(160), allowNull: true },
      campaignId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'campaigns', key: 'id' },
        onDelete: 'RESTRICT',
      },
      qrTagId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'qr_tags', key: 'id' },
        onDelete: 'SET NULL',
      },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  }
  const idx = (sql) => queryInterface.sequelize.query(sql);
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_form_mappings_form_id ON meta_form_mappings ("formId")');
  await idx('CREATE INDEX IF NOT EXISTS idx_mfm_campaign ON meta_form_mappings ("campaignId")');
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS meta_form_mappings');
}
