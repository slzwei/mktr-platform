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
  await safeRun('mktr-leads webhook subscriber', ensureMktrLeadsWebhookSubscriber);

  // Warn if a destination webhook is configured but delivery is globally disabled
  const lyfeAdapter = adapterRegistry.get('lyfe');
  if (lyfeAdapter.outboundWebhookUrl?.() && String(process.env.WEBHOOK_ENABLED || 'false').toLowerCase() !== 'true') {
    logger.warn('⚠️ Lyfe webhook URL is set but WEBHOOK_ENABLED is not "true" — leads will NOT be delivered to Lyfe');
  }
  const mktrLeadsAdapter = adapterRegistry.get('mktr_leads');
  if (mktrLeadsAdapter.outboundWebhookUrl?.() && String(process.env.WEBHOOK_ENABLED || 'false').toLowerCase() !== 'true') {
    logger.warn('⚠️ mktr-leads webhook URL is set but WEBHOOK_ENABLED is not "true" — leads will NOT be delivered to mktr-leads');
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
          logger.warn('[AgentSync] periodic Lyfe sync failed (non-fatal)', { error: err?.message });
        }
        // mktr-leads is a second agent source — sync it too when configured.
        // Run sequentially after Lyfe (not a separate timer) so the two never
        // contend for the shared advisory lock; each has its own try/catch so a
        // failure in one doesn't suppress the other.
        if (process.env.MKTR_LEADS_SUPABASE_URL) {
          try {
            const { syncAgentsFromMktrLeads } = await import('../services/agentSyncService.js');
            await syncAgentsFromMktrLeads();
          } catch (err) {
            logger.warn('[AgentSync] periodic mktr-leads sync failed (non-fatal)', { error: err?.message });
          }
        }
      }, 10 * 60 * 1000); // every 10 min
      logger.info('[AgentSync] periodic sync scheduled (10 min interval)');
    }

    // Lead-quota safety net: periodic held-queue sweep (every 2 min). NOTE: auto-release
    // is currently DISABLED (held leads are manual-only), so sweepAll no-ops today —
    // retained as the periodic hook in case auto-release is re-enabled.
    setInterval(async () => {
      try {
        const { sweepAll } = await import('../services/releaseSweep.js');
        const n = await sweepAll();
        if (n > 0) logger.info(`[ReleaseSweep] periodic sweep released ${n} held lead(s)`);
      } catch (err) {
        logger.warn('[ReleaseSweep] periodic sweep failed', { error: err?.message });
      }
    }, 2 * 60 * 1000); // every 2 min

    // Discover tool: reconcile Apify runs whose completion webhook never landed
    // (missed delivery, FAILED/TIMED_OUT with no hook, an instance restart
    // mid-run, or a start that crashed before the provider id was recorded).
    // Once ~45s after boot (spec §2.2 "plus on boot" — an instance restart is
    // exactly when webhooks were missed), then in-process every 5 min; each stuck
    // run is re-fetched from Apify and driven terminal idempotently. A daily
    // purge expires scraped candidate PII (DISCOVERY_CANDIDATE_TTL_DAYS). Gated
    // by DISCOVERY_ENABLED.
    if (String(process.env.DISCOVERY_ENABLED || 'false').toLowerCase() === 'true') {
      const runDiscoveryReconcile = async () => {
        try {
          const { default: discoveryService } = await import('../services/redeemOps/discoveryService.js');
          const { checked, stranded } = await discoveryService.reconcileStuckRuns();
          if (checked > 0 || stranded > 0) {
            logger.info(`[Discovery] reconciled ${checked} stuck + ${stranded} stranded run(s)`);
          }
        } catch (err) {
          logger.warn('[Discovery] periodic reconcile failed', { error: err?.message });
        }
      };
      setTimeout(runDiscoveryReconcile, 45 * 1000);
      setInterval(runDiscoveryReconcile, 5 * 60 * 1000); // every 5 min
      const runDiscoveryPurge = async () => {
        try {
          const { default: discoveryService } = await import('../services/redeemOps/discoveryService.js');
          await discoveryService.purgeExpiredCandidates();
        } catch (err) {
          logger.warn('[Discovery] retention purge failed (non-fatal)', { error: err?.message });
        }
      };
      setTimeout(runDiscoveryPurge, 2 * 60 * 1000);
      setInterval(runDiscoveryPurge, 24 * 60 * 60 * 1000); // daily
      logger.info('[Discovery] reconcile (5 min) + retention purge (daily) scheduled');
    }

    // Redeemed-audience exclusion sync (Meta customer list). Pushes hashed
    // redeemers into the exclusion audience so people who already redeemed stop
    // seeing ads. Runs IN-PROCESS (the backend is single-instance — no
    // double-fire) so it inherits the DB + Meta credentials without a separate
    // Render service (the Render MCP can't create Docker cron jobs, and a
    // standalone cron would have to duplicate the DB secrets). Gated by
    // REDEEMED_AUDIENCE_SYNC_ENABLED; an initial run ~60s after boot keeps it
    // fresh across deploys, then it repeats every
    // REDEEMED_AUDIENCE_SYNC_INTERVAL_HOURS (default 24). Idempotent (additive +
    // Meta person-level dedup), so extra runs are harmless.
    if (String(process.env.REDEEMED_AUDIENCE_SYNC_ENABLED || 'false').toLowerCase() === 'true') {
      const intervalHours = Math.max(1, Number(process.env.REDEEMED_AUDIENCE_SYNC_INTERVAL_HOURS) || 24);
      const runRedeemedAudienceSync = async () => {
        try {
          const { syncRedeemedAudience } = await import('../services/redeemedAudienceService.js');
          await syncRedeemedAudience();
        } catch (err) {
          logger.warn('[RedeemedAudience] periodic sync failed (non-fatal)', { error: err?.message });
        }
      };
      setTimeout(runRedeemedAudienceSync, 60_000);
      setInterval(runRedeemedAudienceSync, intervalHours * 60 * 60 * 1000);
      logger.info(`[RedeemedAudience] periodic sync scheduled (${intervalHours}h interval)`);
    }

    // Redeem Ops claim-inactivity sweep (docs/redeem-ops/ERD.md §6). Flags
    // at-risk (48h no first outreach) and stale (14d no meaningful activity)
    // partners — NEVER auto-releases; managers act on the flags. In-process like
    // the sweeps above; a dark deploy (flag off) schedules nothing.
    if (String(process.env.REDEEM_OPS_ENABLED || 'false').toLowerCase() === 'true') {
      const runRedeemOpsSweepSafe = async () => {
        try {
          const { runRedeemOpsStaleSweep } = await import('../services/redeemOps/staleSweep.js');
          await runRedeemOpsStaleSweep();
        } catch (err) {
          logger.warn('[RedeemOps] stale sweep failed (non-fatal)', { error: err?.message });
        }
      };
      setTimeout(runRedeemOpsSweepSafe, 120_000);
      setInterval(runRedeemOpsSweepSafe, 30 * 60 * 1000); // every 30 min
      logger.info('[RedeemOps] stale sweep scheduled (30m interval)');

      // Cadence engine (docs/plans/redeem-ops-cadences.md §5.4) — COMPOSITION
      // ROOT for the P0 hook registry: the CRM services never import the
      // engine; we register its handlers here. Removing this block (or leaving
      // the flag off) returns every choke point to no-op hook fires.
      if (String(process.env.REDEEM_OPS_CADENCES_ENABLED || 'false').toLowerCase() === 'true') {
        await safeRun('Redeem Ops cadence engine', async () => {
          const { registerCadenceHooks } = await import('../services/redeemOps/cadenceHooks.js');
          const { makeCadenceService } = await import('../services/redeemOps/cadenceService.js');
          const { ensureCadences } = await import('../services/redeemOps/cadenceSeeds.js');
          const cadences = makeCadenceService();
          registerCadenceHooks(cadences.hookHandlers());
          await ensureCadences();
          const runCadenceReconcileSafe = async () => {
            try {
              await cadences.reconcile();
            } catch (err) {
              logger.warn('[RedeemOps] cadence reconcile failed (non-fatal)', { error: err?.message });
            }
          };
          setTimeout(runCadenceReconcileSafe, 240_000);
          setInterval(runCadenceReconcileSafe, 30 * 60 * 1000); // every 30 min
          logger.info('[RedeemOps] cadence hooks registered + reconcile scheduled (30m interval)');
        });
      }

      // Phase 6 fulfilment (docs/redeem-ops/MKTR_INTEGRATION.md §2). This is the
      // COMPOSITION ROOT for the dependency-inverted capture hook: prospectService
      // never imports Redeem Ops — we register the callback here, so removing this
      // block returns lead capture to byte-identical pre-Redeem-Ops behaviour.
      // Additionally gated by REDEEM_OPS_ENTITLEMENTS_ENABLED so partners/rewards
      // can go live before reward issuance does.
      if (String(process.env.REDEEM_OPS_ENTITLEMENTS_ENABLED || 'false').toLowerCase() === 'true') {
        await safeRun('Redeem Ops entitlement hook', async () => {
          const { registerLeadCapturedHook } = await import('../services/prospectService.js');
          const { makeEntitlementService } = await import('../services/redeemOps/entitlementService.js');
          const { makeFulfilmentNotify } = await import('../services/redeemOps/fulfilmentNotify.js');
          const notify = makeFulfilmentNotify();
          const entitlements = makeEntitlementService({
            notifyUnlock: ({ entitlement, prospect, voucherToken }) =>
              notify.sendVoucherEmail({ entitlement, prospect, voucherToken }),
          });
          registerLeadCapturedHook(async (prospect) => {
            const r = await entitlements.issueForProspect(prospect, { via: 'hook' });
            if (r?.entitlement && r.reason === null && r.presentationToken && !r.voucherToken) {
              // agent_unlock policy: deliver the reservation pass (fire-and-forget)
              notify.sendReservationEmail({
                entitlement: r.entitlement, prospect, presentationToken: r.presentationToken,
              }).catch((err) => logger.error('[RedeemOps] reservation email failed', { error: err?.message }));
            } else if (r?.voucherToken) {
              notify.sendVoucherEmail({
                entitlement: r.entitlement, prospect, voucherToken: r.voucherToken,
              }).catch((err) => logger.error('[RedeemOps] voucher email failed', { error: err?.message }));
            }
          });
          logger.info('[RedeemOps] entitlement capture hook registered');
        });

        // Reservation expiry + missed-lead reconciliation (at-least-once backstop
        // for the hook; idempotent via the unique (activationId, prospectId) anchor).
        const runFulfilmentSweepSafe = async () => {
          try {
            const { makeEntitlementService } = await import('../services/redeemOps/entitlementService.js');
            const svc = makeEntitlementService();
            await svc.expireReservations();
            await svc.reconcileMissedLeads();
          } catch (err) {
            logger.warn('[RedeemOps] fulfilment sweep failed (non-fatal)', { error: err?.message });
          }
        };
        setTimeout(runFulfilmentSweepSafe, 180_000);
        setInterval(runFulfilmentSweepSafe, 15 * 60 * 1000); // every 15 min
        logger.info('[RedeemOps] fulfilment sweep scheduled (15m interval)');
      }
    }

    // DNC re-scrub / retry backfill — recovers dnc_pending leads whose check errored or
    // timed out at capture (releases on clear). In-process, gated by DNC_BACKFILL_ENABLED;
    // the re-entrancy guard + DB job lock live in the service (paid API → no double-fire).
    if (String(process.env.DNC_BACKFILL_ENABLED || 'false').toLowerCase() === 'true') {
      const intervalMin = Math.max(5, Number(process.env.DNC_BACKFILL_INTERVAL_MINUTES) || 30);
      const runDncBackfillSafe = async () => {
        try {
          const { runDncBackfill } = await import('../services/dncBackfillService.js');
          await runDncBackfill();
        } catch (err) {
          logger.warn('[DNC] backfill run failed (non-fatal)', { error: err?.message });
        }
      };
      setTimeout(runDncBackfillSafe, 90_000);
      setInterval(runDncBackfillSafe, intervalMin * 60 * 1000);
      logger.info(`[DNC] backfill scheduled (${intervalMin}m interval)`);
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
      || JSON.stringify(existing.events?.sort()) !== JSON.stringify(requiredEvents.sort())
      || existing.metadata?.destination !== 'lyfe';
    if (needsUpdate) {
      await existing.update({
        url,
        secret,
        enabled: true,
        events: requiredEvents,
        metadata: { ...(existing.metadata || {}), destination: 'lyfe' },
      });
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
    description: 'Forward leads to Lyfe mobile app via Supabase Edge Function',
    metadata: { destination: 'lyfe' },
  });

  logger.info('Lyfe webhook subscriber registered', { url });
}

