/**
 * 088 — Retell AI screening-call gate (docs/plans/retell-screening-calls.md §4).
 *
 * Discrete fence columns + evidence JSONB (the DNC shape, migration 041):
 * every state transition fences on the discrete columns in a single
 * conditional UPDATE; `screeningMetadata` holds append-only evidence
 * (attempts keyed by local token, verdict detail, charge bookkeeping).
 * All additive + nullable — zero backfill, dark until RETELL_SCREENING_ENABLED.
 */
export async function up(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);

  await q(`ALTER TABLE prospects
    ADD COLUMN IF NOT EXISTS "screeningActiveCallId" VARCHAR(80),
    ADD COLUMN IF NOT EXISTS "screeningAttemptCount" SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "screeningNextAttemptAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "screeningVerdict" VARCHAR(16),
    ADD COLUMN IF NOT EXISTS "screeningMetadata" JSONB`);
}

export async function down(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);
  await q(`ALTER TABLE prospects
    DROP COLUMN IF EXISTS "screeningActiveCallId",
    DROP COLUMN IF EXISTS "screeningAttemptCount",
    DROP COLUMN IF EXISTS "screeningNextAttemptAt",
    DROP COLUMN IF EXISTS "screeningVerdict",
    DROP COLUMN IF EXISTS "screeningMetadata"`);
}
