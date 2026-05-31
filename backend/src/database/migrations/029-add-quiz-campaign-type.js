/**
 * Add 'quiz' to the `campaigns.type` enum.
 *
 * Makes quiz-funnel campaigns a first-class type (admin campaign list, type
 * selector, filters, and the IG/TikTok quiz funnel). Functionally a quiz
 * campaign is lead_generation + design_config.quiz.enabled; the enum value is
 * for UX/reporting clarity. Mirrors the addition in the Sequelize model
 * (Campaign.type) and the Joi schemas (campaignCreate/campaignUpdate).
 *
 * Sequelize names the backing enum `enum_<table>_<column>` => `enum_campaigns_type`.
 * `ADD VALUE IF NOT EXISTS` is idempotent and instant — safe to re-run, and a
 * no-op when a fresh DB built from the (updated) model already has the value.
 *
 * Requires Postgres 12+ (ADD VALUE inside the runner's implicit transaction).
 * Postgres has no DROP VALUE, so `down` is intentionally a no-op.
 */
export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    `ALTER TYPE "enum_campaigns_type" ADD VALUE IF NOT EXISTS 'quiz'`
  );
}

export async function down() {
  // Postgres cannot remove an enum value without recreating the type; no-op.
}
