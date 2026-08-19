/**
 * 126 — platform_deliveries: the durable Meta/TikTok conversion-delivery
 * outbox (ads-centralisation §3.1). One row = one (prospect, platform,
 * eventKey) delivery obligation, planned in the capture / outcome-fact
 * transaction and drained by inline dispatch + the delivery worker.
 * At-least-once with provider event-id dedupe; deadlines are anchored on
 * dedupeAnchorAt (per-key) and firstWireAt (provider dedupe window).
 *
 * Pseudonymous personal data: rows join to a person via prospectId — they are
 * hard-deleted in the erasure transaction (erasureService matrix) and
 * terminal rows are purged after PLATFORM_DELIVERY_RETENTION_DAYS.
 */

export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('platform_deliveries', {
    id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true },
    prospectId: {
      type: Sequelize.UUID,
      allowNull: false,
      references: { model: 'prospects', key: 'id' },
      onDelete: 'CASCADE',
    },
    platform: { type: Sequelize.STRING(16), allowNull: false },
    eventKey: { type: Sequelize.STRING(32), allowNull: false },
    eventId: { type: Sequelize.STRING(64), allowNull: false },
    // Occurrence time (CReg: the browser reveal timestamp when supplied).
    eventTime: { type: Sequelize.DATE, allowNull: false },
    // §1.3 anchor for the deadline formula (capture / reveal ts / fact time).
    dedupeAnchorAt: { type: Sequelize.DATE, allowNull: false },
    // Destination snapshot; set at planning when resolvable; immutable once non-null.
    pixelId: { type: Sequelize.STRING(64), allowNull: true },
    state: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'pending' },
    // RESERVED wire attempts — incremented by the pre-wire reservation CAS.
    sendAttempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
    nextAttemptAt: { type: Sequelize.DATE, allowNull: true },
    claimedAt: { type: Sequelize.DATE, allowNull: true },
    claimToken: { type: Sequelize.UUID, allowNull: true },
    firstWireAt: { type: Sequelize.DATE, allowNull: true },
    lastAttemptAt: { type: Sequelize.DATE, allowNull: true },
    sentAt: { type: Sequelize.DATE, allowNull: true },
    lastStatus: { type: Sequelize.INTEGER, allowNull: true },
    errorCode: { type: Sequelize.STRING(64), allowNull: true },
    providerRequestId: { type: Sequelize.STRING(128), allowNull: true },
    createdAt: { type: Sequelize.DATE, allowNull: false },
    updatedAt: { type: Sequelize.DATE, allowNull: false },
  });
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_pd_prospect_platform_event ON platform_deliveries ("prospectId", platform, "eventKey")`
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_pd_due ON platform_deliveries ("nextAttemptAt") WHERE state IN ('retry_wait','config_blocked')`
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_pd_pending ON platform_deliveries ("createdAt") WHERE state = 'pending'`
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_pd_stale ON platform_deliveries ("claimedAt") WHERE state = 'sending'`
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_pd_sent ON platform_deliveries (platform, "sentAt")`
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_pd_prospect ON platform_deliveries ("prospectId")`
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE platform_deliveries ADD CONSTRAINT chk_pd_platform CHECK (platform IN ('meta','tiktok'))`
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE platform_deliveries ADD CONSTRAINT chk_pd_state CHECK (state IN
       ('pending','sending','sent','retry_wait','config_blocked','failed_permanent','expired','skipped'))`
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE platform_deliveries ADD CONSTRAINT chk_pd_event CHECK ("eventKey" IN
       ('lead','complete_registration','confirmed_resident','closed_won'))`
  );
}

export async function down(queryInterface) {
  await queryInterface.dropTable('platform_deliveries');
}
