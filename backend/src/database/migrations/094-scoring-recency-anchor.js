/**
 * 094 — score/v2: engagement recency anchors to the newest signup
 * (per-campaign-lead-scoring.md §16 B1 / §3.3-as-corrected).
 *
 * The algorithm change lives in code (consumerScoring.js v2: recency reads
 * the newest prospect's createdAt, never consumers.lastSeenAt — lastSeenAt
 * refreshes on per-campaign RESPONSE touches, which must not move the
 * person-grain score). This migration exists because the EFFECTIVE algorithm
 * version is `config.algorithmVersion || SCORING_ALGORITHM_VERSION`
 * (consumerScoringService.js), and the live config row pins 'score/v1':
 * bumping the code constant alone would recompute nothing. A new append-only
 * config row carrying 'score/v2' makes findStaleConsumerIds see every stored
 * score as config-stale, so the whole population recomputes on the next
 * sweep and the change is visible in both stamps.
 *
 * The row COPIES the current highest configJson (weights untouched — this is
 * an algorithm re-version, not a recalibration) and takes MAX(version)+1,
 * per §7.2's append-only contract. Empty table (fresh DB pre-093, or a test
 * schema before seeding) → inserts nothing; code defaults already carry v2.
 * Idempotent: re-running after the highest row is already 'score/v2' is a
 * no-op.
 *
 * "createdAt"/"updatedAt" are supplied EXPLICITLY — test schemas are built
 * by sync({force:true}) from the models, where Sequelize emits them NOT NULL
 * with NO database default, so a raw INSERT that omits them dies.
 */

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    await sequelize.query(
      `INSERT INTO enrichment_scoring_configs
         (version, "configJson", "activatedAt", "actorUserId", "createdAt", "updatedAt")
       SELECT c.version + 1,
              jsonb_set(c."configJson", '{algorithmVersion}', '"score/v2"'),
              now(), NULL, now(), now()
         FROM enrichment_scoring_configs c
        WHERE c.version = (SELECT MAX(version) FROM enrichment_scoring_configs)
          AND c."configJson"->>'algorithmVersion' IS DISTINCT FROM 'score/v2'
       ON CONFLICT (version) DO NOTHING`,
      { transaction: t }
    );
  });
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    // Remove only the row this migration appended: the highest version, and
    // only if it is the v2 stamp row. A later human recalibration (also
    // possibly stamped v2) is deliberately NOT matched by version arithmetic
    // against the v1 seed — restrict to the immediate successor shape:
    // highest row, algorithmVersion v2, weights identical to its predecessor.
    await sequelize.query(
      `DELETE FROM enrichment_scoring_configs c
        WHERE c.version = (SELECT MAX(version) FROM enrichment_scoring_configs)
          AND c."configJson"->>'algorithmVersion' = 'score/v2'
          AND (c."configJson" - 'algorithmVersion') = (
            SELECT p."configJson" - 'algorithmVersion'
              FROM enrichment_scoring_configs p
             WHERE p.version = c.version - 1
          )`,
      { transaction: t }
    );
  });
}
