/**
 * One-time cleanup: remove test prospects created during Retell integration testing.
 */
export async function up(queryInterface) {
  const testCallIds = [
    'call_test_manual_002',
    'call_test_campaign_check_001'
  ];

  for (const callId of testCallIds) {
    // Delete related idempotency keys
    await queryInterface.sequelize.query(
      `DELETE FROM idempotency_keys WHERE key = :callId AND scope = 'retell:call'`,
      { replacements: { callId } }
    ).catch(() => {});

    // Delete related prospect activities
    await queryInterface.sequelize.query(
      `DELETE FROM "ProspectActivities" WHERE "prospectId" IN (SELECT id FROM prospects WHERE "retellCallId" = :callId)`,
      { replacements: { callId } }
    ).catch(() => {});

    // Delete the prospect
    await queryInterface.sequelize.query(
      `DELETE FROM prospects WHERE "retellCallId" = :callId`,
      { replacements: { callId } }
    ).catch(() => {});
  }
}
