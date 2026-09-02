import { deployEnv, isSandbox, flagOn } from '../utils/deployEnv.js';
import { normalizePhone, normalizeEmail } from '../services/outboundPolicy.js';

/**
 * Fail-closed configuration validation for the deployment identity
 * (docs/plans/mktr-production-sandbox.md §4).
 *
 * The sandbox runs `NODE_ENV=production` on purpose, so nothing in the existing
 * env validation can tell the two apart. This module is the difference: it
 * refuses to boot a sandbox whose configuration resolves to ANY production
 * resource, and refuses to boot a production deployment carrying sandbox live-rail
 * switches.
 *
 * It reports VARIABLE NAMES and resource categories only — never values.
 */

/**
 * Public, non-secret production identifiers. If one of these strings appears in a
 * sandbox environment variable, that variable is pointed at production.
 * `SANDBOX_FORBIDDEN_MARKERS` appends more without a code change.
 */
const PRODUCTION_MARKERS = [
  ['nvtedkyjwulkzjeoqjgx', 'Lyfe production Supabase project'],
  ['rciuejxgziqxrwtifpbo', 'mktr-leads production Supabase project'],
  ['dpg-d2s2h7nfte5s739gnl7g-a', 'production MKTR Postgres'],
  ['mktr-backend-jo6r.onrender.com', 'production MKTR API service'],
  ['//api.mktr.sg', 'production MKTR API origin'],
  ['1402034528611431', 'production Meta pixel'],
  ['act_2170132703771607', 'production Meta ad account'],
  ['D8GJ6T3C77UDLID6746G', 'production TikTok pixel'],
  ['52506028688033', 'production Meta redeemed-audience'],
  ['www.dnc.gov.sg', 'PDPC production endpoint (sandbox must use the shared DNC queue)'],
];

/**
 * Variables that must be ABSENT (or falsey) in a sandbox: every one of them is a
 * live production rail whose sandbox destination has not been approved.
 */
const FORBIDDEN_IN_SANDBOX = [
  // The DNC credential lives ONLY in the shared gateway.
  ['DNC_ORG_CODE', 'DNC credential — belongs only to the shared DNC queue'],
  ['DNC_ESERVICE_ID', 'DNC credential — belongs only to the shared DNC queue'],
  ['DNC_PRIVATE_KEY', 'DNC credential — belongs only to the shared DNC queue'],
  ['DNC_BASE_URL', 'direct PDPC endpoint — sandbox must submit through DNC_GATEWAY_URL'],
  ['DNC_HTTPS_PROXY', 'DNC egress proxy — belongs only to the shared DNC queue'],
  // Production data planes.
  ['LYFE_SUPABASE_URL', 'production Lyfe database'],
  ['LYFE_SUPABASE_SERVICE_ROLE_KEY', 'production Lyfe service-role key'],
  ['MKTR_LEADS_SUPABASE_URL', 'production mktr-leads database'],
  ['MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY', 'production mktr-leads service-role key'],
  // Advertising / analytics writes.
  ['META_ACCESS_TOKEN', 'Meta ads/CAPI'],
  ['META_CAPI_ACCESS_TOKEN', 'Meta CAPI'],
  ['TIKTOK_ACCESS_TOKEN', 'TikTok Events API'],
  ['GOOGLE_DM_REFRESH_TOKEN', 'Google Data Manager'],
  ['GOOGLE_ADS_DEVELOPER_TOKEN', 'Google Ads'],
  // Voice / payments / AI.
  ['RETELL_API_KEY', 'Retell voice'],
  ['HITPAY_API_KEY', 'HitPay payments'],
  ['OPENAI_API_KEY', 'AI provider'],
  ['ANTHROPIC_API_KEY', 'AI provider'],
];

/** Feature flags that must be off in a sandbox — each one arms a background writer. */
const FLAGS_OFF_IN_SANDBOX = [
  'META_CAPI_ENABLED',
  'TIKTOK_EVENTS_API_ENABLED',
  'REDEEMED_AUDIENCE_SYNC_ENABLED',
  'GOOGLE_ADS_UPLOADS_ENABLED',
  'GOOGLE_CM_SYNC_ENABLED',
  'RETELL_SCREENING_ENABLED',
  'META_LEAD_ADS_ENABLED',
  'META_OAUTH_ENABLED',
  'BILLING_ENABLED',
  'DISCOVERY_ENABLED',
  'DNC_BACKFILL_ENABLED',
  'REDEEM_OPS_WHATSAPP_ENABLED',
  'PLATFORM_DELIVERY_PLANNING_ENABLED',
];

