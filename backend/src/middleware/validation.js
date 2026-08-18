import Joi from 'joi';
import { logger } from '../utils/logger.js';
import { CAMPAIGN_TYPE_IDS } from '../utils/campaignTypes.js';
import {
  CUSTOM_ANSWER_TEXT_MAX,
  MAX_CUSTOM_OPTIONS,
  MAX_TOTAL_PROFILE_QUESTIONS,
} from '../utils/designConfigV2.js';

// Validation middleware.
//
// Optional per-route Joi options (2nd arg) let a route opt into stripUnknown.
// The PUBLIC lead-capture route (POST /prospects) uses { stripUnknown: true } so
// an additive frontend field (frontend/backend contract drift) is DROPPED rather
// than 400ing the whole submission and losing the lead — a recurring failure mode
// for that revenue-critical endpoint, and a defence against a client injecting
// server-controlled keys (e.g. consentMetadata) it must never set. Internal /
// admin routes deliberately omit it so typos and stale clients keep failing loudly.
export const validate = (schema, options = {}) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, ...options });

    if (error) {
      const details = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        details: 'Invalid request data',
        errors: details
      });
    }

    // Only when a route explicitly opted into stripping do we swap in the
    // sanitized body; every other route keeps the raw req.body untouched, so this
    // change cannot alter Joi type-coercion behaviour for them.
    if (options.stripUnknown && value && typeof value === 'object') {
      const stripped = Object.keys(req.body || {}).filter((k) => !(k in value));
      if (stripped.length > 0) {
        // A stripped key almost always means frontend/backend contract drift.
        // Warn so the next mismatch isn't silent now that it no longer 400s.
        logger.warn(
          { route: req.originalUrl, strippedKeys: stripped },
          'validate(): dropped unknown request keys'
        );
      }
      req.body = value;
    }

    next();
  };
};

