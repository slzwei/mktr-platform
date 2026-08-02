import { createHash } from 'crypto';
import { Transaction } from 'sequelize';
import {
  Prospect,
  User,
  Campaign,
  QrTag,
  Attribution,
  ProspectActivity,
  AgentGroup,
  AgentGroupMember,
  IdempotencyKey,
  sequelize,
} from '../models/index.js';
import { resolveLeadRouting, getSystemAgentId, resolveLeadAssignment } from './systemAgent.js';
import { makeIdempotencyOps } from './idempotencyProtocol.js';
import { makeProspectReads } from './prospectReadService.js';
import { makeHeldQueueOps } from './prospectHeldQueueService.js';
import { makeAssignmentOps } from './prospectAssignmentService.js';
import { makeCreateTxRunner } from './prospectCreateTx.js';
import { makeDispatchRunner } from './prospectDispatch.js';
import {
  UUID_RE, PROSPECT_UPDATE_FIELDS,
} from './prospectShared.js';
import { deductLeadCredit, chargeLeadCredit, deductExternalLeadBalance } from './leadCredits.js';
import { decideAssignment } from './leadQuota.js';
import { dncEnforcement, formatDncNumber, checkAndRecord as dncCheckAndRecord } from './dncService.js';
import { gateHeldDncLead, dncCaptureGate } from './dncGate.js';
import { hasValidExternalConsent, buildExternalConsentEvidence } from './externalConsent.js';
import { buildDncConsentEvidence } from './dncConsent.js';
import { buildProspectWhere } from './prospectScope.js';
import { AppError } from '../middleware/appError.js';
import { dispatchEvent, persistEventDeliveries, flushDeliveries, hasDeliverableSubscriber } from './webhookService.js';
import {
  sendLeadEvent as metaSendLeadEvent,
  sendCompleteRegistrationEvent as metaSendCompleteRegistrationEvent,
} from './metaCapiService.js';
import {
  sendTikTokLeadEvent,
  sendTikTokCompleteRegistrationEvent,
} from './tiktokEventsService.js';
// Cycle-safe + graph-neutral: leadOutcomeService imports only models,
// metaCapiService and consentService — all already in this module's graph.
import { processLeadOutcome } from './leadOutcomeService.js';
import { getOrCreateProspectShareLink } from './shortlinkService.js';
import { isPhoneVerifiedDurable } from './verifiedPhoneStore.js';
import {
  resolveConsumerForCaptureTx,
  recomputeConsumersByPhone,
  getConsumerJourney,
} from './consumerService.js';
import { recordCaptureConsentEventsTx, canMarketTo } from './consentService.js';
// Enrichment mapper (docs/plans/consumer-profile-enrichment.md §5): leaf
// imports only (models + fence + taxonomy) — no cycle back into this module.
import { buildFactSnapshot, enqueueMapJobsTx, drainMapJobs } from './factMapperService.js';
import { bumpEnrichmentInputTx } from './enrichmentFence.js';
import { getProfileQuestion, resolveAnswer as resolveProfileAnswer } from '../utils/profileQuestionLibrary.js';
import { validateFact } from '../utils/factTaxonomy.js';
import { isV2 as isV2DesignConfig } from '../utils/designConfigV2.js';
// Lead Profile page composer (admin-only, ?include=profile — plan §4). Leaf
// imports only (models + sibling services); no cycle back into this module.
import {
  enrichJourneyProfile, getSignupProfile, getSessionContext, getLyfeDelivery,
  getProspectOutcomes,
} from './leadProfileService.js';
import { customerHostOrigin, normalizeCustomerHostChoice } from '../utils/customerHost.js';
import { sgtDayEndExclusiveMs } from '../utils/sgtTime.js';

// Redeem Ops capture hook (docs/redeem-ops/MKTR_INTEGRATION.md §2): a
// dependency-INVERTED callback — this module never imports Redeem Ops code.
// bootstrap (the composition root) registers the real implementation when the
// module is enabled; the default is a no-op. Removing the registration makes
// lead capture byte-identical to the pre-Redeem-Ops behaviour.
let _leadCapturedHook = null;
export function registerLeadCapturedHook(fn) {
  _leadCapturedHook = typeof fn === 'function' ? fn : null;
}
import { logger } from '../utils/logger.js';
import {
  normalizePhone,
  buildLeadDeletedPayload,
  destinationForAgent,
} from './prospectHelpers.js';
import { scoreQuiz } from './quizScoringService.js';
import { readLegacyViewSafe } from '../utils/designConfigV2Clamp.js';


