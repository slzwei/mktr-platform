/**
 * Add indexes on WebhookDelivery to support dead-letter and stats queries.
 */
export async function up(queryInterface) {
  // Composite index for dead-letter queries (status='failed' grouped by subscriber)
  await queryInterface.addIndex('webhook_deliveries', ['status', 'subscriberId'], {
    name: 'idx_webhook_deliveries_status_subscriber'
  }).catch(() => {}); // ignore if exists

  // Index for time-based stats queries
  await queryInterface.addIndex('webhook_deliveries', ['createdAt'], {
    name: 'idx_webhook_deliveries_created_at'
  }).catch(() => {}); // ignore if exists
}
