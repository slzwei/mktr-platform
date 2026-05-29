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
}
