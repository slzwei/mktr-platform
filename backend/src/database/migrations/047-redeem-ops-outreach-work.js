/**
 * Redeem Ops Phase 3 — tasks, prospecting pools (docs/redeem-ops/ERD.md §3.7–3.9).
 * Guarded for partial re-runs and NODE_ENV=test sync-first, like 045/046.
 */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  const UUID = Sequelize.UUID;
  const ts = () => ({
    createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
  });

  if (!tables.includes('outreach_tasks')) {
    await queryInterface.createTable('outreach_tasks', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      title: { type: Sequelize.STRING(160), allowNull: false },
      partnerOrganisationId: { type: UUID, allowNull: false, references: { model: 'partner_organisations', key: 'id' }, onDelete: 'CASCADE' },
      contactId: { type: UUID, references: { model: 'partner_contacts', key: 'id' }, onDelete: 'SET NULL' },
      assigneeUserId: { type: UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      createdBy: { type: UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      dueAt: { type: Sequelize.DATE, allowNull: false },
      hasTime: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      priority: { type: Sequelize.STRING(12), allowNull: false, defaultValue: 'medium' },
      type: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'follow_up' },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'open' },
      description: { type: Sequelize.TEXT },
      completedAt: { type: Sequelize.DATE },
      completedBy: { type: UUID },
      ...ts(),
    });
  }

  if (!tables.includes('prospecting_pools')) {
    await queryInterface.createTable('prospecting_pools', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      name: { type: Sequelize.STRING(120), allowNull: false, unique: true },
      description: { type: Sequelize.TEXT },
      category: { type: Sequelize.STRING(64) },
      area: { type: Sequelize.STRING(64) },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdBy: { type: UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      ...ts(),
    });
  }

  if (!tables.includes('prospecting_pool_members')) {
    await queryInterface.createTable('prospecting_pool_members', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      poolId: { type: UUID, allowNull: false, references: { model: 'prospecting_pools', key: 'id' }, onDelete: 'CASCADE' },
      partnerOrganisationId: { type: UUID, allowNull: false, references: { model: 'partner_organisations', key: 'id' }, onDelete: 'CASCADE' },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'available' },
      addedBy: { type: UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      claimedBy: { type: UUID },
      claimedAt: { type: Sequelize.DATE },
      ...ts(),
    });
  }

  // Indexes — always-run IF NOT EXISTS (independent of table-exists branches;
  // the runner is non-transactional, 045/046 pattern).
  const idx = (sql) => queryInterface.sequelize.query(sql);
  await idx('CREATE INDEX IF NOT EXISTS idx_ot_assignee_status_due ON outreach_tasks ("assigneeUserId", "status", "dueAt")');
  await idx('CREATE INDEX IF NOT EXISTS idx_ot_partner_status ON outreach_tasks ("partnerOrganisationId", "status")');
  await idx(`CREATE INDEX IF NOT EXISTS idx_ot_due_open ON outreach_tasks ("dueAt") WHERE "status" IN ('open', 'in_progress')`);
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_ppm_pool_partner ON prospecting_pool_members ("poolId", "partnerOrganisationId")');
  await idx('CREATE INDEX IF NOT EXISTS idx_ppm_pool_status ON prospecting_pool_members ("poolId", "status")');
}

export async function down(queryInterface) {
  for (const table of ['prospecting_pool_members', 'prospecting_pools', 'outreach_tasks']) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
}
