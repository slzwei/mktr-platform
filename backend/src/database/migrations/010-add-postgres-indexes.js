/**
 * Replaces the runtime ensurePostgresIndexes() function from bootstrap.js.
 * Adds ENUM value, partial unique indexes for qr_tags and prospects.
 * All operations are idempotent — safe to re-run.
 */
export async function up(queryInterface, sequelize) {
  // 1. Add 'call_bot' to the prospects leadSource ENUM
  await queryInterface.sequelize.query(`
    ALTER TYPE "enum_prospects_leadSource" ADD VALUE IF NOT EXISTS 'call_bot'
  `).catch(() => {});

  // 2. Unique partial index: one QR tag per car
  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_car_qr
    ON qr_tags("carId") WHERE type = 'car'
  `).catch(() => {});

  // 3. Unique partial index: one prospect per (campaignId, phone)
  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS prospects_campaign_id_phone
    ON prospects ("campaignId", phone)
    WHERE phone IS NOT NULL AND phone <> ''
  `).catch(() => {});

  // 4. Unique partial index: one prospect per retellCallId
  await queryInterface.sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS prospects_retell_call_id
    ON prospects ("retellCallId")
    WHERE "retellCallId" IS NOT NULL
  `).catch(() => {});
}

export async function down(queryInterface) {
  // NOTE: Postgres does not support removing a value from an ENUM.
  // The 'call_bot' value will remain in enum_prospects_leadSource.

  await queryInterface.sequelize.query(`
    DROP INDEX IF EXISTS prospects_retell_call_id
  `).catch(() => {});

  await queryInterface.sequelize.query(`
    DROP INDEX IF EXISTS prospects_campaign_id_phone
  `).catch(() => {});

  await queryInterface.sequelize.query(`
    DROP INDEX IF EXISTS uniq_car_qr
  `).catch(() => {});
}
