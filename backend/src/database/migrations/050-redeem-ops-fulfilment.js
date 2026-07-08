/**
 * Redeem Ops Phase 6 — entitlements, redemptions, fulfilment history
 * (docs/redeem-ops/ERD.md §3.16–3.18). Two-token design: reservation pass at
 * capture, voucher minted only at the consultant unlock.
 */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  const UUID = Sequelize.UUID;
  const ts = () => ({
    createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
  });

  if (!tables.includes('reward_entitlements')) {
    await queryInterface.createTable('reward_entitlements', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      rewardOfferId: { type: UUID, allowNull: false, references: { model: 'reward_offers', key: 'id' }, onDelete: 'RESTRICT' },
      activationId: { type: UUID, allowNull: false, references: { model: 'activations', key: 'id' }, onDelete: 'RESTRICT' },
      prospectId: { type: UUID, references: { model: 'prospects', key: 'id' }, onDelete: 'SET NULL' },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'eligible' },
      reservedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      unlockedAt: { type: Sequelize.DATE },
      unlockedByUserId: { type: UUID, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
      unlockedVia: { type: Sequelize.STRING(16) },
      expiresAt: { type: Sequelize.DATE },
      presentationTokenHash: { type: Sequelize.STRING(64), allowNull: false },
      tokenHash: { type: Sequelize.STRING(64) },
      tokenHint: { type: Sequelize.STRING(8) },
      issuedVia: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'hook' },
      createdBy: { type: UUID },
      ...ts(),
    });
  }

  if (!tables.includes('redemptions')) {
    await queryInterface.createTable('redemptions', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      entitlementId: { type: UUID, allowNull: false, references: { model: 'reward_entitlements', key: 'id' }, onDelete: 'RESTRICT' },
      rewardOfferId: { type: UUID, allowNull: false, references: { model: 'reward_offers', key: 'id' }, onDelete: 'RESTRICT' },
      activationId: { type: UUID, allowNull: false, references: { model: 'activations', key: 'id' }, onDelete: 'RESTRICT' },
      partnerOrganisationId: { type: UUID, allowNull: false, references: { model: 'partner_organisations', key: 'id' }, onDelete: 'RESTRICT' },
      locationId: { type: UUID, references: { model: 'partner_locations', key: 'id' }, onDelete: 'SET NULL' },
      redeemedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      method: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'code' },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'completed' },
      actorType: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'staff' },
      actorUserId: { type: UUID, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
      notes: { type: Sequelize.TEXT },
      ...ts(),
    });
  }

  if (!tables.includes('redemption_events')) {
    await queryInterface.createTable('redemption_events', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      entitlementId: { type: UUID, allowNull: false, references: { model: 'reward_entitlements', key: 'id' }, onDelete: 'CASCADE' },
      redemptionId: { type: UUID, references: { model: 'redemptions', key: 'id' }, onDelete: 'CASCADE' },
      type: { type: Sequelize.STRING(24), allowNull: false },
      metadata: { type: Sequelize.JSONB },
      actorType: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'system' },
      actorUserId: { type: UUID },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  }

  const idx = (sql) => queryInterface.sequelize.query(sql);
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_re_activation_prospect ON reward_entitlements ("activationId", "prospectId") WHERE "prospectId" IS NOT NULL');
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_re_presentation_token ON reward_entitlements ("presentationTokenHash")');
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_re_voucher_token ON reward_entitlements ("tokenHash") WHERE "tokenHash" IS NOT NULL');
  await idx('CREATE INDEX IF NOT EXISTS idx_re_activation_status ON reward_entitlements ("activationId", "status")');
  await idx('CREATE INDEX IF NOT EXISTS idx_re_prospect ON reward_entitlements ("prospectId")');
  await idx(`CREATE INDEX IF NOT EXISTS idx_re_expiry_eligible ON reward_entitlements ("expiresAt") WHERE "status" = 'eligible'`);
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS "redemptions_entitlementId_key" ON redemptions ("entitlementId")');
  await idx('CREATE INDEX IF NOT EXISTS idx_red_partner_redeemed ON redemptions ("partnerOrganisationId", "redeemedAt")');
  await idx('CREATE INDEX IF NOT EXISTS idx_rde_entitlement_created ON redemption_events ("entitlementId", "createdAt")');
}

export async function down(queryInterface) {
  for (const table of ['redemption_events', 'redemptions', 'reward_entitlements']) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
}
