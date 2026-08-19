/**
 * The DISPATCH stage of lead capture — everything that happens AFTER the create
 * transaction commits.
 *
 * Lifted verbatim out of prospectService.createProspect (P3-1). It is one
 * cohesive concern with one rule holding it together: none of it may fail or
 * slow the capture. So it is uniformly post-commit and fire-and-forget — DNC
 * scrubbing, the Lyfe delivery webhook and the held-queue ping, the Meta and
 * TikTok CAPI pairs, the Redeem Ops entitlement hook, the enrichment drain, the
 * referral share link, and the AI screening dial.
 *
 * Statement ORDER here is load-bearing and unchanged: DNC scrubbing runs before
 * the webhook so a held lead stays suppressed; the CAPI dispatches run before
 * the entitlement hook so capture-time events see the prospect exactly as they
 * did; the screening dial is deliberately last.
 *
 * The stage used to read ~22 variables out of the enclosing closure. They are
 * now named fields of `ctx`, and the four values the caller needs back are named
 * fields of the return value.
 */
import {
  buildLeadCreatedPayload,
  buildLeadHeldPayload,
  destinationForAgent,
  externalIdForDestination,
} from './prospectHelpers.js';
import { customerHostOrigin, normalizeCustomerHostChoice } from '../utils/customerHost.js';

/**
 * @param {object} args
 * @param {object} args.d Injected dependencies (the prospectService `d` object).
 * @param {object} args.m Injected models (the prospectService `m` object).
 */
