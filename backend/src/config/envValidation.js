/**
 * Validate that required environment variables are set in production.
 * Call once at startup — throws on missing required vars.
 */
export function validateEnv() {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) return;

  const required = [
    'JWT_SECRET',
    'DB_HOST',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
  ];

  const recommended = [
    'CORS_ORIGIN',
    'IP_HASH_SALT',
    'ATTRIB_SECRET',
    'RETELL_WEBHOOK_SECRET',
  ];

  // Pipeline-critical: without these, leads never reach Lyfe
  const pipelineCritical = [
    'WEBHOOK_ENABLED',
    'LYFE_WEBHOOK_URL',
    'LYFE_WEBHOOK_SECRET',
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
  }

  const missingRecommended = recommended.filter(key => !process.env[key]);
  if (missingRecommended.length > 0) {
    console.warn(`⚠️ Recommended environment variables not set: ${missingRecommended.join(', ')}`);
  }

  const missingPipeline = pipelineCritical.filter(key => !process.env[key]);
  if (missingPipeline.length > 0) {
    console.warn(`⚠️ Pipeline-critical variables not set (leads will NOT reach Lyfe): ${missingPipeline.join(', ')}`);
  }

  // AI screening-call gate (docs/plans/retell-screening-calls.md §3.1): when the
  // master flag is on, every dial precondition must be present — otherwise
  // opted-in campaigns silently capture-and-hold with no dial ever happening
  // (the drain sweep would release them unscreened, defeating the feature).
  if (String(process.env.RETELL_SCREENING_ENABLED || 'false').toLowerCase() === 'true') {
    const screeningRequired = ['RETELL_API_KEY', 'RETELL_WEBHOOK_SECRET', 'RETELL_SCREENING_AGENT_ID', 'RETELL_SCREENING_FROM_NUMBER'];
    const missingScreening = screeningRequired.filter(key => !process.env[key]);
    if (missingScreening.length > 0) {
      console.warn(`⚠️ RETELL_SCREENING_ENABLED=true but missing: ${missingScreening.join(', ')} — screening dials cannot start; held leads will drain unscreened`);
    }
    if (process.env.RETELL_SCREENING_AGENT_ID && !/^agent_[a-z0-9]{10,64}$/i.test(process.env.RETELL_SCREENING_AGENT_ID.trim())) {
      console.warn('⚠️ RETELL_SCREENING_AGENT_ID does not look like a Retell agent id (agent_…) — dials will be skipped');
    }
    if (process.env.RETELL_SCREENING_FROM_NUMBER && !/^\+[1-9]\d{9,14}$/.test(process.env.RETELL_SCREENING_FROM_NUMBER.trim())) {
      console.warn('⚠️ RETELL_SCREENING_FROM_NUMBER is not E.164 (+65…) — dials will be skipped');
    }
  }

  // Meta Lead Ads ingestion (docs/plans/meta-lead-ads-native-pipe.md §7): the
  // flag arms a PUBLIC lead-bearing webhook, so a partial config must refuse
  // to boot — a missing secret would force the handler to drop or blindly
  // trust payloads, and a bad enc key strands every stored page token.
  if (String(process.env.META_LEAD_ADS_ENABLED || 'false').toLowerCase() === 'true') {
    const metaRequired = ['META_APP_SECRET', 'META_VERIFY_TOKEN', 'META_PAGE_TOKEN_ENC_KEY'];
    const missingMeta = metaRequired.filter((key) => !process.env[key]);
    if (missingMeta.length > 0) {
      throw new Error(`FATAL: META_LEAD_ADS_ENABLED=true but missing: ${missingMeta.join(', ')}`);
    }
    const rawKey = process.env.META_PAGE_TOKEN_ENC_KEY;
    const keyBytes = /^[0-9a-fA-F]{64}$/.test(rawKey) ? 32 : Buffer.from(rawKey, 'utf8').length;
    if (keyBytes !== 32) {
      throw new Error('FATAL: META_PAGE_TOKEN_ENC_KEY must be 32 bytes (64-char hex or a 32-char string)');
    }
    if (Boolean(process.env.META_PAGE_ID) !== Boolean(process.env.META_PAGE_ACCESS_TOKEN)) {
      throw new Error('FATAL: META_PAGE_ID and META_PAGE_ACCESS_TOKEN must be set together (the env fallback binds its token to exactly one page) or not at all');
    }
    if (String(process.env.WEBHOOK_ENABLED || 'false').toLowerCase() !== 'true') {
      // Assigned Meta leads persist their delivery INSIDE the capture txn and
      // fail closed on zero subscribers — with delivery disabled they would
      // retry to dead-letter with no prospect ever created.
      throw new Error('FATAL: META_LEAD_ADS_ENABLED=true requires WEBHOOK_ENABLED=true — Meta leads cannot deliver with webhooks off');
    }
  }

  // Connect Facebook (docs/plans/facebook-connect-self-serve.md §5): the flag
  // arms a PUBLIC OAuth surface — half-configured must refuse to boot.
  if (String(process.env.META_OAUTH_ENABLED || 'false').toLowerCase() === 'true') {
    if (String(process.env.META_LEAD_ADS_ENABLED || 'false').toLowerCase() !== 'true') {
      throw new Error('FATAL: META_OAUTH_ENABLED=true requires META_LEAD_ADS_ENABLED=true — self-serve connects ride the lead pipe');
    }
    const oauthRequired = ['META_APP_ID', 'FB_LOGIN_CONFIG_ID', 'META_AGENT_ADS_CAMPAIGN_ID', 'EXTERNAL_APP_SECRET'];
    const missingOauth = oauthRequired.filter((key) => !process.env[key]);
    if (missingOauth.length > 0) {
      throw new Error(`FATAL: META_OAUTH_ENABLED=true but missing: ${missingOauth.join(', ')}`);
    }
    // Explicit in production (review F18): a staging/custom host silently
    // inheriting the api.mktr.sg default would register the WRONG callback.
    const origin = process.env.META_OAUTH_CALLBACK_ORIGIN;
    if (!origin) {
      throw new Error('FATAL: META_OAUTH_ENABLED=true requires META_OAUTH_CALLBACK_ORIGIN (bare https origin, e.g. https://api.mktr.sg)');
    }
    if (!/^https:\/\/[^/]+$/.test(origin)) {
      throw new Error('FATAL: META_OAUTH_CALLBACK_ORIGIN must be a bare https origin (e.g. https://api.mktr.sg)');
    }
  }

  if (process.env.WEBHOOK_ENABLED && String(process.env.WEBHOOK_ENABLED).toLowerCase() !== 'true') {
    console.warn(`⚠️ WEBHOOK_ENABLED is "${process.env.WEBHOOK_ENABLED}" (not "true") — webhook delivery is disabled, leads will not reach Lyfe`);
  }

  // WhatsApp OTP is optional — SMS is the default channel. Warn only on a partial
  // config: one of the pair without the other guarantees WhatsApp send failures.
  const waId = process.env.META_WA_PHONE_NUMBER_ID;
  const waToken = process.env.META_WA_ACCESS_TOKEN;
  if (Boolean(waId) !== Boolean(waToken)) {
    console.warn('⚠️ WhatsApp OTP partially configured — both META_WA_PHONE_NUMBER_ID and META_WA_ACCESS_TOKEN are required. WhatsApp sends will fail and fall back to SMS until both are set.');
  }

  // Boolean feature flags are compared with === 'true' throughout the code, so
  // a typo ("ture", "1", "yes") silently disables the feature with no error.
  // Warn on any set-but-not-boolean value. (P3-1 — several of these silently
  // dark whole modules: a fresh deploy 404s all of Redeem Ops when
  // REDEEM_OPS_ENABLED is mistyped.)
  const booleanFlags = [
    'WEBHOOK_ENABLED', 'TRUST_PROXY', 'DB_SSL', 'ENABLE_DOMAIN_PREFIXES',
    'DESIGN_CONFIG_V2_WRITES_ENABLED', 'MARKETPLACE_INHERIT_ENABLED',
    'MARKETPLACE_QR_REDIRECT_ENABLED', 'MARKETPLACE_PUBLIC_API_ENABLED',
    'REDEEM_OPS_ENABLED', 'REDEEM_OPS_ENTITLEMENTS_ENABLED',
    'REDEEM_OPS_CADENCES_ENABLED', 'REDEEM_OPS_CADENCES_AI_ENABLED',
    'REDEEM_OPS_WHATSAPP_ENABLED',
    'DISCOVERY_ENABLED', 'DISCOVERY_IG_ENABLED', 'DISCOVERY_AI_TERMS_ENABLED',
    'DISCOVERY_SEARCH_TERMS_ENABLED', 'DISCOVERY_RESULT_QUOTA_ENABLED',
    'RETELL_SCREENING_ENABLED', 'SCREENING_DRY_RUN', 'HELD_LEAD_PING_ENABLED',
    'META_CAPI_ENABLED', 'TIKTOK_EVENTS_API_ENABLED',
    'REDEEMED_AUDIENCE_SYNC_ENABLED', 'REDEEMED_AUDIENCE_REQUIRE_CONSENT',
    'BILLING_ENABLED', 'AGENT_WALLET_ENABLED',
    'ADMIN_LEAD_OPS_EXTERNAL_ENABLED', 'ADMIN_PACKAGES_EXTERNAL_ENABLED',
    'AGENT_PACKAGES_EXTERNAL_ENABLED', 'HELD_LEADS_EXTERNAL_ENABLED',
    'LEAD_TIMELINE_EXTERNAL_ENABLED', 'SCORING_CONFIG_ADMIN_ENABLED',
    'DNC_API_ENABLED', 'DNC_BACKFILL_ENABLED',
    'DRAW_BOOST_AUTOPROVISION_ENABLED', 'DRAW_RECORD_AUTOCREATE_ENABLED',
    'ENRICHMENT_MAP_ARTIFACT_JOBS', 'ENRICHMENT_SCORING_ENABLED',
    'LYFE_LEAD_SUPPRESSED_ENABLED', 'MKTR_LEADS_LEAD_SUPPRESSED_ENABLED',
    'SYNC_AGENT_CRON', 'WHATSAPP_QR_HEADER', 'ENABLE_AUTH_MAPPING',
    'META_LEAD_ADS_ENABLED', 'META_OAUTH_ENABLED',
    'GOOGLE_ADS_UPLOADS_ENABLED', 'GOOGLE_CM_SYNC_ENABLED',
    'PLATFORM_DELIVERY_PLANNING_ENABLED', 'PLATFORM_DELIVERY_PAUSED',
    'TOUCHPOINTS_ENABLED', 'AUDIENCE_REMOVAL_WRITERS_ENABLED',
  ];
  const mistyped = booleanFlags.filter((k) => {
    const v = process.env[k];
    return v !== undefined && v !== '' && !['true', 'false'].includes(String(v).toLowerCase());
  });
  if (mistyped.length > 0) {
    console.warn(`⚠️ Boolean flags with non-boolean values (treated as FALSE by === 'true' checks): ${mistyped.map((k) => `${k}="${process.env[k]}"`).join(', ')}`);
  }

  // Bounded numerics (ads-centralisation §8): consumers clamp out-of-bounds
  // values into range at runtime, so a typo can't break delivery — but it CAN
  // silently give you a different cadence/horizon than you wrote. Warn.
  const numericBounds = [
    ['PLATFORM_DELIVERY_WORKER_MINUTES', 1, 60],
    ['PLATFORM_DELIVERY_MAX_ATTEMPTS', 1, 20],
    ['PLATFORM_DELIVERY_HTTP_TIMEOUT_MS', 1000, 120000],
    ['PLATFORM_DELIVERY_LEAD_HORIZON_HOURS', 1, 47],
    ['PLATFORM_DELIVERY_CREG_HORIZON_HOURS', 1, 47],
    ['PLATFORM_DELIVERY_CREG_FALLBACK_HORIZON_HOURS', 1, 24],
    ['PLATFORM_DELIVERY_OUTCOME_HORIZON_HOURS', 1, 160],
    ['PLATFORM_DELIVERY_RETENTION_DAYS', 7, 365],
    ['TOUCHPOINT_RETENTION_DAYS', 7, 730],
    ['TOUCHPOINTS_MAX_PER_SESSION_DAY', 5, 500],
    ['AUDIENCE_REMOVAL_DRAIN_MINUTES', 5, 120],
    ['AUDIENCE_REMOVAL_MAX_ATTEMPTS', 1, 30],
    ['AUDIENCE_REMOVAL_HTTP_TIMEOUT_MS', 1000, 120000],
    ['AUDIENCE_REMOVAL_MAX_DAYS', 7, 90],
  ];
  const badNumerics = numericBounds.filter(([k, min, max]) => {
    const v = process.env[k];
    if (v === undefined || v === '') return false;
    const n = Number(v);
    return !Number.isFinite(n) || n < min || n > max;
  });
  if (badNumerics.length > 0) {
    console.warn(`⚠️ Numeric env vars out of bounds (runtime clamps into range): ${badNumerics.map(([k, min, max]) => `${k}="${process.env[k]}" (allowed ${min}–${max})`).join(', ')}`);
  }

  // ENABLE_AUTH_MAPPING auto-creates a local account (emailVerified: true) for
  // any JWKS-verified token with an unknown email — shout when it is live.
  if (String(process.env.ENABLE_AUTH_MAPPING || '').toLowerCase() === 'true') {
    console.warn('⚠️ ENABLE_AUTH_MAPPING=true — JWKS-verified tokens with unknown emails will AUTO-CREATE user accounts (emailVerified: true). Make sure this is intentional.');
  }

  // Redeem-Ops consumer WhatsApp delivery (trial-reward PR E) ships dark —
  // REDEEM_OPS_WHATSAPP_ENABLED defaults false. Warn only when the flag is ON
  // but the dedicated Redeem WABA creds are missing: every reward send would
  // fail (truthfully receipted as notify_failed, but still silence for the
  // customer). Template names have code defaults (reward_pass/reward_voucher).
  if (String(process.env.REDEEM_OPS_WHATSAPP_ENABLED || '').toLowerCase() === 'true') {
    const missingRewardWa = ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'].filter((k) => !process.env[k]);
    if (missingRewardWa.length > 0) {
      console.warn(`⚠️ REDEEM_OPS_WHATSAPP_ENABLED=true but ${missingRewardWa.join(', ')} not set — reward WhatsApp sends will all fail (notify_failed receipts).`);
    }
  }
}
