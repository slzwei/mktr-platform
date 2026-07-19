/**
 * Rebuild/heal the consumer spine — the drift repair tool the projection
 * design leans on (docs/plans/consumer-spine-and-consent-ledger.md §2.4).
 *
 * Runs the SAME reconciler as migration 079: assigns complete projections
 * from prospect rows (never increments), heals wrong/missing links, unlinks
 * call_bot rows, links entitlements. Idempotent — safe to run anytime.
 *
 * Usage: node scripts/rebuild-consumer-spine.js
 */
import dotenv from 'dotenv';
dotenv.config({ path: new URL('../.env', import.meta.url) });

const { sequelize } = await import('../src/database/connection.js');
const { reconcileConsumerSpine } = await import('../src/services/consumerService.js');

try {
  await sequelize.authenticate();
  const stats = await reconcileConsumerSpine();
  console.log('[rebuild-consumer-spine] done:', JSON.stringify(stats, null, 2));
  await sequelize.close();
  process.exit(0);
} catch (err) {
  console.error('[rebuild-consumer-spine] failed:', err?.message || err);
  process.exit(1);
}
