import * as Sentry from '@sentry/node';
import { Op } from 'sequelize';
import { Prospect } from '../models/index.js';
import { hashEmail, hashPhone } from '../utils/piiHashing.js';
import { logger } from '../utils/logger.js';

/**
 * Redeemed-audience sync — pushes redeemers (hashed email + phone) from our own
 * `prospects` table into a Meta Customer-List custom audience (DFCA) used as an
 * ad-set EXCLUSION, so people who already redeemed stop seeing our ads.
 *
 * Complements (does not replace) the pixel-based "Already redeemed (Lead)"
 * audience, which under-captures because it depends on the browser pixel firing.
 *
 * Reliability/design notes:
 *  - Email/phone are pre-hashed here (SHA-256) via the shared piiHashing utils —
 *    the raw Graph API does NOT hash for us (unlike the Meta MCP). Raw PII never
 *    leaves this process; only hashes are sent, and only counts are logged.
 *  - Auth is an `Authorization: Bearer` header (precedent: metaLeadService.js),
 *    never a `?access_token=` query string.
 *  - Two upload modes (REDEEMED_AUDIENCE_SYNC_MODE):
 *      'add'     → POST /{id}/users      (additive; VERIFIED working)  [default]
 *      'replace' → POST /{id}/usersreplace (authoritative full replace; handles
 *                  removals/erasure, but its exact contract is PROBE-PENDING —
 *                  confirm against the live API before switching the default)
 *    For a suppression list, additive is safe: re-running ADD nightly is
 *    idempotent at the person level and refreshes retention so nobody ages out.
 */

const MAX_BATCH = 10000; // Meta cap: ≤10,000 users per /users request
const AUDIENCE_SCHEMA = ['EMAIL', 'PHONE'];
const SYNTHETIC_EMAIL_SUFFIX = '@calls.mktr.sg'; // Retell placeholder addresses

const defaultDeps = { Prospect, fetch: globalThis.fetch };

/** Read the configured Graph API version at call time (env-overridable). */
function graphVersion() {
  return process.env.META_GRAPH_API_VERSION || 'v21.0';
}

/** Default true; only `REDEEMED_AUDIENCE_REQUIRE_CONSENT=false` disables the gate. */
function requireConsentEnabled() {
  return process.env.REDEEMED_AUDIENCE_REQUIRE_CONSENT !== 'false';
}

/**
 * Guard: should the sync run at all? Mirrors metaCapiService.shouldFireCapi.
 * No-op (returns false) when the master switch is off or required config is
 * missing — so a misconfigured cron exits cleanly rather than erroring.
 */
export function shouldSync() {
  if (process.env.REDEEMED_AUDIENCE_SYNC_ENABLED !== 'true') return false;
  if (!process.env.META_ADS_MANAGEMENT_TOKEN) return false;
  if (!process.env.META_REDEEMED_AUDIENCE_ID) return false;
  return true;
}

/** Split an array into chunks of `size`. Exported for testing. */
export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Select redeemers: every non-bot prospect (form submitters). Consent + synthetic
 * filtering happens in buildUserRows so the SQL stays simple and the JSON consent
 * read mirrors metaCapiService (which treats consent_contact as a JS boolean).
 */
export async function selectRedeemers(deps = {}) {
  const d = { ...defaultDeps, ...deps };
  return d.Prospect.findAll({
    attributes: ['email', 'phone', 'sourceMetadata'],
    where: { leadSource: { [Op.ne]: 'call_bot' } },
    raw: true,
  });
}

/**
 * Turn prospect rows into hashed multi-key audience rows `[emailHash, phoneHash]`.
 * - Drops synthetic Retell emails (@calls.mktr.sg).
 * - When consent is required, drops rows without consent_contact === true.
 * - Drops rows with neither a usable email nor phone.
 * - Missing key → empty string (Meta multi-key allows blanks).
 */
