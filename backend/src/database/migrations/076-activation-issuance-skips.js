/**
 * 076 — Persisted issuance-skip log (trial-reward hardening PR C).
 *
 * A detached or starved funnel must be VISIBLE: every skipped reward issuance
 * (no active activation, allocation exhausted, offer paused, activation ended,
 * quarantined, unverified, no phone, duplicate phone) writes one row here, and
 * the activation detail endpoint reads a last-24h reason breakdown from it.
 * Codex-verified plan note: this cannot be derived from structured logs — no
 * log analytics exists. Rows are ephemeral (30-day purge in the fulfilment
 * sweep); campaignId/activationId are plain UUIDs on purpose — the row must
 * survive whatever happens to its subjects.
 */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  if (!tables.includes('activation_issuance_skips')) {
    await queryInterface.createTable('activation_issuance_skips', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      campaignId: { type: Sequelize.UUID, allowNull: true },
      activationId: { type: Sequelize.UUID, allowNull: true },
      reason: { type: Sequelize.STRING(32), allowNull: false },
      via: { type: Sequelize.STRING(16), allowNull: true, comment: 'hook|sweep|manual' },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  }
  const idx = (sql) => queryInterface.sequelize.query(sql);
  await idx('CREATE INDEX IF NOT EXISTS idx_ais_activation_created ON activation_issuance_skips ("activationId", "createdAt")');
  await idx('CREATE INDEX IF NOT EXISTS idx_ais_campaign_created ON activation_issuance_skips ("campaignId", "createdAt")');
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS activation_issuance_skips');
}
