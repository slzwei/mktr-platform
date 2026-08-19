/**
 * The PERSIST stage of lead capture — the single transaction that turns a
 * validated, gated, routed lead into rows.
 *
 * Lifted verbatim out of prospectService.createProspect (P3-1), which had grown
 * to ~1,200 lines by inlining every stage of the pipeline. This was the densest
 * part: one transaction that decides the assignment, applies the DNC and
 * screening holds, resolves the consumer spine, writes the prospect, the consent
 * ledger, the enrichment outbox, two activities, the credit deduct and the QR
 * analytics bump — six concerns sharing one `t`.
 *
 * It reached all of that through the enclosing closure. Everything it read is
 * now a named field of `ctx`, and everything it wrote back is a named field of
 * the return value, so the data flow across this boundary is readable without
 * holding the whole function in your head.
 *
 * Behaviour is unchanged, deliberately and completely: the statement order, the
 * savepoint isolation, the "never override an existing quarantine" precedence
 * between the quota / DNC / screening gates, and the throw contract are all as
 * they were. The only difference is that `dncIntendedAgentId` and
 * `dncAlreadyCharged` are now locals — the caller never read them.
 */
import { bakeHoldTargetAgentId } from './dncGate.js';
import { signupActivityDescription } from '../utils/sourceLabel.js';

/**
 * @param {object} args
 * @param {object} args.d Injected dependencies (the prospectService `d` object).
 * @param {object} args.m Injected models (the prospectService `m` object).
 */
