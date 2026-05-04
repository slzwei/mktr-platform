import { Op } from 'sequelize';
import { sequelize } from './connection.js';
import { initSystemAgent } from '../services/systemAgent.js';
import { validateEnv } from '../config/envValidation.js';
import { validateGoogleOAuthConfig } from '../controllers/authController.js';
import { runMigrations } from './runMigrations.js';
import { logger } from '../utils/logger.js';
import { WebhookSubscriber, Campaign, IdempotencyKey } from '../models/index.js';
import { adapterRegistry } from '../integrations/AdapterRegistry.js';
// Side-effect: registers all platform adapters (currently just Lyfe).
import '../integrations/index.js';

/**
 * Connect to the database, run migrations, and seed runtime data.
 */
export async function bootstrapDatabase() {
  // 1. Validate env
  validateEnv();
  validateGoogleOAuthConfig();

  // 2. Connect
  await sequelize.authenticate();
  logger.info('Database connection established.');

  // 2b. In test mode, sync all model definitions to create base tables first.
  //     Migrations then layer on indexes, column tweaks, and data migrations.
  if (process.env.NODE_ENV === 'test') {
    await sequelize.sync({ force: true });
    logger.info('Test DB: tables synced (force: true).');
  }

  // 3. Run pending migrations (all schema work is here now)
  await runMigrations();
  logger.info('Migrations complete.');

  // 4. Seed runtime data (idempotent, safe to re-run every boot)
  await safeRun('System Agent', async () => {
    const systemId = await initSystemAgent();
    logger.info('System Agent ready', { systemId });
  });
  await safeRun('Lyfe webhook subscriber', ensureLyfeWebhookSubscriber);

  // Warn if Lyfe webhook is configured but delivery is disabled
  const lyfeAdapter = adapterRegistry.get('lyfe');
  if (lyfeAdapter.outboundWebhookUrl?.() && String(process.env.WEBHOOK_ENABLED || 'false').toLowerCase() !== 'true') {
    logger.warn('⚠️ Lyfe webhook URL is set but WEBHOOK_ENABLED is not "true" — leads will NOT be delivered to Lyfe');
  }

  await safeRun('Retell campaigns', ensureRetellCampaigns);

  await safeRun('Webhook recovery', async () => {
    const { recoverPendingRetries } = await import('../services/webhookService.js');
    await recoverPendingRetries();
  });

  // Poll for stale webhook retries every 60 seconds (skip in test mode)
  if (process.env.NODE_ENV !== 'test') {
    setInterval(async () => {
      try {
        const { recoverPendingRetries } = await import('../services/webhookService.js');
        await recoverPendingRetries();
      } catch (err) {
        logger.warn('[Webhook] periodic recovery failed', { error: err?.message });
      }
    }, 60_000);

    // Purge expired idempotency keys every hour
    setInterval(async () => {
      try {
        const deleted = await IdempotencyKey.destroy({
          where: { expiresAt: { [Op.lt]: new Date() } }
        });
        if (deleted > 0) {
          logger.info(`[cleanup] Removed ${deleted} expired idempotency keys`);
        }
      } catch (err) {
        logger.error('[cleanup] Idempotency key cleanup failed:', err.message);
      }
    }, 60 * 60 * 1000); // every hour

    // Periodic agent sync (FMEA F13). Every 10 minutes pulls latest state
    // from each registered platform adapter. The orchestrator's advisory
    // lock ensures concurrent runs (cron + manual API) coexist safely.
    // Disable via SYNC_AGENT_CRON=false for ad-hoc deploy debugging.
    if (String(process.env.SYNC_AGENT_CRON || 'true').toLowerCase() !== 'false') {
      setInterval(async () => {
        try {
          const { syncAgentsFromLyfe } = await import('../services/agentSyncService.js');
          await syncAgentsFromLyfe();
        } catch (err) {
          logger.warn('[AgentSync] periodic sync failed (non-fatal)', { error: err?.message });
        }
      }, 10 * 60 * 1000); // every 10 min
      logger.info('[AgentSync] periodic sync scheduled (10 min interval)');
    }
  }

  logger.info('Database bootstrap complete.');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function safeRun(label, fn) {
  try {
    await fn();
  } catch (e) {
    logger.warn(`${label} failed (non-fatal)`, { error: e?.message || String(e) });
  }
}

// ---------------------------------------------------------------------------
// Runtime data seeding
// ---------------------------------------------------------------------------

/**
 * Ensure the Lyfe webhook subscriber exists so lead.created events
 * are forwarded to the Lyfe Edge Function automatically.
 * Reads URL and secret from env vars; skips silently if not configured.
 */
async function ensureLyfeWebhookSubscriber() {
  const adapter = adapterRegistry.get('lyfe');
  const url = adapter.outboundWebhookUrl?.();
  const secret = adapter.outboundWebhookSecret?.();

  if (!url || !secret) {
    logger.debug('Lyfe webhook not configured (URL/secret missing on adapter), skipping.');
    return;
  }

  const SUBSCRIBER_NAME = 'Lyfe App';

  const existing = await WebhookSubscriber.findOne({ where: { name: SUBSCRIBER_NAME } });

  const requiredEvents = ['lead.created', 'lead.assigned', 'lead.unassigned'];

  if (existing) {
    const needsUpdate = existing.url !== url || existing.secret !== secret || !existing.enabled
      || JSON.stringify(existing.events?.sort()) !== JSON.stringify(requiredEvents.sort());
    if (needsUpdate) {
      await existing.update({ url, secret, enabled: true, events: requiredEvents });
      logger.info('Lyfe webhook subscriber updated', { url, events: requiredEvents });
    } else {
      logger.debug('Lyfe webhook subscriber already registered', { url });
    }
    return;
  }

  await WebhookSubscriber.create({
    name: SUBSCRIBER_NAME,
    url,
    secret,
    events: ['lead.created', 'lead.assigned', 'lead.unassigned'],
    enabled: true,
    description: 'Forward leads to Lyfe mobile app via Supabase Edge Function'
  });

  logger.info('Lyfe webhook subscriber registered', { url });
}

/**
 * Auto-create campaigns for Retell AI agents.
 * Reads RETELL_AGENTS env var (JSON array) to know which agents to create campaigns for.
 * Format: RETELL_AGENTS=[{"agentId":"agent_xxx","name":"Luggage - CPF CareShield Life"}]
 * Falls back to a default if not set.
 */
async function ensureRetellCampaigns() {
  let retellAgents;
  try {
    retellAgents = JSON.parse(process.env.RETELL_AGENTS || '[]');
  } catch {
    retellAgents = [];
  }

  // Default: Luggage Redemption agent (always ensure this exists)
  if (retellAgents.length === 0) {
    retellAgents = [{
      agentId: 'agent_58b8bbdfb8920ce49bb2750b86',
      name: 'Luggage - CPF CareShield Life'
    }];
  }

  const { initSystemAgent } = await import('../services/systemAgent.js');
  const systemAgentId = await initSystemAgent();

  for (const agent of retellAgents) {
    const campaignName = `[Retell] ${agent.name}`;

    const existing = await Campaign.findOne({ where: { name: campaignName } });

    if (existing) {
      // Ensure it stays active
      if (!existing.is_active) {
        await existing.update({ is_active: true });
        logger.info('Retell campaign reactivated', { name: campaignName });
      } else {
        logger.debug('Retell campaign already exists', { name: campaignName });
      }
      continue;
    }

    await Campaign.create({
      name: campaignName,
      type: 'lead_generation',
      status: 'active',
      is_active: true,
      description: `Auto-created campaign for Retell AI agent: ${agent.name}. Leads from successful phone calls are captured here automatically.`,
      createdBy: systemAgentId,
      min_age: 30,
      max_age: 65
    });

    logger.info('Retell campaign created', { name: campaignName, retellAgentId: agent.agentId });
  }
}