/**
 * Ensure the mktr-leads webhook subscriber exists so leads assigned to
 * mktr-leads agents are forwarded to that app's receive-mktr-lead Edge
 * Function. Tagged metadata.destination='mktr_leads' so the destination-aware
 * dispatcher delivers ONLY mktr-leads-destined leads here. Env-gated: skips
 * silently if the URL/secret aren't configured (mirrors the Lyfe subscriber).
 */
async function ensureMktrLeadsWebhookSubscriber() {
  const adapter = adapterRegistry.get('mktr_leads');
  const url = adapter.outboundWebhookUrl?.();
  const secret = adapter.outboundWebhookSecret?.();

  if (!url || !secret) {
    logger.debug('mktr-leads webhook not configured (URL/secret missing on adapter), skipping.');
    return;
  }

  const SUBSCRIBER_NAME = 'MKTR Leads App';
  // lead.held → the admin held-queue ping (only the mktr-leads app has that surface;
  // the Lyfe subscriber intentionally does NOT subscribe to it). The events-diff in
  // the update guard below self-heals this onto the existing subscriber on deploy.
  const requiredEvents = ['lead.created', 'lead.assigned', 'lead.unassigned', 'lead.held', 'lead.deleted'];

  const existing = await WebhookSubscriber.findOne({ where: { name: SUBSCRIBER_NAME } });

  if (existing) {
    const needsUpdate = existing.url !== url || existing.secret !== secret || !existing.enabled
      || JSON.stringify(existing.events?.sort()) !== JSON.stringify(requiredEvents.sort())
      || existing.metadata?.destination !== 'mktr_leads';
    if (needsUpdate) {
      await existing.update({
        url,
        secret,
        enabled: true,
        events: requiredEvents,
        metadata: { ...(existing.metadata || {}), destination: 'mktr_leads' },
      });
      logger.info('mktr-leads webhook subscriber updated', { url, events: requiredEvents });
    } else {
      logger.debug('mktr-leads webhook subscriber already registered', { url });
    }
    return;
  }

  await WebhookSubscriber.create({
    name: SUBSCRIBER_NAME,
    url,
    secret,
    events: requiredEvents,
    enabled: true,
    description: 'Forward leads to the mktr-leads app via Supabase Edge Function',
    metadata: { destination: 'mktr_leads' },
  });

  logger.info('mktr-leads webhook subscriber registered', { url });
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
