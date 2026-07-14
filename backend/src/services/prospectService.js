import { randomUUID, createHash } from 'crypto';
import { Op, Transaction } from 'sequelize';
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
  IdempotencyKey,
  sequelize,
} from '../models/index.js';
import { resolveAssignedAgentId, resolveLeadRouting, getSystemAgentId, resolveLeadAssignment } from './systemAgent.js';
import { deductLeadCredit, chargeLeadCredit, deductExternalLeadBalance } from './leadCredits.js';
import { decideAssignment } from './leadQuota.js';
import { dncEnforcement, formatDncNumber, checkAndRecord as dncCheckAndRecord } from './dncService.js';
import { gateHeldDncLead } from './dncGate.js';
import { hasValidExternalConsent, buildExternalConsentEvidence } from './externalConsent.js';
import { buildDncConsentEvidence } from './dncConsent.js';
import { repeatSignupDetail, repeatSignupCounts } from './repeatSignup.js';
import { buildProspectWhere } from '../middleware/prospectScope.js';
import { AppError } from '../middleware/errorHandler.js';
import { dispatchEvent, persistEventDeliveries, flushDeliveries, hasDeliverableSubscriber } from './webhookService.js';
import {
  sendLeadEvent as metaSendLeadEvent,
  sendCompleteRegistrationEvent as metaSendCompleteRegistrationEvent,
} from './metaCapiService.js';
import {
  sendTikTokLeadEvent,
  sendTikTokCompleteRegistrationEvent,
} from './tiktokEventsService.js';
import { getOrCreateProspectShareLink } from './shortlinkService.js';
import { isPhoneRecentlyVerified } from './verifiedPhoneStore.js';
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
import { signupActivityDescription, signupSourceLabel } from '../utils/sourceLabel.js';
import {
  normalizePhone,
  buildLeadCreatedPayload,
  buildLeadHeldPayload,
  buildLeadDeletedPayload,
  buildLeadAssignedPayload,
  buildLeadUnassignedPayload,
  buildHeldLeadEnrichment,
  destinationForAgent,
  externalIdForDestination,
  withBatchContext,
} from './prospectHelpers.js';
import { fetchLeadActivitiesFromSupabase, mergeProspectTimeline } from './webLeadTimelineService.js';
import { scoreQuiz } from './quizScoringService.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mirrors the Prospect.leadStatus ENUM. A filter value outside this set would
// otherwise reach Postgres and throw ("invalid input value for enum"), so the
// list endpoint validates against it and returns no matches for unknown values.
const VALID_LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiating', 'won', 'lost', 'nurturing'];

// Assignment-state filter values for the admin list (D6). Unknown values degrade to
// an empty page (same pattern as VALID_LEAD_STATUSES).
const VALID_ASSIGNMENT_FILTERS = ['assigned', 'unassigned', 'held'];

