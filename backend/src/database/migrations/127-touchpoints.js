/**
 * 127 — touchpoints (+ erased_session_sweeps): cross-channel touchpoint
 * history (ads-centralisation §4.1). Every allow-listed customer-surface
 * visit leaves one append-only session-keyed row; first/last/multi-touch
 * become SQL joins against prospects."sessionId" (session EVIDENCE, not
 * identity truth — §4). The sid is never authorization material.
 *
 * erased_session_sweeps makes erasure durable against in-flight beacons: the
 * erasure txn deletes the person's touchpoints AND upserts a 24h sweep row;
 * the purge tick re-deletes under the same per-sid advisory lock the beacon
 * insert takes, so a beacon that raced the erasure cannot survive it.
 */

export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('touchpoints', {
    id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true },
    sessionId: { type: Sequelize.STRING(64), allowNull: false },
    occurredAt: { type: Sequelize.DATE, allowNull: false },
    surface: { type: Sequelize.STRING(24), allowNull: false },
    landingPath: { type: Sequelize.STRING(512), allowNull: true },
    // ORIGIN only — the full referrer URL is parsed and discarded server-side.
    referrerOrigin: { type: Sequelize.STRING(255), allowNull: true },
    campaignId: {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'campaigns', key: 'id' },
      onDelete: 'SET NULL',
    },
    utmSource: { type: Sequelize.STRING(128), allowNull: true },
    utmMedium: { type: Sequelize.STRING(128), allowNull: true },
    utmCampaign: { type: Sequelize.STRING(190), allowNull: true },
    utmTerm: { type: Sequelize.STRING(190), allowNull: true },
    utmContent: { type: Sequelize.STRING(190), allowNull: true },
    fbclid: { type: Sequelize.STRING(512), allowNull: true },
    ttclid: { type: Sequelize.STRING(512), allowNull: true },
    gclid: { type: Sequelize.STRING(512), allowNull: true },
    gbraid: { type: Sequelize.STRING(512), allowNull: true },
    wbraid: { type: Sequelize.STRING(512), allowNull: true },
    createdAt: { type: Sequelize.DATE, allowNull: false },
    updatedAt: { type: Sequelize.DATE, allowNull: false },
  });
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_tp_session_time ON touchpoints ("sessionId", "occurredAt")`
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_tp_occurred ON touchpoints ("occurredAt")`
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE touchpoints ADD CONSTRAINT chk_tp_surface CHECK (surface IN ('leadcapture','offer','flow','browse'))`
  );

  await queryInterface.createTable('erased_session_sweeps', {
    sessionId: { type: Sequelize.STRING(64), primaryKey: true },
    sweepUntil: { type: Sequelize.DATE, allowNull: false },
    createdAt: { type: Sequelize.DATE, allowNull: false },
    updatedAt: { type: Sequelize.DATE, allowNull: false },
  });
}

export async function down(queryInterface) {
  await queryInterface.dropTable('erased_session_sweeps');
  await queryInterface.dropTable('touchpoints');
}
