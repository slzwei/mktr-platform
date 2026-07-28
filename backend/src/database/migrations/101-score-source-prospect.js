/**
 * 101 — record WHICH lead the person's score was copied from
 * (docs/plans/per-campaign-lead-scoring.md §4).
 *
 * The person's meet/buy/consumerScore are a PROJECTION of their highest-scoring
 * lead — `projectPersonScore` already picks that lead and then throws its
 * identity away. That was survivable while every campaign shared one global
 * rulebook: prod's six multi-signup people have scores 0–1 points apart, so it
 * did not matter which one won.
 *
 * Phase 4 (migration 100) makes it matter. Once a campaign has its own weights,
 * the same person genuinely scores differently on recruitment than on
 * insurance, and "their best" silently becomes "their best at something you
 * cannot see" — worst of all on the People directory, whose Meet/Buy columns
 * are SORTABLE and name no campaign at all.
 *
 * So the projection keeps the receipt. One nullable column, written by the same
 * statement that already chooses the winner; no second copy of the tie-break
 * rule to drift out of sync with the first.
 *
 * ON DELETE SET NULL, not a snapshot. Unlike the config table's `campaignId`
 * (migration 100), nothing has to stay RESOLVABLE here — this is a pointer to a
 * live row, used only to name a campaign in the UI. If the winning lead is
 * deleted the label should disappear rather than name a lead that no longer
 * exists; the stale score beside it is the pre-existing behaviour of a
 * projection that only refreshes when some lead of that person is rescored.
 */

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { transaction: t });

    await q('ALTER TABLE consumer_profiles ADD COLUMN IF NOT EXISTS "scoreSourceProspectId" UUID');

    await q(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cprof_score_source') THEN
        ALTER TABLE consumer_profiles ADD CONSTRAINT fk_cprof_score_source
          FOREIGN KEY ("scoreSourceProspectId") REFERENCES prospects(id) ON DELETE SET NULL;
      END IF;
    END $$`);

    // NO BACKFILL, deliberately. Recomputing the winner here would duplicate
    // projectPersonScore's tie-break in SQL that then never runs again — the
    // exact drift this column exists to avoid. Every person's projection is
    // rewritten the next time any of their leads is scored, which the nightly
    // sweep does for the whole population; until then the label is simply
    // absent, which reads as "not known yet" rather than as a wrong campaign.
  });
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { transaction: t });
    await q('ALTER TABLE consumer_profiles DROP CONSTRAINT IF EXISTS fk_cprof_score_source');
    await q('ALTER TABLE consumer_profiles DROP COLUMN IF EXISTS "scoreSourceProspectId"');
  });
}