// Hold reasons a MANUAL admin (re)assign may release. Everything else is fenced:
// 'no_funded_external_buyer' (external buyer pool), 'dnc_pending'/'dnc_registered'
// (DNC gate). 'returned_by_admin' is the web-admin return flavor — deliberately
// distinct from 'no_funded_agent' so returned leads never surface in the EXTERNAL
// held queue (listDispatchableOrphans) or its release path (releaseHeldProspect),
// both of which filter on 'no_funded_agent'.
const RELEASABLE_HOLD_REASONS = ['no_funded_agent', 'returned_by_admin'];

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
  models: { Prospect, User, Campaign, QrTag, Commission, Attribution, ProspectActivity, AgentGroup, AgentGroupMember, IdempotencyKey },
  sequelize,
  resolveAssignedAgentId,
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
  buildProspectWhere,
  dispatchEvent,
  persistEventDeliveries,
  flushDeliveries,
  hasDeliverableSubscriber,
  sendLeadEvent: metaSendLeadEvent,
  sendCompleteRegistrationEvent: metaSendCompleteRegistrationEvent,
  sendTikTokLeadEvent,
  sendTikTokCompleteRegistrationEvent,
  getOrCreateProspectShareLink,
  isPhoneRecentlyVerified,
  onLeadCaptured: (prospect) => (_leadCapturedHook ? _leadCapturedHook(prospect) : null),
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
    // routing side effect — and consult the in-memory OTP marker exactly ONCE.
    // The marker self-expires (10-min TTL), so gate-then-restamp double reads
    // could pass the gate yet miss the stamp near the boundary, producing an
    // accepted entrant the freeze would later exclude; one read = one truth
    // for both the gate and the stamp below.
    if (incoming.phone) {
      incoming.phone = normalizePhone(incoming.phone);
    }
    const otpMarkerLive = Boolean(incoming.phone && d.isPhoneRecentlyVerified?.(incoming.phone));

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
      const dcfg = sourceCampaign?.design_config || {};
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
    const dncMode = sourceCampaign?.design_config?.dncCheckAtSubmit === true ? d.dncEnforcement() : 'off';
    const dncNumber = dncMode !== 'off' && incoming.phone ? d.formatDncNumber(incoming.phone) : null;
    const dncBlockApplies = dncMode === 'block' && !!dncNumber;
    const dncFlagApplies = dncMode === 'flag' && !!dncNumber;
    const dncWillCheck = dncBlockApplies || dncFlagApplies;

    // Enforce: a phone can register once per campaign, but can register for different campaigns
    if (incoming.phone && incoming.campaignId) {
      const existing = await m.Prospect.findOne({
        where: {
          campaignId: incoming.campaignId,
          phone: incoming.phone,
        },
      });
      if (existing) {
        // Already registered: hand back THIS lead's canonical, attributed share link so the
        // share dialog shows their stable /share/{slug} (not a fresh anonymous ref=1 mint on
        // every open). Submit is OTP-gated, so the caller has proven they own this phone —
        // safe to return their referral link. Best-effort: a mint failure must never turn the
        // clean 409 into a 500 (the SPA can still resolve the link via prospectId).
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
    let heldReason = null;
    let finalAgentId = assignedAgentId;
    // DNC block-mode hold bookkeeping — set inside the tx, consumed post-commit.
    let dncHeld = false;
    let dncIntendedAgentId = null;
    let dncAlreadyCharged = false;
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

      // DNC block-mode gate: a normally-assignable INTERNAL lead is HELD pending a DNC
      // check (released post-commit on clear). Never overrides an existing quarantine
      // (quota / external) or an external-buyer route. The credit is charged on release
      // (unless decideAssignment already charged a funded gated route → dncAlreadyCharged).
      if (dncBlockApplies && decision.action !== 'quarantine' && !externalAgentId) {
        dncIntendedAgentId = decision.assignedAgentId ?? assignedAgentId ?? null;
        dncAlreadyCharged = decision.charged === true;
        dncHeld = true;
        decision = { action: 'quarantine', quarantineReason: 'dnc_pending', charged: dncAlreadyCharged, via: routeVia };
      }

      quarantined = decision.action === 'quarantine';
      heldReason = quarantined ? decision.quarantineReason : null;
      finalAgentId = quarantined ? null : (decision.assignedAgentId ?? null);

      const newProspect = await m.Prospect.create(
        {
          ...incoming,
          assignedAgentId: finalAgentId,
          externalAgentId,
          quarantinedAt: quarantined ? new Date() : null,
          quarantineReason: quarantined ? decision.quarantineReason : null,
          // DNC: mark pending up-front (crash-safe — the backfill finds a stranded row);
          // stash the intended agent so the post-commit clear-release knows who to deliver to.
          ...(dncWillCheck ? { dncStatus: 'pending' } : {}),
          ...(dncHeld ? { dncMetadata: { intendedAgentId: dncIntendedAgentId, alreadyCharged: dncAlreadyCharged } } : {}),
        },
        { transaction: t }
      );

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

    // Redeem Ops reward-entitlement hook — post-commit, fire-and-forget (a
    // Redeem Ops failure must never fail or slow lead capture). No-op unless
    // bootstrap registered the callback (module flag on). Idempotent downstream
    // via the unique (activationId, prospectId) anchor.
    if (!quarantined) {
      try {
        const hookResult = d.onLeadCaptured?.(prospect);
        if (hookResult && typeof hookResult.catch === 'function') {
          hookResult.catch((err) =>
            d.logger.error('[RedeemOps] onLeadCaptured error', { error: err?.message || String(err) })
          );
        }
      } catch (err) {
        d.logger.error('[RedeemOps] onLeadCaptured error', { error: err?.message || String(err) });
      }
    }

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

    return { prospect, assignedAgentId, assignedAgent, prospectWithCampaign, quarantined, shareUrl };
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
          // Newest-first, so the Activity Timeline UI (which renders this array
          // top-to-bottom and pins a "Start of History" marker at the bottom) leads
          // with the most recent event and ends with the genesis 'created' event.
          //
          // `separate: true` is REQUIRED: an `order` inside a normal (JOINed) hasMany
          // include is silently ignored by Sequelize v6 — only the separate (own-query)
          // loader honours include-local ordering. `prospectId` must stay in
          // `attributes` because that loader maps children back to the parent by the
          // FK; omitting it returns an empty activities array. `id DESC` is a
          // deterministic tiebreaker for same-millisecond `createdAt` values.
          separate: true,
          attributes: ['id', 'prospectId', 'type', 'description', 'metadata', 'createdAt'],
          order: [['createdAt', 'DESC'], ['id', 'DESC']],
        },
      ],
    });

    if (!prospect) {
      throw new d.AppError('Prospect not found or access denied', 404);
    }

    // Admin-only: cross-campaign repeat-signup visibility (flag, not block).
    // Omitted entirely for non-admins (this endpoint is shared with the agent
    // detail modal). Resilient — a failed enrichment never breaks the view.
    // Admin-only enrichments. The unified `timeline` merges the agent-engagement half (Supabase
    // lead_activities) with this prospect's ProspectActivity so the web Activity Timeline matches
    // the mktr-leads app. ADMIN-GATED on purpose: the engagement is the external buyer's private
    // notes, which must not surface to a non-admin web user (agents can open the same detail modal).
    // Gated additionally on the export-EF URL (deploy-inert until set). Run in PARALLEL with the
    // repeat-signup lookup so neither blocks the other; both are resilient (a miss never breaks the
    // view, and the timeline degrades to ProspectActivity-only on a Supabase miss).
    if (user?.role === 'admin') {
      const wantTimeline = !!process.env.SUPABASE_LEAD_ACTIVITIES_URL;
      const [repeatSignup, timelineFetch] = await Promise.all([
        repeatSignupDetail(d.sequelize, { phone: prospect.phone, email: prospect.email }).catch(() => null),
        wantTimeline
          ? fetchLeadActivitiesFromSupabase(prospect.id).catch(() => ({ rows: [], ok: false }))
          : Promise.resolve(null),
      ]);
      if (repeatSignup) prospect.setDataValue('repeatSignup', repeatSignup);
      if (timelineFetch) {
        prospect.setDataValue(
          'timeline',
          mergeProspectTimeline(prospect.activities || [], timelineFetch.rows, { ok: timelineFetch.ok }),
        );
      }
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

    // Fire lead.deleted to the mktr-leads mirror so the deletion propagates (the
    // receiver soft-deletes its copy; otherwise the lead is orphaned on the
    // agent's page). Transactional outbox: persist the delivery row INSIDE the
    // same (managed) txn as the destroy so they commit together — no crash window
    // that re-creates the orphan. The prospect is row-locked for the txn so a
    // concurrent reassignment can't shift the destination under us. The managed
    // txn auto-commits on resolve / auto-rolls-back (and rethrows) on a throw, so
    // a hard error => delete fails + admin retries, with NO orphan/partial state.
    let deliveryPairs = [];
    await d.sequelize.transaction(async (t) => {
      const prospect = await m.Prospect.findOne({
        where: { id, ...scopeFilter },
        transaction: t,
        lock: Transaction.LOCK.UPDATE,
      });
      if (!prospect) {
        throw new d.AppError('Prospect not found or access denied', 404);
      }

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

      await prospect.destroy({ transaction: t });
    });

    d.flushDeliveries(deliveryPairs); // post-commit, fire-and-forget
  }

  /**
   * Assign a single prospect to an agent. Returns { prospect, agent } for email side-effect.
   * `opts.batch` ({ id, size }, pre-validated) rides into the delivery webhooks so the
   * receiving app can coalesce a bulk fan-out's pushes into one summary.
   */
  async function assignProspect(prospectId, agentId, user, opts = {}) {
    const { batch = null } = opts;
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

    // DNC fence: a lead held by the DNC gate must NOT be manually released (that would
    // bypass scrubbing and hand a Do-Not-Call number to an adviser). It releases itself
    // automatically once the DNC check clears (gate / backfill). assignProspect's claim
    // below is reason-blind, so this guard is the fence.
    if (prospect.quarantineReason === 'dnc_pending' || prospect.quarantineReason === 'dnc_registered') {
      throw new d.AppError(
        'This lead is held by the DNC (Do Not Call) gate and cannot be manually assigned — it releases automatically once the DNC check clears.',
        409
      );
    }

    // A manual admin assign is an EXEMPT route (decision a): it always delivers and does
    // a best-effort deduct. If the prospect is currently HELD, this is a RELEASE — clear
    // the hold ATOMICALLY (so a double-click / concurrent sweep can't deliver twice) and
    // fire lead.assigned. Always lead.assigned, never lead.created: both receivers UPSERT
    // on assigned (insert if unknown, re-point + un-hide if known), whereas a duplicate
    // lead.created is a silent no-op — so a returned-to-held lead released via
    // lead.created would never re-surface in the agent's app.
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
        include: [
          { association: 'campaign', attributes: ['id', 'name'] },
          { association: 'qrTag', attributes: ['id', 'slug'] },
        ],
      });

      const releaseDestination = destinationForAgent(agent);
      d.dispatchEvent('lead.assigned', () =>
        withBatchContext(
          buildLeadAssignedPayload(prospect, agent, prospectWithCampaign, {
            qrTag: prospectWithCampaign?.qrTag || null,
            routingMode: 'direct',
          }),
          batch
        ),
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
      include: [
        { association: 'campaign', attributes: ['id', 'name'] },
        { association: 'qrTag', attributes: ['id', 'slug'] },
      ],
    });

    // Fire lead.assigned webhook to the NEW owner's app.
    const newDestination = destinationForAgent(agent);
    d.dispatchEvent(
      'lead.assigned',
      () =>
        withBatchContext(
          buildLeadAssignedPayload(prospect, agent, prospectWithCampaign, {
            qrTag: prospectWithCampaign?.qrTag || null,
            routingMode: 'direct',
          }),
          batch
        ),
      { destination: newDestination }
    );

    // Cross-app reassignment: if the PREVIOUS owner lived in a different app, that app
    // still holds a copy of this lead that would otherwise linger. Tell it to release the
    // lead (lead.unassigned -> the receiver marks it disputed). A SAME-app reassignment
    // needs nothing extra — the receiver re-points the single shared row when it handles
    // lead.assigned, so firing unassigned there would wrongly dispute the now-reassigned row.
    if (previousAgentId && previousAgentId !== agentId) {
      const prevAgent = await m.User.findByPk(previousAgentId, {
        attributes: ['id', 'lyfeId', 'mktrLeadsId'],
      });
      const prevDestination = destinationForAgent(prevAgent);
      if (prevDestination && prevDestination !== newDestination) {
        const previousAgentExternalId = externalIdForDestination(prevAgent, prevDestination);
        d.dispatchEvent('lead.unassigned', () => buildLeadUnassignedPayload(prospect, previousAgentExternalId), {
          destination: prevDestination,
        });
      }
    }

    return { prospect, agent, prospectWithCampaign };
  }

  /**
   * Bulk assign prospects to an agent. Returns { affectedCount, releasedCount, skipped, agent }
   * — counts feed the controller's email side-effect and the UI's skip-accounting toast.
   */
  async function bulkAssignProspects(prospectIds, agentId, user) {
    if (!prospectIds || !Array.isArray(prospectIds) || !agentId) {
      throw new d.AppError('Prospect IDs array and agent ID are required', 400);
    }
    const requestedIds = [...new Set(prospectIds)];

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

    // Pre-flight (bulk-only): assignment mutates rows first and delivers after, so refuse
    // to run when delivery is IMPOSSIBLE (webhooks disabled / no subscriber tagged for the
    // agent's app) — otherwise the whole batch would be stranded: assigned in MKTR, never
    // surfaced in the agent's app. Transient send failures are fine (the persistent
    // delivery queue retries); this guards misconfiguration only. A destination-less
    // (local-only) agent passes: no delivery is expected, matching single-assign.
    const newDestination = destinationForAgent(agent);
    if (!(await d.hasDeliverableSubscriber('lead.assigned', newDestination))) {
      throw new d.AppError(
        "Lead delivery is not configured for this agent's app (webhooks disabled or no subscriber) — bulk assign would strand the leads. Fix webhook configuration and retry.",
        409
      );
    }

    const scopeFilter = await d.buildProspectWhere(user);
    const whereConditions = {
      id: { [Op.in]: requestedIds },
      ...scopeFilter,
      [Op.and]: [
        // HELD rows are eligible only for the releasable reasons — bulk assign then acts
        // as a RELEASE (the quarantine is cleared in the same atomic UPDATE below, and
        // lead.assigned upserts at the receiver). Fenced reasons (external buyer pool,
        // DNC gate) stay excluded, mirroring single-assign's guards.
        { [Op.or]: [{ quarantinedAt: null }, { quarantineReason: { [Op.in]: RELEASABLE_HOLD_REASONS } }] },
        // Skip rows already assigned to THIS agent (IS DISTINCT FROM semantics —
        // a bare Op.ne would also exclude unassigned NULL rows). Re-assigning a
        // no-op row used to double-charge the agent for a lead they already held.
        { [Op.or]: [{ assignedAgentId: null }, { assignedAgentId: { [Op.ne]: agentId } }] },
      ],
    };

    // Lock the candidate rows and update them inside ONE transaction so the webhook side
    // sees a consistent picture: a concurrent (re)assignment of the same lead cannot slip
    // between our read and our write (which would otherwise mis-attribute or skip a
    // cross-app release and leave the other app holding an active copy). RETURNING stays the
    // source of truth for WHICH rows changed, so per-campaign credit counting is exact. We
    // lock WITHOUT the campaign include — FOR UPDATE cannot be applied to the nullable side
    // of an outer join — and fetch campaign data for the payloads afterwards.
    let result = [0, []];
    const lockedById = new Map();
    let requestedRows = [];
    await d.sequelize.transaction(async (transaction) => {
      const locked = await m.Prospect.findAll({
        where: whereConditions,
        attributes: ['id', 'assignedAgentId', 'campaignId', 'quarantinedAt'],
        transaction,
        lock: true,
      });
      for (const row of locked) lockedById.set(row.id, row);
      result = await m.Prospect.update(
        // Release + assign is ONE atomic write: clearing the hold here means a concurrent
        // release (external dispatch / double-submit) blocks on the row lock, re-reads
        // quarantinedAt IS NULL, and matches nothing — never a second delivery.
        { assignedAgentId: agentId, lastContactDate: new Date(), quarantinedAt: null, quarantineReason: null },
        // Update exactly the locked set; RETURNING reports the rows actually changed.
        { where: { id: { [Op.in]: [...lockedById.keys()] } }, returning: ['id', 'campaignId'], transaction }
      );
      // Snapshot every requested (in-scope) row for skip classification, same txn so the
      // classification matches what the locked UPDATE saw.
      requestedRows = await m.Prospect.findAll({
        where: { id: { [Op.in]: requestedIds }, ...scopeFilter },
        attributes: ['id', 'assignedAgentId', 'quarantinedAt', 'quarantineReason'],
        transaction,
      });
    });

    const affectedCount = result[0];
    const affectedRows = result[1] || [];

    // Skip accounting for the UI toast: classify every requested id that did NOT change.
    // (Post-UPDATE snapshot: affected rows are classified off the pre-UPDATE lock set.)
    const requestedById = new Map(requestedRows.map((r) => [r.id, r]));
    const skipped = { notFound: 0, alreadyAssigned: 0, heldFenced: 0 };
    let releasedCount = 0;
    for (const id of requestedIds) {
      if (lockedById.has(id)) {
        if (lockedById.get(id).quarantinedAt) releasedCount += 1;
        continue;
      }
      const row = requestedById.get(id);
      if (!row) skipped.notFound += 1;
      else if (row.quarantinedAt && !RELEASABLE_HOLD_REASONS.includes(row.quarantineReason)) skipped.heldFenced += 1;
      else skipped.alreadyAssigned += 1;
    }
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

      // Deliver each newly-assigned lead (bulk-assign previously fired NO webhook at all, so
      // bulk-assigned leads never reached the agent's app). Mirror the single-assign path:
      // lead.assigned to the new owner, plus — for a CROSS-app reassignment — lead.unassigned
      // to the previous owner so its copy in the other app doesn't linger. Payload rows are
      // fetched with their campaign; previous owners come from the locked snapshot.
      // One batch context for the whole fan-out: the mktr-leads receiver coalesces the N
      // per-lead pushes into a single "{size} leads assigned to you" summary (Lyfe ignores
      // batch for now — per-lead pushes, the pre-batch behavior).
      const batch = affectedCount > 1 ? { id: randomUUID(), size: affectedCount } : null;
      const affectedIds = affectedRows.map((row) => row.id);
      const full = await m.Prospect.findAll({
        where: { id: { [Op.in]: affectedIds } },
        include: [
          { association: 'campaign', attributes: ['id', 'name'] },
          { association: 'qrTag', attributes: ['id', 'slug'] },
        ],
      });

      const prevOwnerIds = [
        ...new Set(
          affectedIds
            .map((id) => lockedById.get(id)?.assignedAgentId)
            .filter((prevId) => prevId && prevId !== agentId)
        ),
      ];
      const prevAgentById = new Map();
      if (prevOwnerIds.length > 0) {
        const prevAgents = await m.User.findAll({
          where: { id: { [Op.in]: prevOwnerIds } },
          attributes: ['id', 'lyfeId', 'mktrLeadsId'],
        });
        for (const a of prevAgents) prevAgentById.set(a.id, a);
      }

      for (const p of full) {
        d.dispatchEvent('lead.assigned', () =>
          withBatchContext(
            buildLeadAssignedPayload(p, agent, p, { qrTag: p.qrTag || null, routingMode: 'direct' }),
            batch
          ),
          { destination: newDestination }
        );

        const prevId = lockedById.get(p.id)?.assignedAgentId;
        const prevAgent = prevId && prevId !== agentId ? prevAgentById.get(prevId) : null;
        if (prevAgent) {
          const prevDestination = destinationForAgent(prevAgent);
          if (prevDestination && prevDestination !== newDestination) {
            const previousAgentExternalId = externalIdForDestination(prevAgent, prevDestination);
            d.dispatchEvent('lead.unassigned', () => buildLeadUnassignedPayload(p, previousAgentExternalId), {
              destination: prevDestination,
            });
          }
        }
      }

      // Log a ProspectActivity per newly-assigned lead so BULK assignment lands on the unified
      // timeline too — single-assign already logs (assignProspect), this path historically wrote
      // none, so bulk-assigned leads were missing their "assigned" event. Best-effort (post-commit,
      // like the credit deduction above) — never fail the assignment over an audit-row write.
      await m.ProspectActivity.bulkCreate(
        full.map((p) => {
          const lockedRow = lockedById.get(p.id);
          const prevId = lockedRow?.assignedAgentId;
          return {
            prospectId: p.id,
            type: 'assigned',
            actorUserId: user?.id || null,
            description: `Assigned to ${agent.firstName} ${agent.lastName}`.trim(),
            // Flag a reassignment (a prior owner existed) as a BOOLEAN so the timeline renders
            // 'reassigned' — never expose who held it before. `released` marks a row that was
            // HELD when the bulk assign claimed it (audit parity with single-release).
            metadata: {
              assignedAgentId: agent.id,
              via: 'bulk_assign',
              ...(prevId && prevId !== agentId ? { reassigned: true } : {}),
              ...(lockedRow?.quarantinedAt ? { released: true } : {}),
            },
          };
        })
      ).catch((err) => d.logger.error('Failed to log bulk-assign activity', { error: err?.message || String(err) }));
    }

    return { affectedCount, releasedCount, skipped, agent };
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
      assignment,
      campaignId,
      search,
      dateFrom,
      dateTo,
      qrTagId,
    } = params;

    // Clamp pagination so malformed query params (e.g. ?page=-1&limit=-5) don't
    // reach Sequelize as a negative LIMIT/OFFSET, which throws → 500.
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 10), 200);
    const offset = (pageNum - 1) * limitNum;
    const scopeFilter = await d.buildProspectWhere(user);
    const whereConditions = { ...scopeFilter };

    // Unknown leadStatus would hit the Postgres enum and 500; degrade to "no
    // matches" so a bad filter value returns an empty page rather than erroring.
    if (leadStatus && !VALID_LEAD_STATUSES.includes(leadStatus)) {
      return { prospects: [], pagination: { currentPage: pageNum, totalPages: 0, totalItems: 0, itemsPerPage: limitNum } };
    }
    if (assignment && !VALID_ASSIGNMENT_FILTERS.includes(assignment)) {
      return { prospects: [], pagination: { currentPage: pageNum, totalPages: 0, totalItems: 0, itemsPerPage: limitNum } };
    }

    // Assignment-state filter: 'unassigned' means truly in limbo (not held — held rows
    // have their own bucket so the admin's pending pool and the strays stay separable).
    if (assignment === 'assigned') whereConditions.assignedAgentId = { [Op.ne]: null };
    else if (assignment === 'unassigned') {
      whereConditions.assignedAgentId = null;
      whereConditions.quarantinedAt = null;
    } else if (assignment === 'held') whereConditions.quarantinedAt = { [Op.ne]: null };

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
      limit: limitNum,
      offset,
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

    // Admin-only: attach a light cross-campaign repeat-signup count per row for
    // the list badge. Non-admins never receive it (this list endpoint is shared
    // with the agent MyProspects view). Resilient — failure → no badge data.
    if (user?.role === 'admin' && prospects.length > 0) {
      const counts = await repeatSignupCounts(
        d.sequelize,
        prospects.map((p) => ({ id: p.id, phone: p.phone, email: p.email }))
      ).catch(() => new Map());
      for (const p of prospects) p.setDataValue('repeatSignupCount', counts.get(p.id) ?? null);
    }

    return {
      prospects,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(count / limitNum),
        totalItems: count,
        itemsPerPage: limitNum,
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
    const { campaignId, quarantineReason } = params;
    const limit = Math.min(parseInt(params.limit, 10) || 100, 500);
    const scopeFilter = await d.buildProspectWhere(user);
    const where = { ...scopeFilter, quarantinedAt: { [Op.ne]: null } };
    if (campaignId) where.campaignId = campaignId;
    // Filter by reason IN the query (before the limit) so assignable holds are never
    // hidden behind a page of external-buyer holds.
    if (quarantineReason) where.quarantineReason = quarantineReason;

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

  // The System-Agent routing fallback is only a true orphan marker when it has NO delivery
  // destination (no lyfeId / mktrLeadsId) — its leads were never delivered anywhere. If
  // DEFAULT_AGENT_ID ever points at a REAL fallback agent (whose leads DO get delivered),
  // this returns null so those leads can never be mistaken for orphans (Codex B/P1).
  async function orphanSystemAgentId() {
    const id = await d.getSystemAgentId();
    if (!id) return null;
    const u = await m.User.findByPk(id, { attributes: ['id', 'lyfeId', 'mktrLeadsId'] });
    return u && !u.lyfeId && !u.mktrLeadsId ? id : null;
  }

  /**
   * Fleet-wide list of dispatchable ORPHANS for the external admin queue: no_funded_agent
   * HOLDS *and* leads parked on the phantom System Agent (the soft-campaign fallback,
   * which has no phone so they were never delivered). Each row is tagged with `reason`
   * ('no_funded_agent' | 'unassigned') and a `since` timestamp.
   */
  async function listDispatchableOrphans({ campaignId = null, limit } = {}) {
    const systemAgentId = await orphanSystemAgentId();
    const lim = Math.min(parseInt(limit, 10) || 50, 200);
    const orphanClauses = [{ quarantinedAt: { [Op.ne]: null }, quarantineReason: 'no_funded_agent' }];
    if (systemAgentId) orphanClauses.push({ assignedAgentId: systemAgentId, quarantinedAt: null });
    const where = { [Op.or]: orphanClauses };
    if (campaignId) where.campaignId = campaignId;

    const { count, rows } = await m.Prospect.findAndCountAll({
      where,
      include: [
        { association: 'campaign', attributes: ['id', 'name'] },
        // qrTag drives the "QR code" source label for a bound-QR lead whose leadSource isn't
        // 'qr_code'. Select only REAL columns — QrTag has `slug` but NO `externalId` (that field
        // exists on the webhook payload's qrTag, not the model), so signupSourceLabel keys off slug.
        { association: 'qrTag', attributes: ['id', 'slug'] },
      ],
      order: [['createdAt', 'ASC']], // FIFO by signup (held + unassigned interleaved)
      limit: lim,
    });

    const orphans = rows.map((p) => {
      // Full personal / firmographic data the admin detail view shows (DOB, postal,
      // company, …) — parity with a delivered lead, plus the demographics it drops.
      const { birthday, details } = buildHeldLeadEnrichment(p);
      return {
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        phone: p.phone,
        email: p.email,
        leadSource: p.leadSource,
        // Rich, delivered-lead-equivalent label ("Instagram ad", "Meta ad", "Web form", …)
        // derived from sourceMetadata.utm — so the held queue reads the same source the lead
        // will show once assigned, not the coarse capture channel.
        sourceLabel: signupSourceLabel({ leadSource: p.leadSource, qrTag: p.qrTag, sourceMetadata: p.sourceMetadata }),
        // Raw DOB string — the buyer app formats it to DD/MM/YYYY (one formatter, app-side).
        birthday,
        // Ordered, display-ready [{ label, value }] enrichment rows (no PII beyond what the
        // admin-only detail view already shows; never enters the non-PII summary projection).
        details,
        campaignId: p.campaignId,
        campaignName: p.campaign?.name || null,
        reason: p.quarantinedAt ? 'no_funded_agent' : 'unassigned',
        since: p.quarantinedAt || p.createdAt,
        createdAt: p.createdAt,
      };
    });

    return { count, orphans };
  }

  /**
   * Assign an ORPHANED prospect (a no_funded_agent HOLD, or a lead parked on the phantom
   * System Agent fallback) to a mktr-leads agent and deliver it via a fresh `lead.assigned`
   * — the lead is new to the destination app, so the receiver INSERTs it from that payload
   * AND records an explicit "assigned @ now" activity in the lead's timeline.
   *
   * The held-only counterpart to assignProspect, purpose-built for the external
   * mktr-leads admin dispatch endpoint. Unlike assignProspect it can NEVER fall
   * into the normal-reassignment path: a request that arrives after the lead is
   * already released returns `already_handled` (no second charge, no second
   * delivery). The release UPDATE and the `lead.assigned` delivery row are
   * written in ONE transaction (outbox), so a crash can never leave a lead
   * un-held yet undelivered (recoverPendingRetries flushes the row on restart).
   *
   * Agent identity is resolved by `mktrLeadsId` ONLY — never by phone, which can
   * resolve a Lyfe-owned or provenance-less user whose webhook destination would
   * not be mktr_leads. A manual admin assign is an explicit override: it always
   * delivers and only best-effort deducts a campaign credit (the lead was held
   * precisely because nobody was funded).
   *
   * @returns {Promise<{status:'assigned'|'already_handled'|'invalid_agent'|'not_found'|'not_assignable_external', leadId?:string, agent?:object}>}
   */
  async function releaseHeldProspect(prospectId, agentMktrLeadsId, opts = {}) {
    const { idempotencyKey = null, actorUserId = null, batch = null } = opts;
    const IDEMP_SCOPE = 'external:held-assign';

    // Replay: a retried request with the same key returns the first result verbatim.
    if (idempotencyKey) {
      const existing = await m.IdempotencyKey.findOne({ where: { key: idempotencyKey, scope: IDEMP_SCOPE } });
      if (existing && existing.expiresAt > new Date() && existing.responseBody) {
        return existing.responseBody;
      }
    }

    // Load the prospect FIRST so a retry after a successful release reports
    // already_handled — not invalid_agent if the chosen agent was since deactivated.
    const prospect = await m.Prospect.findByPk(prospectId);
    if (!prospect) return { status: 'not_found' };
    // External-buyer holds can never be manually released to an internal agent.
    if (prospect.quarantineReason === 'no_funded_external_buyer') {
      return { status: 'not_assignable_external' };
    }
    // An orphan = a lead with no real owner: a no_funded_agent HOLD, or one parked on
    // the phantom System Agent (the soft-campaign fallback — never delivered anywhere).
    // Anything else is a real assigned lead and must not be touched here.
    const systemAgentId = await orphanSystemAgentId();
    const isHeld = !!prospect.quarantinedAt && prospect.quarantineReason === 'no_funded_agent';
    const isUnassigned = !prospect.quarantinedAt && !!systemAgentId && prospect.assignedAgentId === systemAgentId;
    if (!isHeld && !isUnassigned) return { status: 'already_handled' };

    // Resolve the destination agent by mktrLeadsId ONLY (phone is unsafe — it can
    // resolve a Lyfe-owned / provenance-less user whose destination ≠ mktr_leads).
    const agent = agentMktrLeadsId
      ? await m.User.findOne({ where: { mktrLeadsId: agentMktrLeadsId, role: 'agent', isActive: true } })
      : null;
    if (!agent) return { status: 'invalid_agent' };

    // Atomic release + delivery intent (transactional outbox).
    const t = await d.sequelize.transaction();
    let result;
    let deliveryPairs = [];
    try {
      // Held-only conditional release: gated on the row STILL being a no_funded_agent
      // hold, so a racing duplicate or the auto sweep loses the row lock and sees
      // `quarantinedAt IS NULL` → 0 rows → already_handled (never a second delivery).
      const [rows] = await d.sequelize.query(
        `UPDATE prospects
            SET "assignedAgentId" = :agentId, "lastContactDate" = NOW(),
                "quarantinedAt" = NULL, "quarantineReason" = NULL, "updatedAt" = NOW()
          WHERE id = :prospectId AND (
            ("quarantinedAt" IS NOT NULL AND "quarantineReason" = 'no_funded_agent')
            OR ("assignedAgentId" = :systemAgentId AND "quarantinedAt" IS NULL)
          )
          RETURNING id`,
        { replacements: { agentId: agent.id, prospectId, systemAgentId }, transaction: t }
      );

      if (!Array.isArray(rows) || rows.length === 0) {
        result = { status: 'already_handled' };
      } else {
        await m.ProspectActivity.create({
          prospectId,
          type: 'assigned',
          actorUserId,
          description: `Assigned to ${agent.firstName} ${agent.lastName} via the dispatch queue`.trim(),
          metadata: { assignedAgentId: agent.id, released: true, via: 'external_app', fromSystemAgent: isUnassigned },
        }, { transaction: t });

        const withCampaign = await m.Prospect.findByPk(prospectId, {
          include: [
            { association: 'campaign', attributes: ['id', 'name'] },
            { association: 'qrTag', attributes: ['id', 'slug'] },
          ],
          transaction: t,
        });

        // Destination is mktr_leads (agent has mktrLeadsId set); the receiver matches
        // `routing.agentExternalId` against agents.mktr_user_id. buildLeadAssignedPayload sets
        // that id via externalIdForDestination(agent,'mktr_leads') === agent.mktrLeadsId.
        const destination = destinationForAgent(agent);

        // Fire lead.assigned (NOT lead.created) so the mktr-leads receiver records an explicit
        // "assigned @ now" activity on top of "received @ signup" — the dispatched lead's timeline
        // then shows the assignment AND its time, matching the MKTR-side activity logged above.
        // The lead is brand-new to the destination app, so the receiver INSERTs it from this
        // payload (the proven lead.assigned-inserts-new path); the lead block is identical to
        // buildLeadCreatedPayload, so delivery is otherwise unchanged.
        deliveryPairs = await d.persistEventDeliveries(
          'lead.assigned',
          () =>
            withBatchContext(
              buildLeadAssignedPayload(withCampaign, agent, withCampaign, {
                qrTag: withCampaign?.qrTag || null,
                routingMode: 'direct',
              }),
              batch
            ),
          { destination },
          t
        );
        // Fail closed: NEVER release a lead we cannot durably deliver. An empty set
        // means webhooks are disabled or no subscriber is tagged for this
        // destination — roll back so the lead stays held instead of vanishing.
        if (deliveryPairs.length === 0) {
          await t.rollback();
          return { status: 'undeliverable' };
        }

        result = { status: 'assigned', leadId: prospectId, agent: { firstName: agent.firstName, lastName: agent.lastName } };
      }

      // Record idempotency atomically with the release so an exact retry replays this
      // result verbatim. A concurrent same-key duplicate loses the unique PK and rolls
      // back — harmless, since the held-only release already prevents any double effect.
      if (idempotencyKey) {
        await m.IdempotencyKey.create({
          key: idempotencyKey,
          scope: IDEMP_SCOPE,
          responseBody: result,
          responseCode: 200,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        }, { transaction: t });
      }

      await t.commit();
    } catch (err) {
      await t.rollback();
      // A concurrent request with the SAME idempotency key won the unique PK — replay
      // its recorded result instead of surfacing a 500 (the held-only release already
      // guaranteed no double effect).
      if (idempotencyKey && (err?.name === 'SequelizeUniqueConstraintError' || err?.original?.code === '23505')) {
        const winner = await m.IdempotencyKey.findOne({ where: { key: idempotencyKey, scope: IDEMP_SCOPE } });
        if (winner?.responseBody) return winner.responseBody;
      }
      throw err;
    }

    // Post-commit side-effects — never block or roll back the durable release.
    if (result.status === 'assigned') {
      await d.deductLeadCredit({ agentId: agent.id, campaignId: prospect.campaignId || null })
        .catch((err) => d.logger.error('[releaseHeldProspect] credit deduct failed', { error: err?.message || String(err) }));
      d.flushDeliveries(deliveryPairs);
    }

    return result;
  }

  /**
   * Reassign an ASSIGNED lead to a different mktr-leads agent (admin, from the app). Wraps
   * assignProspect (which fires lead.assigned → the mktr-leads receiver re-points the single
   * shared row, so the PREVIOUS agent loses RLS access — same-app reassign fires no disputed
   * lead.unassigned). Idempotent: a retry with the same key replays; re-targeting the SAME agent
   * is a no-op (no double charge). NOT for held/orphan leads — those use releaseHeldProspect.
   *
   * @returns {Promise<{status:'reassigned'|'invalid_agent'|'not_found'|'not_assignable', leadId?:string, agent?:object}>}
   */
  async function reassignProspectExternal(prospectId, agentMktrLeadsId, opts = {}) {
    const { idempotencyKey = null, actorUserId = null, batch = null } = opts;
    const IDEMP_SCOPE = 'external:admin-reassign';

    // Claim the idempotency key FIRST (unique PK) so concurrent / retried same-key requests can
    // never both run assignProspect (which always charges + dispatches). A completed claim replays
    // its result; a still-running claim reports in_progress (the caller retries).
    if (idempotencyKey) {
      const existing = await m.IdempotencyKey.findOne({ where: { key: idempotencyKey, scope: IDEMP_SCOPE } });
      if (existing) return existing.responseBody ?? { status: 'error', error: 'in_progress' };
      try {
        await m.IdempotencyKey.create({
          key: idempotencyKey, scope: IDEMP_SCOPE, responseBody: null, responseCode: null,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
      } catch (err) {
        if (err?.name === 'SequelizeUniqueConstraintError' || err?.original?.code === '23505') {
          const winner = await m.IdempotencyKey.findOne({ where: { key: idempotencyKey, scope: IDEMP_SCOPE } });
          return winner?.responseBody ?? { status: 'error', error: 'in_progress' };
        }
        throw err;
      }
    }

    // Record the outcome (success OR validation failure) on the claimed key so a retry replays it.
    const record = async (result) => {
      if (idempotencyKey) {
        await m.IdempotencyKey.update(
          { responseBody: result, responseCode: 200 },
          { where: { key: idempotencyKey, scope: IDEMP_SCOPE } },
        ).catch(() => {});
      }
      return result;
    };

    // Resolve the destination by mktrLeadsId ONLY (excludes Lyfe / provenance-less users).
    const agent = agentMktrLeadsId
      ? await m.User.findOne({ where: { mktrLeadsId: agentMktrLeadsId, role: 'agent', isActive: true } })
      : null;
    if (!agent) return record({ status: 'invalid_agent' });

    const prospect = await m.Prospect.findByPk(prospectId);
    if (!prospect) return record({ status: 'not_found' });
    // Only a lead currently assigned to a real agent is reassignable here; held/orphan leads go
    // through the held queue (releaseHeldProspect) so we never double-handle them.
    if (prospect.quarantinedAt || !prospect.assignedAgentId) return record({ status: 'not_assignable' });

    // Same-app scope: the lead's CURRENT owner must be a mktr-leads agent (a Lyfe-owned lead would
    // route through the Lyfe app — out of scope, and its receiver isn't wired for this).
    const currentOwner = await m.User.findByPk(prospect.assignedAgentId, { attributes: ['id', 'lyfeId', 'mktrLeadsId'] });
    if (destinationForAgent(currentOwner) !== 'mktr_leads') return record({ status: 'not_assignable' });

    const agentBrief = { firstName: agent.firstName, lastName: agent.lastName };
    try {
      // Already with the target → no-op so a retry / re-pick never double-charges the agent.
      if (prospect.assignedAgentId !== agent.id) {
        await assignProspect(prospectId, agent.id, { id: actorUserId }, { batch });
      }
    } catch (err) {
      // assignProspect isn't transactional; record the failure so a retry replays it (no
      // re-charge) and RETURN it as a typed result — a throw surfaces as a generic 500 and
      // the caller's app would misbucket the FIRST response as a retryable transport
      // failure instead of the sticky needs-attention state the recorded replay enforces.
      d.logger.error('[external-reassign] assignProspect failed', {
        prospectId,
        error: err?.message || String(err),
      });
      return record({ status: 'error', error: 'reassign_failed' });
    }
    return record({ status: 'reassigned', leadId: prospectId, agent: agentBrief });
  }

  /**
   * Return an ASSIGNED lead to the held queue (admin pull-back). Re-holds the prospect and
   * fires lead.unassigned WITH `returnedToHeld` so the previous agent's app drops it — the
   * mktr-leads receiver SOFT-DELETES (vanishes) the lead instead of disputing it; the Lyfe
   * receiver nulls its assigned_to (the agent loses RLS visibility — same effect, flag
   * ignored). Admins keep it, and a later dispatch (lead.assigned upsert) re-surfaces it.
   * NO refund (consistent with reassign). Idempotent; fail-closed for deliverable owners
   * (never re-hold a lead we can't durably vanish).
   *
   * Two callers, two flavors:
   * - EXTERNAL (mktr-leads admin app, defaults): reason 'no_funded_agent' so the existing
   *   external held queue + releaseHeldProspect handle it; mktr-leads-owned leads only.
   * - WEB ADMIN (bulk return, opts): reason 'returned_by_admin' — deliberately invisible
   *   to the external queue/release/sweep (all filter 'no_funded_agent'), so a returned
   *   Lyfe-owned lead can never leak to the external buyer pool. `anyDestination` admits
   *   Lyfe-owned and no-destination owners (System Agent — nothing was ever delivered, so
   *   the vanish is skipped and fail-closed does not apply). `promoteUnassigned` folds
   *   already-unassigned strays into the held pool (no webhook — nothing to vanish).
   *
   * @returns {Promise<{status:'returned'|'promoted'|'already_handled'|'not_assignable'|'not_found'|'undeliverable', leadId?:string}>}
   */
  async function returnProspectToHeld(prospectId, opts = {}) {
    const {
      idempotencyKey = null,
      actorUserId = null,
      reason = 'no_funded_agent',
      via = 'external_app',
      anyDestination = false,
      promoteUnassigned = false,
      scopeWhere = null,
    } = opts;
    const IDEMP_SCOPE = 'external:admin-return-held';

    if (idempotencyKey) {
      const existing = await m.IdempotencyKey.findOne({ where: { key: idempotencyKey, scope: IDEMP_SCOPE } });
      if (existing && existing.expiresAt > new Date() && existing.responseBody) {
        return existing.responseBody;
      }
    }

    const prospect = await m.Prospect.findOne({ where: { id: prospectId, ...(scopeWhere || {}) } });
    if (!prospect) return { status: 'not_found' };
    const previousAgentId = prospect.assignedAgentId;
    // A held lead is already in a queue → already_handled (a retry after a successful
    // return replays as a no-op).
    if (prospect.quarantinedAt) return { status: 'already_handled' };

    // ── Promotion arm (web-admin only): an unassigned, unheld stray joins the held pool.
    // No webhook — it has no owner app copy to vanish. Conditional UPDATE = race-safe.
    if (!previousAgentId) {
      if (!promoteUnassigned) return { status: 'already_handled' };
      const pt = await d.sequelize.transaction();
      try {
        const [rows] = await d.sequelize.query(
          `UPDATE prospects
              SET "quarantinedAt" = NOW(), "quarantineReason" = :reason, "updatedAt" = NOW()
            WHERE id = :prospectId AND "assignedAgentId" IS NULL AND "quarantinedAt" IS NULL
            RETURNING id`,
          { replacements: { prospectId, reason }, transaction: pt }
        );
        if (!Array.isArray(rows) || rows.length === 0) {
          await pt.rollback();
          return { status: 'already_handled' };
        }
        await m.ProspectActivity.create({
          prospectId,
          type: 'assigned',
          actorUserId,
          description: 'Moved to held queue by admin',
          metadata: { promoted: true, via },
        }, { transaction: pt });
        await pt.commit();
        return { status: 'promoted', leadId: prospectId };
      } catch (err) {
        await pt.rollback();
        throw err;
      }
    }

    const prevAgent = await m.User.findByPk(previousAgentId, { attributes: ['id', 'lyfeId', 'mktrLeadsId'] });
    const prevDestination = destinationForAgent(prevAgent);
    // External flavor stays same-app-scoped: only a mktr-leads-owned lead can be returned
    // (its broker + receiver own that contract). The web-admin flavor admits any owner.
    if (!anyDestination && prevDestination !== 'mktr_leads') return { status: 'not_assignable' };
    const previousAgentExternalId = externalIdForDestination(prevAgent, prevDestination);

    const t = await d.sequelize.transaction();
    let result;
    let deliveryPairs = [];
    try {
      // Conditional re-hold: gated on the row STILL being assigned to this agent and not held, so
      // a racing duplicate loses the row lock → 0 rows → already_handled (never a second vanish).
      const [rows] = await d.sequelize.query(
        `UPDATE prospects
            SET "assignedAgentId" = NULL, "quarantinedAt" = NOW(),
                "quarantineReason" = :reason, "updatedAt" = NOW()
          WHERE id = :prospectId AND "assignedAgentId" = :previousAgentId AND "quarantinedAt" IS NULL
          RETURNING id`,
        { replacements: { prospectId, previousAgentId, reason }, transaction: t }
      );

      if (!Array.isArray(rows) || rows.length === 0) {
        result = { status: 'already_handled' };
      } else {
        await m.ProspectActivity.create({
          prospectId,
          type: 'assigned',
          actorUserId,
          description: 'Returned to held queue by admin',
          metadata: { previousAgentId, returnedToHeld: true, via },
        }, { transaction: t });

        if (prevDestination) {
          // Vanish the lead from the previous agent's app — the mktr-leads receiver
          // soft-deletes on returnedToHeld; Lyfe nulls assigned_to.
          deliveryPairs = await d.persistEventDeliveries(
            'lead.unassigned',
            () => buildLeadUnassignedPayload(prospect, previousAgentExternalId, { returnedToHeld: true }),
            { destination: prevDestination },
            t
          );
          // Fail closed: never re-hold a lead we cannot durably vanish from the agent's app.
          if (deliveryPairs.length === 0) {
            await t.rollback();
            return { status: 'undeliverable' };
          }
        }
        // No-destination owner (System Agent / provenance-less): nothing was ever
        // delivered, so there is nothing to vanish — the re-hold alone is complete.

        result = { status: 'returned', leadId: prospectId };
      }

      if (idempotencyKey) {
        await m.IdempotencyKey.create({
          key: idempotencyKey,
          scope: IDEMP_SCOPE,
          responseBody: result,
          responseCode: 200,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        }, { transaction: t });
      }

      await t.commit();
    } catch (err) {
      await t.rollback();
      if (idempotencyKey && (err?.name === 'SequelizeUniqueConstraintError' || err?.original?.code === '23505')) {
        const winner = await m.IdempotencyKey.findOne({ where: { key: idempotencyKey, scope: IDEMP_SCOPE } });
        if (winner?.responseBody) return winner.responseBody;
      }
      throw err;
    }

    // Post-commit: flush the vanish delivery. NO credit refund (consistent with reassign).
    if (result.status === 'returned') {
      d.flushDeliveries(deliveryPairs);
    }

    return result;
  }

  /**
   * Bulk return leads to the held queue (web admin). Fan-out over the hardened single op
   * — the same pattern the mktr-leads admin app uses for its bulk — because per-row
   * fail-closed vanish semantics don't fit one set-based transaction: each row either
   * fully returns (re-hold + vanish delivery committed together) or reports why not.
   * `returned_by_admin` keeps every returned lead OUT of the external buyer queue.
   * No idempotency keys: the single op's conditional UPDATE makes re-runs no-ops.
   */
  async function bulkReturnProspectsToHeld(prospectIds, user) {
    if (!prospectIds || !Array.isArray(prospectIds) || prospectIds.length === 0) {
      throw new d.AppError('Prospect IDs array is required', 400);
    }
    const requestedIds = [...new Set(prospectIds)];
    const scopeWhere = await d.buildProspectWhere(user);

    const counts = { returned: 0, promoted: 0, alreadyHeld: 0, undeliverable: 0, notFound: 0 };
    for (const id of requestedIds) {
      const r = await returnProspectToHeld(id, {
        actorUserId: user?.id || null,
        reason: 'returned_by_admin',
        via: 'web_admin',
        anyDestination: true,
        promoteUnassigned: true,
        scopeWhere,
      });
      if (r.status === 'returned') counts.returned += 1;
      else if (r.status === 'promoted') counts.promoted += 1;
      else if (r.status === 'already_handled') counts.alreadyHeld += 1;
      else if (r.status === 'undeliverable') counts.undeliverable += 1;
      else counts.notFound += 1;
    }
    return counts;
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

  /**
   * All ProspectActivity rows for a prospect (oldest-first), with actorUserId explicitly
   * selected (the getProspect include omits it). Read-only; powers the external lead-timeline
   * endpoint that feeds the mktr-leads held detail's merged history.
   */
  async function getProspectActivities(prospectId, { limit = 200 } = {}) {
    if (!prospectId) return [];
    const rows = await m.ProspectActivity.findAll({
      where: { prospectId },
      attributes: ['id', 'type', 'description', 'actorUserId', 'metadata', 'createdAt'],
      order: [['createdAt', 'ASC']],
      limit: Math.min(parseInt(limit, 10) || 200, 500),
    });
    return rows.map((a) => ({
      id: a.id,
      type: a.type,
      description: a.description,
      actorUserId: a.actorUserId,
      metadata: a.metadata,
      createdAt: a.createdAt,
    }));
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
