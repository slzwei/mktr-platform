/**
 * 111 — cadence pauses carry WHY they paused.
 *
 * Three distinct things park an enrollment in 'paused' and they need different
 * treatment afterwards: a snooze (the reconciler may auto-resume it when the
 * partner wakes), a rep's manual pause (nothing may auto-resume it — the
 * reconciler was silently un-pausing these after 10 minutes), and the new
 * missing-contact-info pause (resumed only by the contact-info hook when an
 * email/phone/handle/location is actually added). Legacy NULL rows keep the
 * old auto-resume behavior so in-flight snoozes survive the deploy.
 */

export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE outreach_cadence_enrollments ADD COLUMN IF NOT EXISTS "pausedReason" VARCHAR(32)'
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query(
    'ALTER TABLE outreach_cadence_enrollments DROP COLUMN IF EXISTS "pausedReason"'
  );
}
