/**
 * 090 — WhatsApp delivery-status inbox (docs/plans/wa-delivery-truth.md).
 *
 * Meta reports per-message outcomes (sent/delivered/read/failed — including
 * the silent 131049 marketing-frequency-cap drop this plan exists for) ONLY
 * via a status webhook, and each transition only once. This table is the
 * durable inbox those callbacks commit into BEFORE the webhook answers 200 —
 * readers join it by wamid (redemption_events metadata.messageId) at read
 * time, so receipt rows are never mutated and a status that arrives before
 * its receipt commits still surfaces. recipientHash (sha256 of the E.164
 * recipient, no raw phone) exists solely so PDPA erasure can delete a
 * person's rows.
 */
export async function up(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);

  await q(`CREATE TABLE IF NOT EXISTS wa_message_statuses (
    wamid VARCHAR(128) PRIMARY KEY,
    status VARCHAR(16) NOT NULL,
    "errorCode" VARCHAR(16),
    "errorTitle" VARCHAR(200),
    "recipientHash" VARCHAR(64),
    "occurredAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await q(`CREATE INDEX IF NOT EXISTS idx_wms_recipient_hash
    ON wa_message_statuses ("recipientHash")`);
}

export async function down(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);
  await q('DROP TABLE IF EXISTS wa_message_statuses');
}