const defaultDeps = {
  models: { Prospect, User, Campaign, QrTag, Attribution, ProspectActivity, AgentGroup, AgentGroupMember, IdempotencyKey },
  sequelize,
  resolveLeadRouting,
  getSystemAgentId,
  resolveLeadAssignment,
  deductLeadCredit,
  deductExternalLeadBalance,
  hasValidExternalConsent,
  buildExternalConsentEvidence,
  buildDncConsentEvidence,
  chargeLeadCredit,
  decideAssignment,
  dncEnforcement,
  formatDncNumber,
  dncCheckAndRecord,
  gateHeldDncLead,
  // Screening deps are LAZY dynamic imports (not top-level): existing unit
  // suites mock this module's import graph tightly, and a static edge into the
  // screening services would force every one of them to mock that whole graph.
  // DI tests override these with plain jest.fn()s (await tolerates sync).
  screeningConfig: async () => (await import('./screeningGate.js')).screeningConfig(),
  screeningApplies: async (args, cfg) => (await import('./screeningGate.js')).screeningApplies(args, cfg),
  // Lazy (PR-2, CX13): live-pass cancellation on prospect delete — dynamic so
  // the redeemOps model surface stays out of this module's static graph.
  cancelLiveEntitlementsForProspectTx: async (...a) =>
    (await import('./redeemOps/entitlementService.js')).cancelLiveEntitlementsForProspectTx(...a),
  scheduleScreeningAttempt: async (prospect, opts) => (await import('./retellScreeningService.js')).scheduleScreeningAttempt(prospect, opts),
  buildProspectWhere,
  dispatchEvent,
  persistEventDeliveries,
  flushDeliveries,
  hasDeliverableSubscriber,
  sendLeadEvent: metaSendLeadEvent,
  sendCompleteRegistrationEvent: metaSendCompleteRegistrationEvent,
  sendTikTokLeadEvent,
  sendTikTokCompleteRegistrationEvent,
  processLeadOutcome,
  getOrCreateProspectShareLink,
  isPhoneVerifiedDurable,
  resolveConsumerForCaptureTx,
  recomputeConsumersByPhone,
  getConsumerJourney,
  enrichJourneyProfile,
  getSignupProfile,
  getSessionContext,
  getLyfeDelivery,
  getProspectOutcomes,
  recordCaptureConsentEventsTx,
  canMarketTo,
  buildFactSnapshot,
  enqueueMapJobsTx,
  drainMapJobs,
  bumpEnrichmentInputTx,
  onLeadCaptured: (prospect) => (_leadCapturedHook ? _leadCapturedHook(prospect) : null),
  AppError,
  logger,
};