// Common validation schemas
export const schemas = {
  // User schemas
  userRegister: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).max(128).required(),
    // Allow either full_name/fullName OR firstName+lastName
    full_name: Joi.string().min(1).max(100),
    fullName: Joi.string().min(1).max(100),
    firstName: Joi.string().min(1).max(50),
    lastName: Joi.string().min(1).max(50),
    phone: Joi.string().min(10).max(20).optional(),
    role: Joi.string().valid('customer').optional()
  }).custom((value, helpers) => {
    const hasFull = !!value.full_name || !!value.fullName;
    const hasParts = !!value.firstName && !!value.lastName;
    if (!hasFull && !hasParts) {
      return helpers.error('any.custom', { message: 'Provide either full_name or firstName and lastName' });
    }
    return value;
  }, 'Name fields validation'),

  userLogin: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),

  userUpdate: Joi.object({
    email: Joi.string().email().optional(),
    firstName: Joi.string().min(1).max(50).optional(),
    lastName: Joi.string().min(1).max(50).optional(),
    phone: Joi.string().min(8).max(20).optional(),
    avatar: Joi.string().optional(),
    dateOfBirth: Joi.date().optional(),
    companyName: Joi.string().min(1).max(100).optional()
  }),

  // Campaign schemas — fields match what `campaignService.createCampaign` /
  // `updateCampaign` actually destructure (snake_case is intentional; the
  // table has both camelCase and snake_case columns from a half-migration).
  // assigned_agents is normalized into a join table by the service layer.
  // ad_playlist (retired tablet media) is accepted-and-stripped so a stale
  // cached bundle that still sends it doesn't 400 — the service never sees it.
  campaignCreate: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    type: Joi.string().valid(...CAMPAIGN_TYPE_IDS).optional(),
    // Campaign brief (campaigns.targetAudience) — shape + required picks are
    // enforced by the service via normalizeBrief (utils/campaignBrief.js);
    // format-only here, same split as design_config/slug.
    targetAudience: Joi.object().optional(),
    min_age: Joi.number().integer().min(0).max(120).optional(),
    max_age: Joi.number().integer().min(0).max(120).optional(),
    start_date: Joi.date().optional(),
    end_date: Joi.date().optional(),
    is_active: Joi.boolean().optional(),
    assigned_agents: Joi.array().items(Joi.string().uuid()).optional(),
    design_config: Joi.object().optional(),
    defaultAssignmentMode: Joi.string().valid('direct', 'round_robin').optional(),
    ad_playlist: Joi.any().strip(),
    enforceLeadQuota: Joi.boolean().optional(),
    metaPixelId: Joi.string().max(64).optional().allow(null, ''),
    tiktokPixelId: Joi.string().max(64).optional().allow(null, ''),
    // Wallet commit price (cents) — service enforces the admin-only clamp.
    leadPriceCents: Joi.number().integer().min(1).max(100000000).optional().allow(null),
    // Marketplace URL handle — service enforces charset/lock; format-only here.
    slug: Joi.string().max(80).optional().allow(null, '')
  }),

  campaignUpdate: Joi.object({
    name: Joi.string().min(1).max(100).optional(),
    type: Joi.string().valid(...CAMPAIGN_TYPE_IDS).optional(),
    // Campaign brief — omit to leave the stored brief untouched; when present
    // the service enforces a full valid brief (there is no clearing door).
    targetAudience: Joi.object().optional(),
    min_age: Joi.number().integer().min(0).max(120).optional(),
    max_age: Joi.number().integer().min(0).max(120).optional(),
    start_date: Joi.date().optional(),
    end_date: Joi.date().optional(),
    is_active: Joi.boolean().optional(),
    assigned_agents: Joi.array().items(Joi.string().uuid()).optional(),
    design_config: Joi.object().optional(),
    defaultAssignmentMode: Joi.string().valid('direct', 'round_robin').optional(),
    ad_playlist: Joi.any().strip(),
    enforceLeadQuota: Joi.boolean().optional(),
    metaPixelId: Joi.string().max(64).optional().allow(null, ''),
    tiktokPixelId: Joi.string().max(64).optional().allow(null, ''),
    // Wallet commit price (cents) — service enforces the admin-only clamp.
    leadPriceCents: Joi.number().integer().min(1).max(100000000).optional().allow(null),
    // Marketplace URL handle — service enforces charset + post-activation lock.
    slug: Joi.string().max(80).optional().allow(null, ''),
    // PR 5 rollout escape hatch: admin-only explicit v1-snapshot restore over a
    // stored v2 doc (service enforces role + logs; see the rollout runbook).
    confirmDesignRollback: Joi.boolean().optional(),
    // Draw pass colourway — a narrow top-level field rather than a design_config
    // write (a Studio-saved doc rejects an untagged one, and a display change
    // must not read as a draw-fact edit). Service enforces admin + the enum.
    drawPassTheme: Joi.string().max(16).optional()
  }).min(1),

  // Bulk lead ops (admin). Max 200 ids matches the list endpoint's page-size clamp —
  // a bulk op can never outgrow what one page of selection could have produced.
  prospectBulkAssign: Joi.object({
    prospectIds: Joi.array().items(Joi.string().uuid()).min(1).max(200).required(),
    agentId: Joi.string().uuid().required()
  }),

  prospectBulkIds: Joi.object({
    prospectIds: Joi.array().items(Joi.string().uuid()).min(1).max(200).required()
  }),

  // Prospect schemas
  prospectCreate: Joi.object({
    firstName: Joi.string().min(1).max(50).required(),
    lastName: Joi.string().min(1).max(50).optional().allow(''),
    email: Joi.string().email().required(),
    phone: Joi.string().min(8).max(20).optional()
      .custom((value, helpers) => {
        // Accept E.164 format or raw digits (will be normalized by service)
        const cleaned = value.replace(/[\s\-()]/g, '');
        if (/^\+[1-9]\d{9,14}$/.test(cleaned)) return value; // Valid E.164
        if (/^\d{8,15}$/.test(cleaned)) return value; // Raw digits, service will normalize
        return helpers.error('any.invalid');
      })
      .messages({ 'any.invalid': 'Phone must be in international format (e.g. +6591234567) or 8-15 digits' }),
    company: Joi.string().max(100).optional(),
    jobTitle: Joi.string().max(100).optional(),
    industry: Joi.string().max(50).optional(),
    leadSource: Joi.string().valid('qr_code', 'website', 'referral', 'social_media', 'advertisement', 'direct', 'other').required(),
    interests: Joi.array().items(Joi.string()).optional(),
    budget: Joi.object().optional(),
    location: Joi.object().optional(),
    // Added optional fields for Lead Capture
    // M8: strict calendar date only — the SGT age gate refuses Date-parser
    // ambiguity (TZ-bearing strings shifted the birth day on a UTC host).
    date_of_birth: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional()
      .messages({ 'string.pattern.base': 'date_of_birth must be YYYY-MM-DD' }),
    postal_code: Joi.string().optional(),
    education_level: Joi.string().optional(),
    monthly_income: Joi.string().optional(),
    // Optional associations: when omitted or null, backend may still bind via session attribution
    campaignId: Joi.alternatives().try(Joi.string().uuid(), Joi.valid(null)).optional(),
    qrTagId: Joi.alternatives().try(Joi.string().uuid(), Joi.valid(null)).optional(),
    // Only honored for admins at handler level; validate format only
    assignedAgentId: Joi.string().uuid().optional(),
    // Meta Pixel / CAPI dedup fields. Forwarded by the public lead-capture form
    // and stashed in Prospect.sourceMetadata server-side.
    eventId: Joi.string().max(64).optional(),
    fbp: Joi.string().max(255).optional(),
    fbc: Joi.string().max(255).optional(),
    eventSourceUrl: Joi.string().uri().max(2048).optional(),
    // CompleteRegistration dedup id — set when a quiz reveal fired the browser
    // CompleteRegistration; the server fires a matching CAPI event with this id.
    registrationEventId: Joi.string().max(64).optional(),
    // Google Ads click ids (gclid/gbraid/wbraid) + the CAPTURE timestamp —
    // load-bearing for the offline-conversion age guard, which measures from
    // the click (capture lands minutes after it), never the outcome
    // (plan google-ads-signal-levers §4.1). Whitelisted so stripUnknown
    // doesn't drop them (it logs a contract-drift warning, but the data is
    // still lost).
    gclid: Joi.string().max(512).optional(),
    gbraid: Joi.string().max(512).optional(),
    wbraid: Joi.string().max(512).optional(),
    gclCapturedAt: Joi.string().isoDate().optional(),
    // TikTok attribution identifiers (ttclid click id + _ttp first-party cookie).
    // Captured at the landing page, stashed in sourceMetadata for the Phase 6
    // server-side TikTok Events API. Whitelisted here so they don't 400.
    ttclid: Joi.string().max(512).optional(),
    ttp: Joi.string().max(255).optional(),
    // PDPA consent flags from the lead-capture form. Stashed in sourceMetadata
    // and recorded as consent-ledger evidence at capture. Since 3sites the
    // LEDGER (not this boolean) gates hashed PII (em/ph) in CAPI payloads —
    // see consentService.canMarketTo / metaCapiService._buildPayload.
    consent_contact: Joi.boolean().optional(),
    consent_terms: Joi.boolean().optional(),
    // Third-party-disclosure consent (separate opt-in checkbox added to the
    // public form in a446577). Whitelisted so the submission stops 400ing on the
    // unknown key. Turning it into the `consentMetadata.external` evidence that
    // actually unlocks external/buyer-agent delivery is a follow-up — see
    // services/externalConsent.hasValidExternalConsent; until then external stays
    // inert and the flag is stripped server-side (prospectService) rather than persisted.
    consent_third_party: Joi.boolean().optional(),
    // DNC (Do Not Call) consent — the explicit opt-in the consent gate shows ONLY when
    // the prospect's OTP-verified number is on Singapore's DNC Registry. Whitelisted so
    // the public submit (stripUnknown) keeps it instead of dropping it. The server BUILDS
    // the authoritative consentMetadata.dnc evidence from this intent boolean
    // (prospectService) — the DNC *fact* comes from the server-side check, never the
    // client; this flag only records that the person ticked the box. That evidence is what
    // releases an otherwise-held DNC-registered lead (services/dncConsent.hasValidDncConsent).
    consent_dnc: Joi.boolean().optional(),
    // Which contact-consent wording the form actually displayed.
    // '2026-07-21-agree-all-v1' = the mandatory agree-all block (both funnels
    // since the 2026-07-21 rework); absent = the legacy three-checkbox copy
    // (pre-rework cached bundles). Strict valid() enum, not free string — the
    // consent ledger maps this label to pinned copy/hash evidence
    // (services/contactConsent.js), and an unknown label must never mint
    // evidence.
    consent_copy_version: Joi.string().valid('2026-07-21-agree-all-v1').optional(),
    // Marketplace flow extras (redeem.sg /flow/:slug — docs/plans/
    // redeem-marketplace-v2.md Phase 4). Whitelisted here (this endpoint runs
    // stripUnknown, so an unlisted key is silently dropped); prospectService
    // VALIDATES the values against the campaign's config before stashing them
    // at sourceMetadata.marketplace — never trusted as free text downstream.
    marketplace: Joi.object({
      child_name: Joi.string().max(120).optional().allow(''),
      child_school_level: Joi.string().max(120).optional().allow(''),
      preferred_branch: Joi.string().max(120).optional().allow(''),
      preferred_timing: Joi.string().max(120).optional().allow('')
    }).optional(),
    // Quiz funnel: raw answers + an advisory client-computed result. The server
    // RE-SCORES authoritatively from campaign.design_config.quiz (see
    // prospectService.createProspect) and stashes the result in
    // sourceMetadata.quiz — the client-supplied `result` is never trusted.
    quizResult: Joi.object({
      quizId: Joi.string().max(64).optional(),
      version: Joi.number().integer().optional(),
      answers: Joi.array().items(Joi.object({
        qid: Joi.string().max(64).required(),
        value: Joi.alternatives().try(Joi.string().max(64), Joi.number()).required()
      })).max(50).optional(),
      result: Joi.object().optional()
    }).optional(),
    // Enrichment profile questions (studio-profile-questions §5.4 step 1).
    // Nested-strict by design: the route's global stripUnknown would
    // otherwise silently REMOVE a pattern-failed key instead of 400ing
    // (Codex PR0 R2 #6). Keys are question ids; values are a single option
    // id or a bounded option-id array (multi questions). Structural abuse
    // ⇒ 400 (for requests the rate limiter admits — limiter runs first).
    // Campaign-scoped semantic validation happens in prospectService.
    profileAnswers: Joi.object()
      .pattern(
        Joi.string().pattern(/^[a-z][a-z0-9_]{0,31}$/),
        Joi.alternatives().try(
          // The string alternative also carries custom free-TEXT answers
          // (studio-custom-questions §6) — semantic validation still drops any
          // non-option value for select questions, so the wider bound never
          // loosens library answers.
          Joi.string().max(CUSTOM_ANSWER_TEXT_MAX),
          Joi.array().items(Joi.string().max(32)).max(MAX_CUSTOM_OPTIONS).unique()
        )
      )
      .max(MAX_TOTAL_PROFILE_QUESTIONS)
      .unknown(false)
      .optional(),
    // Ad attribution (IG/TikTok). Captured from the landing URL, stashed in
    // sourceMetadata.utm for per-ad-set reporting. Previously dropped (the
    // schema rejected unknown keys), so these were lost before this change.
    utm_source: Joi.string().max(128).optional(),
    utm_medium: Joi.string().max(128).optional(),
    utm_campaign: Joi.string().max(190).optional(),
    utm_content: Joi.string().max(190).optional(),
    utm_term: Joi.string().max(190).optional(),
    // Referral identity: the sharer's prospect UUID carried by the share URL's
    // ?ref= param. Resolved server-side into sourceMetadata.referral (see
    // prospectService.createProspect) — only honored when leadSource='referral'.
    referralRef: Joi.string().max(64).optional()
  }),

  // QR Tag schemas — fields match `qrCodeService.createQrCode` destructure
  // plus `description` (sent by the promotional QR form, dropped server-side).
  // `slug`/`destinationUrl`/`qrCode`/`qrImageUrl` are server-generated.
  qrTagCreate: Joi.object({
    label: Joi.string().max(128).allow('', null).optional(),
    description: Joi.string().allow('', null).optional(),
    type: Joi.string().max(32).optional(),
    tags: Joi.array().items(Joi.string()).optional(),
    campaignId: Joi.string().uuid().optional(),
    carId: Joi.string().uuid().optional(),
    agentAssignmentMode: Joi.string().valid('direct', 'round_robin').optional(),
    agentGroupId: Joi.string().uuid().allow(null).optional(),
    // Accepts both raw digits (`65XXXXXXXX` — per `users.phone` storage contract)
    // and E.164 (`+65XXXXXXXX`). Frontend pulls agent.phone directly from the
    // synced Lyfe users table where + is stripped (see root CLAUDE.md "Phone
    // format storage contract"), so allowing the raw form is required.
    assignedAgentPhone: Joi.string().pattern(/^\+?[1-9]\d{9,14}$/).allow('', null).optional(),
    assignedAgentEmail: Joi.string().email().allow('', null).optional(),
    assignedAgentName: Joi.string().max(100).allow('', null).optional()
  }),


  // NOTE: `driverCreate` schema removed 2026-05-13. There is no
  // `POST /api/fleet/drivers` (or any `/drivers`) route on the backend; the
  // schema described a fleet-onboarding flow that was never wired and the
  // related tablet-app project is paused. If a driver-create endpoint is
  // ever added, define a fresh schema next to it.

  // Lead Package schemas — fields match `leadPackageController.createPackage`
  // destructure. `description`, `isPublic` and `status` are accepted because the
  // admin "Create Package Template" form sends them; the controller drops them
  // (the service forces status:'active'), but this strict Joi object would
  // otherwise 400 with `"isPublic"/"status" is not allowed`.
  leadPackageCreate: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    price: Joi.number().min(0).required(),
    leadCount: Joi.number().integer().min(1).required(),
    campaignId: Joi.string().uuid().required(),
    type: Joi.string().valid('basic', 'premium', 'enterprise', 'custom').optional(),
    description: Joi.string().allow('', null).optional(),
    isPublic: Joi.boolean().optional(),
    status: Joi.string().valid('active', 'inactive', 'draft', 'archived').optional()
  }),

  // Update mirrors create but every field is optional (partial update). The admin
  // "Edit Package Template" form re-submits the whole payload (incl. description,
  // isPublic, status), so all of those must be accepted here too. `.min(1)`
  // rejects an empty body.
  leadPackageUpdate: Joi.object({
    name: Joi.string().min(1).max(100).optional(),
    price: Joi.number().min(0).optional(),
    leadCount: Joi.number().integer().min(1).optional(),
    campaignId: Joi.string().uuid().optional(),
    type: Joi.string().valid('basic', 'premium', 'enterprise', 'custom').optional(),
    description: Joi.string().allow('', null).optional(),
    isPublic: Joi.boolean().optional(),
    status: Joi.string().valid('active', 'inactive', 'draft', 'archived').optional()
  }).min(1),

  // mktr-leads agent management (admin dashboard → mktr-leads source of truth).
  // Phone is a loose charset pre-check only — the mktr-leads edge function owns
  // canonical SG normalization (normalize_sg_phone); duplicating it here would
  // risk drift between what we accept and what links on signup.
  mktrLeadsAgentInvite: Joi.object({
    phone: Joi.string().trim().pattern(/^\+?[0-9 ()-]{8,16}$/).required()
      .messages({ 'string.pattern.base': 'phone must be a Singapore mobile number' }),
    full_name: Joi.string().trim().max(120).allow('', null).optional(),
    email: Joi.string().trim().email().allow('', null).optional(),
    agency: Joi.string().trim().max(120).allow('', null).optional()
  }),

  mktrLeadsAgentUpdate: Joi.object({
    full_name: Joi.string().trim().min(1).max(120).optional(),
    email: Joi.string().trim().email().allow('', null).optional(),
    agency: Joi.string().trim().max(120).allow('', null).optional()
  }).min(1),

  // ── users.js / agents.js admin writes (P4-6) — previously accepted arbitrary
  // bodies. Field lists mirror exactly what the services read (userService
  // createUser/updateUser/inviteUser/updateApprovalStatus, agentService
  // updateAgent) and the real client payloads (src/api/client.js
  // UserEntity.invite / agents.invite / BaseEntity.update). Types stay loose
  // where the service/normalizers own the format (phone) so sloppy-but-working
  // callers keep working; unknown keys pass through untouched (no stripUnknown),
  // as the services already ignore them.
  userCreate: Joi.object({
    email: Joi.string().email().required(),
    firstName: Joi.string().max(100).optional(),
    lastName: Joi.string().max(100).allow('', null).optional(),
    phone: Joi.string().max(32).allow('', null).optional(),
    role: Joi.string().valid('admin', 'agent', 'fleet_owner', 'driver_partner', 'customer', 'redeem_ops').optional(),
    isActive: Joi.boolean().optional(),
    owed_leads_count: Joi.number().integer().min(0).optional()
  }),

  // (Named adminUserUpdate — `userUpdate` above is /auth/profile's self-service schema.)
  adminUserUpdate: Joi.object({
    firstName: Joi.string().max(100).optional(),
    lastName: Joi.string().max(100).allow('', null).optional(),
    phone: Joi.string().max(32).allow('', null).optional(),
    avatar: Joi.string().max(2048).allow('', null).optional(),
    dateOfBirth: Joi.date().iso().allow('', null).optional(),
    // Admin-gated fields — the service ignores them for non-admins.
    role: Joi.string().valid('admin', 'agent', 'fleet_owner', 'driver_partner', 'customer', 'redeem_ops').optional(),
    isActive: Joi.boolean().optional(),
    owed_leads_count: Joi.number().integer().min(0).optional(),
    email: Joi.string().email().optional()
  }),

  // Invite roles = userService.inviteUser's allowlist ('customer' is not invitable).
  userInvite: Joi.object({
    email: Joi.string().email().required(),
    full_name: Joi.string().max(200).allow('', null).optional(),
    role: Joi.string().valid('agent', 'fleet_owner', 'driver_partner', 'redeem_ops', 'admin').required(),
    owed_leads_count: Joi.number().integer().min(0).optional()
  }),

  userBulkDelete: Joi.object({
    ids: Joi.array().items(Joi.string().uuid()).min(1).max(500).required()
  }),

  userStatusPatch: Joi.object({
    isActive: Joi.boolean().required()
  }),

  userApprovalPatch: Joi.object({
    approvalStatus: Joi.string().valid('pending', 'approved', 'rejected').required()
  }),

  agentInvite: Joi.object({
    email: Joi.string().email().required(),
    full_name: Joi.string().max(200).allow('', null).optional(),
    phone: Joi.string().max(32).allow('', null).optional(),
    owed_leads_count: Joi.number().integer().min(0).optional()
  }),

  agentUpdate: Joi.object({
    firstName: Joi.string().max(100).optional(),
    lastName: Joi.string().max(100).allow('', null).optional(),
    phone: Joi.string().max(32).allow('', null).optional(),
    avatar: Joi.string().max(2048).allow('', null).optional(),
    isActive: Joi.boolean().optional()
  })
};
