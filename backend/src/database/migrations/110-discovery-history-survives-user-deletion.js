/**
 * 110 — paid discovery history survives operator deletion (M11).
 *
 * discovery_runs.createdBy was NOT NULL + ON DELETE CASCADE (053), and
 * candidates cascade from each run — permanently deleting a former operator
 * erased provider run ids, actual/estimated costs, raw results, candidate
 * provenance, and the per-user quota history rows. Operational/audit history
 * has to outlive the account that produced it (same policy as 102/105/108).
 *
 * createdBy becomes nullable with ON DELETE SET NULL, and createdByEmail is
 * added as the immutable creator-identity snapshot (backfilled from users,
 * stamped by the service on every new run).
 */

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.query('ALTER TABLE discovery_runs ADD COLUMN IF NOT EXISTS "createdByEmail" VARCHAR(160)');
  await sequelize.query(`
    UPDATE discovery_runs r SET "createdByEmail" = u.email
      FROM users u
     WHERE u.id = r."createdBy" AND r."createdByEmail" IS NULL
  `);

  await sequelize.query('ALTER TABLE discovery_runs ALTER COLUMN "createdBy" DROP NOT NULL');

  // resetFK pattern (014): whatever the current constraint is, re-assert SET NULL.
  const name = 'discovery_runs_createdBy_fkey';
  await queryInterface.removeConstraint('discovery_runs', name).catch(() => {});
  await queryInterface.removeConstraint('discovery_runs', 'discovery_runs_createdBy_users_fk').catch(() => {});
  await sequelize.query(`
    ALTER TABLE discovery_runs ADD CONSTRAINT "${name}"
    FOREIGN KEY ("createdBy") REFERENCES users(id)
    ON DELETE SET NULL NOT VALID
  `);
  await sequelize.query(`ALTER TABLE discovery_runs VALIDATE CONSTRAINT "${name}"`);
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize;
  // Orphaned history cannot re-acquire a NOT NULL owner — remove it before
  // restoring the old shape.
  await sequelize.query('DELETE FROM discovery_runs WHERE "createdBy" IS NULL');
  await sequelize.query('ALTER TABLE discovery_runs ALTER COLUMN "createdBy" SET NOT NULL');
  const name = 'discovery_runs_createdBy_fkey';
  await queryInterface.removeConstraint('discovery_runs', name).catch(() => {});
  await sequelize.query(`
    ALTER TABLE discovery_runs ADD CONSTRAINT "${name}"
    FOREIGN KEY ("createdBy") REFERENCES users(id)
    ON DELETE CASCADE
  `);
  await sequelize.query('ALTER TABLE discovery_runs DROP COLUMN IF EXISTS "createdByEmail"');
}
