import { Op } from 'sequelize';
import {
  Prospect,
  User,
  Campaign,
  QrTag,
  Commission,
  Attribution,
  ProspectActivity,
  AgentGroup,
  AgentGroupMember,
  sequelize,
} from '../models/index.js';
import { resolveAssignedAgentId, resolveLeadRouting, getSystemAgentId, resolveLeadAssignment } from './systemAgent.js';
import { deductLeadCredit, chargeLeadCredit, deductExternalLeadBalance } from './leadCredits.js';
import { decideAssignment } from './leadQuota.js';
import { hasValidExternalConsent } from './externalConsent.js';
import { buildProspectWhere } from '../middleware/prospectScope.js';
import { AppError } from '../middleware/errorHandler.js';
import { dispatchEvent } from './webhookService.js';
import {
  sendLeadEvent as metaSendLeadEvent,
  sendCompleteRegistrationEvent as metaSendCompleteRegistrationEvent,
} from './metaCapiService.js';
import {
  sendTikTokLeadEvent,
  sendTikTokCompleteRegistrationEvent,
} from './tiktokEventsService.js';
import { logger } from '../utils/logger.js';
import {
  normalizePhone,
  buildLeadCreatedPayload,
  buildLeadAssignedPayload,
  buildLeadUnassignedPayload,
  destinationForAgent,
  externalIdForDestination,
} from './prospectHelpers.js';
import { scoreQuiz } from './quizScoringService.js';

const PROSPECT_UPDATE_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'company',
  'jobTitle',
  'leadStatus',
  'priority',
  'leadSource',
  'notes',
  'nextFollowUpDate',
  'lastContactDate',
  // assignedAgentId is intentionally NOT updatable via PUT. Reassignment must go through
  // assignProspect (PATCH /:id/assign), which charges, fires the correct webhook, and
  // releases held leads. A raw PUT could otherwise silently reassign with no charge or
  // webhook — and bypass the lead-quota gate.
  'demographics',
  'location',
  'tags',
];

const defaultDeps = {
  models: { Prospect, User, Campaign, QrTag, Commission, Attribution, ProspectActivity, AgentGroup, AgentGroupMember },
  sequelize,
  resolveAssignedAgentId,
  resolveLeadRouting,
  getSystemAgentId,
  resolveLeadAssignment,
  deductLeadCredit,
  deductExternalLeadBalance,
  hasValidExternalConsent,
  chargeLeadCredit,
  decideAssignment,
  buildProspectWhere,
  dispatchEvent,
  sendLeadEvent: metaSendLeadEvent,
  sendCompleteRegistrationEvent: metaSendCompleteRegistrationEvent,
  sendTikTokLeadEvent,
  sendTikTokCompleteRegistrationEvent,
  AppError,
  logger,
};

