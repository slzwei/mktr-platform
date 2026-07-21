/**
 * 083 — Durable rate counters, backing the SMS abuse controls.
 *
 * Context: SGNIC's SSIR advisory (21 Jul 2026) requires SSIR Users to make
 * "reasonable efforts" to ensure a registered Sender ID is not used for scams
 * (User Agreement cl. 2.3.2), and specifically to consider capping SMS volume
 * and alerting on spikes. Our `MKTR` SID is published by an UNAUTHENTICATED
 * public endpoint (POST /api/verify/send), so the cap has to live server-side.
 *
 * One generic table serves three consumers so there is a single place to reason
 * about counter durability:
 *   1. per-phone OTP cap      — key `otp:phone:<hmac>:<sgt-day>`
 *   2. global daily SMS cap   — key `sms:global:<sgt-day>`
 *   3. express-rate-limit     — key `rl:<prefix>:<client>:<window-start>`
 *
 * Rows are self-healing: a bump past `expiresAt` resets the counter in the same
 * statement (see services/rateCounter.js), so no cleanup job is needed for
 * correctness — purgeExpired() is hygiene only.
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS rate_counters (
      key         TEXT PRIMARY KEY,
      count       INTEGER NOT NULL DEFAULT 0,
      "expiresAt" TIMESTAMPTZ NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Supports purgeExpired(); also keeps the table scannable if it ever grows.
  await queryInterface.sequelize.query(`
    CREATE INDEX IF NOT EXISTS rate_counters_expires_idx
      ON rate_counters ("expiresAt");
  `);
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(`DROP TABLE IF EXISTS rate_counters`);
}