export function makeProspectService(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };
  const m = { ...defaultDeps.models, ...(overrides.models || {}) };
  const idem = makeIdempotencyOps(m.IdempotencyKey);
  const reads = makeProspectReads({ d, m });
  const { getProspect, getProspectStats, listProspects, trackProspectView, listHeldProspects, getProspectActivities } = reads;
  const assigns = makeAssignmentOps({ d, m });
  const { assignProspect, bulkAssignProspects } = assigns;
  const held = makeHeldQueueOps({ d, m, idem, assignProspect });
  const { orphanSystemAgentId, listDispatchableOrphans, releaseHeldProspect, reassignProspectExternal, returnProspectToHeld, bulkReturnProspectsToHeld } = held;
  // The persist stage of createProspect (P3-1) — see prospectCreateTx.js.
  const runCreateTx = makeCreateTxRunner({ d, m });
  // The post-commit stage of createProspect (P3-1) — see prospectDispatch.js.
  const runDispatch = makeDispatchRunner({ d, m });

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
    // Third-party-disclosure consent — the explicit opt-in that gates EXTERNAL
    // (MKTR Leads buyer-agent) delivery. Distinct from the marketing booleans above;
    // recorded as consentMetadata.external evidence below, never as a CAPI signal.
    const consentThirdParty = safeBody.consent_third_party;
    // DNC (Do Not Call) consent — the opt-in the consent gate shows only when the verified
    // number is on Singapore's DNC Registry. Intent boolean only; the server BUILDS the
    // authoritative consentMetadata.dnc evidence from it below (the DNC fact itself comes
    // from the server-side check, never the client). Recorded as consentMetadata.dnc, never
    // a CAPI signal.
    const consentDnc = safeBody.consent_dnc;
    // Wording-era label from the form ('2026-07-21' agree-all block; absent =
    // legacy three-checkbox copy). Joi-whitelisted enum; the ledger + external
    // evidence builders map it to pinned copy/hash (contactConsent.js registry).
    const consentCopyVersion = safeBody.consent_copy_version;

    // Quiz funnel submission (re-scored server-side after the campaign loads),
    // ad attribution (UTM) and referral identity (the sharer's prospect UUID from
    // the share URL's ?ref=). All stashed in sourceMetadata; none is a Prospect column.
    const quizSubmission = safeBody.quizResult;
    const referralRef =
      typeof safeBody.referralRef === 'string' ? safeBody.referralRef.trim() : undefined;
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
      consent_contact: _cc, consent_terms: _ct, consent_third_party: _ctp, consent_dnc: _cd,
      consent_copy_version: _ccv,
      // consentMetadata is SERVER-authoritative — the third-party-consent evidence is
      // built below from consent_third_party. Drop any client-supplied value so external
      // consent can never be forged via the body (defence-in-depth beyond route stripUnknown).
      consentMetadata: _cm,
      quizResult: _qr, referralRef: _rref,
      utm_source: _us, utm_medium: _um, utm_campaign: _ucmp, utm_content: _ucnt, utm_term: _utm,
      // Marketplace flow extras — validated against the campaign config below
      // (never free text into sourceMetadata). NOTE: a caller-supplied
      // sourceMetadata object itself is preserved for internal callers (the
      // public route strips it via Joi stripUnknown), but its `marketplace`
      // subkey is server-built ONLY — scrubbed below before the validated
      // values are written, so it can never be forged through the body.
      marketplace: marketplaceRaw,
      ...bodyWithoutMeta
    } = safeBody;
    const incoming = { ...bodyWithoutMeta };
    if (incoming.sourceMetadata && typeof incoming.sourceMetadata === 'object') {
      const { marketplace: _forgedMk, ...restSm } = incoming.sourceMetadata;
      incoming.sourceMetadata = restSm;
    }

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
      ...(consentCopyVersion !== undefined ? { consent_copy_version: consentCopyVersion } : {}),
      ...(Object.keys(utm).length > 0 ? { utm } : {}),
    };
    if (Object.keys(capiSourceMetadata).length > 0) {
      incoming.sourceMetadata = { ...(incoming.sourceMetadata || {}), ...capiSourceMetadata };
    }

    // (Phone-verification stamping happens AFTER normalization below — the OTP
    // marker is keyed by the full E.164 phone, so the check must run on the
    // normalized value; see docs/plans/lucky-draw-10x.md §4.4.)

    // Third-party-disclosure consent evidence. Written ONLY when the person ticked
    // the box (=> consentMetadata.external), which — together with the campaign's
    // externalEligible flag — unlocks external delivery via the allowExternal gate
    // below (hasValidExternalConsent). Unticked => null => nothing written => never external.
    const externalConsent = d.buildExternalConsentEvidence(consentThirdParty, {
      sourceUrl: eventSourceUrl,
      // Agree-all submissions pin the disclosure clause's wording era; the
      // builder whitelists internally, so a legacy/absent label keeps the default.
      version: consentCopyVersion,
    });
    if (externalConsent) {
      incoming.consentMetadata = { ...(incoming.consentMetadata || {}), external: externalConsent };
    }

    // DNC (Do Not Call) consent evidence. Written ONLY when the prospect ticked the consent
    // box the gate shows when their OTP-verified number is on Singapore's DNC Registry. This
    // is the documented opt-in the post-commit DNC gate (gateHeldDncLead) reads to RELEASE an
    // otherwise-held registered lead — PDPA evidence that a DNC-registered person agreed to be
    // contacted by this advertiser. SERVER-built from the consent_dnc intent boolean (the
    // client's consentMetadata is dropped above, so this can't be forged); unticked/absent =>
    // null => nothing written => the registered lead stays held (the fail-safe).
    const dncConsent = d.buildDncConsentEvidence(consentDnc, { sourceUrl: eventSourceUrl });
    if (dncConsent) {
      incoming.consentMetadata = { ...(incoming.consentMetadata || {}), dnc: dncConsent };
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

    // Referral identity: resolve the sharer's prospect UUID (share URL ?ref=,
    // forwarded by the SPA as referralRef) into sourceMetadata.referral so admin
    // surfaces can show "Referred by …" without per-row lookups. Runs AFTER the
    // campaign guard above so sameCampaign compares against the settled
    // campaignId. Gated on leadSource === 'referral' (a direct API caller can't
    // mint referral metadata onto non-referral leads); cross-campaign referrers
    // keep ids only — no name — so this public endpoint can't be used to read
    // names across campaigns. Lookup failure must never block lead creation.
    if (referralRef && referralRef !== '1' && incoming.leadSource === 'referral') {
      const referral = { ref: referralRef.slice(0, 64) };
      if (UUID_RE.test(referralRef)) {
        try {
          const referrer = await m.Prospect.findByPk(referralRef, {
            attributes: ['id', 'firstName', 'lastName', 'campaignId'],
          });
          if (referrer) {
            const sameCampaign =
              incoming.campaignId != null &&
              String(referrer.campaignId) === String(incoming.campaignId);
            referral.referrerProspectId = referrer.id;
            referral.sameCampaign = sameCampaign;
            if (sameCampaign) {
              referral.referrerName = [referrer.firstName, referrer.lastName]
                .filter(Boolean)
                .join(' ');
            }
          }
        } catch (err) {
          d.logger.warn('Referrer lookup failed (non-blocking)', { error: err.message });
        }
      }
      incoming.sourceMetadata = { ...(incoming.sourceMetadata || {}), referral };
    }

    // Pre-load campaign + QR tag (needed for routing below, the age gate, and quiz scoring).
    const [sourceCampaign, sourceQrTag] = await Promise.all([
      incoming.campaignId ? m.Campaign.findByPk(incoming.campaignId) : null,
      incoming.qrTagId ? m.QrTag.findByPk(incoming.qrTagId) : null,
    ]);
    // Version-aware flat view of the campaign's design_config for every read
    // below (v2 docs nest these keys). Fail-safe: DNC treated as ENABLED so a
    // surprise doc shape can never skip the compliance gate.
    const sourceDesign = readLegacyViewSafe(sourceCampaign?.design_config, { dncCheckAtSubmit: true });

    // Campaign on/off gate: a paused/draft/completed/archived campaign stops accepting
    // public signups, so its referral + lead-capture links stop working at the source (the
    // SPA already hides the form for inactive campaigns — this closes the direct-API
    // bypass). Block only when the campaign exists AND its status is a known non-active
    // value; a missing status (legacy rows / DI test mocks) is treated as allowed so the
    // gate never rejects a live campaign on field drift. 'active' is the canonical "on"
    // signal (what the device fleet serves), set together with is_active on pause/activate.
    if (
      incoming.campaignId &&
      sourceCampaign &&
      sourceCampaign.status != null &&
      sourceCampaign.status !== 'active'
    ) {
      throw new d.AppError('This campaign is no longer active.', 410);
    }

    // Normalize the phone to E.164 HERE — before the draw gate and before any
    // routing side effect — and consult the OTP marker exactly ONCE. The marker
    // self-expires, so gate-then-restamp double reads could pass the gate yet
    // miss the stamp near the boundary, producing an accepted entrant the
    // freeze would later exclude; one read = one truth for both the gate and
    // the stamp below.
    //
    // DURABLE read, not the in-process Map: this answer decides both draw entry
    // and whether reward-bearing proof gets written, so it must survive a
    // redeploy landing between the lead's OTP and their submit.
    if (incoming.phone) {
      incoming.phone = normalizePhone(incoming.phone);
    }
    const otpMarkerLive = Boolean(incoming.phone && await d.isPhoneVerifiedDurable?.(incoming.phone));

    // Lucky-draw entry gate (docs/plans/lucky-draw-10x.md §4.4) — draw campaigns
    // ONLY; the general funnel's capture-everything posture is untouched. Runs
    // before any routing side effect (the round-robin cursor below advances on
    // resolution). The browser flow always satisfies all four checks; only
    // direct-API callers are affected.
    const luckyDraw = sourceCampaign?.design_config?.luckyDraw;
    if (luckyDraw?.enabled === true) {
      if (!incoming.phone) {
        throw new d.AppError('A mobile number is required to enter this draw.', 422);
      }
      if (consentTerms !== true) {
        throw new d.AppError('You must accept the terms and conditions to enter this draw.', 422);
      }
      if (!otpMarkerLive) {
        throw new d.AppError('Please verify your mobile number before entering this draw.', 403);
      }
      const closesAtEnd = luckyDraw.closesAt ? sgtDayEndExclusiveMs(luckyDraw.closesAt) : null;
      if (closesAtEnd !== null && Date.now() >= closesAtEnd) {
        throw new d.AppError('Entries for this draw have closed.', 410);
      }
    }

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
        requestedAgentId: safeBody.assignedAgentId,
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
        requestedAgentId: safeBody.assignedAgentId,
        campaignId: incoming.campaignId,
        qrTagId: incoming.qrTagId,
      });
      assignedAgentId = routing.agentId;
      routeVia = routing.via;
    }

    // (Phone already normalized + OTP marker read once, above the draw gate.)

    // Server-side phone-verification stamp (docs/redeem-ops/MKTR_INTEGRATION.md
    // §2.0): written iff the OTP marker was live at the single read above.
    // Durable evidence that Redeem Ops reward issuance REQUIRES — a raw
    // unverified POST still captures as a lead but can never mint reward value
    // (anti-farming precondition). phoneVerifiedFor binds the stamp to the
    // number it was earned for: a later staff phone edit breaks the match
    // instead of silently inheriting verified status (plan §4.4).
    if (otpMarkerLive) {
      incoming.sourceMetadata = {
        ...(incoming.sourceMetadata || {}),
        phoneVerifiedAt: new Date().toISOString(),
        phoneVerifiedFor: createHash('sha256').update(incoming.phone).digest('hex'),
      };
    }

    // Draw-terms acceptance evidence (docs/plans/lucky-draw-10x.md §4.6):
    // server-built pin of the exact terms version live at entry time. The draw
    // gate above already guaranteed consent_terms === true for draw campaigns.
    if (luckyDraw?.enabled === true && luckyDraw.termsVersionId) {
      incoming.consentMetadata = {
        ...(incoming.consentMetadata || {}),
        drawTerms: {
          termsVersionId: luckyDraw.termsVersionId,
          termsHash: luckyDraw.termsHash || null,
          acceptedAt: new Date().toISOString(),
        },
      };
    }

    // Marketplace flow extras (docs/plans/redeem-marketplace-v2.md Phase 4).
    // Values are validated against the campaign's own config — chip-select
    // fields must match the options the designer authored (mismatches are
    // dropped + logged, never 4xx'd: losing a lead over a stale label is worse
    // than losing the preference). child_name is charset-sanitised free text.
    // NOTE: sourceMetadata (incl. these keys) is forwarded verbatim to the
    // Lyfe lead.created webhook — child_name is a minor's first name, so the
    // campaign's data_use copy must disclose it (plan decision 9).
    if (marketplaceRaw && typeof marketplaceRaw === 'object') {
      const dcfg = sourceDesign;
      const cleanText = (v) => {
        if (typeof v !== 'string') return undefined;
        const t = v.trim().replace(/[<>]/g, '').slice(0, 120);
        return t || undefined;
      };
      const mk = {};
      const childName = cleanText(marketplaceRaw.child_name);
      if (childName) mk.child_name = childName;
      const level = cleanText(marketplaceRaw.child_school_level);
      if (level && Array.isArray(dcfg.school_levels) && dcfg.school_levels.includes(level)) {
        mk.child_school_level = level;
      }
      const branch = cleanText(marketplaceRaw.preferred_branch);
      if (branch) mk.preferred_branch = branch;
      const timing = cleanText(marketplaceRaw.preferred_timing);
      if (timing) {
        const days = dcfg.availability?.days || [];
        const slots = dcfg.availability?.slots || [];
        const parts = timing.split(/\s+/);
        const valid = parts.length >= 1 && parts.length <= 2
          && parts.every((p) => days.includes(p) || slots.includes(p));
        if (valid) mk.preferred_timing = timing;
      }
      if (Object.keys(mk).length > 0) {
        incoming.sourceMetadata = { ...(incoming.sourceMetadata || {}), marketplace: mk };
      }
    }

    // DNC (Do Not Call) scrubbing mode for this lead. 'off' unless scrubbing is configured
    // AND the number is in DNC scope (Singapore). block → born held pending a check;
    // flag → checked post-commit, result attached to the payload. docs/plans/dnc-scrubbing.md.
    // Per-campaign gate: only campaigns that opted in (design_config.dncCheckAtSubmit) ever
    // hit the paid DNC API — scopes credit spend (and the public create endpoint's exposure)
    // to opted-in campaigns. The global enforcement mode (block/flag) still applies on top.
    const { dncBlockApplies, dncFlagApplies, dncWillCheck } = dncCaptureGate(
      sourceDesign, incoming.phone, { dncEnforcement: d.dncEnforcement, formatDncNumber: d.formatDncNumber }
    );

    // AI screening gate (docs/plans/retell-screening-calls.md §5): evaluated on
    // the INCOMING payload (the verified stamp was just written above iff the
    // OTP marker was live — raw unverified POSTs can never dial, Codex #1).
    // When DNC block-mode also applies, DNC holds first and hands off on clear.
    const screeningCfg = await d.screeningConfig();
    const screeningWanted = await d.screeningApplies(
      { campaign: sourceCampaign, prospect: { ...incoming, externalAgentId: null } },
      screeningCfg
    );

    // Enforce: a phone can register once per campaign, but can register for different campaigns
    if (incoming.phone && incoming.campaignId) {
      const existing = await m.Prospect.findOne({
        where: {
          campaignId: incoming.campaignId,
          phone: incoming.phone,
        },
      });
      if (existing) await throwDuplicateSignup(existing);
    }

    // Already registered: hand back THIS lead's canonical, attributed share link so the
    // share dialog shows their stable /share/{slug} (not a fresh anonymous ref=1 mint on
    // every open). Submit is OTP-gated, so the caller has proven they own this phone —
    // safe to return their referral link. Best-effort: a mint failure must never turn the
    // clean 409 into a 500 (the SPA can still resolve the link via prospectId).
    // Hoisted into a helper because BOTH the precheck above and the
    // concurrent-race catch below must emit the identical structured 409.
    async function throwDuplicateSignup(existing) {
      const err = new d.AppError('This phone number has already signed up for this campaign.', 409);
      err.data = { alreadyRegistered: true, prospectId: existing.id };
      try {
        const hostChoice = normalizeCustomerHostChoice(sourceCampaign?.design_config?.customerHost);
        const origin = customerHostOrigin(hostChoice);
        const { url } = await d.getOrCreateProspectShareLink({
          prospectId: existing.id,
          campaignId: incoming.campaignId,
          origin,
        });
        err.data.shareUrl = `${origin}${url}`;
      } catch (e) {
        d.logger.warn('Duplicate-signup share link mint failed (non-blocking)', {
          prospectId: existing.id,
          err: e?.message,
        });
      }
      throw err;
    }

    // Handle Date of Birth -> Age mapping + campaign age gate (defense-in-depth;
    // the LeadCapture form's getAgeValidationError already blocks client-side,
    // but a determined caller can POST directly to /api/prospects).
    //
    // The gate used to hang entirely off `if (body.date_of_birth)`, so a blank
    // DOB skipped it silently — a campaign could advertise "ages 21-65" and
    // still accept a 15-year-old who left the field empty (and those leads are
    // then permanently unmarketable: the binding 18+ cohort floor excludes
    // anyone with no recorded age). A REQUIRED dob is now enforced as required.
    // Deliberately scoped to the operator's own form config: campaigns that
    // leave dob optional keep behaving exactly as before, so this can never
    // start rejecting entrants on a live funnel that was set up to allow them.
    const dobRequired = sourceDesign.requiredFields?.dob === true;
    const parsedDob = safeBody.date_of_birth ? new Date(safeBody.date_of_birth) : null;
    const dobUsable = !!parsedDob && !isNaN(parsedDob.getTime());
    if (dobRequired && !dobUsable) {
      throw new d.AppError('Date of birth is required for this campaign.', 422);
    }
    if (dobUsable) {
      const dob = parsedDob;
      {
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const m_ = today.getMonth() - dob.getMonth();
        if (m_ < 0 || (m_ === 0 && today.getDate() < dob.getDate())) {
          age--;
        }

        // sourceCampaign is already loaded above (same row, full attributes) —
        // the old second findByPk here was a redundant query.
        if (incoming.campaignId) {
          const campaign = sourceCampaign;
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
          dateOfBirth: safeBody.date_of_birth,
        };
      }
    }

    // Handle Postal Code -> Location mapping
    if (safeBody.postal_code) {
      incoming.location = {
        ...(incoming.location || {}),
        zipCode: safeBody.postal_code,
        postalCode: safeBody.postal_code,
      };
    }

    // Handle Education and Income mapping
    if (safeBody.education_level || safeBody.monthly_income) {
      incoming.demographics = {
        ...(incoming.demographics || {}),
      };
      if (safeBody.education_level) incoming.demographics.education = safeBody.education_level;
      if (safeBody.monthly_income) incoming.demographics.income = safeBody.monthly_income;
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

    // --- Enrichment profile questions (studio-profile-questions §5.4) ---
    // Three-leg eligibility gate, ALL legs or the whole object is ignored
    // (Codex PR0 R2 #3 — backend eligibility must equal rendering
    // eligibility): raw config is v2 AND profileQuestions.enabled AND not
    // guided_review. Then iterate the CAMPAIGN'S configured question ids
    // (never attacker keys), resolve server-side, re-validate, and stash
    // only canonical accepted answer ids (erasure's sourceMetadata rebuild
    // removes them). A bad answer never costs a lead.
    let acceptedProfileFacts = [];
    {
      const rawAnswers = safeBody.profileAnswers;
      const dcRaw = sourceCampaign?.design_config;
      const pq = dcRaw?.profileQuestions;
      const eligible = rawAnswers && typeof rawAnswers === 'object' && !Array.isArray(rawAnswers)
        && isV2DesignConfig(dcRaw)
        && pq?.enabled === true
        && dcRaw?.template?.id !== 'guided_review'
        && Array.isArray(pq?.questionIds);
      if (eligible) {
        const acceptedIds = {};
        const dropped = [];
        for (const qid of pq.questionIds) {
          const q = getProfileQuestion(qid);
          if (!q) continue;
          const provided = rawAnswers[qid];
          if (provided === undefined || provided === null || provided === '') continue;
          const value = resolveProfileAnswer(qid, provided);
          if (!value || !validateFact(q.factKey, value).ok) {
            dropped.push(qid);
            continue;
          }
          acceptedProfileFacts.push({ key: q.factKey, value });
          acceptedIds[qid] = provided;
        }
        if (dropped.length) {
          d.logger.warn('[enrichment] profile answers dropped (invalid)', {
            campaignId: incoming.campaignId, dropped,
          });
        }
        if (Object.keys(acceptedIds).length) {
          incoming.sourceMetadata = { ...(incoming.sourceMetadata || {}), profileAnswers: acceptedIds };
        }
      } else if (rawAnswers && typeof rawAnswers === 'object' && Object.keys(rawAnswers).length) {
        d.logger.warn('[enrichment] profile answers ignored (campaign not eligible)', {
          campaignId: incoming.campaignId,
        });
      }
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

        // Atomic round-robin index increment on QrTag. A failed increment must
        // not lose the lead, but the stale-index fallback pins every lead on
        // this tag to the same member while it persists — so it has to be loud.
        const [, [updated]] = await m.QrTag.update(
          { roundRobinIndex: d.sequelize.literal('"roundRobinIndex" + 1') },
          { where: { id: sourceQrTag.id }, returning: true }
        ).catch((err) => {
          d.logger.warn('[Routing] QR round-robin increment failed — reusing stale index', {
            qrTagId: sourceQrTag.id, error: err?.message || String(err),
          });
          return [0, [sourceQrTag]];
        });

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
    // --- PERSIST: the one transaction that turns this lead into rows ---
    // The body lives in prospectCreateTx.js (P3-1). It used to be inlined here
    // and reached ~20 enclosing variables through the closure; now every input
    // is a named ctx field and every decision it makes is a named result field.
    let txOutcome;
    try {
      txOutcome = await runCreateTx({
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
      });
    } catch (err) {
      // Concurrent same-campaign duplicate: both requests passed the precheck;
      // the unique-index loser lands here AFTER a full rollback (including the
      // resolver savepoint's signupCount increment). Surface the SAME
      // structured 409 the precheck emits — errorHandler would otherwise map
      // the Sequelize ValidationError subclass to a generic 400 (Codex R2 #5).
      const constraint = err?.original?.constraint || err?.parent?.constraint;
      if (
        err?.name === 'SequelizeUniqueConstraintError' &&
        constraint === 'prospects_campaign_id_phone' &&
        incoming.phone && incoming.campaignId
      ) {
        const winner = await m.Prospect.findOne({
          where: { campaignId: incoming.campaignId, phone: incoming.phone },
        });
        if (winner) await throwDuplicateSignup(winner);
      }
      throw err;
    }

    const { prospect, quarantined, heldReason, finalAgentId, dncHeld, screeningHeld } = txOutcome;

    // Reflect the committed outcome (null when quarantined) for the rest of the
    // function — webhook dispatch, agent load, and the returned payload.
    assignedAgentId = finalAgentId;

    // --- DISPATCH: everything post-commit ---
    // The body lives in prospectDispatch.js (P3-1): DNC scrubbing, the Lyfe
    // webhook + held ping, the Meta/TikTok CAPI pairs, the Redeem Ops hook, the
    // enrichment drain, the share link and the screening dial. All of it is
    // fire-and-forget by rule, and its statement order is load-bearing.
    const { assignedAgent, prospectWithCampaign, shareUrl, leadCapturedOutcome } = await runDispatch({
      prospect,
      quarantined,
      heldReason,
      assignedAgentId,
      dncHeld,
      dncFlagApplies,
      screeningHeld,
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
    });

    return { prospect, assignedAgentId, assignedAgent, prospectWithCampaign, quarantined, shareUrl, leadCapturedOutcome };
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

    // PR C: an erased row is a legal skeleton — staff edits must not be able
    // to re-attach PII to it (a re-signup creates a fresh row instead).
    if (prospect.sourceMetadata?.erased === true) {
      throw new d.AppError('This lead was erased (PDPA) and can no longer be edited', 410);
    }

    const oldStatus = prospect.leadStatus;
    const oldAssignedAgentId = prospect.assignedAgentId;
    const oldAssignedAgent = prospect.assignedAgent;

    const safeUpdates = Object.fromEntries(Object.entries(body).filter(([k]) => PROSPECT_UPDATE_FIELDS.includes(k)));

    // Identity-integrity on phone edits (plan §2.3, Codex R1 #6): normalize
    // exactly like capture, and strip the OTP verification stamp — it is bound
    // to the OLD number via phoneVerifiedFor, so it must not survive the edit
    // (entitlement issuance independently re-checks the binding).
    const oldPhone = prospect.phone;
    if (safeUpdates.phone !== undefined && safeUpdates.phone !== null) {
      const trimmed = String(safeUpdates.phone).trim();
      // Blank clears the number — and the person link goes with it (R2 #4).
      safeUpdates.phone = trimmed ? normalizePhone(trimmed) : null;
    }
    const phoneChanged = safeUpdates.phone !== undefined && safeUpdates.phone !== oldPhone;
    const emailChanged = safeUpdates.email !== undefined && safeUpdates.email !== prospect.email;
    if (phoneChanged && prospect.sourceMetadata?.phoneVerifiedAt) {
      const sm = { ...(prospect.sourceMetadata || {}) };
      delete sm.phoneVerifiedAt;
      delete sm.phoneVerifiedFor;
      safeUpdates.sourceMetadata = sm;
    }
    if (phoneChanged && !safeUpdates.phone) {
      // Phone cleared entirely: no number, no person link (recompute below
      // only handles E.164 values; the reconciler's empty-phone step is the
      // backstop).
      safeUpdates.consumerId = null;
    }

    // Won-transition precondition runs BEFORE any mutation (Codex R1 #5):
    // a lead may only be marked won while assigned to a real agent (assignment
    // integrity for down-funnel attribution — the retired commission mint is
    // gone, the rule stays).
    const becomingWon = oldStatus !== 'won' && safeUpdates.leadStatus === 'won';
    if (becomingWon) {
      const systemId = await d.getSystemAgentId();
      if (prospect.assignedAgentId && prospect.assignedAgentId === systemId) {
        throw new d.AppError('Lead must be assigned to a real agent before marking as won', 400);
      }
    }

    try {
      if (becomingWon) {
        await prospect.update({ ...safeUpdates, conversionDate: new Date() });
      } else {
        await prospect.update(safeUpdates);
      }
    } catch (err) {
      if (err?.name === 'SequelizeUniqueConstraintError') {
        // (campaignId, phone) partial unique — the edited number already has a
        // signup in this campaign.
        throw new d.AppError('Another lead in this campaign already has this phone number.', 409);
      }
      throw err;
    }

    // Consumer-spine projection upkeep: recompute BOTH phones' consumers from
    // rows (assign, never adjust) — this also relinks this row's consumerId.
    // Best-effort by design; the reconciler heals any miss.
    if ((phoneChanged || emailChanged) && prospect.leadSource !== 'call_bot') {
      await d.recomputeConsumersByPhone([oldPhone, prospect.phone].filter(Boolean));
      await prospect.reload().catch(() => {});
    }

    // Enrichment choke points (docs/plans/consumer-profile-enrichment.md §5,
    // §6.3 — Codex R4-era #2). Best-effort: the sweep's repair scan heals.
    // (a) demographics is a mapped field — a staff edit mints the next form-
    //     artifact revision + a new map job whose activation supersedes the
    //     old revision's observations (including a CLEARED DOB — zero-fact
    //     snapshots at revision > 1 still supersede).
    if (safeUpdates.demographics !== undefined) {
      try {
        await d.sequelize.transaction(async (t) => {
          const rev = (prospect.enrichmentRevision || 1) + 1;
          await prospect.update({ enrichmentRevision: rev }, { transaction: t });
          // FORM section only: quiz/profile artifacts are capture-immutable —
          // absent sections mean "leave those artifacts alone" (§5.1).
          const snapshot = d.buildFactSnapshot({
            demographics: prospect.demographics || {},
          });
          await d.enqueueMapJobsTx(t, {
            prospectId: prospect.id,
            formRevision: rev,
            snapshot,
          });
        });
        d.drainMapJobs({ limit: 2 }).catch(() => {});
      } catch (enrichErr) {
        d.logger.warn('[enrichment] edit revision/outbox failed (sweep heals)', {
          error: enrichErr?.message || String(enrichErr),
        });
      }
    }
    // (b) prospect lifecycle fields feed the score/DTO — bump the owner's
    //     input version so the profile goes dirty (no observation write here).
    if (safeUpdates.leadStatus !== undefined && safeUpdates.leadStatus !== oldStatus && prospect.consumerId) {
      try {
        await d.sequelize.transaction(async (t) => {
          await d.bumpEnrichmentInputTx(t, prospect.consumerId);
        });
      } catch (enrichErr) {
        d.logger.warn('[enrichment] leadStatus input bump failed', {
          error: enrichErr?.message || String(enrichErr),
        });
      }
    }

    // (Reassignment / unassignment is handled exclusively by assignProspect — see the
    // PROSPECT_UPDATE_FIELDS note — so PUT no longer needs unassignment side-effects.)

    // Down-funnel CAPI for admin-recorded outcomes (plan Phase 3): qualified
    // and won set in the mktr CRM fire the SAME processLeadOutcome the Lyfe +
    // mktr-leads webhooks use — post-commit, fire-and-forget. Its
    // mark-on-success markers dedup across all three paths, and a repeat
    // transition never re-enters (oldStatus is already terminal).
    if (['qualified', 'won'].includes(safeUpdates.leadStatus) && oldStatus !== safeUpdates.leadStatus) {
      try {
        const hook = d.processLeadOutcome({
          external_id: prospect.id,
          new_status: safeUpdates.leadStatus,
          occurred_at: new Date().toISOString(),
        });
        if (hook && typeof hook.catch === 'function') {
          hook.catch((err) =>
            d.logger.error('[CAPI] admin lead-outcome hook error', { error: err?.message || String(err) })
          );
        }
      } catch (err) {
        d.logger.error('[CAPI] admin lead-outcome hook error', { error: err?.message || String(err) });
      }
    }

    return prospect;
  }

  /**
   * Delete a prospect, scoped to user access.
   */
  async function deleteProspect(id, user) {
    const scopeFilter = await d.buildProspectWhere(user);

    // Fire lead.deleted to the mktr-leads mirror so the deletion propagates (the
    // receiver soft-deletes its copy; otherwise the lead is orphaned on the
    // agent's page). Transactional outbox: persist the delivery row INSIDE the
    // same (managed) txn as the destroy so they commit together — no crash window
    // that re-creates the orphan. The prospect is row-locked for the txn so a
    // concurrent reassignment can't shift the destination under us. The managed
    // txn auto-commits on resolve / auto-rolls-back (and rethrows) on a throw, so
    // a hard error => delete fails + admin retries, with NO orphan/partial state.
    let deliveryPairs = [];
    let deletedPhone = null;
    let deletedSource = null;
    await d.sequelize.transaction(async (t) => {
      const prospect = await m.Prospect.findOne({
        where: { id, ...scopeFilter },
        transaction: t,
        lock: Transaction.LOCK.UPDATE,
      });
      if (!prospect) {
        throw new d.AppError('Prospect not found or access denied', 404);
      }
      deletedPhone = prospect.phone;
      deletedSource = prospect.leadSource;

      // Only the mktr-leads receiver handles lead.deleted. Held / unassigned /
      // System-Agent (no assignee) or a non-mktr_leads destination => no mirrored
      // row to clean => skip the emit.
      let destination = null;
      if (prospect.assignedAgentId) {
        const agent = await m.User.findByPk(prospect.assignedAgentId, {
          attributes: ['id', 'lyfeId', 'mktrLeadsId'],
          transaction: t,
        });
        destination = destinationForAgent(agent);
      }

      // Live reward passes die WITH their prospect (PR-2, Codex R1 CX13): the
      // SET-NULL FK alone left orphaned, still-scannable passes holding the
      // phone's anti-farm slot and never returning inventory. Same tx as the
      // destroy — all-or-nothing.
      await d.cancelLiveEntitlementsForProspectTx(prospect.id, t, { reason: 'prospect_deleted' });

      if (destination === 'mktr_leads') {
        deliveryPairs = await d.persistEventDeliveries(
          'lead.deleted',
          () => buildLeadDeletedPayload(prospect),
          { destination },
          t
        );
        // BEST-EFFORT (unlike releaseHeldProspect's fail-closed rollback): an empty
        // set means webhooks are disabled or no subscriber is tagged. Deleting is an
        // admin cleanup action that must NOT be blocked on mirror delivery — proceed.
        if (deliveryPairs.length === 0) {
          d.logger.warn('[Webhook] lead.deleted not queued (webhooks off / no subscriber) — deleting anyway', {
            prospectId: prospect.id,
          });
        }
      }

      // Enrichment: a deleted signup CASCADE-deletes its observations, which
      // changes the owner's resolved facts — dirty their profile in the same
      // txn (plan §6.3 choke list; erased consumers are skipped by the bump).
      if (prospect.consumerId) {
        await d.bumpEnrichmentInputTx(t, prospect.consumerId);
      }
      await prospect.destroy({ transaction: t });
    });

    d.flushDeliveries(deliveryPairs); // post-commit, fire-and-forget

    // Consumer-spine projection upkeep (assign-from-rows; best-effort — the
    // reconciler heals). call_bot rows never linked, so nothing to recompute.
    if (deletedPhone && deletedSource !== 'call_bot') {
      await d.recomputeConsumersByPhone([deletedPhone]);
    }
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
   * Bulk delete prospects (web admin). Fan-out over the hardened single delete — each row
   * keeps its transactional-outbox lead.deleted (mktr-leads-owned rows only; a Lyfe-owned
   * row's app copy is orphaned, the same documented limitation as single delete). One bad
   * row never aborts the rest.
   */
  async function bulkDeleteProspects(prospectIds, user) {
    if (!prospectIds || !Array.isArray(prospectIds) || prospectIds.length === 0) {
      throw new d.AppError('Prospect IDs array is required', 400);
    }
    const requestedIds = [...new Set(prospectIds)];

    const counts = { deleted: 0, notFound: 0, failed: 0 };
    for (const id of requestedIds) {
      try {
        await deleteProspect(id, user);
        counts.deleted += 1;
      } catch (err) {
        if (err?.statusCode === 404) {
          counts.notFound += 1;
        } else {
          counts.failed += 1;
          d.logger.error('[bulk-delete] delete failed', { prospectId: id, error: err?.message || String(err) });
        }
      }
    }
    return counts;
  }


  return {
    createProspect,
    getProspect,
    updateProspect,
    deleteProspect,
    assignProspect,
    releaseHeldProspect,
    reassignProspectExternal,
    returnProspectToHeld,
    bulkReturnProspectsToHeld,
    bulkDeleteProspects,
    listDispatchableOrphans,
    getProspectActivities,
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
export const releaseHeldProspect = _default.releaseHeldProspect;
export const reassignProspectExternal = _default.reassignProspectExternal;
export const returnProspectToHeld = _default.returnProspectToHeld;
export const bulkReturnProspectsToHeld = _default.bulkReturnProspectsToHeld;
export const bulkDeleteProspects = _default.bulkDeleteProspects;
export const listDispatchableOrphans = _default.listDispatchableOrphans;
export const getProspectActivities = _default.getProspectActivities;
export const bulkAssignProspects = _default.bulkAssignProspects;
export const getProspectStats = _default.getProspectStats;
export const listProspects = _default.listProspects;
export const listHeldProspects = _default.listHeldProspects;
export const scheduleFollowUp = _default.scheduleFollowUp;
export const trackProspectView = _default.trackProspectView;

/**
 * Resolve a referrer's display name for the public lead-capture "Referred by" badge.
 * Mirrors the same-campaign privacy guard in createProspect (see the referral block):
 * a name is returned ONLY when the referrer prospect is in the SAME campaign, so the
 * public path can't harvest names across campaigns by probing UUIDs. Returns null for
 * the legacy anonymous ref ('1'), a non-UUID, a missing prospect, a cross-campaign
 * referrer, or any lookup error (never throws — display is best-effort).
 */
export async function resolveReferrerName({ ref, campaignId } = {}) {
  if (!ref || ref === '1' || !campaignId || !UUID_RE.test(ref)) return null;
  try {
    const referrer = await Prospect.findByPk(ref, {
      attributes: ['firstName', 'lastName', 'campaignId'],
    });
    if (!referrer || String(referrer.campaignId) !== String(campaignId)) return null;
    const name = [referrer.firstName, referrer.lastName].filter(Boolean).join(' ').trim();
    return name || null;
  } catch {
    return null;
  }
}
