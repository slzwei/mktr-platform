/**
 * 091 — Consumer profile enrichment: observation ledger + profiles + job
 * queue + scoring configs + sweep fence (docs/plans/consumer-profile-enrichment.md §3).
 *
 * Five tables + prospects.enrichmentRevision. ALL statements run inside ONE
 * migration-owned transaction (plan §11 / Codex R3 #12 — the runner executes
 * migrations on pool connections and is NOT atomic on its own), and every
 * object is additionally guarded so a re-run after partial failure or a
 * sync({force:true})-built test schema is safe (the 084 pattern).
 *
 * Ships DARK: nothing reads these tables until the mapper (this PR, flag-off
 * writers) and the enrichment routes (PR 2, ENRICHMENT_ENABLED) land.
 * Retention: owner decision 2026-07-26 — customer data kept forever; erasure
 * remains the sole deletion path (erasureService cascade, this PR).
 */
export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { transaction: t });

    // ── consumer_observations — append-only, revisioned fact ledger (§3.1) ──
    await q(`CREATE TABLE IF NOT EXISTS consumer_observations (
      id UUID PRIMARY KEY,
      "sourceProspectId" UUID,
      "consumerId" UUID,
      key VARCHAR(64) NOT NULL,
      value JSONB NOT NULL,
      confidence REAL NOT NULL,
      source VARCHAR(24) NOT NULL,
      "sourceArtifactId" VARCHAR(80),
      "sourceRevisionId" BIGINT,
      "sourceContentHash" VARCHAR(64),
      "sourceEventAt" TIMESTAMP WITH TIME ZONE NOT NULL,
      pipeline VARCHAR(24) NOT NULL,
      "pipelineVersion" VARCHAR(48) NOT NULL,
      evidence TEXT,
      "supersededAt" TIMESTAMP WITH TIME ZONE,
      "retractedAt" TIMESTAMP WITH TIME ZONE,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    )`);

    // Guarded FKs (sync-built test schemas already carry them from the model).
    await q(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cobs_prospect') THEN
        ALTER TABLE consumer_observations ADD CONSTRAINT fk_cobs_prospect
          FOREIGN KEY ("sourceProspectId") REFERENCES prospects(id) ON DELETE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cobs_consumer') THEN
        ALTER TABLE consumer_observations ADD CONSTRAINT fk_cobs_consumer
          FOREIGN KEY ("consumerId") REFERENCES consumers(id) ON DELETE CASCADE;
      END IF;
    END $$`);

    // Source-aware anchor CHECK (plan §3.1, R2 #7 / R3 #6): manual rows are
    // consumer-anchored; every other source is prospect-anchored WITH full
    // artifact identity (nullable identity columns cannot guard uniqueness).
    await q(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cobs_anchor') THEN
        ALTER TABLE consumer_observations ADD CONSTRAINT chk_cobs_anchor CHECK (
          (source = 'manual' AND "consumerId" IS NOT NULL AND "sourceProspectId" IS NULL)
          OR
          (source <> 'manual' AND "consumerId" IS NULL AND "sourceProspectId" IS NOT NULL
            AND "sourceArtifactId" IS NOT NULL AND "sourceRevisionId" IS NOT NULL
            AND "sourceContentHash" IS NOT NULL)
        );
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cobs_source') THEN
        ALTER TABLE consumer_observations ADD CONSTRAINT chk_cobs_source CHECK (
          source IN ('form','quiz','retell_analysis','screening_transcript','manual')
        );
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cobs_confidence') THEN
        ALTER TABLE consumer_observations ADD CONSTRAINT chk_cobs_confidence CHECK (
          confidence >= 0 AND confidence <= 1
        );
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cobs_evidence_len') THEN
        ALTER TABLE consumer_observations ADD CONSTRAINT chk_cobs_evidence_len CHECK (
          evidence IS NULL OR char_length(evidence) <= 300
        );
      END IF;
    END $$`);

    // Idempotency identity (R3 #3: revision, not content hash, is identity).
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_cobs_artifact_revision_key
      ON consumer_observations ("sourceArtifactId", "sourceRevisionId", pipeline, "pipelineVersion", key)
      WHERE "sourceArtifactId" IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_cobs_prospect_key
      ON consumer_observations ("sourceProspectId", key) WHERE "sourceProspectId" IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_cobs_consumer_key
      ON consumer_observations ("consumerId", key) WHERE "consumerId" IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_cobs_artifact
      ON consumer_observations ("sourceArtifactId") WHERE "sourceArtifactId" IS NOT NULL`);

    // ── consumer_profiles — one row per person (§3.2) ──
    await q(`CREATE TABLE IF NOT EXISTS consumer_profiles (
      "consumerId" UUID PRIMARY KEY,
      summary TEXT,
      "profileJson" JSONB,
      "consumerScore" SMALLINT,
      "scoreBreakdown" JSONB,
      "scoredConfigVersion" INTEGER,
      "scoringAlgorithmVersion" VARCHAR(16),
      "scoreInputHash" VARCHAR(64),
      "inputVersion" BIGINT NOT NULL DEFAULT 0,
      "syncedInputVersion" BIGINT NOT NULL DEFAULT 0,
      "profileInputHash" VARCHAR(64),
      "modelVersion" VARCHAR(48),
      "summaryGeneratedAt" TIMESTAMP WITH TIME ZONE,
      "scoreComputedAt" TIMESTAMP WITH TIME ZONE,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    )`);

    await q(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cprof_consumer') THEN
        ALTER TABLE consumer_profiles ADD CONSTRAINT fk_cprof_consumer
          FOREIGN KEY ("consumerId") REFERENCES consumers(id) ON DELETE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cprof_score') THEN
        ALTER TABLE consumer_profiles ADD CONSTRAINT chk_cprof_score CHECK (
          "consumerScore" IS NULL OR ("consumerScore" >= 0 AND "consumerScore" <= 100)
        );
      END IF;
    END $$`);

    // Dirty discovery: inputVersion > syncedInputVersion (§6.3).
    await q(`CREATE INDEX IF NOT EXISTS idx_cprof_dirty
      ON consumer_profiles ("consumerId") WHERE "inputVersion" > "syncedInputVersion"`);

    // ── enrichment_jobs — durable queue (§3.3) ──
    await q(`CREATE TABLE IF NOT EXISTS enrichment_jobs (
      id UUID PRIMARY KEY,
      kind VARCHAR(12) NOT NULL,
      "subjectProspectId" UUID,
      "subjectConsumerId" UUID,
      "sourceArtifactId" VARCHAR(80),
      "sourceRevisionId" BIGINT,
      "sourceContentHash" VARCHAR(64),
      "inputHash" VARCHAR(64),
      "promptVersion" VARCHAR(32),
      payload JSONB,
      "taxonomyVersion" VARCHAR(16),
      "pipelineVersion" VARCHAR(48) NOT NULL,
      status VARCHAR(12) NOT NULL DEFAULT 'pending',
      "leaseToken" UUID,
      "leaseExpiresAt" TIMESTAMP WITH TIME ZONE,
      "workerId" VARCHAR(80),
      attempts SMALLINT NOT NULL DEFAULT 0,
      "lastError" TEXT,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    )`);

    await q(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ejobs_prospect') THEN
        ALTER TABLE enrichment_jobs ADD CONSTRAINT fk_ejobs_prospect
          FOREIGN KEY ("subjectProspectId") REFERENCES prospects(id) ON DELETE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ejobs_consumer') THEN
        ALTER TABLE enrichment_jobs ADD CONSTRAINT fk_ejobs_consumer
          FOREIGN KEY ("subjectConsumerId") REFERENCES consumers(id) ON DELETE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ejobs_status') THEN
        ALTER TABLE enrichment_jobs ADD CONSTRAINT chk_ejobs_status CHECK (
          status IN ('pending','leased','done','stale','dead','cancelled')
        );
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ejobs_kind') THEN
        ALTER TABLE enrichment_jobs ADD CONSTRAINT chk_ejobs_kind CHECK (
          (kind = 'map' AND "subjectProspectId" IS NOT NULL AND "subjectConsumerId" IS NULL
            AND "sourceRevisionId" IS NOT NULL AND "sourceContentHash" IS NOT NULL
            AND "sourceArtifactId" IS NULL AND "inputHash" IS NULL AND "promptVersion" IS NULL)
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

    // Durable queue identities (R2 #5 / R4 #1): map+extract dedupe across
    // pending/leased/done; synthesize across ACTIVE only — a done synth job
    // must never block re-enqueueing a hash that recurs (A→B→A convergence).
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ejobs_map
      ON enrichment_jobs (kind, "subjectProspectId", "sourceRevisionId", "pipelineVersion")
      WHERE kind = 'map' AND status IN ('pending','leased','done')`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ejobs_extract
      ON enrichment_jobs (kind, "subjectProspectId", "sourceArtifactId", "sourceRevisionId", "pipelineVersion")
      WHERE kind = 'extract' AND status IN ('pending','leased','done')`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ejobs_synthesize
      ON enrichment_jobs (kind, "subjectConsumerId", "inputHash", "promptVersion")
      WHERE kind = 'synthesize' AND status IN ('pending','leased')`);

    await q(`CREATE INDEX IF NOT EXISTS idx_ejobs_pending
      ON enrichment_jobs (kind, "createdAt") WHERE status = 'pending'`);
    await q(`CREATE INDEX IF NOT EXISTS idx_ejobs_lease_expiry
      ON enrichment_jobs ("leaseExpiresAt") WHERE status = 'leased'`);
    await q(`CREATE INDEX IF NOT EXISTS idx_ejobs_subject_consumer
      ON enrichment_jobs ("subjectConsumerId") WHERE "subjectConsumerId" IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_ejobs_subject_prospect
      ON enrichment_jobs ("subjectProspectId") WHERE "subjectProspectId" IS NOT NULL`);

    // ── enrichment_scoring_configs — immutable versioned rows (§7.2) ──
    await q(`CREATE TABLE IF NOT EXISTS enrichment_scoring_configs (
      version INTEGER PRIMARY KEY,
      "configJson" JSONB NOT NULL,
      "activatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "actorUserId" UUID,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    )`);
    await q(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_escfg_actor') THEN
        ALTER TABLE enrichment_scoring_configs ADD CONSTRAINT fk_escfg_actor
          FOREIGN KEY ("actorUserId") REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$`);

    // ── enrichment_sweep_runs — nightly fence + repair cursor (§7.3, R4-era R3 #9) ──
    await q(`CREATE TABLE IF NOT EXISTS enrichment_sweep_runs (
      id UUID PRIMARY KEY,
      "runDateSgt" VARCHAR(10) NOT NULL,
      "runType" VARCHAR(12) NOT NULL DEFAULT 'nightly',
      status VARCHAR(10) NOT NULL,
      "ownerToken" UUID NOT NULL,
      "heartbeatAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "finishedAt" TIMESTAMP WITH TIME ZONE,
      stats JSONB,
      cursor JSONB,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    )`);
    await q(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_esruns_status') THEN
        ALTER TABLE enrichment_sweep_runs ADD CONSTRAINT chk_esruns_status CHECK (
          status IN ('running','done','failed')
        );
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_esruns_type') THEN
        ALTER TABLE enrichment_sweep_runs ADD CONSTRAINT chk_esruns_type CHECK (
          "runType" IN ('nightly','backfill')
        );
      END IF;
    END $$`);
    // One nightly fence per SGT date (done ends the date; failed may retry);
    // backfill runs are unfenced by date.
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_esruns_nightly_date
      ON enrichment_sweep_runs ("runDateSgt")
      WHERE "runType" = 'nightly' AND status IN ('running','done')`);

    // ── prospects.enrichmentRevision — per-form-artifact revision counter (§3.1/§5) ──
    await q(`ALTER TABLE prospects
      ADD COLUMN IF NOT EXISTS "enrichmentRevision" INTEGER NOT NULL DEFAULT 1`);
  });
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize;
  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { transaction: t });
    await q('DROP TABLE IF EXISTS enrichment_sweep_runs');
    await q('DROP TABLE IF EXISTS enrichment_scoring_configs');
    await q('DROP TABLE IF EXISTS enrichment_jobs');
    await q('DROP TABLE IF EXISTS consumer_profiles');
    await q('DROP TABLE IF EXISTS consumer_observations');
    await q('ALTER TABLE prospects DROP COLUMN IF EXISTS "enrichmentRevision"');
  });
}