export function makeCreateTxRunner({ d, m }) {
  /**
   * @param {object} ctx Everything the transaction needs from the stages before it.
   * @param {object} ctx.incoming The assembled Prospect attributes.
   * @param {object|null} ctx.user The requesting user, for activity attribution.
   * @param {object|null} ctx.sourceCampaign The resolved campaign (quiz definition, name).
   * @param {object|null} ctx.sourceQrTag The resolved QR tag, for the analytics bump.
   * @param {string|null} ctx.assignedAgentId Internal routing's pick, pre-quota.
   * @param {string|null} ctx.externalAgentId MKTR Leads buyer, when this is an external lead.
   * @param {boolean} ctx.externalHold External-eligible + consented but unfunded.
   * @param {string|null} ctx.externalHoldReason Quarantine reason for that hold.
   * @param {string} ctx.routeVia How the agent was reached (qr/group/direct/…).
   * @param {boolean} ctx.dncBlockApplies DNC is in block mode for this lead.
   * @param {boolean} ctx.dncWillCheck A DNC check will run post-commit (block or flag mode).
   * @param {boolean} ctx.screeningWanted The campaign wants an AI screening call first.
   * @param {boolean} ctx.otpMarkerLive The durable proof this phone was OTP-verified.
   * @param {string|null} ctx.eventSourceUrl Capture page URL, for the consent ledger.
   * @param {boolean|undefined} ctx.consentContact Marketing-contact opt-in.
   * @param {boolean|undefined} ctx.consentTerms Terms acceptance.
   * @param {string|undefined} ctx.consentCopyVersion Wording era of the consent block.
   * @param {object|null} ctx.externalConsent Third-party-disclosure evidence.
   * @param {object|null} ctx.dncConsent DNC-consent evidence.
   * @param {Array} ctx.acceptedProfileFacts Validated profile-question facts.
   * @param {string|undefined} ctx.eventId Meta/TikTok Lead dedup id (server-generated when the client omits one).
   * @param {string|undefined} ctx.registrationEventId Quiz CompleteRegistration dedup id.
   * @param {string|undefined} ctx.registrationEventAt Browser reveal timestamp (clamped ISO) — the CReg deadline anchor.
   *
   * @returns {Promise<{
   *   prospect: object, quarantined: boolean, heldReason: string|null,
   *   finalAgentId: string|null, dncHeld: boolean, screeningHeld: boolean,
   *   deliveriesPlanned: boolean
   * }>} The committed row plus the outcome flags the post-commit stages read.
   */
  return async function runCreateTx(ctx) {
    const {
      incoming,
      user,
      sourceCampaign,
      sourceQrTag,
      assignedAgentId,
      externalAgentId,
      externalHold,
      externalHoldReason,
      routeVia,
      dncBlockApplies,
      dncWillCheck,
      screeningWanted,
      otpMarkerLive,
      eventSourceUrl,
      consentContact,
      consentTerms,
      consentCopyVersion,
      externalConsent,
      dncConsent,
      acceptedProfileFacts,
      eventId,
      registrationEventId,
      registrationEventAt,
    } = ctx;

    let quarantined = false;
    let heldReason = null;
    let finalAgentId = assignedAgentId;
    // DNC block-mode hold bookkeeping — written onto the row below; the caller
    // only needs to know THAT the lead was held, not who it was held for.
    let dncHeld = false;
    let dncIntendedAgentId = null;
    let dncAlreadyCharged = false;
    // Screening hold bookkeeping (plan §5.2) — mirrors the DNC shape.
    let screeningHeld = false;
    // Platform-delivery ledger planning outcome (ads-centralisation §3.3.1) —
    // false = the legacy direct senders cover this prospect.
    let deliveriesPlanned = false;

    const prospect = await d.sequelize.transaction(async (t) => {
      // The internal quota gate applies ONLY to the internal path. For external
      // leads default to a plain "assign" directive so the shared activity/deduct
      // code below stays correct (external is charged authoritatively, not metered).
      let decision = { action: 'assign', assignedAgentId, charged: false, via: routeVia };
      if (externalHold) {
        // External-eligible + consented but no funded buyer → HOLD (never System Agent,
        // never charged). The distinct quarantineReason fences this lead off from the
        // internal release sweep so it can never be delivered to Lyfe.
        decision = { action: 'quarantine', quarantineReason: externalHoldReason, charged: false, via: routeVia };
      } else if (!externalAgentId) {
        decision = await d.decideAssignment({
          campaign: sourceCampaign,
          routing: { agentId: assignedAgentId, via: routeVia },
          campaignId: incoming.campaignId,
          transaction: t,
          charge: d.chargeLeadCredit,
        });
      }

      // Hold-target bake rule — shared with the Retell capture path (P1-3);
      // the rule itself is documented on bakeHoldTargetAgentId in dncGate.js.
      const bakeIntendedAgentId = (candidateId) =>
        bakeHoldTargetAgentId(candidateId, { routeVia, User: m.User, transaction: t });

      // DNC block-mode gate: a normally-assignable INTERNAL lead is HELD pending a DNC
      // check (released post-commit on clear). Never overrides an existing quarantine
      // (quota / external) or an external-buyer route. The credit is charged on release
      // (unless decideAssignment already charged a funded gated route → dncAlreadyCharged).
      if (dncBlockApplies && decision.action !== 'quarantine' && !externalAgentId) {
        dncIntendedAgentId = await bakeIntendedAgentId(decision.assignedAgentId ?? assignedAgentId ?? null);
        dncAlreadyCharged = decision.charged === true;
        dncHeld = true;
        decision = { action: 'quarantine', quarantineReason: 'dnc_pending', charged: dncAlreadyCharged, via: routeVia };
      }

      // Screening gate (plan §5.2): a normally-assignable INTERNAL lead is HELD
      // pending the AI screening call. Sits AFTER the DNC block on purpose —
      // when both gates apply the lead is born dnc_pending and dncGate hands
      // off to screening on clear (never dial an unscrubbed number, §6).
      let screeningIntendedAgentId = null;
      let screeningAlreadyCharged = false;
      if (screeningWanted && decision.action !== 'quarantine' && !externalAgentId) {
        screeningIntendedAgentId = await bakeIntendedAgentId(decision.assignedAgentId ?? assignedAgentId ?? null);
        screeningAlreadyCharged = decision.charged === true;
        screeningHeld = true;
        decision = { action: 'quarantine', quarantineReason: 'screening_pending', charged: screeningAlreadyCharged, via: routeVia };
      }

      quarantined = decision.action === 'quarantine';
      heldReason = quarantined ? decision.quarantineReason : null;
      finalAgentId = quarantined ? null : (decision.assignedAgentId ?? null);

      // Consumer spine (docs/plans/consumer-spine-and-consent-ledger.md §2.3):
      // resolve-or-create the cross-campaign person for this already-normalized
      // phone INSIDE A SAVEPOINT — a spine failure rolls back the savepoint
      // only and capture proceeds with consumerId null (reconciler heals).
      // Runs AFTER the per-campaign 409 dupe check so duplicates never bump
      // signupCount. call_bot never links (to_number ambiguity — see
      // consumerService.js); `verified` is the single OTP-marker read above.
      const consumerId = incoming.leadSource === 'call_bot'
        ? null
        : await d.resolveConsumerForCaptureTx(t, {
            phone: incoming.phone,
            firstName: incoming.firstName,
            lastName: incoming.lastName,
            email: incoming.email,
            verified: otpMarkerLive,
          });

      const newProspect = await m.Prospect.create(
        {
          ...incoming,
          consumerId,
          assignedAgentId: finalAgentId,
          externalAgentId,
          quarantinedAt: quarantined ? new Date() : null,
          quarantineReason: quarantined ? decision.quarantineReason : null,
          // DNC: mark pending up-front (crash-safe — the backfill finds a stranded row);
          // stash the intended agent so the post-commit clear-release knows who to deliver to.
          ...(dncWillCheck ? { dncStatus: 'pending' } : {}),
          ...(dncHeld ? { dncMetadata: { intendedAgentId: dncIntendedAgentId, alreadyCharged: dncAlreadyCharged } } : {}),
          ...(screeningHeld
            ? { screeningMetadata: { intendedAgentId: screeningIntendedAgentId, alreadyCharged: screeningAlreadyCharged, attempts: {} } }
            : {}),
        },
        { transaction: t }
      );

      // Consent ledger (PR B, plan §3.1): person-level evidence for this
      // capture — savepoint-isolated + non-blocking like the resolver; every
      // input also lives on the prospect row, so backfillConsentEvents can
      // re-derive a missed write. No-op when consumerId is null (call_bot /
      // unlinked rows carry no person-level evidence until reconciled).
      await d.recordCaptureConsentEventsTx(t, {
        consumerId,
        prospectId: newProspect.id,
        campaignId: newProspect.campaignId || null,
        sourceUrl: eventSourceUrl || null,
        verified: otpMarkerLive,
        contact: consentContact,
        copyVersion: consentCopyVersion,
        terms: consentTerms,
        externalConsent,
        dncConsent,
        drawTerms: incoming.consentMetadata?.drawTerms || null,
      });

      // Enrichment outbox (docs/plans/consumer-profile-enrichment.md §5):
      // freeze the normalized fact snapshot and enqueue the map job IN THIS
      // transaction (crash-safe — Codex R1 #5), savepoint-isolated like the
      // spine resolver: enrichment must never fail capture; the nightly
      // sweep re-drains anything a crash or savepoint rollback loses.
      try {
        await d.sequelize.transaction({ transaction: t }, async (sp) => {
          const snapshot = d.buildFactSnapshot({
            demographics: newProspect.demographics,
            sourceMetadata: newProspect.sourceMetadata,
            quizDefinition: sourceCampaign?.design_config?.quiz,
            profileFacts: acceptedProfileFacts,
          });
          await d.enqueueMapJobsTx(sp, {
            prospectId: newProspect.id,
            formRevision: newProspect.enrichmentRevision || 1,
            snapshot,
          });
        });
      } catch (enrichErr) {
        d.logger.warn('[enrichment] map-job outbox failed (sweep heals)', {
          error: enrichErr?.message || String(enrichErr),
        });
      }

      // Platform-delivery ledger (ads-centralisation §3.3.1): persist the
      // submit-time delivery obligations (meta/tiktok × lead/creg) IN THIS
      // transaction, savepoint-isolated like the enrichment outbox above —
      // planning must never fail capture. A savepoint failure leaves
      // deliveriesPlanned=false, and the dispatch stage fires the legacy
      // direct senders for exactly this prospect instead.
      if (d.submitPlanningApplies({ prospect: newProspect })) {
        try {
          await d.sequelize.transaction({ transaction: t }, async (sp) => {
            await d.planSubmitDeliveriesTx(sp, {
              prospect: newProspect,
              sourceCampaign,
              eventId,
              registrationEventId,
              registrationEventAt,
            });
          });
          deliveriesPlanned = true;
        } catch (planErr) {
          d.logger.warn('[delivery] submit planning failed (legacy senders cover this prospect)', {
            error: planErr?.message || String(planErr),
          });
        }
      }

      const campaignName = sourceCampaign?.name || 'Unknown Campaign';
      // Source-aware phrase ("via TikTok ad" / "via web form" / "via {name} QR
      // code" …) instead of the old hardcoded "via {qr} QR code", which
      // mislabeled every non-QR lead as "Unknown QR". See utils/sourceLabel.js.
      const activityDescription = signupActivityDescription(campaignName, {
        leadSource: incoming.leadSource,
        qrTag: sourceQrTag,
        sourceMetadata: incoming.sourceMetadata,
      });

      // Activity: created
      await m.ProspectActivity.create(
        {
          prospectId: newProspect.id,
          type: 'created',
          actorUserId: user?.id || null,
          description: activityDescription,
          metadata: {
            leadSource: incoming.leadSource,
            campaignId: newProspect.campaignId,
            qrTagId: newProspect.qrTagId,
          },
        },
        { transaction: t }
      );

      // Activity: assignment outcome (assigned, or held under quota)
      if (quarantined) {
        await m.ProspectActivity.create(
          {
            prospectId: newProspect.id,
            type: 'updated',
            actorUserId: user?.id || null,
            description:
              decision.quarantineReason === 'no_funded_external_buyer'
                ? 'Held — no funded MKTR Leads (external) buyer'
                : decision.quarantineReason === 'dnc_pending'
                  ? 'Held — pending DNC (Do Not Call) check'
                  : decision.quarantineReason === 'screening_pending'
                    ? 'Held — pending AI screening call'
                    : 'Held — no funded agent (lead quota)',
            metadata: { quarantined: true, reason: decision.quarantineReason, via: routeVia },
          },
          { transaction: t }
        );
      } else {
        await m.ProspectActivity.create(
          {
            prospectId: newProspect.id,
            type: 'assigned',
            actorUserId: user?.id || null,
            description: externalAgentId
              ? `Routed to external buyer ${externalAgentId} (MKTR Leads)`
              : `Assigned to agent ${finalAgentId}`,
            metadata: externalAgentId
              ? { externalAgentId }
              : { assignedAgentId: finalAgentId },
          },
          { transaction: t }
        );

        // Deduct lead credit.
        //  - External (MKTR Leads) buyers are PAID leads: the charge is authoritative
        //    — if the buyer's prepaid balance can't be charged, abort the whole create
        //    (rollback) rather than hand over a lead we can't bill.
        //  - Internal stays best-effort, and is skipped when decideAssignment already
        //    charged authoritatively (charged:true) to avoid double-charging.
        if (externalAgentId) {
          const extCharged = await d.deductExternalLeadBalance(externalAgentId, 1, t);
          if (!extCharged) {
            throw new d.AppError('No paid external buyer balance available for this lead.', 409);
          }
        } else if (finalAgentId && decision.charged !== true) {
          await d
            .deductLeadCredit({ agentId: finalAgentId, campaignId: newProspect.campaignId || null, transaction: t })
            .catch((err) => d.logger.error('Failed to deduct credit', { error: err?.message || String(err) }));
        }
      }

      // Update QR tag analytics (atomic to avoid read-modify-write race).
      // A quarantined lead is still a captured conversion, so we count it.
      if (newProspect.qrTagId && sourceQrTag) {
        await sourceQrTag.update(
          {
            analytics: d.sequelize.literal(`
            jsonb_set(
              COALESCE(analytics::jsonb, '{}'),
              '{conversions}',
              to_jsonb(COALESCE((analytics->>'conversions')::int, 0) + 1)
            )
          `),
          },
          { transaction: t }
        );
      }

      // Campaign metrics are now computed from real data (no JSON blob to increment)

      return newProspect;
    });

    return { prospect, quarantined, heldReason, finalAgentId, dncHeld, screeningHeld, deliveriesPlanned };
  };
}
