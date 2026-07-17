/**
 * 077 — Draft visibility for cadences. `publishedAt` NULL = draft: listed and
 * enrollable only by its creator and admins (settings.manage); publishing
 * shares it team-wide.
 *
 * RENAMED from 066-cadence-draft-visibility.js (trial-reward hardening PR D):
 * two migrations shared the 066 prefix and migrations.test.js was red on it.
 * The runner tracks applied migrations by FILENAME, so this file RE-RUNS on
 * prod boot under its new name — that is expected and safe: the column-add is
 * IF NOT EXISTS, and the historical backfill UPDATE (publish-all-existing,
 * written for the pre-drafts era) has been STRIPPED so a re-run can never
 * force-publish someone's current drafts. (074 was the planned rename target
 * but was claimed by 074-redeem-ops-category-filter-words in PR #169; 075/076
 * belong to hardening PRs B/C.)
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE outreach_cadences ADD COLUMN IF NOT EXISTS "publishedAt" timestamptz'
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE outreach_cadences DROP COLUMN IF EXISTS "publishedAt"'
  );
}
