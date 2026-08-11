/**
 * 121 — inbox-loop health surface (Phase C,
 * docs/plans/redeem-ops-cadence-email-autosend.md §5).
 *
 * unmatchedInboxCount: human mail to persona addresses the reply-matcher
 * couldn't tie to a tracked thread — a gauge on the Settings health card so
 * nobody has to tail the shared mailbox raw. Ordinary business@ mail (not
 * addressed to a persona) never counts.
 */

export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE outreach_accounts ADD COLUMN IF NOT EXISTS "unmatchedInboxCount" INTEGER NOT NULL DEFAULT 0'
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE outreach_accounts DROP COLUMN IF EXISTS "unmatchedInboxCount"'
  );
}
