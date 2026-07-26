/**
 * 097 — the score moves to the lead (per-campaign-lead-scoring.md §4, §6, §10).
 *
 * A fresh grad is a great recruit and a poor insurance buyer: identical facts,
 * opposite verdict. One number per PERSON cannot hold both, so the score
 * becomes a property of (person × campaign) — which is what a prospect row
 * already is.
 *
 * `prospects.score` already exists (INTEGER 0-100, Prospect.js:75-83) and has
 * been dead since inception: written by nothing, and the prospect-update
 * endpoint's field allowlist excludes it. It becomes the lead score. Around it
 * go the same stamps consumer_profiles carries
 * (consumerScoringService.js:240-258) so a stored breakdown stays
 * interpretable, plus the two sub-scores §4's person-grain projection reads.
 *
 * ONE STORED NUMBER, DECAYED AT WRITE TIME (§6). Engagement recency and
 * life-event facts both decay INSIDE the base (consumerScoring.js:226-227,
 * :297-298), so there is no time-independent base to store and decay at read;
 * and a freshly-decayed display over a nightly-materialised sort column shows
 * visibly misordered pages. So sort, display and API all read `score`, and
 * nothing decays at read anywhere. The sacrifice, stated: pure-time freshness
 * between rescores.
 *
 * `scoreDirtyAt` is the lead-grain dirty marker (§10). Nothing existing covers
 * lead-grain invalidation: the spine relinker bumps only
 * consumer_profiles.inputVersion (consumerService.js:326-338),
 * bumpEnrichmentInputTx upserts only consumer_profiles
 * (enrichmentFence.js:38-52), and the sweep enumerates consumers
 * (enrichmentSweepService.js:249,278). Prospect.enrichmentRevision exists but
 * feeds map jobs — it is not a scanned dirty flag. A dirty lead is PROVABLY
 * stale, so it rides the sweep's stale-FIRST phase.
 *
 * Nullable throughout: an unscored lead is a real state, and a NOT NULL with a
 * default would claim every one of the 138 existing leads had been scored.
 */
export async function up(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);

  await q(`ALTER TABLE prospects
    ADD COLUMN IF NOT EXISTS "meetScore" INTEGER,
    ADD COLUMN IF NOT EXISTS "buyScore" INTEGER,
    ADD COLUMN IF NOT EXISTS "scoreBreakdown" JSONB,
    ADD COLUMN IF NOT EXISTS "scoreComputedAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "scoredConfigVersion" INTEGER,
    ADD COLUMN IF NOT EXISTS "scoringAlgorithmVersion" VARCHAR(24),
    ADD COLUMN IF NOT EXISTS "scoreInputHash" VARCHAR(64),
    ADD COLUMN IF NOT EXISTS "scoreDirtyAt" TIMESTAMPTZ`);

  // The stale-lead query's predicate: never scored, scored by a superseded
  // config/algorithm, or explicitly dirtied. Ordered by id, so the index
  // carries id to keep the cursor walk index-only where it can be.
  await q(`CREATE INDEX IF NOT EXISTS idx_prospects_score_stale
    ON prospects ("scoredConfigVersion", "scoringAlgorithmVersion", id)`);

  // Dirty leads are a small set by construction — partial keeps it that way.
  await q(`CREATE INDEX IF NOT EXISTS idx_prospects_score_dirty
    ON prospects ("scoreDirtyAt") WHERE "scoreDirtyAt" IS NOT NULL`);

  // §4's projection: the person's highest-scoring non-erased lead, ties by
  // createdAt then id. One index serves the lookup and the tiebreak.
  await q(`CREATE INDEX IF NOT EXISTS idx_prospects_consumer_score
    ON prospects ("consumerId", score DESC, "createdAt" DESC, id DESC)`);
}

export async function down(queryInterface) {
  const q = (sql) => queryInterface.sequelize.query(sql);
  await q('DROP INDEX IF EXISTS idx_prospects_consumer_score');
  await q('DROP INDEX IF EXISTS idx_prospects_score_dirty');
  await q('DROP INDEX IF EXISTS idx_prospects_score_stale');
  // `score` predates this migration — it is NOT dropped.
  await q(`ALTER TABLE prospects
    DROP COLUMN IF EXISTS "meetScore",
    DROP COLUMN IF EXISTS "buyScore",
    DROP COLUMN IF EXISTS "scoreBreakdown",
    DROP COLUMN IF EXISTS "scoreComputedAt",
    DROP COLUMN IF EXISTS "scoredConfigVersion",
    DROP COLUMN IF EXISTS "scoringAlgorithmVersion",
    DROP COLUMN IF EXISTS "scoreInputHash",
    DROP COLUMN IF EXISTS "scoreDirtyAt"`);
}
