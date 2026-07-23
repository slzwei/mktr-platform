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
