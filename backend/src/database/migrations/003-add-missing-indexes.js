/**
 * Add composite indexes for high-traffic query patterns.
 */
export async function up(queryInterface) {
  // Commissions: queries frequently filter by (agentId, status) together
  await queryInterface.addIndex('commissions', ['agentId', 'status'], {
    name: 'idx_commissions_agent_status'
  }).catch(() => {}); // ignore if exists

  // Commissions: payout queries filter by (agentId, earnedDate)
  await queryInterface.addIndex('commissions', ['agentId', 'earnedDate'], {
    name: 'idx_commissions_agent_earned'
  }).catch(() => {}); // ignore if exists
}
