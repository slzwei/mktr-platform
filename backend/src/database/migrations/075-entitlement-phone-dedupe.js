/**
 * 075 — Anti-farming phone dedupe (trial-reward hardening PR B).
 *
 * One LIVE reward per phone per activation: `phoneKey` is the digits-only
 * holder phone stamped at issuance, and the partial unique covers only
 * eligible/issued/redeemed rows — an expired or cancelled reward frees the
 * slot for that person. Without this, one human could re-submit the signup
 * form inside the 10-min OTP window and drain an activation's allocation
 * (N prospect rows → N reservations).
 *
 * Numbering note (updated in PR D): the 074 slot this note originally
 * reserved was independently claimed by 074-redeem-ops-category-filter-words
 * (PR #169) while the hardening series was in flight; the cadence-draft
 * rename landed as 077 instead. The runner tracks by FILENAME
 * (runMigrations.js), so numeric order never mattered.
 *
 * No backfill: reward_entitlements is empty in prod at ship time.
 */
export async function up(queryInterface, Sequelize) {
  const table = await queryInterface.describeTable('reward_entitlements');
  if (!table.phoneKey) {
    await queryInterface.addColumn('reward_entitlements', 'phoneKey', {
      type: Sequelize.STRING(20),
      allowNull: true,
      comment: 'Digits-only holder phone at issuance — anti-farming dedupe key (one live reward per phone per activation)',
    });
  }
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_re_activation_phone
       ON reward_entitlements ("activationId", "phoneKey")
       WHERE "phoneKey" IS NOT NULL AND status IN ('eligible','issued','redeemed')`
  );
}

export async function down(queryInterface) {
  await queryInterface.sequelize.query('DROP INDEX IF EXISTS uq_re_activation_phone');
  const table = await queryInterface.describeTable('reward_entitlements');
  if (table.phoneKey) {
    await queryInterface.removeColumn('reward_entitlements', 'phoneKey');
  }
}
