/**
 * 086 — Resubscribe lift: pair state machine (plan v3 addendum).
 *
 * A verified agree-all capture now LIFTS an unsubscribe suppression
 * (latest-explicit-consent-wins). Pairs become a two-state machine:
 * `state` = desired downstream state (derived from current suppressions +
 * resubscribe ledger evidence), `deliveredState` = what the last queued
 * delivery conveyed. Needs-queue = the two differ. 'all'-scope pairs are a
 * latch and never flip. Guarded/idempotent + sync-tolerant like 083.
 */
export async function up(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);

  // Constraint surgery FIRST (Codex resub-round-1 #1 — prod would reject
  // every lift write): 080's chk_ce_source and 083's chk_sp_reason both
  // predate 'resubscribe'. Each DROP+ADD pair lives in ONE DO block — a
  // single statement, so the runner's lack of per-migration transactions
  // cannot strand the table unconstrained mid-surgery (round-2 #4). ADD is
  // NOT VALID (no full-table validation scan under ACCESS EXCLUSIVE); the
  // separate VALIDATE takes only SHARE UPDATE EXCLUSIVE and is retryable.
  await q(`DO $$ BEGIN
    ALTER TABLE consent_events DROP CONSTRAINT IF EXISTS chk_ce_source;
    ALTER TABLE consent_events ADD CONSTRAINT chk_ce_source
      CHECK (source IN ('signup', 'backfill', 'unsubscribe', 'admin', 'erasure', 'resubscribe'))
      NOT VALID;
  END $$`);
  await q(`ALTER TABLE consent_events VALIDATE CONSTRAINT chk_ce_source`);
  await q(`DO $$ BEGIN
    ALTER TABLE suppression_propagations DROP CONSTRAINT IF EXISTS chk_sp_reason;
    ALTER TABLE suppression_propagations ADD CONSTRAINT chk_sp_reason
      CHECK (reason IN ('unsubscribe', 'complaint', 'admin', 'erasure', 'resubscribe'))
      NOT VALID;
  END $$`);
  await q(`ALTER TABLE suppression_propagations VALIDATE CONSTRAINT chk_sp_reason`);

  await q(`ALTER TABLE suppression_propagations
             ADD COLUMN IF NOT EXISTS state VARCHAR(16) NOT NULL DEFAULT 'suppressed'`);
  await q(`ALTER TABLE suppression_propagations
             ADD COLUMN IF NOT EXISTS "deliveredState" VARCHAR(16)`);

  await q(`DO $$ BEGIN
    ALTER TABLE suppression_propagations
      ADD CONSTRAINT chk_sp_state CHECK (state IN ('suppressed', 'lifted'));
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await q(`DO $$ BEGIN
    ALTER TABLE suppression_propagations
      ADD CONSTRAINT chk_sp_delivered_state
        CHECK ("deliveredState" IN ('suppressed', 'lifted') OR "deliveredState" IS NULL);
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  // Pairs queued under the v2 model conveyed 'suppressed'.
  await q(`UPDATE suppression_propagations
              SET "deliveredState" = 'suppressed'
            WHERE "queuedAt" IS NOT NULL AND "deliveredState" IS NULL`);

  await q(`CREATE INDEX IF NOT EXISTS idx_sp_state_pending
             ON suppression_propagations ("createdAt")
             WHERE "deliveredState" IS DISTINCT FROM state`);
}

export async function down(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);
  await q('DROP INDEX IF EXISTS idx_sp_state_pending');
  await q('ALTER TABLE suppression_propagations DROP COLUMN IF EXISTS "deliveredState"');
  await q('ALTER TABLE suppression_propagations DROP COLUMN IF EXISTS state');
}
