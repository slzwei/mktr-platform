/**
 * Migration: Drop the campaign `metrics` JSON column.
 *
 * Campaign metrics (leads, conversions, views, etc.) are now computed at
 * query time from the real source tables (prospects, qr_tags, commissions).
 * This eliminates the race condition caused by concurrent read-modify-write
 * on the JSON blob.
 */
export async function up(queryInterface) {
  await queryInterface.removeColumn('campaigns', 'metrics').catch(() => {});
}

export async function down(queryInterface, Sequelize) {
  await queryInterface.addColumn('campaigns', 'metrics', {
    type: Sequelize.DataTypes.JSON,
    allowNull: true,
    defaultValue: { views: 0, clicks: 0, conversions: 0, leads: 0, revenue: 0 }
  }).catch(() => {});
}
