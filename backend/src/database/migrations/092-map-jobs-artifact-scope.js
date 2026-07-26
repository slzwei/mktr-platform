/**
 * 092 — Artifact-scoped map jobs, EXPAND step
 * (docs/plans/studio-profile-questions.md §5.1, Codex PR0 R2 #1 / R3).
 *
 * Rolling deploys run old + new instances together, and legacy map jobs of
 * every status carry sourceArtifactId NULL with possibly COMBINED
 * form+quiz payloads. So this migration only EXPANDS:
 *   - chk_ejobs_kind now accepts BOTH map shapes (legacy-null and
 *     artifact-bearing);
 *   - the legacy map unique is re-scoped to NULL-artifact rows;
 *   - an artifact-scoped unique is added for the new shape.
 * Writers keep emitting the legacy shape until
 * ENRICHMENT_MAP_ARTIFACT_JOBS flips post-deploy (restart), so old
 * processors never see a new-shape job. The CONTRACT step (require
 * artifact on non-terminal map jobs, drop the legacy unique) is a later
 * migration, after live legacy jobs drain to zero.
 *
 * Idempotent + owned transaction, like 091.
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;
  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { transaction: t });

    await q('ALTER TABLE enrichment_jobs DROP CONSTRAINT IF EXISTS chk_ejobs_kind');
    await q(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ejobs_kind') THEN
        ALTER TABLE enrichment_jobs ADD CONSTRAINT chk_ejobs_kind CHECK (
          (kind = 'map' AND "subjectProspectId" IS NOT NULL AND "subjectConsumerId" IS NULL
            AND "sourceRevisionId" IS NOT NULL AND "sourceContentHash" IS NOT NULL
            AND "inputHash" IS NULL AND "promptVersion" IS NULL)
          OR
          (kind = 'extract' AND "subjectProspectId" IS NOT NULL AND "subjectConsumerId" IS NULL
            AND "sourceArtifactId" IS NOT NULL AND "sourceRevisionId" IS NOT NULL
            AND "sourceContentHash" IS NOT NULL AND "inputHash" IS NULL
            AND "promptVersion" IS NULL AND payload IS NULL)
          OR
          (kind = 'synthesize' AND "subjectConsumerId" IS NOT NULL AND "subjectProspectId" IS NULL
            AND "inputHash" IS NOT NULL AND "promptVersion" IS NOT NULL
            AND "sourceArtifactId" IS NULL AND "sourceRevisionId" IS NULL
            AND "sourceContentHash" IS NULL AND payload IS NULL)
        );
      END IF;
    END $$`);

    // Legacy unique re-scoped to NULL-artifact rows (partition, no overlap).
    await q('DROP INDEX IF EXISTS uq_ejobs_map');
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ejobs_map
      ON enrichment_jobs (kind, "subjectProspectId", "sourceRevisionId", "pipelineVersion")
      WHERE kind = 'map' AND "sourceArtifactId" IS NULL AND status IN ('pending','leased','done')`);

    await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ejobs_map_artifact
      ON enrichment_jobs (kind, "subjectProspectId", "sourceArtifactId", "sourceRevisionId", "pipelineVersion")
      WHERE kind = 'map' AND "sourceArtifactId" IS NOT NULL AND status IN ('pending','leased','done')`);
  });
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize;
  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { transaction: t });
    await q('DROP INDEX IF EXISTS uq_ejobs_map_artifact');
    await q('DROP INDEX IF EXISTS uq_ejobs_map');
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ejobs_map
      ON enrichment_jobs (kind, "subjectProspectId", "sourceRevisionId", "pipelineVersion")
      WHERE kind = 'map' AND status IN ('pending','leased','done')`);
  });
}
