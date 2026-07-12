/**
 * Redeem Ops cadences P1 — schema ONLY (docs/plans/redeem-ops-cadences.md §4).
 * Definitions are seeded by bootstrap.ensureCadences AFTER initSystemAgent
 * (migrations run before the system agent exists, so a migration seed could
 * never satisfy createdBy NOT NULL on a fresh database).
 *
 * Guarded for partial re-runs and NODE_ENV=test sync-first, like 045-053.
 */
export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();
  const UUID = Sequelize.UUID;
  const ts = () => ({
    createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
  });

  if (!tables.includes('outreach_cadences')) {
    await queryInterface.createTable('outreach_cadences', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      key: { type: Sequelize.STRING(64), allowNull: false },
      version: { type: Sequelize.INTEGER, allowNull: false },
      name: { type: Sequelize.STRING(120), allowNull: false },
      description: { type: Sequelize.TEXT },
      targetCategory: { type: Sequelize.STRING(64) },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdBy: { type: UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      ...ts(),
    });
  }

  if (!tables.includes('outreach_cadence_steps')) {
    await queryInterface.createTable('outreach_cadence_steps', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      cadenceId: { type: UUID, allowNull: false, references: { model: 'outreach_cadences', key: 'id' }, onDelete: 'RESTRICT' },
      stepOrder: { type: Sequelize.INTEGER, allowNull: false },
      channel: { type: Sequelize.STRING(24), allowNull: false },
      mode: { type: Sequelize.STRING(12), allowNull: false, defaultValue: 'manual' },
      title: { type: Sequelize.STRING(160), allowNull: false },
      scriptTemplate: { type: Sequelize.TEXT },
      priority: { type: Sequelize.STRING(12), allowNull: false, defaultValue: 'medium' },
      ...ts(),
    });
  }

  if (!tables.includes('outreach_cadence_transitions')) {
    await queryInterface.createTable('outreach_cadence_transitions', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      cadenceId: { type: UUID, allowNull: false, references: { model: 'outreach_cadences', key: 'id' }, onDelete: 'RESTRICT' },
      // NULL = entry edge (enrollment start)
      fromStepId: { type: UUID, references: { model: 'outreach_cadence_steps', key: 'id' }, onDelete: 'RESTRICT' },
      disposition: { type: Sequelize.STRING(24), allowNull: false },
      // NULL toStepId + NULL terminalAction = finish
      toStepId: { type: UUID, references: { model: 'outreach_cadence_steps', key: 'id' }, onDelete: 'RESTRICT' },
      terminalAction: { type: Sequelize.STRING(24) },
      delayDays: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      timeWindow: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'any' },
      ...ts(),
    });
  }

  if (!tables.includes('outreach_cadence_enrollments')) {
    await queryInterface.createTable('outreach_cadence_enrollments', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      cadenceId: { type: UUID, allowNull: false, references: { model: 'outreach_cadences', key: 'id' }, onDelete: 'RESTRICT' },
      partnerOrganisationId: { type: UUID, allowNull: false, references: { model: 'partner_organisations', key: 'id' }, onDelete: 'CASCADE' },
      state: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'active' },
      currentStepId: { type: UUID, references: { model: 'outreach_cadence_steps', key: 'id' }, onDelete: 'RESTRICT' },
      lastDisposition: { type: Sequelize.STRING(24) },
      exitReason: { type: Sequelize.STRING(32) },
      enrolledBy: { type: UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      pausedAt: { type: Sequelize.DATE },
      endedAt: { type: Sequelize.DATE },
      ...ts(),
    });
  }

  if (!tables.includes('outreach_suppressions')) {
    await queryInterface.createTable('outreach_suppressions', {
      id: { type: UUID, primaryKey: true, allowNull: false },
      channel: { type: Sequelize.STRING(24), allowNull: false },
      value: { type: Sequelize.STRING(160), allowNull: false },
      reason: { type: Sequelize.STRING(32), allowNull: false },
      source: { type: Sequelize.STRING(32) },
      expiresAt: { type: Sequelize.DATE },
      ...ts(),
    });
  }

  // outreach_tasks provenance columns — per-column guards (047 pattern).
  const taskCols = await queryInterface.describeTable('outreach_tasks');
  if (!taskCols.cadenceEnrollmentId) {
    // NO ACTION (not RESTRICT): checked at statement end, so a partner-delete
    // cascade that removes both enrollments and tasks still succeeds, while a
    // direct enrollment delete with live tasks is refused.
    await queryInterface.addColumn('outreach_tasks', 'cadenceEnrollmentId', {
      type: UUID, references: { model: 'outreach_cadence_enrollments', key: 'id' },
    });
  }
  if (!taskCols.cadenceStepId) {
    await queryInterface.addColumn('outreach_tasks', 'cadenceStepId', {
      type: UUID, references: { model: 'outreach_cadence_steps', key: 'id' },
    });
  }
  if (!taskCols.snapshotRecipient) {
    await queryInterface.addColumn('outreach_tasks', 'snapshotRecipient', { type: Sequelize.STRING(160) });
  }

  // Indexes — always-run IF NOT EXISTS (runner is non-transactional; 045/047 pattern).
  const idx = (sql) => queryInterface.sequelize.query(sql);
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_oc_key_version ON outreach_cadences ("key", "version")');
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_ocs_cadence_order ON outreach_cadence_steps ("cadenceId", "stepOrder")');
  await idx(`CREATE UNIQUE INDEX IF NOT EXISTS uq_oct_from_dispo ON outreach_cadence_transitions ("fromStepId", "disposition") WHERE "fromStepId" IS NOT NULL`);
  await idx(`CREATE UNIQUE INDEX IF NOT EXISTS uq_oct_entry ON outreach_cadence_transitions ("cadenceId", "disposition") WHERE "fromStepId" IS NULL`);
  await idx(`CREATE UNIQUE INDEX IF NOT EXISTS uq_oce_live_partner ON outreach_cadence_enrollments ("partnerOrganisationId") WHERE "state" IN ('active', 'paused')`);
  await idx('CREATE INDEX IF NOT EXISTS idx_oce_state_updated ON outreach_cadence_enrollments ("state", "updatedAt")');
  await idx(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ot_open_per_enrollment ON outreach_tasks ("cadenceEnrollmentId") WHERE "cadenceEnrollmentId" IS NOT NULL AND "status" IN ('open', 'in_progress')`);
  await idx(`CREATE INDEX IF NOT EXISTS idx_ot_cadence_enrollment ON outreach_tasks ("cadenceEnrollmentId") WHERE "cadenceEnrollmentId" IS NOT NULL`);
  await idx('CREATE UNIQUE INDEX IF NOT EXISTS uq_osup_channel_value ON outreach_suppressions ("channel", "value")');

  // Structural CHECKs (prod backstops; NODE_ENV=test sync-first skips these —
  // the service enforces the same invariants and tests cover them).
  const check = (name, table, expr) => queryInterface.sequelize.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
        ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expr});
      END IF;
    END $$;`);
  await check('ck_ocs_step_order_min', 'outreach_cadence_steps', '"stepOrder" >= 1');
  await check('ck_oct_delay_min', 'outreach_cadence_transitions', '"delayDays" >= 0');
  await check('ck_ot_cadence_pair', 'outreach_tasks', '("cadenceEnrollmentId" IS NULL) = ("cadenceStepId" IS NULL)');
}

export async function down(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);
  await q('ALTER TABLE outreach_tasks DROP CONSTRAINT IF EXISTS ck_ot_cadence_pair');
  await q('ALTER TABLE outreach_tasks DROP COLUMN IF EXISTS "cadenceEnrollmentId"');
  await q('ALTER TABLE outreach_tasks DROP COLUMN IF EXISTS "cadenceStepId"');
  await q('ALTER TABLE outreach_tasks DROP COLUMN IF EXISTS "snapshotRecipient"');
  for (const table of [
    'outreach_suppressions', 'outreach_cadence_enrollments',
    'outreach_cadence_transitions', 'outreach_cadence_steps', 'outreach_cadences',
  ]) {
    await q(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
}