export function buildUserRows(prospects, { requireConsent = true } = {}) {
  const rows = [];
  for (const p of prospects || []) {
    if (requireConsent && p?.sourceMetadata?.consent_contact !== true) continue;
    const email =
      p?.email && !String(p.email).toLowerCase().endsWith(SYNTHETIC_EMAIL_SUFFIX)
        ? p.email
        : null;
    const emHash = hashEmail(email);
    const phHash = hashPhone(p?.phone);
    if (!emHash && !phHash) continue;
    rows.push([emHash || '', phHash || '']);
  }
  return rows;
}

/**
 * Upload one batch to the audience. Throws a sanitized Error on non-2xx (message
 * carries Meta's error text + status only — never PII or invalid_entry_samples).
 */
export async function uploadBatch(
  { audienceId, token, version, mode, schema, data, session },
  deps = {}
) {
  const d = { ...defaultDeps, ...deps };
  const edge = mode === 'replace' ? 'usersreplace' : 'users';
  const url = `https://graph.facebook.com/${version}/${audienceId}/${edge}`;

  const form = new URLSearchParams();
  form.set('payload', JSON.stringify({ schema, data }));
  form.set('session', JSON.stringify(session));

  const res = await d.fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Meta's error message is safe to surface; do NOT attach the body (it can
    // carry invalid_entry_samples = hashed PII).
    const err = new Error(
      `redeemed audience upload failed: HTTP ${res.status} ${body?.error?.message || ''}`.trim()
    );
    err.status = res.status;
    throw err;
  }
  return {
    num_received: body.num_received,
    num_invalid_entries: body.num_invalid_entries,
    session_id: body.session_id,
  };
}

/**
 * Orchestrate a full sync. Never throws — errors land in Sentry + structured
 * logs (counts only). Returns a summary object.
 */
export async function syncRedeemedAudience(deps = {}) {
  const d = { ...defaultDeps, ...deps };

  if (!shouldSync()) {
    logger.info('redeemed_audience.sync.skipped (disabled or missing config)');
    return { synced: false, reason: 'guarded' };
  }

  const audienceId = process.env.META_REDEEMED_AUDIENCE_ID;
  const token = process.env.META_ADS_MANAGEMENT_TOKEN;
  const version = graphVersion();
  const mode = (process.env.REDEEMED_AUDIENCE_SYNC_MODE || 'add').toLowerCase();
  const requireConsent = requireConsentEnabled();

  try {
    const prospects = await selectRedeemers(d);
    const rows = buildUserRows(prospects, { requireConsent });
    logger.info(
      { selected: prospects.length, eligible: rows.length, requireConsent, mode },
      'redeemed_audience.sync.start'
    );

    if (rows.length === 0) {
      logger.warn('redeemed_audience.sync.empty (no eligible redeemers)');
      return { synced: true, eligible: 0, totalReceived: 0, totalInvalid: 0 };
    }

    const batches = chunk(rows, MAX_BATCH);
    const sessionId = Date.now(); // int64-safe, unique per run
    let totalReceived = 0;
    let totalInvalid = 0;

    for (let i = 0; i < batches.length; i++) {
      const session = {
        session_id: sessionId,
        batch_seq: i + 1,
        last_batch_flag: i === batches.length - 1,
        estimated_num_total: rows.length,
      };
      const r = await uploadBatch(
        { audienceId, token, version, mode, schema: AUDIENCE_SCHEMA, data: batches[i], session },
        d
      );
      totalReceived += r.num_received || 0;
      totalInvalid += r.num_invalid_entries || 0;
      logger.info(
        { batch_seq: session.batch_seq, num_received: r.num_received, num_invalid_entries: r.num_invalid_entries },
        'redeemed_audience.sync.batch'
      );
    }

    logger.info(
      { eligible: rows.length, totalReceived, totalInvalid, mode },
      'redeemed_audience.sync.done'
    );
    return { synced: true, eligible: rows.length, totalReceived, totalInvalid };
  } catch (err) {
    Sentry.captureException(err, { tags: { source: 'redeemed_audience_sync' } });
    logger.error({ err: err.message }, 'redeemed_audience.sync.failed');
    return { synced: false, error: err.message };
  }
}
