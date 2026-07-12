/**
 * Lucky draw Phase 2 — the draw ledger (docs/plans/lucky-draw-10x.md §4.3):
 * draws (one per campaign draw), draw_entries (the frozen, PII-masked pool
 * snapshot), draw_attempts (every witnessed pick incl. redraws), and
 * draw_boost_reviews (approve/reject of agent_button ×N evidence).
 * Guarded createTable + always-run IF NOT EXISTS indexes (048/058 pattern).
 *
 * No circular FK: the picked winner lives on draw_attempts.pickedEntryId
 * (created after draw_entries), never on draws.
 */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  const UUID = Sequelize.UUID;
  const ts = () => ({
    createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
  });

  if (!tables.includes('draws')) {
    await queryInterface.createTable('draws', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      campaignId: { type: UUID, allowNull: false, references: { model: 'campaigns', key: 'id' }, onDelete: 'RESTRICT' },
      activationId: { type: UUID, references: { model: 'activations', key: 'id' }, onDelete: 'RESTRICT' },
      termsVersionId: { type: UUID, references: { model: 'draw_terms_versions', key: 'id' }, onDelete: 'RESTRICT' },
      closesAt: { type: Sequelize.DATE, allowNull: false },
      boostClosesAt: { type: Sequelize.DATE },
      multiplier: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 10 },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'open' },
      poolHash: { type: Sequelize.STRING(64) },
      witnessedByUserId: { type: UUID, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
      notes: { type: Sequelize.TEXT },
      createdBy: { type: UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      ...ts(),
    });
  }

  if (!tables.includes('draw_entries')) {
    await queryInterface.createTable('draw_entries', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      drawId: { type: UUID, allowNull: false, references: { model: 'draws', key: 'id' }, onDelete: 'CASCADE' },
      prospectId: { type: UUID, references: { model: 'prospects', key: 'id' }, onDelete: 'SET NULL' },
      phoneHash: { type: Sequelize.STRING(64), allowNull: false },
      phoneLast4: { type: Sequelize.STRING(4) },
      displayName: { type: Sequelize.STRING(120) },
      chances: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      verifiedAtFreeze: { type: Sequelize.DATE },
      boostVia: { type: Sequelize.STRING(16) },
      boostEventId: { type: UUID, references: { model: 'redemption_events', key: 'id' }, onDelete: 'SET NULL' },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  }

  if (!tables.includes('draw_attempts')) {
    await queryInterface.createTable('draw_attempts', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      drawId: { type: UUID, allowNull: false, references: { model: 'draws', key: 'id' }, onDelete: 'CASCADE' },
      attemptNo: { type: Sequelize.INTEGER, allowNull: false },
      seed: { type: Sequelize.STRING(64), allowNull: false },
      totalChances: { type: Sequelize.INTEGER, allowNull: false },
      eligibleHash: { type: Sequelize.STRING(64), allowNull: false },
      pickedEntryId: { type: UUID, allowNull: false, references: { model: 'draw_entries', key: 'id' }, onDelete: 'RESTRICT' },
      reason: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'initial' },
      drawnAt: { type: Sequelize.DATE, allowNull: false },
      witnessedByUserId: { type: UUID, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
      contactedAt: { type: Sequelize.DATE },
      claimDeadline: { type: Sequelize.DATE },
      claimedAt: { type: Sequelize.DATE },
      outcome: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'pending' },
      ...ts(),
    });
  }

  if (!tables.includes('draw_boost_reviews')) {
    await queryInterface.createTable('draw_boost_reviews', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      drawId: { type: UUID, allowNull: false, references: { model: 'draws', key: 'id' }, onDelete: 'CASCADE' },
      entitlementId: { type: UUID, allowNull: false, references: { model: 'reward_entitlements', key: 'id' }, onDelete: 'RESTRICT' },
      prospectId: { type: UUID },
      decision: { type: Sequelize.STRING(16), allowNull: false },
      reviewedByUserId: { type: UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      reason: { type: Sequelize.TEXT },
      ...ts(),
    });
  }

  const idx = (sql) => queryInterface.sequelize.query(sql);
  // At most ONE live draw per campaign — history (published/void) unlimited.
  await idx(`CREATE UNIQUE INDEX IF NOT EXISTS uq_draws_live_campaign ON draws ("campaignId")
             WHERE status IN ('open', 'frozen', 'sealed', 'drawn')`);
  await idx('CREATE INDEX IF NOT EXISTS idx_draws_campaign ON draws ("campaignId")');
  await idx(`CREATE UNIQUE INDEX IF NOT EXISTS uq_de_draw_prospect ON draw_entries ("drawId", "prospectId")
             WHERE "prospectId" IS NOT NULL`);
  await idx('CREATE INDEX IF NOT EXISTS idx_de_draw ON draw_entries ("drawId")');
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_da_draw_attempt ON draw_attempts ("drawId", "attemptNo")');
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_dbr_draw_entitlement ON draw_boost_reviews ("drawId", "entitlementId")');
}

export async function down(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);
  await q('DROP TABLE IF EXISTS draw_boost_reviews CASCADE');
  await q('DROP TABLE IF EXISTS draw_attempts CASCADE');
  await q('DROP TABLE IF EXISTS draw_entries CASCADE');
  await q('DROP TABLE IF EXISTS draws CASCADE');
}
