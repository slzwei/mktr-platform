/**
 * 084 — Saved cohorts (tracker "cohortapi",
 * docs/plans/cohort-builder-backend.md).
 *
 * A cohort is a SAVED DEFINITION (filters + age gate + marketing-gate scope),
 * never a materialized member list — membership and reachability are resolved
 * live by cohortService at every ask, so consent changes take effect
 * immediately. Snapshot columns are advisory UI hints only.
 *
 * Soft-archive (`archivedAt`), no hard delete: the Phase-3 push senders will
 * FK send logs to cohorts and history must survive.
 *
 * Guarded/idempotent + sync-tolerant like 080 (test boot syncs models first).
 */
export async function up(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);

  await q(`CREATE TABLE IF NOT EXISTS cohorts (
    id UUID PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    definition JSONB NOT NULL,
    "createdBy" UUID,
    "lastTotalCount" INTEGER,
    "lastReachableCount" INTEGER,
    "lastPreviewBreakdown" JSONB,
    "lastPreviewAt" TIMESTAMP WITH TIME ZONE,
    "archivedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
  )`);

  // FK added guarded (the 078 pattern) — sync()-built test schemas already
  // carry it from the model; prod gets it here.
  await q(`DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON kcu.constraint_name = tc.constraint_name
         WHERE tc.table_name = 'cohorts' AND tc.constraint_type = 'FOREIGN KEY'
           AND kcu.column_name = 'createdBy'
      ) THEN
        ALTER TABLE cohorts ADD CONSTRAINT fk_cohorts_created_by
          FOREIGN KEY ("createdBy") REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$`);

  await q(`CREATE INDEX IF NOT EXISTS idx_cohorts_archived_created
             ON cohorts ("archivedAt", "createdAt" DESC)`);

  // Draw-participation filter: two independently-indexed EXISTS branches —
  // the phoneHash fallback (entries whose prospect was hard-deleted) and the
  // prospect-link lookup (uq_de_draw_prospect leads on drawId, so it cannot
  // serve a bare prospectId probe, e.g. anyDraw).
  await q(`CREATE INDEX IF NOT EXISTS idx_de_phone_hash
             ON draw_entries ("phoneHash")`);
  await q(`CREATE INDEX IF NOT EXISTS idx_de_prospect
             ON draw_entries ("prospectId") WHERE "prospectId" IS NOT NULL`);
}
