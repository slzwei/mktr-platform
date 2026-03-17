export async function up(queryInterface) {
  // LeadPackage columns
  const lpCols = ['targetAudience', 'leadCriteria', 'deliverySchedule', 'features', 'limitations', 'analytics', 'tags'];
  for (const col of lpCols) {
    await queryInterface.removeColumn('lead_packages', col).catch(() => {});
  }

  // Commission columns
  await queryInterface.removeColumn('commissions', 'period').catch(() => {});
  await queryInterface.removeColumn('commissions', 'qualificationCriteria').catch(() => {});
}

export async function down(queryInterface, Sequelize) {
  // Recreate LeadPackage columns
  await queryInterface.addColumn('lead_packages', 'targetAudience', { type: Sequelize.DataTypes.JSON, defaultValue: {} }).catch(() => {});
  await queryInterface.addColumn('lead_packages', 'leadCriteria', { type: Sequelize.DataTypes.JSON, defaultValue: {} }).catch(() => {});
  await queryInterface.addColumn('lead_packages', 'deliverySchedule', { type: Sequelize.DataTypes.JSON, defaultValue: {} }).catch(() => {});
  await queryInterface.addColumn('lead_packages', 'features', { type: Sequelize.DataTypes.TEXT, defaultValue: '[]' }).catch(() => {});
  await queryInterface.addColumn('lead_packages', 'limitations', { type: Sequelize.DataTypes.JSON, defaultValue: {} }).catch(() => {});
  await queryInterface.addColumn('lead_packages', 'analytics', { type: Sequelize.DataTypes.JSON, defaultValue: {} }).catch(() => {});
  await queryInterface.addColumn('lead_packages', 'tags', { type: Sequelize.DataTypes.TEXT, defaultValue: '[]' }).catch(() => {});

  // Recreate Commission columns
  await queryInterface.addColumn('commissions', 'period', { type: Sequelize.DataTypes.JSON, defaultValue: {} }).catch(() => {});
  await queryInterface.addColumn('commissions', 'qualificationCriteria', { type: Sequelize.DataTypes.JSON, defaultValue: {} }).catch(() => {});
}
