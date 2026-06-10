import Joi from 'joi';

// Validation middleware
export const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });

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
    role: Joi.string().valid('customer', 'driver_partner', 'fleet_owner').optional()
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
  // ad_playlist + assigned_agents are normalized into join tables by the
  // service layer; we accept them as opaque arrays here.
  campaignCreate: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    type: Joi.string().valid('lead_generation', 'brand_awareness', 'product_promotion', 'event_marketing', 'quiz').optional(),
    min_age: Joi.number().integer().min(0).max(120).optional(),
    max_age: Joi.number().integer().min(0).max(120).optional(),
    start_date: Joi.date().optional(),
    end_date: Joi.date().optional(),
    is_active: Joi.boolean().optional(),
    assigned_agents: Joi.array().items(Joi.string().uuid()).optional(),
    commission_amount_driver: Joi.number().min(0).optional().allow(null),
    commission_amount_fleet: Joi.number().min(0).optional().allow(null),
    defaultAssignmentMode: Joi.string().valid('direct', 'round_robin').optional(),
    ad_playlist: Joi.array().items(Joi.object()).optional(),
    enforceLeadQuota: Joi.boolean().optional()
  }),

  campaignUpdate: Joi.object({
    name: Joi.string().min(1).max(100).optional(),
    type: Joi.string().valid('lead_generation', 'brand_awareness', 'product_promotion', 'event_marketing', 'quiz').optional(),
    min_age: Joi.number().integer().min(0).max(120).optional(),
    max_age: Joi.number().integer().min(0).max(120).optional(),
    start_date: Joi.date().optional(),
    end_date: Joi.date().optional(),
    is_active: Joi.boolean().optional(),
    assigned_agents: Joi.array().items(Joi.string().uuid()).optional(),
    design_config: Joi.object().optional(),
    commission_amount_driver: Joi.number().min(0).optional().allow(null),
    commission_amount_fleet: Joi.number().min(0).optional().allow(null),
    defaultAssignmentMode: Joi.string().valid('direct', 'round_robin').optional(),
    ad_playlist: Joi.array().items(Joi.object()).optional(),
    enforceLeadQuota: Joi.boolean().optional()
  }).min(1),

  // Car schemas
  carCreate: Joi.object({
    make: Joi.string().min(1).max(50).required(),
    model: Joi.string().min(1).max(50).required(),
    year: Joi.number().min(1900).max(new Date().getFullYear() + 1).required(),
    color: Joi.string().max(30).optional(),
    plate_number: Joi.string().min(1).max(20).required(),
    vin: Joi.string().length(17).optional(),
    type: Joi.string().valid('sedan', 'suv', 'truck', 'van', 'coupe', 'hatchback', 'convertible', 'other').required(),
    status: Joi.string().valid('active', 'inactive', 'maintenance', 'retired').optional(),
    fleet_owner_id: Joi.string().uuid().required(),
    location: Joi.object().optional(),
    features: Joi.array().items(Joi.string()).optional(),
    mileage: Joi.number().min(0).optional(),
    fuelType: Joi.string().valid('gasoline', 'diesel', 'electric', 'hybrid', 'other').optional()
  }),

  // Fleet Owner schemas
  fleetOwnerCreate: Joi.object({
    full_name: Joi.string().min(1).max(100).required(),
    email: Joi.string().email().required(),
    phone: Joi.string().max(20).optional(),
    company_name: Joi.string().max(100).optional(),
    uen: Joi.string().max(50).optional(),
    payout_method: Joi.string().valid('PayNow', 'Bank Transfer').optional(),
    status: Joi.string().valid('active', 'inactive').optional()
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
    date_of_birth: Joi.alternatives().try(Joi.string(), Joi.date()).optional(),
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
    // TikTok attribution identifiers (ttclid click id + _ttp first-party cookie).
    // Captured at the landing page, stashed in sourceMetadata for the Phase 6
    // server-side TikTok Events API. Whitelisted here so they don't 400.
    ttclid: Joi.string().max(512).optional(),
    ttp: Joi.string().max(255).optional(),
    // PDPA consent flags from the lead-capture form. Stashed in sourceMetadata.
    // consent_contact gates hashed PII (em/ph) in the CAPI payload — see
    // metaCapiService._buildPayload's `marketingConsent` check.
    consent_contact: Joi.boolean().optional(),
    consent_terms: Joi.boolean().optional(),
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
    // Ad attribution (IG/TikTok). Captured from the landing URL, stashed in
    // sourceMetadata.utm for per-ad-set reporting. Previously dropped (the
    // schema rejected unknown keys), so these were lost before this change.
    utm_source: Joi.string().max(128).optional(),
    utm_medium: Joi.string().max(128).optional(),
    utm_campaign: Joi.string().max(190).optional(),
    utm_content: Joi.string().max(190).optional(),
    utm_term: Joi.string().max(190).optional()
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

  // NOTE: Removed duplicate fleetOwnerCreate schema that conflicted with app's current model

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
  })
};
