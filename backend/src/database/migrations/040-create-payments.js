/**
 * Migration 040 — create payments.
 *
 * Immutable financial records for agent lead-package purchases (HitPay one-time
 * checkout). FKs are ON DELETE SET NULL (never CASCADE) so a deleted agent /
 * package / assignment never erases a payment — the snapshots on the row preserve
 * the audit. Partial unique indexes on the HitPay provider ids (and the linked
 * assignment) ensure one request / payment / grant maps to at most one row.
 *
 * This is a CRITICAL financial table, so DDL errors are NOT blanket-swallowed: only
 * "already exists" (idempotent re-run) is ignored — any other failure re-throws so
 * the runner never records a half-applied migration as done. A post-up assertion
 * verifies the table + the unique guards actually exist.
 */
function ignoreExists(e) {
  const msg = String(e?.message || e || '');
  if (!/already exists|duplicate/i.test(msg)) throw e;
}

export async function up(queryInterface, Sequelize) {
  const { DataTypes } = Sequelize;

  await queryInterface
    .createTable('payments', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      agentId: {
        type: DataTypes.UUID, allowNull: true,
        references: { model: 'users', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE',
      },
      leadPackageId: {
        type: DataTypes.UUID, allowNull: true,
        references: { model: 'lead_packages', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE',
      },
      leadPackageAssignmentId: {
        type: DataTypes.UUID, allowNull: true,
        references: { model: 'lead_package_assignments', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE',
      },
      provider: { type: DataTypes.STRING, allowNull: false, defaultValue: 'hitpay' },
      providerRequestId: { type: DataTypes.STRING, allowNull: true },
      providerPaymentId: { type: DataTypes.STRING, allowNull: true },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'SGD' },
      leadCount: { type: DataTypes.INTEGER, allowNull: false },
      packageName: { type: DataTypes.STRING, allowNull: true },
      campaignName: { type: DataTypes.STRING, allowNull: true },
      status: {
        type: DataTypes.ENUM('pending', 'paid', 'failed', 'expired', 'refunded', 'comp'),
        allowNull: false, defaultValue: 'pending',
      },
      source: {
        type: DataTypes.ENUM('mktr_leads_app', 'web', 'admin_comp'),
        allowNull: false, defaultValue: 'mktr_leads_app',
      },
      rawWebhook: { type: DataTypes.JSON, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    })
    .catch(ignoreExists);

  await queryInterface.addIndex('payments', ['agentId', 'status'], { name: 'idx_payments_agent_status' }).catch(ignoreExists);
  await queryInterface.addIndex('payments', ['status'], { name: 'idx_payments_status' }).catch(ignoreExists);
  await queryInterface
    .addIndex('payments', ['providerRequestId'], {
      unique: true, name: 'uniq_payments_provider_request',
      where: Sequelize.literal('"providerRequestId" IS NOT NULL'),
    })
    .catch(ignoreExists);
  await queryInterface
    .addIndex('payments', ['providerPaymentId'], {
      unique: true, name: 'uniq_payments_provider_payment',
      where: Sequelize.literal('"providerPaymentId" IS NOT NULL'),
    })
    .catch(ignoreExists);
  // One assignment ↔ at most one payment (belt-and-suspenders on the row-lock idempotency).
  await queryInterface
    .addIndex('payments', ['leadPackageAssignmentId'], {
      unique: true, name: 'uniq_payments_assignment',
      where: Sequelize.literal('"leadPackageAssignmentId" IS NOT NULL'),
    })
    .catch(ignoreExists);

  // Post-assertion — money table: fail loudly rather than record a half-applied migration.
  const [tblRows] = await queryInterface.sequelize.query("SELECT to_regclass('public.payments') AS t");
  if (!tblRows?.[0]?.t) throw new Error('migration 040: payments table was not created');
  const [idxRows] = await queryInterface.sequelize.query(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'payments'
       AND indexname IN ('uniq_payments_provider_request', 'uniq_payments_provider_payment')`,
  );
  if (!Array.isArray(idxRows) || idxRows.length < 2) {
    throw new Error('migration 040: provider-id unique indexes were not created');
  }
}

export async function down(queryInterface) {
  await queryInterface.dropTable('payments').catch(() => {});
  // Postgres ENUM types persist after dropTable — drop them so a re-run recreates cleanly.
  for (const t of ['enum_payments_status', 'enum_payments_source']) {
    await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "${t}"`).catch(() => {});
  }
}
