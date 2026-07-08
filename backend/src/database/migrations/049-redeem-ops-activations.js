/**
 * Redeem Ops Phase 5 — Activations (docs/redeem-ops/ERD.md §3.15). The bridge
 * between a partner's Reward Offer and ONE canonical MKTR campaign. Partial
 * unique index enforces one LIVE activation per campaign at the schema level.
 */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  const UUID = Sequelize.UUID;

  if (!tables.includes('activations')) {
    await queryInterface.createTable('activations', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      partnerOrganisationId: { type: UUID, allowNull: false, references: { model: 'partner_organisations', key: 'id' }, onDelete: 'RESTRICT' },
      rewardOfferId: { type: UUID, allowNull: false, references: { model: 'reward_offers', key: 'id' }, onDelete: 'RESTRICT' },
      campaignId: { type: UUID, references: { model: 'campaigns', key: 'id' }, onDelete: 'SET NULL' },
      campaignNameSnapshot: { type: Sequelize.STRING(160) },
      allocatedQuantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      issuedCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      redeemedCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'draft' },
      unlockPolicy: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'agent_unlock' },
      startDate: { type: Sequelize.DATE },
      endDate: { type: Sequelize.DATE },
      internalNotes: { type: Sequelize.TEXT },
      renewalOutcome: { type: Sequelize.STRING(24) },
      createdBy: { type: UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  }

  const idx = (sql) => queryInterface.sequelize.query(sql);
  await idx('CREATE INDEX IF NOT EXISTS idx_act_partner ON activations ("partnerOrganisationId")');
  await idx('CREATE INDEX IF NOT EXISTS idx_act_offer ON activations ("rewardOfferId")');
  await idx('CREATE INDEX IF NOT EXISTS idx_act_status ON activations ("status")');
  await idx(`CREATE UNIQUE INDEX IF NOT EXISTS uq_act_live_campaign ON activations ("campaignId")
             WHERE "status" IN ('preparing', 'active', 'paused') AND "campaignId" IS NOT NULL`);
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS activations CASCADE');
}
