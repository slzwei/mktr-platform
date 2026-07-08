/**
 * Redeem Ops Phase 4 — onboarding checklist, reward offers, versioned terms,
 * participating locations, inventory ledger (docs/redeem-ops/ERD.md §3.10–3.14).
 * Guarded + always-run IF NOT EXISTS indexes (045/046/047 pattern).
 */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  const UUID = Sequelize.UUID;
  const ts = () => ({
    createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
  });

  if (!tables.includes('partner_onboarding_items')) {
    await queryInterface.createTable('partner_onboarding_items', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      partnerOrganisationId: { type: UUID, allowNull: false, references: { model: 'partner_organisations', key: 'id' }, onDelete: 'CASCADE' },
      itemKey: { type: Sequelize.STRING(48), allowNull: false },
      label: { type: Sequelize.STRING(160), allowNull: false },
      sortOrder: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'pending' },
      assigneeUserId: { type: UUID, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
      completedAt: { type: Sequelize.DATE },
      notes: { type: Sequelize.TEXT },
      ...ts(),
    });
  }

  if (!tables.includes('reward_offers')) {
    await queryInterface.createTable('reward_offers', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      partnerOrganisationId: { type: UUID, allowNull: false, references: { model: 'partner_organisations', key: 'id' }, onDelete: 'RESTRICT' },
      title: { type: Sequelize.STRING(160), allowNull: false },
      publicTitle: { type: Sequelize.STRING(160) },
      internalRef: { type: Sequelize.STRING(64) },
      description: { type: Sequelize.TEXT },
      category: { type: Sequelize.STRING(64) },
      rewardType: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'free_service' },
      retailValue: { type: Sequelize.DECIMAL(10, 2) },
      fulfilmentCost: { type: Sequelize.DECIMAL(10, 2) },
      currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'SGD' },
      fundingSource: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'partner' },
      committedQuantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      allocatedQuantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      issuedQuantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      redeemedQuantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      validityStart: { type: Sequelize.DATE },
      validityEnd: { type: Sequelize.DATE },
      claimExpiryDays: { type: Sequelize.INTEGER },
      redemptionExpiryDays: { type: Sequelize.INTEGER },
      fulfilmentMethod: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'partner_verification' },
      externalBookingUrl: { type: Sequelize.STRING(255) },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'draft' },
      currentTermsVersion: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      createdBy: { type: UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      ...ts(),
    });
  }

  if (!tables.includes('reward_terms_versions')) {
    await queryInterface.createTable('reward_terms_versions', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      rewardOfferId: { type: UUID, allowNull: false, references: { model: 'reward_offers', key: 'id' }, onDelete: 'CASCADE' },
      version: { type: Sequelize.INTEGER, allowNull: false },
      structured: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      freeText: { type: Sequelize.TEXT },
      createdBy: { type: UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  }

  if (!tables.includes('reward_offer_locations')) {
    await queryInterface.createTable('reward_offer_locations', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      rewardOfferId: { type: UUID, allowNull: false, references: { model: 'reward_offers', key: 'id' }, onDelete: 'CASCADE' },
      partnerLocationId: { type: UUID, allowNull: false, references: { model: 'partner_locations', key: 'id' }, onDelete: 'CASCADE' },
      ...ts(),
    });
  }

  if (!tables.includes('reward_inventory_events')) {
    await queryInterface.createTable('reward_inventory_events', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      rewardOfferId: { type: UUID, allowNull: false, references: { model: 'reward_offers', key: 'id' }, onDelete: 'RESTRICT' },
      activationId: { type: UUID },
      entitlementId: { type: UUID },
      redemptionId: { type: UUID },
      type: { type: Sequelize.STRING(24), allowNull: false },
      quantity: { type: Sequelize.INTEGER, allowNull: false },
      actorType: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'staff' },
      actorUserId: { type: UUID, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
      reason: { type: Sequelize.STRING(255) },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  }

  const idx = (sql) => queryInterface.sequelize.query(sql);
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_poi_partner_key ON partner_onboarding_items ("partnerOrganisationId", "itemKey")');
  await idx('CREATE INDEX IF NOT EXISTS idx_ro_partner_status ON reward_offers ("partnerOrganisationId", "status")');
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_rtv_offer_version ON reward_terms_versions ("rewardOfferId", "version")');
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_rol_offer_location ON reward_offer_locations ("rewardOfferId", "partnerLocationId")');
  await idx('CREATE INDEX IF NOT EXISTS idx_rie_offer_created ON reward_inventory_events ("rewardOfferId", "createdAt")');
  await idx('CREATE INDEX IF NOT EXISTS idx_rie_activation ON reward_inventory_events ("activationId")');
}

export async function down(queryInterface) {
  for (const table of [
    'reward_inventory_events',
    'reward_offer_locations',
    'reward_terms_versions',
    'reward_offers',
    'partner_onboarding_items',
  ]) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
}
