/**
 * 118 — a missing-info park records WHICH blocker parked it.
 *
 * Park-at-first-block (product call 2026-08-11): the engine no longer skips
 * an unreachable step forward through its edge — it pauses ON the step and
 * the rep decides (fix the record, skip the step explicitly, or stop). The
 * UI needs the exact reason to say why: 'no_email' is fixable data while
 * 'suppressed' is a do-not-contact block, and the client cannot derive
 * suppression or template failures from the partner payload it holds.
 * Values: no_phone | no_email | no_instagram_handle | no_active_location |
 * suppressed | unresolved_template. NULL = not parked (or a legacy park from
 * before this migration, which the UI answers with its generic guidance).
 */

export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE outreach_cadence_enrollments ADD COLUMN IF NOT EXISTS "blockedReason" VARCHAR(32)'
  );
  // The step's authored due time, computed at park time. Automatic resumes
  // (contact-info hook) schedule the retried step for max(this, now) so a
  // fixed record does NOT fire the step days early; a rep's explicit
  // Retry/Resume clears it first (they asked for NOW).
  await queryInterface.sequelize.query(
    'ALTER TABLE outreach_cadence_enrollments ADD COLUMN IF NOT EXISTS "blockedDueAt" TIMESTAMP WITH TIME ZONE'
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE outreach_cadence_enrollments DROP COLUMN IF EXISTS "blockedReason"'
  );
  await queryInterface.sequelize.query(
    'ALTER TABLE outreach_cadence_enrollments DROP COLUMN IF EXISTS "blockedDueAt"'
  );
}
