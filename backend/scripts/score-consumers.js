/**
 * Consumer scoring backfill — the separately-invoked catch-up mode
 * (docs/plans/consumer-profile-enrichment.md §5, §7.3).
 *
 * Deliberately NOT folded into the nightly sweep: a one-off catch-up over
 * the whole population must not consume the night's budget, and its stats
 * must be readable on their own row (runType='backfill') rather than
 * inflating a nightly's numbers into looking healthy.
 *
 * Shares the nightly's advisory lock, so this will decline to start while a
 * sweep is mid-flight rather than double-scoring anyone. Idempotent: every
 * consumer whose inputs are unchanged short-circuits on the score-input hash.
 *
 * Runs regardless of ENRICHMENT_SCORING_ENABLED — that flag gates the
 * automatic scheduler, not a human deliberately invoking this. Migration 093
 * must have run (it seeds scoring config v1); without it the script still
 * works but stamps scoredConfigVersion 0 from the code defaults.
 *
 * Usage:
 *   node scripts/score-consumers.js
 *   node scripts/score-consumers.js --limit 200
 *   node scripts/score-consumers.js --after <consumer-uuid>   # resume a slice
 */
import dotenv from 'dotenv';
dotenv.config({ path: new URL('../.env', import.meta.url) });

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const { sequelize } = await import('../src/database/connection.js');
const { runBackfill } = await import('../src/services/enrichmentSweepService.js');

const rowBudget = Number(arg('limit', '5000'));
const afterId = arg('after', null);

try {
  await sequelize.authenticate();
  const result = await runBackfill({ rowBudget, afterId });

  if (!result.ran) {
    console.error(`[score-consumers] did not run: ${result.reason}`);
    process.exit(1);
  }

  console.log('[score-consumers] done:', JSON.stringify(result.stats, null, 2));
  if (result.cursor?.lastConsumerId) {
    // Surfaced so an operator can slice a large backfill across sessions
    // without re-walking what's already done.
    console.log(`[score-consumers] resume with: --after ${result.cursor.lastConsumerId}`);
  }
  process.exit(0);
} catch (err) {
  console.error('[score-consumers] failed:', err?.message || err);
  process.exit(1);
}
