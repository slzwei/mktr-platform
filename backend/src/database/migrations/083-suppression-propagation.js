/**
 * 083 — Suppression-propagation projection (tracker "propagate",
 * docs/plans/suppression-propagation-plan.md §1).
 *
 * One row = "subscriber X must be told (at scope S) to stop contacting the
 * person behind lead P". Rows are DERIVED from current state (consumer
 * suppressions/erasure ⨝ the person's prospects ⨝ delivery history) by a
 * deterministic reconciler — never trusted, always recomputable. The partial
 * unique is the real idempotency: concurrent reconcilers INSERT … ON CONFLICT
 * DO NOTHING. Scope is monotonic: a 'marketing' pair may later be joined by an
 * 'all' pair (erasure escalation); nothing ever downgrades or deletes short of
 * the lead itself going away (CASCADE).
 *
 * Guarded/idempotent + sync-tolerant like 078/080 (test boot syncs models
 * first); runner holds the advisory lock.
 */
export async function up(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);

  await q(`CREATE TABLE IF NOT EXISTS suppression_propagations (
    id UUID PRIMARY KEY,
    "consumerId" UUID NOT NULL,
    "prospectId" UUID NOT NULL,
    "subscriberId" UUID NOT NULL,
    scope VARCHAR(16) NOT NULL,
    reason VARCHAR(32) NOT NULL,
    "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "deliveryId" UUID,
    "queuedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
  )`);

  await q(`DO $$ BEGIN
    ALTER TABLE suppression_propagations
      ADD CONSTRAINT fk_sp_consumer FOREIGN KEY ("consumerId")
        REFERENCES consumers (id) ON DELETE RESTRICT;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await q(`DO $$ BEGIN
    ALTER TABLE suppression_propagations
      ADD CONSTRAINT fk_sp_prospect FOREIGN KEY ("prospectId")
        REFERENCES prospects (id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await q(`DO $$ BEGIN
    ALTER TABLE suppression_propagations
      ADD CONSTRAINT fk_sp_subscriber FOREIGN KEY ("subscriberId")
        REFERENCES webhook_subscribers (id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  await q(`DO $$ BEGIN
    ALTER TABLE suppression_propagations
      ADD CONSTRAINT chk_sp_scope CHECK (scope IN ('marketing', 'all'));
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await q(`DO $$ BEGIN
    ALTER TABLE suppression_propagations
      ADD CONSTRAINT chk_sp_reason
        CHECK (reason IN ('unsubscribe', 'complaint', 'admin', 'erasure'));
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_sp_sub_prospect_scope
             ON suppression_propagations ("subscriberId", "prospectId", scope)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_sp_needs_queue
             ON suppression_propagations ("createdAt") WHERE "queuedAt" IS NULL`);
  await q(`CREATE INDEX IF NOT EXISTS idx_sp_consumer
             ON suppression_propagations ("consumerId")`);
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP TABLE IF EXISTS suppression_propagations');
}
