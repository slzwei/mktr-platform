/**
 * Phase 2 schema changes for the agent integration plan.
 *
 *   1. users.email becomes nullable
 *      Lyfe agents authenticate via phone OTP and frequently have no email.
 *      Pre-Phase-2 we synthesised `lyfe_<uuid>@placeholder.local` to satisfy
 *      a NOT NULL constraint — that synthetic value leaked into UIs and
 *      exports. Allowing NULL lets the orchestrator stop fabricating values.
 *
 *   2. users.external_role: text NULL
 *      The orchestrator currently collapses Lyfe roles {director, manager,
 *      agent} into local role='agent'. external_role preserves the upstream
 *      role for read-side filtering (e.g., "show only directors") without
 *      touching MKTR's internal permission model (which keeps using `role`).
 *
 *   3. users.pending_deletion_at: timestamp NULL
 *      Two-phase delete grace window. Sync flips this to NOW() when an
 *      external agent disappears AND has no attached prospects/leads.
 *      A subsequent sync 24h+ later confirms still gone, then hard-deletes.
 *      If they reappear, sync clears pending_deletion_at.
 *
 * All three columns are additive and nullable — safe rollback.
 *
 * IMPORTANT: deploy the orchestrator code that reads/writes external_role
 * BEFORE running this migration. Old code reading users will simply ignore
 * the new column.
 */
export async function up(queryInterface, Sequelize) {
  // 1. Make email nullable (was NOT NULL pre-migration)
  await queryInterface
    .changeColumn('users', 'email', {
      type: Sequelize.DataTypes.STRING,
      allowNull: true,
    })
    .catch((err) => {
      // changeColumn on Postgres may fail if there are dependent objects;
      // tolerate and log.
      console.warn('[migration 025] could not relax users.email NOT NULL:', err?.message);
    });

  // 2. external_role
  await queryInterface
    .addColumn('users', 'external_role', {
      type: Sequelize.DataTypes.STRING(32),
      allowNull: true,
    })
    .catch(() => {});

  await queryInterface
    .addIndex('users', ['external_role'], {
      name: 'users_external_role_idx',
      where: { external_role: { [Sequelize.Op.ne]: null } },
    })
    .catch(() => {});

  // 3. pending_deletion_at — two-phase delete grace window
  await queryInterface
    .addColumn('users', 'pending_deletion_at', {
      type: Sequelize.DataTypes.DATE,
      allowNull: true,
    })
    .catch(() => {});

  await queryInterface
    .addIndex('users', ['pending_deletion_at'], {
      name: 'users_pending_deletion_at_idx',
      where: { pending_deletion_at: { [Sequelize.Op.ne]: null } },
    })
    .catch(() => {});
}

export async function down(queryInterface, Sequelize) {
  await queryInterface.removeIndex('users', 'users_pending_deletion_at_idx').catch(() => {});
  await queryInterface.removeColumn('users', 'pending_deletion_at').catch(() => {});

  await queryInterface.removeIndex('users', 'users_external_role_idx').catch(() => {});
  await queryInterface.removeColumn('users', 'external_role').catch(() => {});

  // Note: re-tightening email to NOT NULL is intentionally a no-op here.
  // After this migration runs, real users will have NULL emails. Reversing
  // would require a backfill strategy — leave email nullable on rollback.
}
