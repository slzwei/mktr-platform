/**
 * Redeem Ops Phase 1 foundation — docs/redeem-ops/IMPLEMENTATION_PLAN.md (Phase 1),
 * docs/redeem-ops/ERD.md §2 + §3.19.
 *
 *  1. users.role gains 'redeem_ops' — dedicated internal ops staff. Deliberately a NEW
 *     enum value so these users are invisible to every existing requireRole gate, to
 *     agent-sync sweeps (scoped to role='agent'), and to lead routing.
 *  2. users."redeemOpsRole" — nullable sub-role read by the capability map
 *     (services/redeemOps/permissions.js). NULL = no Redeem Ops access; role='admin'
 *     is an implicit super_admin in middleware regardless of this column.
 *  3. redeem_ops_audit_events — append-only audit trail for the redeem-ops module
 *     (the platform has no generic audit infra; REPOSITORY_DISCOVERY.md §6).
 *
 * ADD VALUE IF NOT EXISTS requires PG 12+ (migration 029 precedent). The runner applies
 * migrations non-transactionally (runMigrations.js), so every step below is guarded to
 * be idempotent-safe across a partial re-run. In NODE_ENV=test, sequelize.sync() creates
 * everything from the models first and each guard no-ops.
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.sequelize.query(
    `ALTER TYPE "enum_users_role" ADD VALUE IF NOT EXISTS 'redeem_ops'`
  );

  const usersTable = await queryInterface.describeTable('users');
  if (!usersTable.redeemOpsRole) {
    await queryInterface.addColumn('users', 'redeemOpsRole', {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
  }

  const tables = await queryInterface.showAllTables();
  if (!tables.includes('redeem_ops_audit_events')) {
    await queryInterface.createTable('redeem_ops_audit_events', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      actorUserId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      // staff | agent | partner_user | consumer | system (ERD.md §3.19)
      actorType: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'staff' },
      // dot-namespaced, e.g. access.role_granted, partner.claimed
      action: { type: Sequelize.STRING(64), allowNull: false },
      entityType: { type: Sequelize.STRING(32), allowNull: false },
      entityId: { type: Sequelize.UUID, allowNull: true },
      before: { type: Sequelize.JSONB, allowNull: true },
      after: { type: Sequelize.JSONB, allowNull: true },
      reason: { type: Sequelize.STRING(255), allowNull: true },
      requestId: { type: Sequelize.STRING(64), allowNull: true },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
  }

  // Indexes OUTSIDE the table-exists branch (Codex review): the runner is
  // non-transactional, so a crash between createTable and an index must not
  // leave a rerun that skips index creation. IF NOT EXISTS makes each step
  // independently idempotent.
  await queryInterface.sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_roae_entity ON redeem_ops_audit_events ("entityType", "entityId", "createdAt")'
  );
  await queryInterface.sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_roae_actor ON redeem_ops_audit_events ("actorUserId", "createdAt")'
  );
  await queryInterface.sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_roae_action ON redeem_ops_audit_events ("action", "createdAt")'
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS redeem_ops_audit_events CASCADE');
  const usersTable = await queryInterface.describeTable('users');
  if (usersTable.redeemOpsRole) {
    await queryInterface.removeColumn('users', 'redeemOpsRole');
  }
  // Postgres cannot remove an enum value without recreating the type; the
  // 'redeem_ops' role value stays as a harmless no-op (029 precedent).
}
