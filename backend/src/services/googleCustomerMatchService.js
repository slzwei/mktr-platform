import * as Sentry from '@sentry/node';
import { Op } from 'sequelize';
import { Prospect } from '../models/index.js';
import { hashEmailGoogle, hashPhoneE164 } from '../utils/piiHashing.js';
import { dmRequest } from '../utils/googleDataManagerClient.js';
import { phoneVerificationIsCurrent } from './consumerService.js';
import { logger } from '../utils/logger.js';
import { sendEmail } from './mailer.js';
import { contactGrantAllows } from './contactConsent.js';

/**
 * Google Customer Match exclusion sync — the Google counterpart of
 * redeemedAudienceService, uploading hashed email+phone of a campaign's
 * verified entrants into a Customer Match list used as a CAMPAIGN-LEVEL
 * EXCLUSION, so people the funnel would dedupe-reject anyway stop costing
 * paid impressions (docs/plans/google-ads-signal-levers.md §3/2b).
 *
 * Deliberate differences from the Meta service, all review-driven (plan §10):
 *  - PER-CAMPAIGN population (GOOGLE_CM_CAMPAIGN_ID): the funnel dedupe is
 *    per (campaignId, phone) — a global list would suppress people still
 *    eligible for other campaigns.
 *  - Verified-phone predicate uses the shared phoneVerificationIsCurrent
 *    binding semantic (phoneVerifiedFor is a HASH bound to the number the
 *    stamp was earned for), never a bare phoneVerifiedAt check.
 *  - NO consent escape hatch. The Meta service's REQUIRE_CONSENT=false also
 *    removed its only verified-contact filter; not replicated here.
 *  - Google-specific hashing: hashEmailGoogle (gmail canonicalization) +
 *    hashPhoneE164 (E.164 WITH '+', the TikTok util — NOT Meta's digits-only
 *    hashPhone; wrong normalizer = silent zero-match).
 *  - Transport is the Data Manager API (audienceMembers:ingest) — the classic
 *    Google Ads API's Customer Match surface is closed to new integrations
 *    since 2026-04-01. Requests carry encoding:HEX (mandatory with hashed
 *    userData), the Customer Match terms acceptance, and CONSENT_GRANTED
 *    enums — truthful because every row is ledger-gated before upload.
 *
 * Erased rows never upload (sourceMetadata.erased skeleton). Erasure-time and
 * withdrawal-time REMOVAL hooks live with the erasure/consent services (plan
 * §3); the list's finite membership duration (Ads UI setting, 180d) is the
 * backstop for anything those hooks miss.
 */

const MAX_BATCH_MEMBERS = 5000; // ≤2 identifiers/member keeps us under the 10k identifier cap
const SYNTHETIC_EMAIL_SUFFIX = '@calls.mktr.sg';

const defaultDeps = { Prospect, fetch: globalThis.fetch, sendEmail, dmRequest };

/**
 * Guard: no-op cleanly when the master switch is off or config is missing —
 * a misconfigured scheduler exits instead of erroring. Mirrors
 * redeemedAudienceService.shouldSync.
 */
export function shouldSync() {
  if (process.env.GOOGLE_CM_SYNC_ENABLED !== 'true') return false;
  if (!process.env.GOOGLE_DM_OAUTH_CLIENT_ID) return false;
  if (!process.env.GOOGLE_DM_OAUTH_CLIENT_SECRET) return false;
  if (!process.env.GOOGLE_DM_REFRESH_TOKEN) return false;
  if (!process.env.GOOGLE_ADS_CUSTOMER_ID) return false;
  if (!process.env.GOOGLE_CM_USER_LIST_ID) return false;
  if (!process.env.GOOGLE_CM_CAMPAIGN_ID) return false;
  return true;
}

/** Split an array into chunks of `size`. Exported for testing. */
export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Select the target campaign's non-bot prospects. sourceMetadata rides along
 * for the erased flag + the verified-phone binding check in buildMemberRows.
 */
export async function selectCampaignProspects(deps = {}) {
  const d = { ...defaultDeps, ...deps };
  return d.Prospect.findAll({
    attributes: ['email', 'phone', 'campaignId', 'sourceMetadata'],
    where: {
      campaignId: process.env.GOOGLE_CM_CAMPAIGN_ID,
      leadSource: { [Op.ne]: 'call_bot' },
    },
    raw: true,
  });
}

/**
 * Prospect rows → Data Manager audience members. Every filter fails CLOSED:
 *  - erased skeletons out
 *  - unverified / stale-binding phones out (phoneVerificationIsCurrent)
 *  - no ledger contact grant in scope {row campaign, global} → out (no hatch;
 *    grantMap keyed BY PHONE like the Meta service so spine-unlinked rows
 *    still enforce; missing map/phone/entry → excluded)
 *  - suppressed phones out
 *  - synthetic Retell emails dropped from the email key
 *  - neither usable identifier → out
 * Returns [{ userIdentifiers: [{emailAddress}|{phoneNumber}...] }, ...] with
 * HEX SHA-256 values (request-level `encoding: "HEX"` declares this).
 */