function extraMarkers() {
  const raw = process.env.SANDBOX_FORBIDDEN_MARKERS;
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => [s, 'operator-supplied production marker']);
}

/** Env vars whose values are scanned for production markers. Secrets are never printed. */
function scannableEnv() {
  return Object.entries(process.env).filter(([key, value]) => {
    if (!value) return false;
    // The markers list itself, and the guard rails that name production on purpose.
    if (key === 'SANDBOX_FORBIDDEN_MARKERS') return false;
    return true;
  });
}

function collectMarkerHits() {
  const markers = [...PRODUCTION_MARKERS, ...extraMarkers()];
  const hits = [];
  for (const [key, value] of scannableEnv()) {
    for (const [marker, description] of markers) {
      if (String(value).includes(marker)) hits.push(`${key} → ${description}`);
    }
  }
  return hits;
}

function railProblems() {
  const problems = [];
  const caps = (rail) => {
    const R = rail.toUpperCase();
    const values = [
      process.env[`SANDBOX_${R}_PER_DEST_DAILY_CAP`],
      process.env[`SANDBOX_${R}_DAILY_CAP`],
      process.env[`SANDBOX_${R}_MONTHLY_CAP`],
    ];
    // Absent means "use the built-in starting caps", which are durable and tiny.
    // An explicit 0 or a non-numeric value is a misconfiguration, not a cap.
    return values.every((v) => v === undefined || v === '' || (Number.parseInt(v, 10) > 0));
  };

  if (flagOn('SANDBOX_LIVE_OTP_ENABLED')) {
    const allowed = (process.env.SANDBOX_ALLOWED_PHONES || '').split(',').map(normalizePhone).filter(Boolean);
    if (allowed.length === 0) problems.push('SANDBOX_LIVE_OTP_ENABLED=true requires a non-empty SANDBOX_ALLOWED_PHONES');
    if (!caps('otp')) problems.push('SANDBOX_OTP_* caps must be positive integers when the OTP rail is live');
  }

  if (flagOn('SANDBOX_LIVE_EMAIL_ENABLED')) {
    const allowed = (process.env.SANDBOX_ALLOWED_EMAILS || '').split(',').map(normalizeEmail).filter(Boolean);
    if (allowed.length === 0) problems.push('SANDBOX_LIVE_EMAIL_ENABLED=true requires a non-empty SANDBOX_ALLOWED_EMAILS');
    if (!caps('email')) problems.push('SANDBOX_EMAIL_* caps must be positive integers when the email rail is live');
  }

  if (flagOn('DNC_API_ENABLED')) {
    if (!flagOn('SANDBOX_LIVE_DNC_ENABLED')) {
      problems.push('DNC_API_ENABLED=true requires SANDBOX_LIVE_DNC_ENABLED=true in a sandbox');
    }
    const allowed = (process.env.SANDBOX_ALLOWED_PHONES || '').split(',').map(normalizePhone).filter(Boolean);
    if (allowed.length === 0) problems.push('DNC_API_ENABLED=true requires a non-empty SANDBOX_ALLOWED_PHONES');
    if (!caps('dnc')) problems.push('SANDBOX_DNC_* caps must be positive integers when the DNC rail is live');
    if (!/^https:\/\/[^/]+/.test(process.env.DNC_GATEWAY_URL || '')) {
      problems.push('DNC_API_ENABLED=true requires DNC_GATEWAY_URL (https origin of the shared DNC queue)');
    }
    if (!process.env.DNC_GATEWAY_TOKEN) {
      problems.push('DNC_API_ENABLED=true requires DNC_GATEWAY_TOKEN (the sandbox source credential)');
    }
  }

  if (flagOn('SANDBOX_LIVE_DNC_ENABLED') && !flagOn('DNC_API_ENABLED')) {
    // Not fatal — the rail switch is armed but DNC itself is off. Surfaced by the caller.
  }

  return problems;
}

