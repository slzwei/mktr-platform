/**
 * 128 — audience_removals + audience_destination_state: the durable audience
 * removal outbox and the per-destination settlement watermark
 * (ads-centralisation §5.1/§5.5).
 *
 * audience_removals: one row = one person × one destination = one provider
 * request per submission. `identifiers` holds PLATFORM-NORMALIZED HASHES
 * ONLY (never raw email/phone), blanked to '[]' once the removal confirms.
 * States walk the §5.5 transition table; nothing terminal is ever silent —
 * a row that can't confirm ages into needs_manual_action for the ops queue.
 *
 * audience_destination_state: exactly one row per (platform, destination).
 * `oldestUnsettledAcceptAt` is the §5.1 settlement watermark: a removal may
 * dispatch ONLY while it is NULL (zero unsettled additive ingests for that
 * destination) — strictly conservative, no timestamp reasoning.
 */

export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('audience_removals', {
    id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true },
    platform: { type: Sequelize.STRING(16), allowNull: false },
    destinationId: { type: Sequelize.STRING(64), allowNull: false },
    // PLATFORM-NORMALIZED HASHES ONLY; '[]' once blanked.
    identifiers: { type: Sequelize.JSONB, allowNull: false },
    sourceKey: { type: Sequelize.STRING(120), allowNull: false },
    // Edit-removals: drives the §5.1 additive-selection suppression.
    subjectProspectId: { type: Sequelize.UUID, allowNull: true },
    state: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
    submitAttempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
    nextAttemptAt: { type: Sequelize.DATE, allowNull: true },
    claimedAt: { type: Sequelize.DATE, allowNull: true },
    claimToken: { type: Sequelize.UUID, allowNull: true },
    providerRequestId: { type: Sequelize.STRING(128), allowNull: true },
    confirmedAt: { type: Sequelize.DATE, allowNull: true },
    resolvedBy: { type: Sequelize.UUID, allowNull: true },
    resolvedAt: { type: Sequelize.DATE, allowNull: true },
    resolutionNote: { type: Sequelize.STRING(500), allowNull: true },
    errorCode: { type: Sequelize.STRING(64), allowNull: true },
    createdAt: { type: Sequelize.DATE, allowNull: false },
    updatedAt: { type: Sequelize.DATE, allowNull: false },
  });
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_source_platform_dest ON audience_removals ("sourceKey", platform, "destinationId")`
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_ar_due ON audience_removals ("nextAttemptAt") WHERE state IN ('pending','retry_wait','accepted')`
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_ar_stale ON audience_removals ("claimedAt") WHERE state = 'sending'`
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE audience_removals ADD CONSTRAINT chk_ar_platform CHECK (platform IN ('meta','google','tiktok'))`
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE audience_removals ADD CONSTRAINT chk_ar_state CHECK (state IN
       ('pending','sending','accepted','confirmed','retry_wait','needs_manual_action','manually_resolved'))`
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE audience_removals ADD CONSTRAINT chk_ar_confirmed CHECK
       ("confirmedAt" IS NULL OR state IN ('confirmed','manually_resolved'))`
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE audience_removals ADD CONSTRAINT chk_ar_blanked CHECK
       (identifiers <> '[]'::jsonb OR state IN ('confirmed','manually_resolved'))`
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE audience_removals ADD CONSTRAINT chk_ar_resolved CHECK
       (state <> 'manually_resolved' OR ("resolvedBy" IS NOT NULL AND "resolvedAt" IS NOT NULL AND "resolutionNote" IS NOT NULL))`
  );

  await queryInterface.createTable('audience_destination_state', {
    platform: { type: Sequelize.STRING(16), allowNull: false },
    destinationId: { type: Sequelize.STRING(64), allowNull: false },
    lastIngestAcceptedAt: { type: Sequelize.DATE, allowNull: true },
    // NULL = all accepted ingests settled (the removal-dispatch gate).
    oldestUnsettledAcceptAt: { type: Sequelize.DATE, allowNull: true },
    createdAt: { type: Sequelize.DATE, allowNull: false },
    updatedAt: { type: Sequelize.DATE, allowNull: false },
  });
  await queryInterface.sequelize.query(
    `ALTER TABLE audience_destination_state ADD PRIMARY KEY (platform, "destinationId")`
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE audience_destination_state ADD CONSTRAINT chk_ads_platform CHECK (platform IN ('meta','google','tiktok'))`
  );
}

export async function down(queryInterface) {
  await queryInterface.dropTable('audience_destination_state');
  await queryInterface.dropTable('audience_removals');
}
