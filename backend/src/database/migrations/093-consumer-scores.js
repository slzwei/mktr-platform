/**
 * 093 — MEET × BUY sub-score columns + the seed scoring config
 * (docs/plans/consumer-profile-enrichment.md §7.1b).
 *
 * 091 shipped the blended `consumerScore`; §7.1b splits the SAME component
 * math into two sortable sub-scores, so both land as real columns rather
 * than being dug out of scoreBreakdown JSON at sort time.
 *
 * The seed config is INLINED here, never imported from
 * utils/consumerScoring.js. A migration is a frozen historical record: if it
 * imported live code, editing today's defaults would retroactively rewrite
 * what version 1 meant, and every stored breakdown stamped
 * `scoredConfigVersion: 1` would start lying about the weights that produced
 * it. Later calibrations are new append-only rows (§7.2), never edits here.
 *
 * Owned transaction + catalog guards + idempotent, like 091/092 — the runner
 * executes migrations on pool connections and is NOT atomic on its own
 * (Codex R3 #12), and sync({force:true})-built test schemas already carry
 * the model-declared columns.
 */

// Config v1 — Shawn recalibrates via a version-2 row, not by editing this
// (§11 step 4: he is ground truth at this scale; §18 A3: breakdown-first).
const SEED_CONFIG_V1 = {
  algorithmVersion: 'score/v1',
  groups: {
    meet: ['engagement', 'contactability', 'market_fit'],
    buy: ['life_events', 'family_gap', 'capacity', 'coverage_headroom'],
  },
  components: {
    engagement: { maxPoints: 15 },
    contactability: { maxPoints: 10 },
    market_fit: { maxPoints: 15 },
    life_events: { maxPoints: 25 },
    family_gap: { maxPoints: 20 },
    capacity: { maxPoints: 15 },
    coverage_headroom: { maxPoints: -10 },
  },
  targetSegments: [{ language: 'zh', ethnicity: 'chinese', weight: 1 }],
  decay: { lifeEventHalfLifeDays: 365, engagementHalfLifeDays: 180 },
  minFactConfidence: 0.5,
};

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    const q = (sql, replacements) => sequelize.query(sql, { transaction: t, replacements });

    await q('ALTER TABLE consumer_profiles ADD COLUMN IF NOT EXISTS "meetScore" SMALLINT');
    await q('ALTER TABLE consumer_profiles ADD COLUMN IF NOT EXISTS "buyScore" SMALLINT');

    await q(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cprof_meet_score') THEN
        ALTER TABLE consumer_profiles ADD CONSTRAINT chk_cprof_meet_score
          CHECK ("meetScore" IS NULL OR ("meetScore" >= 0 AND "meetScore" <= 100));
      END IF;
    END $$`);
    await q(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cprof_buy_score') THEN
        ALTER TABLE consumer_profiles ADD CONSTRAINT chk_cprof_buy_score
          CHECK ("buyScore" IS NULL OR ("buyScore" >= 0 AND "buyScore" <= 100));
      END IF;
    END $$`);

    // Sort indexes for the People columns (PR 3). Partial: an unscoreable
    // consumer renders "—" and is never in a score-ordered page.
    await q(`CREATE INDEX IF NOT EXISTS idx_cprof_meet_score
      ON consumer_profiles ("meetScore" DESC) WHERE "meetScore" IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_cprof_buy_score
      ON consumer_profiles ("buyScore" DESC) WHERE "buyScore" IS NOT NULL`);

    // Re-score cursor: find profiles scored by a superseded config version
    // (config change ⇒ full recompute, §7.1) without a sequential scan.
    await q(`CREATE INDEX IF NOT EXISTS idx_cprof_scored_config
      ON consumer_profiles ("scoredConfigVersion")`);

    // Seed config v1 — ON CONFLICT DO NOTHING so a re-run never rewrites a
    // version Shawn may already have recalibrated past.
    // Seed config v1 — ON CONFLICT DO NOTHING so a re-run never rewrites a
    // version Shawn may already have recalibrated past.
    //
    // "createdAt"/"updatedAt" are supplied EXPLICITLY. 091 declares them
    // DEFAULT now(), but test schemas are built by sync({force:true}) from
    // the models, where Sequelize emits them NOT NULL with NO database
    // default — it fills timestamps at the ORM layer, and a raw INSERT that
    // omits them dies on the not-null constraint. Any raw INSERT into a
    // model-backed table must name them.
    await q(
      `INSERT INTO enrichment_scoring_configs
         (version, "configJson", "activatedAt", "actorUserId", "createdAt", "updatedAt")
       VALUES (1, :cfg::jsonb, now(), NULL, now(), now())
       ON CONFLICT (version) DO NOTHING`,
      { cfg: JSON.stringify(SEED_CONFIG_V1) }
    );
  });
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { transaction: t });

    await q('DROP INDEX IF EXISTS idx_cprof_meet_score');
    await q('DROP INDEX IF EXISTS idx_cprof_buy_score');
    await q('DROP INDEX IF EXISTS idx_cprof_scored_config');
    await q('ALTER TABLE consumer_profiles DROP CONSTRAINT IF EXISTS chk_cprof_meet_score');
    await q('ALTER TABLE consumer_profiles DROP CONSTRAINT IF EXISTS chk_cprof_buy_score');
    await q('ALTER TABLE consumer_profiles DROP COLUMN IF EXISTS "meetScore"');
    await q('ALTER TABLE consumer_profiles DROP COLUMN IF EXISTS "buyScore"');
    // The seed config row is deliberately NOT deleted: stored breakdowns
    // stamp scoredConfigVersion and must stay interpretable (§7.2).
  });
}