export function makeDispatchRunner({ d, m }) {
  /**
   * @param {object} ctx
   * @param {object} ctx.prospect The committed row.
   * @param {boolean} ctx.quarantined Whether the lead was held.
   * @param {string|null} ctx.heldReason Why, when it was.
   * @param {string|null} ctx.assignedAgentId The committed assignment (null when held).
   * @param {boolean} ctx.dncHeld The lead was born dnc_pending (block mode).
   * @param {boolean} ctx.dncFlagApplies DNC runs in flag mode for this lead.
   * @param {boolean} ctx.screeningHeld The lead is awaiting an AI screening call.
   * @param {boolean} ctx.deliveriesPlanned Capture txn planned platform-delivery rows (§3.3.1).
   * @param {string|null} ctx.externalAgentId MKTR Leads buyer, when external.
   * @param {object|null} ctx.sourceCampaign Campaign (pixel overrides, design_config).
   * @param {object|null} ctx.sourceQrTag QR tag, for the webhook payload.
   * @param {object|null} ctx.resolvedAgent Partial agent from QR/group routing (fallback fields).
   * @param {object|null} ctx.agentGroup Routing group, for the webhook payload.
   * @param {string} ctx.routingMode How the lead was routed.
   * @param {string|undefined} ctx.eventId Meta/TikTok Lead dedup id.
   * @param {string|undefined} ctx.registrationEventId Quiz CompleteRegistration dedup id.
   * @param {string|null} ctx.eventSourceUrl Capture page URL.
   * @param {string|undefined} ctx.fbp Meta browser id.
   * @param {string|undefined} ctx.fbc Meta click id.
   * @param {string|undefined} ctx.ttclid TikTok click id.
   * @param {string|undefined} ctx.ttp TikTok browser id.
   * @param {string|undefined} ctx.clientIp Caller IP, for CAPI.
   * @param {string|undefined} ctx.clientUserAgent Caller UA, for CAPI.
   *
   * @returns {Promise<{
   *   assignedAgent: object|null, prospectWithCampaign: object,
   *   shareUrl: string|null, leadCapturedOutcome: Promise|null
   * }>} What the caller returns to the controller.
   */
  return async function runDispatch(ctx) {
    const {
      prospect,
      quarantined,
      heldReason,
      assignedAgentId,
      dncHeld,
      dncFlagApplies,
      screeningHeld,
      deliveriesPlanned,
      externalAgentId,
      sourceCampaign,
      sourceQrTag,
      resolvedAgent,
      agentGroup,
      routingMode,
      eventId,
      registrationEventId,
      eventSourceUrl,
      fbp,
      fbc,
      ttclid,
      ttp,
      clientIp,
      clientUserAgent,
    } = ctx;

    // --- DNC scrubbing (post-commit, synchronous before dispatch) ---
    // Block mode: the lead was born held (dnc_pending). Check, then release-on-clear (which
    // fires its own first lead.created) or keep held (dnc_registered) — so the normal
    // lead.created below stays suppressed (quarantined). Flag mode: check + record so the
    // lead.created payload below carries the result; the lead delivers regardless.
    if (dncHeld) {
      await d.gateHeldDncLead(prospect).catch((err) =>
        d.logger.error('[DNC] gate error', { error: err?.message || String(err) })
      );
    } else if (dncFlagApplies) {
      await d
        .dncCheckAndRecord(prospect)
        .catch((err) => d.logger.error('[DNC] check error', { error: err?.message || String(err) }));
    }

    // --- Webhook dispatch (AFTER transaction commits, fire-and-forget) ---
    // Always load the assigned agent's provenance (lyfeId/mktrLeadsId) by id — NOT
    // the possibly-partial resolvedAgent from QR/group routing, which lacks it — so
    // we route to the right app and send the destination-correct external id.
    let agentForWebhook = null;
    let leadDestination = null;
    if (assignedAgentId) {
      const agentRecord = await m.User.findByPk(assignedAgentId, {
        attributes: ['id', 'lyfeId', 'mktrLeadsId', 'phone', 'email', 'firstName', 'lastName'],
      });
      if (agentRecord) {
        leadDestination = destinationForAgent(agentRecord);
        agentForWebhook = {
          phone: agentRecord.phone || resolvedAgent?.phone || null,
          email: agentRecord.email || resolvedAgent?.email || null,
          name: `${agentRecord.firstName || ''} ${agentRecord.lastName || ''}`.trim() || resolvedAgent?.name || null,
          id: externalIdForDestination(agentRecord, leadDestination),
        };
      }
    }

    // Suppress the Lyfe 'lead.created' delivery webhook when there is no internal
    // agent to deliver to:
    //  - quarantined (held under lead quota) — no agent yet; it fires on release
    //    (slice 4) as the first lead.created.
    //  - external (MKTR Leads) — the existing subscriber is the Lyfe app, and an
    //    external buyer lead must NEVER be dispatched to it (no external subscriber
    //    exists yet; destination-aware routing lands later in webhookService).
    if (!quarantined && !externalAgentId) {
      d.dispatchEvent('lead.created', () =>
        buildLeadCreatedPayload(
          prospect,
          routingMode,
          agentForWebhook,
          assignedAgentId,
          sourceCampaign,
          sourceQrTag,
          agentGroup
        ),
        { destination: leadDestination }
      ).catch((err) => {
        d.logger.error('[Webhook] dispatch error', { error: err?.message || String(err) });
      });
      // Suppressed-person new-lead propagation rides webhookService's
      // flush-time catchup choke point (tracker "propagate") — no per-site
      // hook needed here.
    }

    // Held (no_funded_agent) → ping the mktr-leads admin held queue so a pending
    // lead is never silent. ONLY this reason: the external (no_funded_external_buyer)
    // hold is a DIFFERENT, fenced pool that is NOT in that admin queue, so it must
    // not ping. Gated by HELD_LEAD_PING_ENABLED; the sweep is the completeness net.
    if (
      quarantined &&
      heldReason === 'no_funded_agent' &&
      String(process.env.HELD_LEAD_PING_ENABLED || 'false').toLowerCase() === 'true'
    ) {
      d.dispatchEvent('lead.held', () => buildLeadHeldPayload(prospect, sourceCampaign, heldReason), {
        destination: 'mktr_leads',
      }).catch((err) => {
        d.logger.error('[Webhook] lead.held dispatch error', { error: err?.message || String(err) });
      });
    }

    // em/ph gate for every submit-time CAPI dispatch (Meta + TikTok), derived
    // from the consent ledger ONCE — the capture txn just committed, so the
    // capture-hook contact event (with its OTP `verified` stamp) is visible.
    // FAIL CLOSED on any lookup error: the events still fire, without em/ph.
    // The stored consent_contact boolean keeps being WRITTEN at capture
    // (evidence/backfill) but is no longer read here (3sites).
    let capiMarketingConsent = false;
    try {
      capiMarketingConsent = (await d.canMarketTo({
        consumerId: prospect.consumerId || null,
        phone: prospect.phone || null,
        channel: 'all',
        campaignId: prospect.campaignId || null,
      })) === true;
    } catch (err) {
      d.logger.warn('[CAPI] canMarketTo failed — omitting em/ph (fail-closed)', {
        error: err?.message || String(err),
      });
    }

    // Meta + TikTok submit-time dispatch (ads-centralisation §3.3.5), at the
    // same statement position the four direct sends held. Row-ownership
    // routing: pairs the capture txn planned into platform_deliveries are
    // delivered through the ledger (inline claim now, worker later); pairs
    // WITHOUT rows fire the legacy closures below — exactly the pre-ledger
    // direct sends, permanently kept for the planning-off / savepoint-failed
    // path. The whole block is fire-and-forget: zero new awaited work on the
    // capture path (§3.4). Per-campaign pixel overrides ride as before.
    const legacyMetaCtx = {
      fbp,
      fbc,
      eventSourceUrl,
      clientIp,
      clientUserAgent,
      pixelIdOverride: sourceCampaign?.metaPixelId || undefined,
      marketingConsent: capiMarketingConsent,
    };
    const tiktokCtxBase = {
      ttclid,
      ttp,
      eventSourceUrl,
      clientIp,
      clientUserAgent,
      pixelIdOverride: sourceCampaign?.tiktokPixelId || undefined,
      marketingConsent: capiMarketingConsent,
    };
    d.dispatchSubmitDeliveries({
      prospect,
      plannedOk: deliveriesPlanned === true,
      marketingConsent: capiMarketingConsent,
      legacy: {
        // Meta CAPI Lead (guard inside sendLeadEvent).
        metaLead: () => {
          d.sendLeadEvent(prospect, { eventId, ...legacyMetaCtx }).catch((err) => {
            d.logger.error('[CAPI] sendLeadEvent error', { error: err?.message || String(err) });
          });
        },
        // Meta CAPI CompleteRegistration — only when the browser sent a
        // registrationEventId (the quiz reveal happened), with that same id so
        // Meta dedups it against the Pixel CompleteRegistration fired at the
        // reveal. No-op closure absent for non-quiz leads.
        metaCompleteRegistration: registrationEventId
          ? () => {
              d.sendCompleteRegistrationEvent(prospect, { eventId: registrationEventId, ...legacyMetaCtx }).catch((err) => {
                d.logger.error('[CAPI] sendCompleteRegistrationEvent error', { error: err?.message || String(err) });
              });
            }
          : null,
        // TikTok mirror of the Meta pair, deduped via the shared event ids.
        tiktokLead: () => {
          d.sendTikTokLeadEvent(prospect, { eventId, ...tiktokCtxBase }).catch((err) => {
            d.logger.error('[TikTok] sendTikTokLeadEvent error', { error: err?.message || String(err) });
          });
        },
        tiktokCompleteRegistration: registrationEventId
          ? () => {
              d.sendTikTokCompleteRegistrationEvent(prospect, { eventId: registrationEventId, ...tiktokCtxBase }).catch((err) => {
                d.logger.error('[TikTok] sendTikTokCompleteRegistrationEvent error', { error: err?.message || String(err) });
              });
            }
          : null,
      },
    }).catch((err) => {
      d.logger.error('[delivery] submit dispatch error', { error: err?.message || String(err) });
    });

    // Redeem Ops reward-entitlement hook — post-commit, fire-and-forget (a
    // Redeem Ops failure must never fail or slow lead capture). No-op unless
    // bootstrap registered the callback (module flag on). Idempotent downstream
    // via the unique (activationId, prospectId) anchor.
    // Screening holds ARE reward-eligible (plan D8): the consumer earned the
    // signup reward by verified signup — screening gates AGENT delivery, not
    // consumer rewards. Quota/DNC/external holds stay excluded as before.
    // The hook's ISSUANCE result is kept as an always-resolving promise for the
    // caller: the controller chains the confirmation email on it so a queued
    // merged draw email (drawEmailQueued) suppresses the near-duplicate generic
    // confirmation — an observed outcome, never a prediction, so a skip can
    // never orphan a signup with zero emails. Still fire-and-forget for the
    // capture path itself (errors resolve to null, logged as before).
    let leadCapturedOutcome = null;
    if (!quarantined || heldReason === 'screening_pending') {
      try {
        const hookResult = d.onLeadCaptured?.(prospect);
        if (hookResult && typeof hookResult.then === 'function') {
          leadCapturedOutcome = hookResult.catch((err) => {
            d.logger.error('[RedeemOps] onLeadCaptured error', { error: err?.message || String(err) });
            return null;
          });
        } else if (hookResult != null) {
          leadCapturedOutcome = Promise.resolve(hookResult);
        }
      } catch (err) {
        d.logger.error('[RedeemOps] onLeadCaptured error', { error: err?.message || String(err) });
      }
    }

    // Enrichment: opportunistic post-commit drain of the map-job outbox —
    // fire-and-forget (the job row is already durable; the sweep re-drains).
    d.drainMapJobs({ limit: 5 }).catch((err) => {
      d.logger.warn('[enrichment] post-capture drain failed', { error: err?.message || String(err) });
    });

    // Pre-load agent + prospect-with-campaign for the caller's fire-and-forget
    // email side-effects. The campaign's design_config.customerHost drives the
    // confirmation-email brand, so load the campaign (with design_config) for
    // EVERY prospect — not only when an agent is assigned.
    let assignedAgent = null;
    if (assignedAgentId) {
      assignedAgent = await m.User.findByPk(assignedAgentId);
    }
    const prospectWithCampaign =
      (await m.Prospect.findByPk(prospect.id, {
        include: [{ association: 'campaign', attributes: ['id', 'name', 'design_config'] }],
      })) || prospect;

    // Mint the prospect's ONE canonical referral share link now, on the campaign's
    // canonical host, so the confirmation email and the SPA share dialog hand out the
    // identical /share/{slug}. Non-blocking: a failure must never break lead creation —
    // the email + SPA fall back to the long ?ref= URL. Injected via deps so DI unit tests
    // can stub it (keeps them DB-free).
    let shareUrl = null;
    const shareCampaignId = prospect.campaignId;
    if (shareCampaignId) {
      try {
        const hostChoice = normalizeCustomerHostChoice(
          prospectWithCampaign?.campaign?.design_config?.customerHost
        );
        const origin = customerHostOrigin(hostChoice);
        const { url } = await d.getOrCreateProspectShareLink({
          prospectId: prospect.id,
          campaignId: shareCampaignId,
          origin,
        });
        shareUrl = `${origin}${url}`;
      } catch (err) {
        d.logger.warn('Referral share link mint failed (non-blocking)', {
          prospectId: prospect.id,
          err: err?.message,
        });
      }
    }

    // AI screening dial trigger (plan §5.3) — LAST on purpose: after the CAPI
    // dispatches (capture-time events must see the prospect exactly as today)
    // and the entitlement hook. Fire-and-forget; any failure leaves the held
    // row for the sweep. DNC-held leads are NOT triggered here — dncGate hands
    // off and dials on clear (§6).
    // SCHEDULE, don't dial: the first attempt waits cfg.dialDelaySeconds so the
    // consumer can read the success page's "an automated call is coming" notice
    // before their phone rings (§7.1a).
    if (screeningHeld) {
      d.scheduleScreeningAttempt(prospect, { campaign: sourceCampaign }).catch((err) =>
        d.logger.error('[Screening] capture dial trigger error', { error: err?.message || String(err) })
      );
    }

    return { assignedAgent, prospectWithCampaign, shareUrl, leadCapturedOutcome };
  };
}
