/**
 * 120 — the auto-send outbox + engine columns (Phase B,
 * docs/plans/redeem-ops-cadence-email-autosend.md §3/§4).
 *
 * `outreach_emails` is a durable outbox cloned from the webhook_deliveries
 * retry shape: rows are claimed atomically (queued→sending), retried via
 * nextAttemptAt, reclaimed if a crash strands them in `sending`. It stores
 * ROUTING + idempotency only — the body/subject that actually send are read
 * from the TASK at send time (single source of truth; an accepted edit is
 * guaranteed to be the text that sends), and the sent copy is written back
 * after the fact for the record.
 *
 * Engine columns: steps gain subjectTemplate (required for mode='auto');
 * enrollments remember their Gmail thread (follow-ups join it, replies match
 * it); tasks carry the rendered, EDITABLE subject; partners can opt out of
 * machine-timed email entirely; cadences count approved sends (the
 * first-N-per-version approval ramp).
 */

export async function up(queryInterface, Sequelize) {
  const tables = await queryInterface.showAllTables();

  if (!tables.includes('outreach_emails')) {
    await queryInterface.createTable('outreach_emails', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      taskId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'outreach_tasks', key: 'id' },
        onDelete: 'CASCADE',
      },
      cadenceEnrollmentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'outreach_cadence_enrollments', key: 'id' },
        onDelete: 'CASCADE',
      },
      partnerOrganisationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'partner_organisations', key: 'id' },
        onDelete: 'CASCADE',
      },
      contactId: { type: Sequelize.UUID, allowNull: true },
      personaId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'outreach_personas', key: 'id' },
        onDelete: 'SET NULL',
      },
      accountId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'outreach_accounts', key: 'id' },
        onDelete: 'SET NULL',
      },
      toAddress: { type: Sequelize.STRING(160), allowNull: false },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'queued' },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      nextAttemptAt: { type: Sequelize.DATE, allowNull: true },
      approvedBy: { type: Sequelize.UUID, allowNull: true },
      approvedAt: { type: Sequelize.DATE, allowNull: true },
      holdReason: { type: Sequelize.STRING(64), allowNull: true },
      wireMessageId: { type: Sequelize.STRING(320), allowNull: true },
      gmailMessageId: { type: Sequelize.STRING(32), allowNull: true },
      gmailThreadId: { type: Sequelize.STRING(32), allowNull: true },
      sentSubject: { type: Sequelize.STRING(220), allowNull: true },
      sentBody: { type: Sequelize.TEXT, allowNull: true },
      lastError: { type: Sequelize.TEXT, allowNull: true },
      sentAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_oe_live_task ON outreach_emails ("taskId")
        WHERE status IN ('queued', 'needs_approval', 'sending')`
    );
    await queryInterface.sequelize.query(
      'CREATE INDEX IF NOT EXISTS idx_oe_status_next ON outreach_emails (status, "nextAttemptAt")'
    );
  }

  await queryInterface.sequelize.query(
    'ALTER TABLE outreach_cadence_steps ADD COLUMN IF NOT EXISTS "subjectTemplate" VARCHAR(160)'
  );
  await queryInterface.sequelize.query(
    'ALTER TABLE outreach_cadence_enrollments ADD COLUMN IF NOT EXISTS "gmailThreadId" VARCHAR(32)'
  );
  await queryInterface.sequelize.query(
    'ALTER TABLE outreach_cadence_enrollments ADD COLUMN IF NOT EXISTS "gmailThreadSubject" VARCHAR(220)'
  );
  await queryInterface.sequelize.query(
    'ALTER TABLE outreach_tasks ADD COLUMN IF NOT EXISTS "emailSubject" VARCHAR(220)'
  );
  await queryInterface.sequelize.query(
    'ALTER TABLE partner_organisations ADD COLUMN IF NOT EXISTS "autoEmailOptOut" BOOLEAN NOT NULL DEFAULT false'
  );
  await queryInterface.sequelize.query(
    'ALTER TABLE outreach_cadences ADD COLUMN IF NOT EXISTS "autoSendApprovals" INTEGER NOT NULL DEFAULT 0'
  );
}

export async function down(queryInterface) {
  await queryInterface.dropTable('outreach_emails');
  await queryInterface.sequelize.query('ALTER TABLE outreach_cadence_steps DROP COLUMN IF EXISTS "subjectTemplate"');
  await queryInterface.sequelize.query('ALTER TABLE outreach_cadence_enrollments DROP COLUMN IF EXISTS "gmailThreadId"');
  await queryInterface.sequelize.query('ALTER TABLE outreach_cadence_enrollments DROP COLUMN IF EXISTS "gmailThreadSubject"');
  await queryInterface.sequelize.query('ALTER TABLE outreach_tasks DROP COLUMN IF EXISTS "emailSubject"');
  await queryInterface.sequelize.query('ALTER TABLE partner_organisations DROP COLUMN IF EXISTS "autoEmailOptOut"');
  await queryInterface.sequelize.query('ALTER TABLE outreach_cadences DROP COLUMN IF EXISTS "autoSendApprovals"');
}
