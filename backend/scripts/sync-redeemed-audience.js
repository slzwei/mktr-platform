/**
 * Redeemed-audience sync — Render Cron Job entrypoint.
 *
 * Pushes consenting redeemers (hashed email + phone) from the `prospects` table
 * into the Meta customer-list exclusion audience, so redeemers stop seeing ads.
 *
 * Run as a Render Cron Job via entrypoint.sh:  RUN_MODE=cron-redeemed-audience
 * Or directly:  node scripts/sync-redeemed-audience.js
 *
 * Env: REDEEMED_AUDIENCE_SYNC_ENABLED=true, META_ADS_MANAGEMENT_TOKEN,
 *      META_REDEEMED_AUDIENCE_ID (+ optional META_GRAPH_API_VERSION,
 *      REDEEMED_AUDIENCE_REQUIRE_CONSENT, REDEEMED_AUDIENCE_SYNC_MODE).
 */
import dotenv from 'dotenv';
dotenv.config({ path: new URL('../.env', import.meta.url) });

import { initSentry } from '../src/utils/sentryInit.js';
import { logger } from '../src/utils/logger.js';
import { syncRedeemedAudience } from '../src/services/redeemedAudienceService.js';
import { sequelize } from '../src/models/index.js';

initSentry({ service: 'mktr-redeemed-audience-sync' });

async function main() {
  const result = await syncRedeemedAudience();

  if (result.synced) {
    logger.info({ result }, 'redeemed-audience cron: done');
  } else if (result.reason === 'guarded') {
    logger.warn('redeemed-audience cron: disabled or misconfigured — skipped (exit 0)');
  } else {
    logger.error({ result }, 'redeemed-audience cron: sync failed');
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    logger.error({ err: err.message }, 'redeemed-audience cron: fatal');
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await sequelize.close();
    } catch {
      /* ignore close errors on shutdown */
    }
    process.exit(process.exitCode || 0);
  });