function webhookProblems() {
  const problems = [];
  const sink = process.env.SANDBOX_WEBHOOK_SINK_URL || '';
  for (const key of ['LYFE_WEBHOOK_URL', 'MKTR_LEADS_WEBHOOK_URL']) {
    const value = process.env[key];
    if (!value) continue;
    if (!sink || value !== sink) {
      problems.push(`${key} must be absent or exactly SANDBOX_WEBHOOK_SINK_URL — a sandbox may never deliver to a production receiver`);
    }
  }
  if (flagOn('WEBHOOK_ENABLED') && !sink) {
    problems.push('WEBHOOK_ENABLED=true requires SANDBOX_WEBHOOK_SINK_URL — the local signed sink is the only permitted destination');
  }
  return problems;
}

/**
 * Validate the deployment. Throws on any fail-closed condition; returns a list of
 * non-fatal warnings.
 * @returns {string[]} warnings
 */
export function validateDeployment() {
  const env = deployEnv(); // throws on an unknown DEPLOY_ENV
  const warnings = [];

  if (env === 'production') {
    const armed = ['SANDBOX_LIVE_OTP_ENABLED', 'SANDBOX_LIVE_DNC_ENABLED', 'SANDBOX_LIVE_EMAIL_ENABLED', 'SANDBOX_SEED_ALLOWED', 'SANDBOX_INIT_DB_ALLOWED']
      .filter((key) => flagOn(key));
    if (armed.length > 0) {
      throw new Error(`FATAL: DEPLOY_ENV=production but sandbox switches are armed: ${armed.join(', ')}`);
    }
    return warnings;
  }

  if (!isSandbox()) return warnings;

  const failures = [];

  // 1. Security posture: the sandbox must behave like production.
  if (process.env.NODE_ENV !== 'production') {
    failures.push('DEPLOY_ENV=sandbox requires NODE_ENV=production so production security behaviour stays active');
  }

  // 2. Database must be the isolated sandbox instance.
  if (!process.env.DB_HOST && !process.env.DATABASE_URL) {
    failures.push('DB_HOST (or DATABASE_URL) is required');
  }

  // 3. Nothing may resolve to a production resource.
  const hits = collectMarkerHits();
  if (hits.length > 0) {
    failures.push(`configuration points at production resources: ${hits.join('; ')}`);
  }

  // 4. Live production rails must not be credentialed at all.
  const present = FORBIDDEN_IN_SANDBOX.filter(([key]) => Boolean(process.env[key]));
  if (present.length > 0) {
    failures.push(`production-only credentials present: ${present.map(([k, why]) => `${k} (${why})`).join(', ')}`);
  }

  // 5. Background writers stay dark.
  const armedFlags = FLAGS_OFF_IN_SANDBOX.filter((key) => flagOn(key));
  if (armedFlags.length > 0) {
    failures.push(`background integrations must be off in a sandbox: ${armedFlags.join(', ')}`);
  }

  // 6. Agent sync must be off — its only source is production Lyfe.
  if (String(process.env.SYNC_AGENT_CRON || 'true').toLowerCase() !== 'false') {
    failures.push('SYNC_AGENT_CRON must be explicitly "false" in a sandbox (its default source is production Lyfe)');
  }

  // 7. Live-rail preconditions.
  failures.push(...railProblems());

  // 8. Webhook destinations.
  failures.push(...webhookProblems());

  // 9. Observability must never claim to be production.
  if (String(process.env.SENTRY_ENVIRONMENT || '').toLowerCase() === 'production') {
    failures.push('SENTRY_ENVIRONMENT must not be "production" in a sandbox');
  }

  if (failures.length > 0) {
    throw new Error(
      `FATAL: sandbox configuration refused to boot (${failures.length} problem(s)):\n  - ${failures.join('\n  - ')}`,
    );
  }

  if (!process.env.SANDBOX_PUBLIC_HOSTS) {
    warnings.push('SANDBOX_PUBLIC_HOSTS is not set — host detection falls back to sandbox.mktr.sg only');
  }
  if (process.env.DO_SPACES_BUCKET === undefined || process.env.DO_SPACES_BUCKET === '') {
    warnings.push('DO_SPACES_BUCKET is unset — uploads land on the ephemeral service disk, not an isolated bucket');
  }
  if (flagOn('SANDBOX_LIVE_DNC_ENABLED') && !flagOn('DNC_API_ENABLED')) {
    warnings.push('SANDBOX_LIVE_DNC_ENABLED=true but DNC_API_ENABLED=false — no DNC checks will run');
  }

  return warnings;
}

export default { validateDeployment };