export function buildMemberRows(prospects, { suppressedPhones = null, grantMap = null } = {}) {
  const rows = [];
  for (const p of prospects || []) {
    if (p?.sourceMetadata?.erased === true) continue;
    if (!phoneVerificationIsCurrent(p)) continue;
    if (!contactGrantAllows(grantMap?.get(p?.phone), p?.campaignId || null)) continue;
    if (suppressedPhones && p?.phone && suppressedPhones.has(p.phone)) continue;
    const email =
      p?.email && !String(p.email).toLowerCase().endsWith(SYNTHETIC_EMAIL_SUFFIX)
        ? p.email
        : null;
    const emHash = hashEmailGoogle(email);
    const phHash = hashPhoneE164(p?.phone);
    if (!emHash && !phHash) continue;
    const userIdentifiers = [];
    if (emHash) userIdentifiers.push({ emailAddress: emHash });
    if (phHash) userIdentifiers.push({ phoneNumber: phHash });
    rows.push({ userIdentifiers });
  }
  return rows;
}

/**
 * The ingest envelope for one batch. Exported for golden-envelope tests —
 * field names are pinned from the plan's round-2/3 doc checks and re-verified
 * by the opt-in validateOnly smoke script before the first live flip.
 */
export function buildIngestBody(members, { validateOnly = false } = {}) {
  return {
    destinations: [
      {
        operatingAccount: {
          product: 'GOOGLE_ADS',
          accountId: process.env.GOOGLE_ADS_CUSTOMER_ID,
        },
        productDestinationId: process.env.GOOGLE_CM_USER_LIST_ID,
      },
    ],
    audienceMembers: members.map((m) => ({ userData: { userIdentifiers: m.userIdentifiers } })),
    consent: { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' },
    encoding: 'HEX',
    termsOfService: { customerMatchTermsOfServiceStatus: 'ACCEPTED' },
    ...(validateOnly ? { validateOnly: true } : {}),
  };
}

async function sendBadRunAlert(d, subject, body) {
  const to = process.env.GOOGLE_CM_ALERT_EMAIL || process.env.REDEEMED_AUDIENCE_ALERT_EMAIL;
  if (!to) return;
  try {
    await d.sendEmail({ to, subject, text: body });
    logger.info({ to }, 'google_cm.sync.alert_sent');
  } catch (err) {
    logger.warn({ err: err.message }, 'google_cm.sync.alert_failed');
  }
}

// In-process single-flight: the scheduler's interval and a deploy's initial
// run must never overlap (single-instance backend — this is the whole lock).
let syncInFlight = false;

/**
 * Orchestrate a full sync. Never throws — errors land in Sentry + structured
 * logs (counts only, never PII) + an optional alert email. Aggregate-only
 * accounting is deliberate: membership isn't tracked per-row locally and the
 * next additive run self-heals partial failures (plan §3 job lifecycle).
 */
export async function syncGoogleCustomerMatch(deps = {}) {
  const d = { ...defaultDeps, ...deps };

  if (!shouldSync()) {
    logger.info('google_cm.sync.skipped (disabled or missing config)');
    return { synced: false, reason: 'guarded' };
  }
  if (syncInFlight) {
    logger.warn('google_cm.sync.overlap_skipped');
    return { synced: false, reason: 'overlap' };
  }
  syncInFlight = true;

  try {
    // Fail-closed by construction: if either ledger lookup throws, the run
    // aborts — never upload while blind to withdrawals/suppressions.
    const { getSuppressedPhoneSet, getMarketableGrantMap } = await import('./consentService.js');
    const suppressedPhones = await getSuppressedPhoneSet();
    const grantMap = await getMarketableGrantMap();

    const prospects = await selectCampaignProspects(d);
    const rows = buildMemberRows(prospects, { suppressedPhones, grantMap });
    logger.info(
      { selected: prospects.length, eligible: rows.length, campaignId: process.env.GOOGLE_CM_CAMPAIGN_ID },
      'google_cm.sync.start'
    );

    if (rows.length === 0) {
      logger.warn('google_cm.sync.empty (no eligible members)');
      return { synced: true, eligible: 0, batches: 0, requestIds: [] };
    }

    const batches = chunk(rows, MAX_BATCH_MEMBERS);
    const requestIds = [];
    for (let i = 0; i < batches.length; i++) {
      const body = buildIngestBody(batches[i]);
      const res = await d.dmRequest('audienceMembers:ingest', body, d);
      requestIds.push(res?.requestId || null);
      logger.info(
        { batch: i + 1, members: batches[i].length, requestId: res?.requestId },
        'google_cm.sync.batch'
      );
    }

    logger.info({ eligible: rows.length, batches: batches.length, requestIds }, 'google_cm.sync.done');
    return { synced: true, eligible: rows.length, batches: batches.length, requestIds };
  } catch (err) {
    Sentry.captureException(err, { tags: { source: 'google_cm_sync' } });
    logger.error({ err: err.message }, 'google_cm.sync.failed');
    await sendBadRunAlert(
      d,
      '⚠️ MKTR Google Customer Match sync FAILED',
      [
        'The Google Customer Match exclusion sync failed — nothing was uploaded this run.',
        '',
        `Error:     ${err.message}`,
        `List:      ${process.env.GOOGLE_CM_USER_LIST_ID || '(unset)'}`,
        `Campaign:  ${process.env.GOOGLE_CM_CAMPAIGN_ID || '(unset)'}`,
        `Time:      ${new Date().toISOString()}`,
        '',
        'It will retry on the next scheduled run (~24h) or next deploy.',
        'Check Render logs (mktr-backend-jo6r, search "google_cm") + Sentry (source:google_cm_sync).',
      ].join('\n')
    );
    return { synced: false, error: err.message };
  } finally {
    syncInFlight = false;
  }
}
