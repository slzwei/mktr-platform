import { Op } from 'sequelize';
import { sequelize } from './connection.js';
import { initSystemAgent } from '../services/systemAgent.js';
import { validateEnv } from '../config/envValidation.js';
import { DEFAULT_CAMPAIGN_TYPE } from '../utils/campaignTypes.js';
import { validateGoogleOAuthConfig } from '../controllers/authController.js';
import { runMigrations } from './runMigrations.js';
import { acquireTestRunLock } from './testRunLock.js';
import { restoreBaselineSchema } from './restoreBaseline.js';
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

  // 2b. In test mode, rebuild the schema from the FROZEN BASELINE + the
  //     migration chain — migrations are the sole schema source, so the test
  //     schema equals prod by construction (the old sync({force:true})-then-
  //     migrate boot made models a second schema source and every migration
  //     had to be hand-mirrored onto them; see database/baseline/README.md).
  if (process.env.NODE_ENV === 'test') {
    // Refuse to run beside another jest process on this database — its
    // schema rebuild would drop our tables mid-run (see testRunLock.js).
    await acquireTestRunLock();
    await restoreBaselineSchema();
    logger.info('Test DB: baseline schema restored (migrations-only source).');
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

  // Meta Lead Ads (docs/plans/meta-lead-ads-native-pipe.md §3.3): deliberately
  // NOT safeRun — with the flag on, a missing fallback pool or worker would
  // silently strand webhook leads, so ensure failure is boot-fatal.
  if (String(process.env.META_LEAD_ADS_ENABLED || 'false').toLowerCase() === 'true') {
    await ensureMetaLeadAds();
    // Connect Facebook (docs/plans/facebook-connect-self-serve.md): also
    // boot-fatal — a mis-set agent-ads campaign would mis-route every
    // self-serve agent's leads.
    if (String(process.env.META_OAUTH_ENABLED || 'false').toLowerCase() === 'true') {
      await ensureMetaOauth();
    }
  }

  await safeRun('Webhook recovery', async () => {
    const { recoverPendingRetries } = await import('../services/webhookService.js');
    await recoverPendingRetries();
  });

  // Suppression-propagation reconcile (tracker "propagate"): project + queue
  // lead.suppressed pairs from current state. Runs dark until a subscriber
  // carries the event (env flags above); the boot pass doubles as the
  // flag-flip backfill.
  await safeRun('Suppression propagation reconcile', async () => {
    const { reconcileSuppressionPropagation } = await import('../services/suppressionPropagationService.js');
    await reconcileSuppressionPropagation();
    logger.info('suppression propagation reconciler armed (dark until a subscriber carries lead.suppressed)');
  });

  // Email broadcasts (tracker "emailpush"): flip in-flight broadcasts whose
  // worker died with the old process to `interrupted`. Resume is a human act
  // in the admin UI — nothing auto-sends on a deploy/restart.
  await safeRun('Email broadcast stale sweep', async () => {
    const { sweepStaleBroadcasts } = await import('../services/emailBroadcastService.js');
    await sweepStaleBroadcasts();
  });

  // Draw-record reconciler: every ACTIVE draw campaign with an open entry
  // window gets its engine record ensured (creation still runs through
  // createDraw's fail-closed validation). Heals campaigns launched before
  // auto-creation existed — the manual run-lucky-draw.js create step is gone.
  await safeRun('Draw record reconciler', async () => {
    const { sweepDrawRecords } = await import('../services/luckyDrawService.js');
    await sweepDrawRecords();
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

    // Email-broadcast stale-sweep backstop (5 min): a worker lost to a deploy
    // mid-send surfaces as `interrupted` (Resume button) without waiting for
    // the next boot.
    setInterval(async () => {
      try {
        const { sweepStaleBroadcasts } = await import('../services/emailBroadcastService.js');
        await sweepStaleBroadcasts();
      } catch (err) {
        logger.warn('[EmailBroadcast] stale sweep failed', { error: err?.message });
      }
    }, 300_000);

    // Suppression-propagation backstop pass every 60 minutes — heals lost
    // triggers, races, and dark-period backlogs (never throws internally).
    setInterval(async () => {
      const { reconcileSuppressionPropagation } = await import('../services/suppressionPropagationService.js');
      await reconcileSuppressionPropagation();
    }, 3_600_000);

    // Draw-record backstop every 60 minutes: a launch whose record ensure
    // failed transiently, or a draw enabled by a path that skipped the hook,
    // self-heals within the hour (sweepDrawRecords never throws internally).
    setInterval(async () => {
      try {
        const { sweepDrawRecords } = await import('../services/luckyDrawService.js');
        await sweepDrawRecords();
      } catch (err) {
        logger.warn('[LuckyDraw] record sweep failed', { error: err?.message });
      }
    }, 3_600_000);

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

    // Redemption CAPI reconciliation sweep — the no-rescan safety net for
    // VoucherRedeemed sends lost between the redemption commit and the
    // fire-and-forget dispatch (process death). Marker-guarded + Meta event_id
    // dedup ⇒ idempotent; single-instance backend ⇒ no double-fire. Rides the
    // CAPI master switch — no separate flag.
    if (process.env.META_CAPI_ENABLED === 'true') {
      const runRedemptionCapiSweep = async () => {
        try {
          const { sweepUnmarkedRedemptions } = await import('../services/redemptionOutcomeService.js');
          await sweepUnmarkedRedemptions();
        } catch (err) {
          logger.warn('[RedemptionCapi] periodic sweep failed (non-fatal)', { error: err?.message });
        }
      };
      setTimeout(runRedemptionCapiSweep, 90_000);
      setInterval(runRedemptionCapiSweep, 6 * 60 * 60 * 1000);
      logger.info('[RedemptionCapi] reconciliation sweep scheduled (6h interval)');
    }

    // Consumer enrichment scoring sweep (consumer-profile-enrichment §7.3).
    // Recomputes MEET × BUY for consumers whose facts, telemetry or scoring
    // config moved. Ticks HOURLY but is fenced to one real run per SGT date
    // by enrichment_sweep_runs — the frequent tick exists so a process that
    // was down at the intended hour still sweeps that day rather than
    // silently skipping it. Extra ticks cost one indexed SELECT.
    // §13 pivot: this runs IN-PROCESS; the Mac/Ollama worker and its
    // claim/renew/complete endpoints were dropped.
    if (String(process.env.ENRICHMENT_SCORING_ENABLED || 'false').toLowerCase() === 'true') {
      const runEnrichmentSweep = async () => {
        try {
          // Reclaim orphaned map-job leases first (P2-6). drainMapJobs reaps on
          // its own path, but that path only runs when a capture happens — a
          // quiet period would leave a job stranded by a dead worker sitting
          // 'leased' forever, and its person scored on incomplete evidence.
          const { reapExpiredLeases } = await import('../services/factMapperService.js');
          await reapExpiredLeases();
        } catch (err) {
          logger.warn('[EnrichmentScoring] lease reap failed (non-fatal)', { error: err?.message });
        }
        try {
          const { runNightlySweep } = await import('../services/enrichmentSweepService.js');
          await runNightlySweep();
        } catch (err) {
          logger.warn('[EnrichmentScoring] sweep failed (non-fatal)', { error: err?.message });
        }
      };
      setTimeout(runEnrichmentSweep, 150_000);
      setInterval(runEnrichmentSweep, 60 * 60 * 1000);
      logger.info('[EnrichmentScoring] scoring sweep scheduled (hourly tick, one run per SGT date)');
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
          const { makeWiredEntitlementService } = await import('../services/redeemOps/entitlementWiring.js');
          // Delivery (reservation + voucher emails, receipt events) lives
          // INSIDE the wired service now — one choke point for hook, sweep and
          // manual issuance (trial-reward-funnel-hardening PR A).
          const entitlements = makeWiredEntitlementService();
          // The issuance result flows BACK through the hook: the controller
          // chains its confirmation email on it and skips the send when the
          // merged draw email (drawEmailQueued) already covers it.
          registerLeadCapturedHook((prospect) => entitlements.issueForProspect(prospect, { via: 'hook' }));
          logger.info('[RedeemOps] entitlement capture hook registered');
        });

        // Reservation expiry + missed-lead reconciliation + delivery recovery
        // (at-least-once backstops for the hook; issuance stays exactly-once
        // via the unique (activationId, prospectId) anchor, and delivery
        // recovery re-mints only rows with no successful `notified` receipt).
        const runFulfilmentSweepSafe = async () => {
          try {
            const { makeWiredEntitlementService } = await import('../services/redeemOps/entitlementWiring.js');
            const svc = makeWiredEntitlementService();
            await svc.expireReservations();
            await svc.reconcileMissedLeads();
            await svc.reconcileMissedDeliveries();
            await svc.purgeIssuanceSkips(); // 30-day retention on the skip log
            // Draw-boost auto-top-up (PR-2, D1 "effectively unlimited"):
            // active draw rails under 20% remaining get another default block.
            const { topUpDrawBoostAllocations } = await import('../services/redeemOps/drawBoostProvisioningService.js');
            await topUpDrawBoostAllocations();
            // Inventory ledger ⇄ counter reconciliation (P2-11): a pure
            // detector — logs drift loudly, never mutates (self-healing would
            // hide the bug that caused it). This is the sweep that would have
            // caught the redemption-reverse counter asymmetry.
            const { default: inventory } = await import('../services/redeemOps/inventoryService.js');
            const { RewardOffer } = await import('../models/index.js');
            const offers = await RewardOffer.findAll({ attributes: ['id', 'title'] });
            for (const offer of offers) {
              const { consistent, derived, actual } = await inventory.reconcile(offer.id);
              if (!consistent) {
                logger.warn('[RedeemOps] inventory ledger/counter drift detected', {
                  offerId: offer.id, offerTitle: offer.title, derived, actual,
                });
              }
            }
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

    // AI screening sweep (docs/plans/retell-screening-calls.md §10) — the
    // restart-safe net for the screening-call gate: qualified-delivery retries,
    // stale in-flight resolution, TTL, drain, due re-dials. ALWAYS scheduled
    // (not env-gated like the DNC backfill): the sweep itself is drain-aware —
    // feature off + no screening rows ⇒ one cheap COUNT and out; feature off +
    // rows pending (kill switch mid-flight) ⇒ it releases them unscreened.
    {
      const intervalMin = Math.max(2, Number(process.env.SCREENING_SWEEP_INTERVAL_MINUTES) || 5);
      const runScreeningSweepSafe = async () => {
        try {
          const { runScreeningSweep } = await import('../services/screeningSweepService.js');
          await runScreeningSweep();
        } catch (err) {
          logger.warn('[Screening] sweep run failed (non-fatal)', { error: err?.message });
        }
      };
      setTimeout(runScreeningSweepSafe, 120_000);
      setInterval(runScreeningSweepSafe, intervalMin * 60 * 1000);
      logger.info(`[Screening] sweep scheduled (${intervalMin}m interval, drain-aware)`);
    }

    // rate_counters hygiene. Expired rows are already inert (bump resets them in
    // the same statement), but the limiter writes one row per client per 15-min
    // window and those keys are never revisited — without a sweep the table grows
    // without bound. Retention is deliberately 2 days so a counter is still
    // inspectable the morning after an incident.
    const runRateCounterPurge = async () => {
      try {
        const { purgeExpired } = await import('../services/rateCounter.js');
        const deleted = await purgeExpired();
        if (deleted > 0) logger.info(`[RateCounters] purged ${deleted} expired row(s)`);
      } catch (err) {
        logger.warn('[RateCounters] purge failed (non-fatal)', { error: err?.message });
      }
    };
    setTimeout(runRateCounterPurge, 3 * 60 * 1000);
    setInterval(runRateCounterPurge, 24 * 60 * 60 * 1000); // daily
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
/**
 * Which signature scheme the two BOOTSTRAP-MANAGED live subscribers are signed
 * with (P2-3). The sender defaults to v2 (timestamp-bound); these two are held
 * on v1 because their receivers verify the body ALONE and would 401 every
 * delivery the moment we flipped.
 *
 * THE CUTOVER IS THIS CONSTANT. Deploy the dual-accept receivers first, then
 * change 'v1' → 'v2' here: the self-heal below re-pins both rows on the next
 * boot. Full runbook: docs/plans/webhook-signature-v2-cutover.md.
 */
const LIVE_SUBSCRIBER_SIGNATURE_VERSION = 'v2';

export async function ensureLyfeWebhookSubscriber() {
  const adapter = adapterRegistry.get('lyfe');
  const url = adapter.outboundWebhookUrl?.();
  const secret = adapter.outboundWebhookSecret?.();

  if (!url || !secret) {
    logger.debug('Lyfe webhook not configured (URL/secret missing on adapter), skipping.');
    return;
  }

  const SUBSCRIBER_NAME = 'Lyfe App';

  const existing = await WebhookSubscriber.findOne({ where: { name: SUBSCRIBER_NAME } });

  // lead.suppressed is env-gated per destination (tracker "propagate"): the
  // receiver 400s unknown events, and 50 consecutive failures auto-disable the
  // subscriber — flip ONLY after the consumer's handler is deployed
  // (docs/reference/webhook-propagation-contract.md runbook). The self-heal
  // below makes the flag authoritative in both directions on every boot.
  const requiredEvents = [
    'lead.created', 'lead.assigned', 'lead.unassigned',
    ...(String(process.env.LYFE_LEAD_SUPPRESSED_ENABLED || 'false').toLowerCase() === 'true'
      ? ['lead.suppressed', 'lead.unsuppressed'] : []),
  ];

  if (existing) {
    const needsUpdate = existing.url !== url || existing.secret !== secret || !existing.enabled
      || JSON.stringify(existing.events?.sort()) !== JSON.stringify(requiredEvents.sort())
      || existing.metadata?.destination !== 'lyfe'
      || existing.metadata?.signatureVersion !== LIVE_SUBSCRIBER_SIGNATURE_VERSION;
    if (needsUpdate) {
      await existing.update({
        url,
        secret,
        enabled: true,
        events: requiredEvents,
        metadata: {
          ...(existing.metadata || {}),
          destination: 'lyfe',
          signatureVersion: LIVE_SUBSCRIBER_SIGNATURE_VERSION,
        },
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
    events: requiredEvents,
    enabled: true,
    description: 'Forward leads to Lyfe mobile app via Supabase Edge Function',
    metadata: { destination: 'lyfe', signatureVersion: LIVE_SUBSCRIBER_SIGNATURE_VERSION },
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
export async function ensureMktrLeadsWebhookSubscriber() {
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
  // lead.suppressed is env-gated (tracker "propagate") — flip ONLY after the
  // mktr-leads EF handler is deployed; see the Lyfe block above for why.
  const requiredEvents = [
    'lead.created', 'lead.assigned', 'lead.unassigned', 'lead.held', 'lead.deleted',
    ...(String(process.env.MKTR_LEADS_LEAD_SUPPRESSED_ENABLED || 'false').toLowerCase() === 'true'
      ? ['lead.suppressed', 'lead.unsuppressed'] : []),
  ];

  const existing = await WebhookSubscriber.findOne({ where: { name: SUBSCRIBER_NAME } });

  if (existing) {
    const needsUpdate = existing.url !== url || existing.secret !== secret || !existing.enabled
      || JSON.stringify(existing.events?.sort()) !== JSON.stringify(requiredEvents.sort())
      || existing.metadata?.destination !== 'mktr_leads'
      || existing.metadata?.signatureVersion !== LIVE_SUBSCRIBER_SIGNATURE_VERSION;
    if (needsUpdate) {
      await existing.update({
        url,
        secret,
        enabled: true,
        events: requiredEvents,
        metadata: {
          ...(existing.metadata || {}),
          destination: 'mktr_leads',
          signatureVersion: LIVE_SUBSCRIBER_SIGNATURE_VERSION,
        },
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
    metadata: { destination: 'mktr_leads', signatureVersion: LIVE_SUBSCRIBER_SIGNATURE_VERSION },
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
      type: DEFAULT_CAMPAIGN_TYPE,
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

/**
 * Meta Lead Ads boot (docs/plans/meta-lead-ads-native-pipe.md §3.3): ensure
 * the [Meta] Unmapped held pool — looked up by reserved SLUG (names are not
 * unique) — and start the durable-inbox worker. Called only when
 * META_LEAD_ADS_ENABLED; throws on failure (boot-fatal by design: every
 * unmapped/undeliverable lead depends on this pool existing quota-enforced).
 */
async function ensureMetaLeadAds() {
  const META_UNMAPPED_SLUG = 'meta-unmapped';
  const systemAgentId = await initSystemAgent();

  const existing = await Campaign.findOne({ where: { slug: META_UNMAPPED_SLUG } });
  if (existing) {
    // Drift repair re-asserts EVERY invariant — including firstActivatedAt,
    // which is what locks the reserved slug against ordinary campaign CRUD
    // (campaignService's immutability rule keys off it).
    const drift = existing.status !== 'active' || !existing.is_active
      || existing.enforceLeadQuota !== true || existing.externalEligible !== false
      || !existing.firstActivatedAt;
    if (drift) {
      await existing.update({
        status: 'active',
        is_active: true,
        enforceLeadQuota: true,
        externalEligible: false,
        firstActivatedAt: existing.firstActivatedAt || new Date(),
      });
      logger.info('[Meta] unmapped pool campaign re-armed', { slug: META_UNMAPPED_SLUG });
    }
  } else {
    await Campaign.create({
      name: '[Meta] Unmapped',
      slug: META_UNMAPPED_SLUG,
      type: DEFAULT_CAMPAIGN_TYPE,
      status: 'active',
      is_active: true,
      enforceLeadQuota: true,
      externalEligible: false,
      // Locks the slug immediately (campaignService immutability rule) so
      // admin CRUD can never rename/clear the reserved handle from under
      // every future unmapped lead.
      firstActivatedAt: new Date(),
      description: 'Auto-created held pool for Meta Lead Ads leads whose form has no active mapping (or whose route is undeliverable). enforceLeadQuota quarantines every lead here into the admin held queue — never delivered free, never lost on the System Agent.',
      createdBy: systemAgentId,
    });
    logger.info('[Meta] unmapped pool campaign created', { slug: META_UNMAPPED_SLUG });
  }

  const { drainMetaInbox, armMetaLeadAds } = await import('../services/metaLeadService.js');
  setInterval(() => {
    drainMetaInbox().catch((err) => logger.warn('[Meta] inbox drain failed', { error: err?.message }));
  }, 30_000);
  // Arm ONLY now — pool ensured + worker scheduled. The webhook 503s until
  // this point (the server shell keeps routes serving even on init failure).
  armMetaLeadAds();
  drainMetaInbox().catch((err) => logger.warn('[Meta] boot drain failed', { error: err?.message }));
  logger.info('[Meta] leadgen inbox worker started (30s interval)');
}

/**
 * Connect Facebook boot (docs/plans/facebook-connect-self-serve.md §0):
 * validate the agent-ads campaign every self-serve connection routes into,
 * then start the provisioning worker + daily token-health probe. Called only
 * when META_OAUTH_ENABLED (inside the META_LEAD_ADS_ENABLED block); throws on
 * failure — boot-fatal by design.
 */
async function ensureMetaOauth() {
  // Tests own their fixtures (the campaign row can only exist AFTER boot ran
  // the migrations) — soft-skip there; production stays boot-fatal.
  const isTest = process.env.NODE_ENV === 'test';
  const campaignId = process.env.META_AGENT_ADS_CAMPAIGN_ID;
  if (!campaignId) {
    if (isTest) { logger.warn('[MetaConnect] META_AGENT_ADS_CAMPAIGN_ID unset (test) — ensure skipped'); return; }
    throw new Error('META_OAUTH_ENABLED=true requires META_AGENT_ADS_CAMPAIGN_ID');
  }
  const campaign = await Campaign.findByPk(campaignId);
  if (!campaign) {
    if (isTest) { logger.warn('[MetaConnect] agent-ads campaign missing (test) — ensure skipped'); return; }
    throw new Error(`META_AGENT_ADS_CAMPAIGN_ID ${campaignId} not found`);
  }
  // "Agents pay with ad spend": EITHER quota trigger would start charging
  // credits per lead — both must be off, and the campaign must accept intake.
  const drift = campaign.status !== 'active' || !campaign.is_active
    || campaign.enforceLeadQuota !== false
    || (Number.isInteger(campaign.leadPriceCents) && campaign.leadPriceCents > 0);
  if (drift) {
    await campaign.update({
      status: 'active', is_active: true, enforceLeadQuota: false, leadPriceCents: null,
    });
    logger.info('[MetaConnect] agent-ads campaign re-armed', { campaignId });
  }

  if (isTest) return; // jest drives drains manually — never leak intervals

  const { drainMetaConnections, probeConnectionsHealth } = await import('../services/metaConnectService.js');
  setInterval(() => {
    drainMetaConnections().catch((err) => logger.warn('[MetaConnect] drain failed', { error: err?.message }));
  }, 60_000);
  setInterval(() => {
    probeConnectionsHealth().catch((err) => logger.warn('[MetaConnect] health probe failed', { error: err?.message }));
  }, 6 * 3600 * 1000);
  drainMetaConnections().catch(() => {});
  logger.info('[MetaConnect] provisioning worker started (60s) + health probe (6h)');
}