export function makeProspectService(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };
  const m = { ...defaultDeps.models, ...(overrides.models || {}) };

  /**
   * Create a new prospect (lead capture).
   * Resolves attribution, normalizes input, wraps DB writes in a transaction.
   * Returns { prospect, assignedAgentId } — caller handles email side-effect.
   */
  async function createProspect(body, user, { cookies, headers, meta } = {}) {
    const safeBody = body || {};
    // Prefer controller-supplied meta context; fall back to body fields if any
    // caller posts directly without the controller's extraction step.
    const eventId = meta?.eventId ?? safeBody.eventId;
    const fbp = meta?.fbp ?? safeBody.fbp;
    const fbc = meta?.fbc ?? safeBody.fbc;
    const eventSourceUrl = meta?.eventSourceUrl ?? safeBody.eventSourceUrl;
    const clientIp = meta?.clientIp;
    const clientUserAgent = meta?.clientUserAgent;
    // Quiz CompleteRegistration dedup id (Meta CAPI) + TikTok attribution ids.
    const registrationEventId = meta?.registrationEventId ?? safeBody.registrationEventId;
    const ttclid = meta?.ttclid ?? safeBody.ttclid;
    const ttp = meta?.ttp ?? safeBody.ttp;
    // Consent flags: preserve explicit `false` (user opted out) via !== undefined check.
    const consentContact = safeBody.consent_contact;
    const consentTerms = safeBody.consent_terms;

    // Quiz funnel submission (re-scored server-side after the campaign loads) and
    // ad attribution (UTM). Both stashed in sourceMetadata; neither is a Prospect column.
    const quizSubmission = safeBody.quizResult;
    const utm = {
      ...(safeBody.utm_source ? { utm_source: safeBody.utm_source } : {}),
      ...(safeBody.utm_medium ? { utm_medium: safeBody.utm_medium } : {}),
      ...(safeBody.utm_campaign ? { utm_campaign: safeBody.utm_campaign } : {}),
      ...(safeBody.utm_content ? { utm_content: safeBody.utm_content } : {}),
      ...(safeBody.utm_term ? { utm_term: safeBody.utm_term } : {}),
    };

    // Strip from body so they don't reach Sequelize as bogus Prospect attributes.
    const {
      eventId: _e, fbp: _p, fbc: _c, eventSourceUrl: _u,
      registrationEventId: _re, ttclid: _tc, ttp: _tp,
      consent_contact: _cc, consent_terms: _ct,
      quizResult: _qr,
      utm_source: _us, utm_medium: _um, utm_campaign: _ucmp, utm_content: _ucnt, utm_term: _utm,
      ...bodyWithoutMeta
    } = safeBody;
    const incoming = { ...bodyWithoutMeta };

    const capiSourceMetadata = {
      ...(eventId ? { eventId } : {}),
      ...(fbp ? { fbp } : {}),
      ...(fbc ? { fbc } : {}),
      ...(eventSourceUrl ? { eventSourceUrl } : {}),
      ...(clientIp ? { clientIp } : {}),
      ...(clientUserAgent ? { clientUserAgent } : {}),
      ...(registrationEventId ? { registrationEventId } : {}),
      ...(ttclid ? { ttclid } : {}),
      ...(ttp ? { ttp } : {}),
      ...(consentContact !== undefined ? { consent_contact: consentContact } : {}),
      ...(consentTerms !== undefined ? { consent_terms: consentTerms } : {}),
      ...(Object.keys(utm).length > 0 ? { utm } : {}),
    };
    if (Object.keys(capiSourceMetadata).length > 0) {
      incoming.sourceMetadata = { ...(incoming.sourceMetadata || {}), ...capiSourceMetadata };
    }

    // Capture the campaign the caller explicitly asked for (e.g. a bare
    // /LeadCapture?campaign_id=X link) BEFORE we derive one from a QR tag.
    const explicitCampaignId = incoming.campaignId != null ? incoming.campaignId : null;

    // Bind attribution by session cookie (sid). Most-recently-touched wins
    // (last-touch); createdAt then id DESC are deterministic tiebreakers for a
    // same-millisecond lastTouchAt tie.
    const sid = cookies?.sid || headers?.['x-session-id'];
    if (sid) {
      const attribution = await m.Attribution.findOne({
        where: { sessionId: sid },
        order: [['lastTouchAt', 'DESC'], ['createdAt', 'DESC'], ['id', 'DESC']],
      });
      if (attribution) {
        incoming.attributionId = attribution.id;
        incoming.qrTagId = attribution.qrTagId || incoming.qrTagId;
        incoming.sessionId = sid;
      }
    }

    // If qrTagId is provided but campaignId is missing/null, derive from QR tag
    if (incoming.qrTagId && !incoming.campaignId) {
      const qr = await m.QrTag.findByPk(incoming.qrTagId);
      if (qr?.campaignId) {
        incoming.campaignId = qr.campaignId;
      }
    }

    // Guard: when the caller specified an explicit campaign, a qrTagId — whether
    // it arrived in the request body or via a stale session attribution — is
    // honored ONLY if it provably belongs to that same campaign. Everything else
    // is dropped: a QR for a different campaign, a QR with no campaign at all
    // (campaignId null), or an unknown/deleted QR. Any of those could otherwise
    // skew QR-level agent routing for a campaign the QR does not belong to. Runs
    // before resolveAssignedAgentId so agent resolution never sees the wrong QR.
    if (explicitCampaignId != null && incoming.qrTagId) {
      const boundQr = await m.QrTag.findByPk(incoming.qrTagId);
      const qrBelongsToExplicitCampaign =
        boundQr != null &&
        boundQr.campaignId != null &&
        String(boundQr.campaignId) === String(explicitCampaignId);
      if (!qrBelongsToExplicitCampaign) {
        delete incoming.qrTagId;
        delete incoming.attributionId;
        delete incoming.sessionId;
        incoming.campaignId = explicitCampaignId;
      }
    }

    // Pre-load campaign + QR tag (needed for routing below, the age gate, and quiz scoring).
    const [sourceCampaign, sourceQrTag] = await Promise.all([
      incoming.campaignId ? m.Campaign.findByPk(incoming.campaignId) : null,
      incoming.qrTagId ? m.QrTag.findByPk(incoming.qrTagId) : null,
    ]);

    // External (MKTR Leads) eligibility. INERT until per-source consent capture writes
    // consentMetadata.external — hasValidExternalConsent returns false for all current
    // data, so allowExternal is false and routing takes the internal-only path below,
    // byte-for-byte as before.
    const allowExternal =
      sourceCampaign?.externalEligible === true &&
      d.hasValidExternalConsent({ consentMetadata: incoming.consentMetadata });

    // SINGLE routing pass — exactly one resolver runs, so the per-campaign round-robin
    // cursor advances once and routeVia is never stale:
    //   - external-eligible + consented → unified resolveLeadAssignment (internal +
    //     external pools); it also owns the self/admin/qr tiers, so the QR-override
    //     block below is skipped for these leads.
    //   - everyone else (the live path) → internal-only resolveLeadRouting, unchanged.
    let assignedAgentId = null;
    let externalAgentId = null;
    let externalHold = false; // external-eligible + consented, but no funded buyer → HOLD
    let externalHoldReason = null;
    let routeVia;
    if (allowExternal) {
      const r = await d.resolveLeadAssignment({
        reqUser: user,
        requestedAgentId: body.assignedAgentId,
        campaignId: incoming.campaignId,
        qrTagId: incoming.qrTagId,
        allowExternal: true,
      });
      routeVia = r.via;
      if (r.kind === 'external') {
        externalAgentId = r.externalAgentId; // assignedAgentId stays null (mutually exclusive)
      } else if (r.kind === 'hold') {
        // No funded buyer AND no funded internal pool agent — never hand a monetized,
        // consented lead to the free System Agent. Quarantine it (held) below.
        externalHold = true;
        externalHoldReason = r.holdReason || 'no_funded_external_buyer';
      } else {
        assignedAgentId = r.internalAgentId ?? null;
      }
    } else {
      const routing = await d.resolveLeadRouting({
        reqUser: user,
        requestedAgentId: body.assignedAgentId,
        campaignId: incoming.campaignId,
        qrTagId: incoming.qrTagId,
      });
      assignedAgentId = routing.agentId;
      routeVia = routing.via;
    }

    // Normalize phone to E.164 format
    if (incoming.phone) {
      incoming.phone = normalizePhone(incoming.phone);
    }

    // Enforce: a phone can register once per campaign, but can register for different campaigns
    if (incoming.phone && incoming.campaignId) {
      const existing = await m.Prospect.findOne({
        where: {
          campaignId: incoming.campaignId,
          phone: incoming.phone,
        },
      });
      if (existing) {
        throw new d.AppError('This phone number has already signed up for this campaign.', 409);
      }
    }

    // Handle Date of Birth -> Age mapping + campaign age gate (defense-in-depth;
    // the LeadCapture form's getAgeValidationError already blocks client-side,
    // but a determined caller can POST directly to /api/prospects).
    if (body.date_of_birth) {
      const dob = new Date(body.date_of_birth);
      if (!isNaN(dob.getTime())) {
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const m_ = today.getMonth() - dob.getMonth();
        if (m_ < 0 || (m_ === 0 && today.getDate() < dob.getDate())) {
          age--;
        }

        if (incoming.campaignId) {
          const campaign = await m.Campaign.findByPk(incoming.campaignId, {
            attributes: ['min_age', 'max_age']
          });
          if (campaign) {
            if (campaign.min_age != null && age < campaign.min_age) {
              throw new d.AppError(`Must be at least ${campaign.min_age} years old for this campaign.`, 422);
            }
            if (campaign.max_age != null && age > campaign.max_age) {
              const range = campaign.min_age != null
                ? `${campaign.min_age}-${campaign.max_age}`
                : `up to ${campaign.max_age}`;
              throw new d.AppError(`Only available for ages ${range}.`, 422);
            }
          }
        }

        incoming.demographics = {
          ...(incoming.demographics || {}),
          age: age,
          dateOfBirth: body.date_of_birth,
        };
      }
    }

    // Handle Postal Code -> Location mapping
    if (body.postal_code) {
      incoming.location = {
        ...(incoming.location || {}),
        zipCode: body.postal_code,
        postalCode: body.postal_code,
      };
    }

    // Handle Education and Income mapping
    if (body.education_level || body.monthly_income) {
      incoming.demographics = {
        ...(incoming.demographics || {}),
      };
      if (body.education_level) incoming.demographics.education = body.education_level;
      if (body.monthly_income) incoming.demographics.income = body.monthly_income;
    }

    // --- Quiz funnel: re-score server-side (anti-tamper) and stash on the lead ---
    // The client sends raw answers (+ an advisory result we ignore). We recompute
    // the authoritative profile/readiness/leadScore from the campaign's own quiz
    // definition so a tampered client cannot fake a result. Stored under
    // sourceMetadata.quiz; forwarded verbatim to Lyfe in the lead.created webhook.
    if (quizSubmission && Array.isArray(quizSubmission.answers) && quizSubmission.answers.length > 0) {
      const quizDef = sourceCampaign?.design_config?.quiz;
      let quizMeta;
      if (quizDef && quizDef.enabled) {
        let scored = null;
        try {
          scored = scoreQuiz(quizDef, quizSubmission.answers);
        } catch (err) {
          d.logger.error('[Quiz] scoring failed', { error: err?.message || String(err) });
        }
        quizMeta = {
          quizId: quizDef.quizId || quizSubmission.quizId || null,
          version: quizDef.version ?? quizSubmission.version ?? null,
          answers: quizSubmission.answers,
          result: scored
            ? { profileId: scored.profileId, title: scored.title, readiness: scored.readiness, agentAngle: scored.agentAngle }
            : (quizSubmission.result || null),
          leadScore: scored?.leadScore || null,
          scoredBy: scored ? 'server' : 'client-unverified',
        };
      } else {
        // No quiz definition on the campaign (or disabled): keep the raw answers
        // and the advisory client result, clearly marked unverified.
        quizMeta = {
          quizId: quizSubmission.quizId || null,
          version: quizSubmission.version ?? null,
          answers: quizSubmission.answers,
          result: quizSubmission.result || null,
          scoredBy: 'client-unverified',
        };
      }
      incoming.sourceMetadata = { ...(incoming.sourceMetadata || {}), quiz: quizMeta };
    }

    // --- Routing resolution: reads from QrTag, not Campaign ---
    let routingMode = 'direct';
    let resolvedAgent = null;
    let agentGroup = null;

    // QR-level routing refines the INTERNAL path only; external-eligible leads were
    // already routed by resolveLeadAssignment above (it includes the QR tier), so
    // re-running QR routing here would double-route them.
    if (!allowExternal && sourceQrTag?.agentAssignmentMode === 'round_robin') {
      routingMode = 'round_robin';

      // Query members from join table, ordered by sortOrder
      const members = sourceQrTag.agentGroupId
        ? await m.AgentGroupMember.findAll({
            where: { agentGroupId: sourceQrTag.agentGroupId },
            order: [['sortOrder', 'ASC']],
          })
        : [];

      if (members.length > 0) {
        // Load the group record for webhook metadata
        agentGroup = await m.AgentGroup.findByPk(sourceQrTag.agentGroupId);

        // Atomic round-robin index increment on QrTag
        const [, [updated]] = await m.QrTag.update(
          { roundRobinIndex: d.sequelize.literal('"roundRobinIndex" + 1') },
          { where: { id: sourceQrTag.id }, returning: true }
        ).catch(() => [0, [sourceQrTag]]);

        const idx = (updated?.roundRobinIndex ?? sourceQrTag.roundRobinIndex) % members.length;
        const selectedMember = members[idx];

        resolvedAgent = {
          phone: selectedMember.phone,
          email: selectedMember.email,
          name: selectedMember.name,
        };
      }
    } else if (!allowExternal && sourceQrTag?.assignedAgentId) {
      // Direct FK lookup — faster than phone-based search
      assignedAgentId = sourceQrTag.assignedAgentId;
      routeVia = 'qr';
    } else if (!allowExternal && sourceQrTag?.assignedAgentPhone) {
      // Fallback for QR tags not yet backfilled
      resolvedAgent = {
        phone: sourceQrTag.assignedAgentPhone,
        email: sourceQrTag.assignedAgentEmail,
        name: sourceQrTag.assignedAgentName,
      };
    }

    // Override assignedAgentId with QR-level routing result (by phone lookup)
    if (resolvedAgent?.phone) {
      const agentByPhone = await m.User.findOne({
        where: { phone: resolvedAgent.phone, role: 'agent', isActive: true },
      });
      if (agentByPhone) {
        assignedAgentId = agentByPhone.id;
        routeVia = 'qr';
      }
    }

    // Wrap all DB writes in a transaction for data integrity.
    // Two orthogonal gates compose here:
    //   - External (MKTR Leads): a PAID third-party buyer lead. It bypasses the
    //     internal lead-package quota (a separate pool) and is charged against the
    //     buyer's prepaid balance below — never quarantined here.
    //   - Internal: the lead-quota gate (decideAssignment) may QUARANTINE (hold) the
    //     lead, and for a funded gated route charges a credit authoritatively
    //     (charged:true ⇒ skip the best-effort deduct below to avoid double-charging).
    //     Soft/exempt routes are unchanged: assign + best-effort deduct.
    let quarantined = false;
    let finalAgentId = assignedAgentId;
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
      quarantined = decision.action === 'quarantine';
      finalAgentId = quarantined ? null : (decision.assignedAgentId ?? null);

      const newProspect = await m.Prospect.create(
        {
          ...incoming,
          assignedAgentId: finalAgentId,
          externalAgentId,
          quarantinedAt: quarantined ? new Date() : null,
          quarantineReason: quarantined ? decision.quarantineReason : null,
        },
        { transaction: t }
      );

      const campaignName = sourceCampaign?.name || 'Unknown Campaign';
      const qrTagName = sourceQrTag?.name || sourceQrTag?.label || 'Unknown QR';
      const activityDescription = `Prospect signed up for ${campaignName} campaign via ${qrTagName} QR code`;

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

    // Reflect the committed outcome (null when quarantined) for the rest of the
    // function — webhook dispatch, agent load, and the returned payload.
    assignedAgentId = finalAgentId;

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
    }

    // Meta CAPI dispatch (fire-and-forget; post-commit; guard inside sendLeadEvent)
    d.sendLeadEvent(prospect, {
      eventId,
      fbp,
      fbc,
      eventSourceUrl,
      clientIp,
      clientUserAgent,
      pixelIdOverride: sourceCampaign?.metaPixelId || undefined,
    }).catch((err) => {
      d.logger.error('[CAPI] sendLeadEvent error', { error: err?.message || String(err) });
    });

    // Meta CAPI CompleteRegistration (quiz funnel). Fired server-side only when
    // the browser sent a registrationEventId (the quiz reveal happened), using
    // that same id so Meta dedups it against the Pixel CompleteRegistration fired
    // at the reveal. No-op for non-quiz leads. Guard inside sendCompleteRegistrationEvent.
    if (registrationEventId) {
      d.sendCompleteRegistrationEvent(prospect, {
        eventId: registrationEventId,
        fbp,
        fbc,
        eventSourceUrl,
        clientIp,
        clientUserAgent,
        pixelIdOverride: sourceCampaign?.metaPixelId || undefined,
      }).catch((err) => {
        d.logger.error('[CAPI] sendCompleteRegistrationEvent error', { error: err?.message || String(err) });
      });
    }

    // TikTok Events API dispatch (fire-and-forget; post-commit; guard inside the
    // sender). Mirrors the Meta CAPI pair: a Lead at submit, plus a
    // CompleteRegistration when the quiz reveal fired one — each deduped against
    // the browser ttq pixel via the shared event ids. Per-campaign tiktokPixelId
    // overrides env TIKTOK_PIXEL_ID.
    const tiktokCtxBase = {
      ttclid,
      ttp,
      eventSourceUrl,
      clientIp,
      clientUserAgent,
      pixelIdOverride: sourceCampaign?.tiktokPixelId || undefined,
    };
    d.sendTikTokLeadEvent(prospect, { eventId, ...tiktokCtxBase }).catch((err) => {
      d.logger.error('[TikTok] sendTikTokLeadEvent error', { error: err?.message || String(err) });
    });
    if (registrationEventId) {
      d.sendTikTokCompleteRegistrationEvent(prospect, { eventId: registrationEventId, ...tiktokCtxBase }).catch((err) => {
        d.logger.error('[TikTok] sendTikTokCompleteRegistrationEvent error', { error: err?.message || String(err) });
      });
    }

    // Pre-load agent + prospect-with-campaign for caller's email side-effect
    let assignedAgent = null;
    let prospectWithCampaign = prospect;
    if (assignedAgentId) {
      assignedAgent = await m.User.findByPk(assignedAgentId);
      prospectWithCampaign = await m.Prospect.findByPk(prospect.id, {
        include: [{ association: 'campaign', attributes: ['id', 'name'] }],
      });
    }

    return { prospect, assignedAgentId, assignedAgent, prospectWithCampaign, quarantined };
  }

  /**
   * Get a single prospect by ID, scoped to user access.
   */
  async function getProspect(id, user) {
    const scopeFilter = await d.buildProspectWhere(user);
    const whereConditions = { id, ...scopeFilter };

    const prospect = await m.Prospect.findOne({
      where: whereConditions,
      include: [
        {
          association: 'assignedAgent',
          attributes: ['id', 'firstName', 'lastName', 'email', 'phone'],
        },
        {
          association: 'campaign',
          attributes: ['id', 'name', 'type', 'status', 'description'],
        },
        {
          association: 'qrTag',
          attributes: ['id', 'name', 'type', 'location'],
        },
        {
          association: 'commissions',
          attributes: ['id', 'type', 'amount', 'status', 'earnedDate'],
        },
        {
          association: 'activities',
          attributes: ['id', 'type', 'description', 'metadata', 'createdAt'],
          order: [['createdAt', 'ASC']],
        },
      ],
    });

    if (!prospect) {
      throw new d.AppError('Prospect not found or access denied', 404);
    }

    return prospect;
  }

  /**
   * Update a prospect. Handles status-change-to-won commission logic.
   */
  async function updateProspect(id, body, user) {
    const scopeFilter = await d.buildProspectWhere(user);
    const whereConditions = { id, ...scopeFilter };

    const prospect = await m.Prospect.findOne({
      where: whereConditions,
      include: [{ association: 'assignedAgent', attributes: ['firstName', 'lastName', 'email'] }],
    });

    if (!prospect) {
      throw new d.AppError('Prospect not found or access denied', 404);
    }

    const oldStatus = prospect.leadStatus;
    const oldAssignedAgentId = prospect.assignedAgentId;
    const oldAssignedAgent = prospect.assignedAgent;

    const safeUpdates = Object.fromEntries(Object.entries(body).filter(([k]) => PROSPECT_UPDATE_FIELDS.includes(k)));
    await prospect.update(safeUpdates);

    // (Reassignment / unassignment is handled exclusively by assignProspect — see the
    // PROSPECT_UPDATE_FIELDS note — so PUT no longer needs unassignment side-effects.)

    // If status changed to 'won', create commission and update metrics atomically
    if (oldStatus !== 'won' && safeUpdates.leadStatus === 'won') {
      // Block conversion if assigned to System Agent
      const systemId = await d.getSystemAgentId();
      if (prospect.assignedAgentId && prospect.assignedAgentId === systemId) {
        throw new d.AppError('Lead must be assigned to a real agent before marking as won', 400);
      }

      await d.sequelize.transaction(async (t) => {
        // Create commission for assigned agent
        if (prospect.assignedAgentId) {
          const commissionAmount = parseFloat(process.env.DEFAULT_COMMISSION_AMOUNT || '50');
          await m.Commission.create(
            {
              type: 'conversion',
              amount: commissionAmount,
              status: 'pending',
              description: `Lead conversion: ${prospect.firstName} ${prospect.lastName}`,
              agentId: prospect.assignedAgentId,
              campaignId: prospect.campaignId,
              prospectId: prospect.id,
              earnedDate: new Date(),
            },
            { transaction: t }
          );
        }

        // Campaign metrics are now computed from real data (no JSON blob to increment)

        // Set conversion date
        prospect.conversionDate = new Date();
        await prospect.save({ transaction: t });
      });
    }

    return prospect;
  }

  /**
   * Delete a prospect, scoped to user access.
   */
  async function deleteProspect(id, user) {
    const scopeFilter = await d.buildProspectWhere(user);
    const whereConditions = { id, ...scopeFilter };

    const prospect = await m.Prospect.findOne({ where: whereConditions });

    if (!prospect) {
      throw new d.AppError('Prospect not found or access denied', 404);
    }

    await prospect.destroy();
  }

  /**
   * Assign a single prospect to an agent. Returns { prospect, agent } for email side-effect.
   */
  async function assignProspect(prospectId, agentId, user) {
    const prospect = await m.Prospect.findByPk(prospectId);
    if (!prospect) {
      throw new d.AppError('Prospect not found', 404);
    }

    const previousAgentId = prospect.assignedAgentId;

    // ── Unassign ──
    if (!agentId) {
      await prospect.update({ assignedAgentId: null });

      await m.ProspectActivity.create({
        prospectId: prospect.id,
        type: 'assigned',
        actorUserId: user?.id || null,
        description: 'Unassigned from agent',
        metadata: { previousAgentId },
      });

      // Fire lead.unassigned webhook — but NOT for a HELD (quarantined) lead: Lyfe never
      // received a lead.created for it (the create webhook was suppressed), so an
      // unassigned event would reference a lead Lyfe does not know about.
      if (!prospect.quarantinedAt) {
        // Destination + external id come from the PREVIOUS agent (the assignment
        // is already null). Sourceless previous agent -> null -> default-denied.
        let prevDestination = null;
        let previousAgentExternalId = null;
        if (previousAgentId) {
          const prevAgent = await m.User.findByPk(previousAgentId, {
            attributes: ['id', 'lyfeId', 'mktrLeadsId'],
          });
          prevDestination = destinationForAgent(prevAgent);
          previousAgentExternalId = externalIdForDestination(prevAgent, prevDestination);
        }
        d.dispatchEvent('lead.unassigned', () => buildLeadUnassignedPayload(prospect, previousAgentExternalId), {
          destination: prevDestination,
        });
      }

      return { prospect, agent: null, prospectWithCampaign: prospect };
    }

    // ── Assign ──
    const agent = await m.User.findOne({
      where: { id: agentId, role: 'agent', isActive: true },
    });

    if (!agent) {
      throw new d.AppError('Invalid or inactive agent', 400);
    }

    // An external hold (no funded MKTR Leads buyer) must NEVER be manually released to an
    // internal agent / Lyfe — it was captured for the external buyer pool and can only be
    // delivered via the external channel (or a dedicated conversion flow, not built yet).
    // The auto release-sweep is already fenced off these holds; close the manual path too.
    if (prospect.quarantineReason === 'no_funded_external_buyer') {
      throw new d.AppError(
        'This lead is held for the MKTR Leads (external) buyer pool and cannot be manually assigned to an internal agent.',
        409
      );
    }

    // A manual admin assign is an EXEMPT route (decision a): it always delivers and does
    // a best-effort deduct. If the prospect is currently HELD under lead-quota, this is a
    // RELEASE — clear the hold ATOMICALLY (so a double-click / concurrent sweep can't
    // deliver twice) and fire lead.created, the FIRST delivery to Lyfe (which never saw
    // the suppressed create webhook), NOT lead.assigned.
    if (prospect.quarantinedAt) {
      const [releaseRows] = await d.sequelize.query(
        `UPDATE prospects
            SET "assignedAgentId" = :agentId, "lastContactDate" = NOW(),
                "quarantinedAt" = NULL, "quarantineReason" = NULL, "updatedAt" = NOW()
          WHERE id = :prospectId AND "quarantinedAt" IS NOT NULL
          RETURNING id`,
        { replacements: { agentId, prospectId: prospect.id } }
      );
      const released = Array.isArray(releaseRows) && releaseRows.length > 0;
      await prospect.reload();

      if (!released) {
        // Lost the race — already released elsewhere. Do not double-deliver, and return
        // agent:null so the controller does not email an agent about a lead a concurrent
        // release/sweep already assigned (possibly to a different agent).
        return { prospect, agent: null, prospectWithCampaign: prospect };
      }

      await m.ProspectActivity.create({
        prospectId: prospect.id,
        type: 'assigned',
        actorUserId: user?.id || null,
        description: `Released from hold and assigned to ${agent.firstName} ${agent.lastName}`.trim(),
        metadata: { assignedAgentId: agentId, previousAgentId, released: true },
      });

      await d
        .deductLeadCredit({ agentId, campaignId: prospect.campaignId || null })
        .catch((err) => d.logger.error('Failed to deduct credit', { error: err?.message || String(err) }));

      const prospectWithCampaign = await m.Prospect.findByPk(prospect.id, {
        include: [{ association: 'campaign', attributes: ['id', 'name'] }],
      });

      const releaseDestination = destinationForAgent(agent);
      const agentForWebhook = {
        phone: agent.phone || null,
        email: agent.email || null,
        name: `${agent.firstName || ''} ${agent.lastName || ''}`.trim(),
        id: externalIdForDestination(agent, releaseDestination),
      };
      d.dispatchEvent('lead.created', () =>
        buildLeadCreatedPayload(prospect, 'direct', agentForWebhook, agentId, prospectWithCampaign?.campaign || null, null, null),
        { destination: releaseDestination }
      );

      return { prospect, agent, prospectWithCampaign };
    }

    // ── Normal reassign (not held) ──
    await prospect.update({
      assignedAgentId: agentId,
      lastContactDate: new Date(),
    });

    await m.ProspectActivity.create({
      prospectId: prospect.id,
      type: 'assigned',
      actorUserId: user?.id || null,
      description: `Assigned to agent ${agent.firstName} ${agent.lastName}`.trim(),
      metadata: { assignedAgentId: agentId, previousAgentId },
    });

    await d
      .deductLeadCredit({ agentId, campaignId: prospect.campaignId || null })
      .catch((err) => d.logger.error('Failed to deduct credit', { error: err?.message || String(err) }));

    const prospectWithCampaign = await m.Prospect.findByPk(prospect.id, {
      include: [{ association: 'campaign', attributes: ['id', 'name'] }],
    });

    // Fire lead.assigned webhook
    d.dispatchEvent('lead.assigned', () => buildLeadAssignedPayload(prospect, agent, prospectWithCampaign), {
      destination: destinationForAgent(agent),
    });

    return { prospect, agent, prospectWithCampaign };
  }

  /**
   * Bulk assign prospects to an agent. Returns { affectedCount, agent } for email side-effect.
   */
  async function bulkAssignProspects(prospectIds, agentId, user) {
    if (!prospectIds || !Array.isArray(prospectIds) || !agentId) {
      throw new d.AppError('Prospect IDs array and agent ID are required', 400);
    }

    const agent = await m.User.findOne({
      where: {
        id: agentId,
        role: 'agent',
        isActive: true,
      },
    });

    if (!agent) {
      throw new d.AppError('Invalid or inactive agent', 400);
    }

    const scopeFilter = await d.buildProspectWhere(user);
    const whereConditions = {
      id: { [Op.in]: prospectIds },
      // Bulk assign skips HELD leads — releasing a held lead must deliver it to Lyfe,
      // which bulk update can't do per-lead. Release held leads via single assign
      // (PATCH /:id/assign) or the auto-release sweep.
      quarantinedAt: null,
      // Skip rows already assigned to THIS agent (IS DISTINCT FROM semantics —
      // a bare Op.ne would also exclude unassigned NULL rows). Re-assigning a
      // no-op row used to double-charge the agent for a lead they already held.
      [Op.or]: [{ assignedAgentId: null }, { assignedAgentId: { [Op.ne]: agentId } }],
      ...scopeFilter,
    };

    const result = await m.Prospect.update(
      {
        assignedAgentId: agentId,
        lastContactDate: new Date(),
      },
      // RETURNING gives the exact affected rows (no select-then-update race) so
      // credits can be deducted PER CAMPAIGN — a bulk set can span campaigns,
      // and campaign-A leads must never drain campaign-B credits.
      { where: whereConditions, returning: ['id', 'campaignId'] }
    );

    const affectedCount = result[0];
    const affectedRows = result[1] || [];
    if (affectedCount > 0) {
      const countsByCampaign = new Map();
      for (const row of affectedRows) {
        const cId = row.campaignId || null;
        countsByCampaign.set(cId, (countsByCampaign.get(cId) || 0) + 1);
      }
      for (const [cId, count] of countsByCampaign) {
        await d
          .deductLeadCredit({ agentId, campaignId: cId, amount: count })
          .catch((err) => d.logger.error('Failed to deduct credits', { error: err?.message || String(err) }));
      }
    }

    return { affectedCount, agent };
  }

  /**
   * Get prospect statistics for the user's scope.
   */
  async function getProspectStats(user) {
    const whereConditions = await d.buildProspectWhere(user);

    const [totalProspects, prospectsByStatus, prospectsBySource, prospectsByPriority, recentProspects, convertedCount] =
      await Promise.all([
        m.Prospect.count({ where: whereConditions }),
        m.Prospect.findAll({
          where: whereConditions,
          attributes: ['leadStatus', [d.sequelize.fn('COUNT', d.sequelize.col('leadStatus')), 'count']],
          group: ['leadStatus'],
        }),
        m.Prospect.findAll({
          where: whereConditions,
          attributes: ['leadSource', [d.sequelize.fn('COUNT', d.sequelize.col('leadSource')), 'count']],
          group: ['leadSource'],
        }),
        m.Prospect.findAll({
          where: whereConditions,
          attributes: ['priority', [d.sequelize.fn('COUNT', d.sequelize.col('priority')), 'count']],
          group: ['priority'],
        }),
        m.Prospect.findAll({
          where: {
            ...whereConditions,
            createdAt: {
              [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          },
          limit: 10,
          order: [['createdAt', 'DESC']],
          attributes: ['id', 'firstName', 'lastName', 'email', 'leadStatus', 'createdAt'],
          include: [
            {
              association: 'campaign',
              attributes: ['id', 'name'],
            },
          ],
        }),
        m.Prospect.count({
          where: { ...whereConditions, leadStatus: 'won' },
        }),
      ]);
    const conversionRate = totalProspects > 0 ? ((convertedCount / totalProspects) * 100).toFixed(2) : 0;

    return {
      totalProspects,
      conversionRate: parseFloat(conversionRate),
      byStatus: prospectsByStatus.map((item) => ({
        status: item.leadStatus,
        count: parseInt(item.dataValues.count),
      })),
      bySource: prospectsBySource.map((item) => ({
        source: item.leadSource,
        count: parseInt(item.dataValues.count),
      })),
      byPriority: prospectsByPriority.map((item) => ({
        priority: item.priority,
        count: parseInt(item.dataValues.count),
      })),
      recentProspects,
    };
  }

  /**
   * List prospects with pagination, filtering, and auth scoping.
   */
  async function listProspects(user, params) {
    const {
      page = 1,
      limit = 10,
      leadStatus,
      priority,
      leadSource,
      assignedAgentId,
      campaignId,
      search,
      dateFrom,
      dateTo,
      qrTagId,
    } = params;

    const offset = (page - 1) * limit;
    const scopeFilter = await d.buildProspectWhere(user);
    const whereConditions = { ...scopeFilter };

    if (qrTagId) whereConditions.qrTagId = qrTagId;
    if (leadStatus) whereConditions.leadStatus = leadStatus;
    if (priority) whereConditions.priority = priority;
    if (leadSource) whereConditions.leadSource = leadSource;
    if (assignedAgentId) whereConditions.assignedAgentId = assignedAgentId;
    if (campaignId) whereConditions.campaignId = campaignId;

    if (search) {
      const sanitizedSearch = String(search).slice(0, 100).replace(/%/g, '\\%').replace(/_/g, '\\_');
      const likeOp = Op.iLike;
      whereConditions[Op.or] = [
        { firstName: { [likeOp]: `%${sanitizedSearch}%` } },
        { lastName: { [likeOp]: `%${sanitizedSearch}%` } },
        { email: { [likeOp]: `%${sanitizedSearch}%` } },
        { company: { [likeOp]: `%${sanitizedSearch}%` } },
      ];
    }

    if (dateFrom || dateTo) {
      whereConditions.createdAt = {};
      if (dateFrom) whereConditions.createdAt[Op.gte] = new Date(dateFrom);
      if (dateTo) whereConditions.createdAt[Op.lte] = new Date(dateTo);
    }

    const { count, rows: prospects } = await m.Prospect.findAndCountAll({
      where: whereConditions,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']],
      include: [
        {
          association: 'assignedAgent',
          attributes: ['id', 'firstName', 'lastName', 'email'],
        },
        {
          association: 'campaign',
          attributes: ['id', 'name', 'type', 'status'],
        },
        {
          association: 'qrTag',
          attributes: ['id', 'name', 'type'],
        },
      ],
    });

    return {
      prospects,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    };
  }

  /**
   * Schedule a follow-up for a prospect.
   */
  async function scheduleFollowUp(id, { nextFollowUpDate, notes }, user) {
    if (!nextFollowUpDate) {
      throw new d.AppError('Next follow-up date is required', 400);
    }

    const scopeWhere = await d.buildProspectWhere(user);
    const prospect = await m.Prospect.findOne({ where: { id, ...scopeWhere } });

    if (!prospect) {
      throw new d.AppError('Prospect not found or access denied', 404);
    }

    const updateData = {
      nextFollowUpDate: new Date(nextFollowUpDate),
      lastContactDate: new Date(),
    };

    if (notes) {
      updateData.notes = notes;
    }

    const previous = prospect.toJSON();
    await prospect.update(updateData);

    await m.ProspectActivity.create({
      prospectId: prospect.id,
      type: 'updated',
      actorUserId: user?.id || null,
      description: `Prospect updated by ${user?.role || 'system'}`,
      metadata: { before: previous, after: prospect.toJSON() },
    });

    return prospect;
  }

  /**
   * Track a prospect view.
   */
  async function trackProspectView(id, user, { source, userAgent } = {}) {
    const scopeWhere = await d.buildProspectWhere(user);
    const prospect = await m.Prospect.findOne({ where: { id, ...scopeWhere } });

    if (!prospect) {
      throw new d.AppError('Prospect not found or access denied', 404);
    }

    await m.ProspectActivity.create({
      prospectId: prospect.id,
      type: 'viewed',
      actorUserId: user.id,
      description: `Prospect viewed by ${user.firstName || 'agent'} ${user.lastName || ''}`,
      metadata: {
        source: source || 'email_link',
        viewedAt: new Date(),
        userAgent,
      },
    });
  }

  /**
   * List HELD (quarantined) leads, FIFO by quarantinedAt (the release order). Scoped to
   * the caller's access; optionally filtered by campaign. Release is done via the
   * existing assignProspect (PATCH /:id/assign) or the auto-release sweep on top-up.
   */
  async function listHeldProspects(user, params = {}) {
    const { campaignId } = params;
    const limit = Math.min(parseInt(params.limit, 10) || 100, 500);
    const scopeFilter = await d.buildProspectWhere(user);
    const where = { ...scopeFilter, quarantinedAt: { [Op.ne]: null } };
    if (campaignId) where.campaignId = campaignId;

    const { count, rows } = await m.Prospect.findAndCountAll({
      where,
      include: [{ association: 'campaign', attributes: ['id', 'name'] }],
      order: [['quarantinedAt', 'ASC']], // FIFO — oldest held first (the release order)
      limit,
    });

    const held = rows.map((p) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      phone: p.phone,
      email: p.email,
      leadSource: p.leadSource,
      campaignId: p.campaignId,
      campaignName: p.campaign?.name || null,
      quarantinedAt: p.quarantinedAt,
      quarantineReason: p.quarantineReason,
      createdAt: p.createdAt,
    }));

    return { count, held };
  }

  return {
    createProspect,
    getProspect,
    updateProspect,
    deleteProspect,
    assignProspect,
    bulkAssignProspects,
    getProspectStats,
    listProspects,
    listHeldProspects,
    scheduleFollowUp,
    trackProspectView,
  };
}

const _default = makeProspectService();
export const createProspect = _default.createProspect;
export const getProspect = _default.getProspect;
export const updateProspect = _default.updateProspect;
export const deleteProspect = _default.deleteProspect;
export const assignProspect = _default.assignProspect;
export const bulkAssignProspects = _default.bulkAssignProspects;
export const getProspectStats = _default.getProspectStats;
export const listProspects = _default.listProspects;
export const listHeldProspects = _default.listHeldProspects;
export const scheduleFollowUp = _default.scheduleFollowUp;
export const trackProspectView = _default.trackProspectView;
