/**
 * 095 — score/v3: the age component (per-campaign-lead-scoring.md §13.2 /
 * PR B — "age curve + DOB backfill").
 *
 * The rule lives in code (consumerScoring.js scoreAge: a piecewise curve
 * over AGE evaluated against the current SGT year, band-straddle weighted by
 * the fraction of the band in each segment). This migration exists because
 * the EFFECTIVE algorithm version is `config.algorithmVersion ||
 * SCORING_ALGORITHM_VERSION` (consumerScoringService.js) and the live config
 * row pins 'score/v2': bumping the code constant alone would recompute
 * nothing, and the stored groups.buy would leave the new component ungrouped
 * (computed but contributing to no sub-score). The appended row makes
 * findStaleConsumerIds see every stored score as config-stale, so the whole
 * population recomputes on the next sweep with age placed in Buy.
 *
 * The row COPIES the current highest configJson (existing weights untouched)
 * and takes MAX(version)+1, per §7.2's append-only contract, then:
 *   - algorithmVersion → 'score/v3'
 *   - components.age   → { maxPoints: 10 }  (LOW: age is a prior — known
 *                        income/children must dominate it)
 *   - groups.buy       → + 'age' (before coverage_headroom's position
 *                        doesn't matter — grouping is a set)
 *   - ageCurve         → the seed curve below
 *
 * The curve is INLINED, never imported from consumerScoring.js — a migration
 * is a frozen historical record (093's rule): later tuning is a new
 * append-only row, not an edit here. Empty table (fresh DB pre-093, or a
 * test schema before seeding) → inserts nothing; code defaults already carry
 * v3 + the curve. Idempotent: re-running after the highest row is already
 * 'score/v3' is a no-op.
 *
 * "createdAt"/"updatedAt" are supplied EXPLICITLY — test schemas are built
 * by sync({force:true}) from the models, where Sequelize emits them NOT NULL
 * with NO database default, so a raw INSERT that omits them dies.
 */

// Seed curve v1 (§13.2 shape): under 25 low, rising through 25-29, peaking
// 35-44, easing off after 50. `upTo: null` = open tail. Values are fractions
// of components.age.maxPoints.
const SEED_AGE_CURVE = [
  { upTo: 24, value: 0.25 },
  { upTo: 29, value: 0.55 },
  { upTo: 34, value: 0.8 },
  { upTo: 44, value: 1 },
  { upTo: 49, value: 0.8 },
  { upTo: 59, value: 0.55 },
  { upTo: null, value: 0.3 },
];

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    await sequelize.query(
      `INSERT INTO enrichment_scoring_configs
         (version, "configJson", "activatedAt", "actorUserId", "createdAt", "updatedAt")
       SELECT c.version + 1,
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(c."configJson", '{algorithmVersion}', '"score/v3"'),
                    '{components,age}', '{"maxPoints": 10}'::jsonb
                  ),
                  '{ageCurve}', :curve::jsonb, true
                ),
                '{groups,buy}',
                CASE WHEN COALESCE(c."configJson"->'groups'->'buy' ? 'age', false)
                     THEN c."configJson"->'groups'->'buy'
                     ELSE COALESCE(c."configJson"->'groups'->'buy', '[]'::jsonb) || '["age"]'::jsonb
                END
              ),
              now(), NULL, now(), now()
         FROM enrichment_scoring_configs c
        WHERE c.version = (SELECT MAX(version) FROM enrichment_scoring_configs)
          AND c."configJson"->>'algorithmVersion' IS DISTINCT FROM 'score/v3'
       ON CONFLICT (version) DO NOTHING`,
      { transaction: t, replacements: { curve: JSON.stringify(SEED_AGE_CURVE) } }
    );
  });
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    // Remove only the row this migration appended: the highest version,
    // stamped v3, and — with this migration's four additions stripped —
    // byte-identical to its predecessor. A later human recalibration (also
    // stamped v3) fails the strip-compare and is deliberately left alone.
    await sequelize.query(
      `DELETE FROM enrichment_scoring_configs c
        WHERE c.version = (SELECT MAX(version) FROM enrichment_scoring_configs)
          AND c."configJson"->>'algorithmVersion' = 'score/v3'
          AND jsonb_set(
                (c."configJson" - 'algorithmVersion' - 'ageCurve') #- '{components,age}',
                '{groups,buy}',
                COALESCE((c."configJson"->'groups'->'buy') - 'age', '[]'::jsonb)
              ) = (
                SELECT jsonb_set(
                         p."configJson" - 'algorithmVersion',
                         '{groups,buy}',
                         COALESCE(p."configJson"->'groups'->'buy', '[]'::jsonb)
                       )
                  FROM enrichment_scoring_configs p
                 WHERE p.version = c.version - 1
              )`,
      { transaction: t }
    );
  });
}
