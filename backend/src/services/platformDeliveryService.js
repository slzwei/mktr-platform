import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';
import { sequelize, Prospect, Campaign, PlatformDelivery } from '../models/index.js';
import { sendConversionEvent as metaSendConversionEvent } from './metaCapiService.js';
import { sendConversionEvent as tiktokSendConversionEvent } from './tiktokEventsService.js';
import { eventNameFor, OUTCOME_EVENTS } from './outcomeEvents.js';
import { canMarketTo as ledgerCanMarketTo } from './consentService.js';
import { setPath as setSourceMetadataPath } from '../utils/prospectJsonPatch.js';
import { withAdvisoryLock } from '../utils/advisoryLock.js';
import { logger } from '../utils/logger.js';

/**
 * platformDeliveryService — the durable Meta/TikTok conversion-delivery outbox
 * (ads-centralisation §3). One table (`platform_deliveries`), one state
 * machine, one worker. Guarantee: AT-LEAST-ONCE with provider event-id dedupe,
 * inside wire-anchored deadlines that keep every retry within the provider's
 * ~48h event-id dedupe window (§1.3).
 *
 * Row-ownership routing (§3.2): per (prospect, platform, eventKey), a row in
 * ANY state means the ledger owns delivery and the legacy direct senders must
 * not fire; no row means legacy-eligible. Ownership is queried across ALL
 * states — never inferred from the pending subset.
 *
 * Controls:
 *  - PLATFORM_DELIVERY_PLANNING_ENABLED — SOLE control over row creation
 *    (origin eligibility decides WHICH rows; provider flags gate sending only).
 *  - PLATFORM_DELIVERY_PAUSED — pauses send work (worker + inline). Expiry
 *    still runs: pausing past the deadlines EXPIRES events (ops brake, not
 *    cold storage — §3.2, stated plainly).
 *
 * State machine: pending → sending → sent | retry_wait | config_blocked |
 * failed_permanent | expired | skipped. Claims are fenced (claimToken) and
 * never touch sendAttempts; the pre-wire reservation CAS is what burns an
 * attempt (§3.3.3–.4). Terminal reasons live in errorCode.
 */

const PLATFORMS = ['meta', 'tiktok'];
const SUBMIT_KEYS = ['lead', 'complete_registration'];
export const OUTCOME_KEYS = Object.keys(OUTCOME_EVENTS); // confirmed_resident, closed_won
const TERMINAL_STATES = ['sent', 'failed_permanent', 'expired', 'skipped'];
const STALE_LEASE_SQL = `interval '10 minutes'`;
const STALE_LEASE_MS = 10 * 60 * 1000;
const CONFIG_BLOCKED_RETRY_MS = 30 * 60 * 1000;
const WIRE_DEDUPE_WINDOW_HOURS = 47; // firstWireAt + 47h ≤ the provider's ~48h event-id window

function numEnv(name, def, min, max) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return def;
  return Math.min(max, Math.max(min, raw));
}

export function planningEnabled() {
  return process.env.PLATFORM_DELIVERY_PLANNING_ENABLED === 'true';
}

export function deliveryPaused() {
  return process.env.PLATFORM_DELIVERY_PAUSED === 'true';
}

const maxAttempts = () => numEnv('PLATFORM_DELIVERY_MAX_ATTEMPTS', 8, 1, 20);
const httpTimeoutMs = () => numEnv('PLATFORM_DELIVERY_HTTP_TIMEOUT_MS', 20000, 1000, 120000);

/**
 * Per-key dedupe-anchor horizon (hours). CReg is anchored on the browser
 * reveal timestamp when the submit carried one (sourceMetadata
 * .registrationEventAt); without it the anchor is capture time with the
 * CONSERVATIVE fallback horizon (legacy cached bundles) — §1.3.
 */
export function keyHorizonHours(eventKey, { hasRegistrationAnchor = false } = {}) {
  if (eventKey === 'lead') return numEnv('PLATFORM_DELIVERY_LEAD_HORIZON_HOURS', 47, 1, 47);
  if (eventKey === 'complete_registration') {
    return hasRegistrationAnchor
      ? numEnv('PLATFORM_DELIVERY_CREG_HORIZON_HOURS', 47, 1, 47)
      : numEnv('PLATFORM_DELIVERY_CREG_FALLBACK_HORIZON_HOURS', 24, 1, 24);
  }
  return numEnv('PLATFORM_DELIVERY_OUTCOME_HORIZON_HOURS', 156, 1, 160);
}

/**
 * Deadline (epoch ms) past which a row must EXPIRE rather than retry:
 * min(dedupeAnchorAt + keyHorizon, firstWireAt + 47h) — §1.3/§3.3.4. Once a
 * wire attempt happened, later retries must stay inside the provider's
 * event-id window measured from OUR first wire, whatever the anchor allows.
 */
export function computeDeadlineMs({ eventKey, dedupeAnchorAt, firstWireAt, hasRegistrationAnchor = false }) {
  const H = 3600 * 1000;
  const anchorDeadline =
    new Date(dedupeAnchorAt).getTime() + keyHorizonHours(eventKey, { hasRegistrationAnchor }) * H;
  const wireDeadline = firstWireAt ? new Date(firstWireAt).getTime() + WIRE_DEDUPE_WINDOW_HOURS * H : Infinity;
  return Math.min(anchorDeadline, wireDeadline);
}

/**
 * Origin eligibility (§3.2/§0): Retell and Meta-Lead-Ads prospects are
 * origin-excluded from the ledger exactly as they are from the legacy senders
 * (shouldFireCapi / shouldFireTikTok origin arm).
 */
export function originEligible(prospect) {
  if (!prospect) return false;
  if (prospect.leadSource === 'call_bot') return false;
  if (prospect.retellCallId) return false;
  if (prospect.sourceMetadata?.metaLeadgenId) return false;
  return true;
}

/** Should capture-time planning run for this prospect? (flag ∧ origin) */
export function submitPlanningApplies({ prospect }) {
  return planningEnabled() && originEligible(prospect);
}

function platformEnvPixelId(platform) {
  return platform === 'meta' ? process.env.META_PIXEL_ID : process.env.TIKTOK_PIXEL_ID;
}

function campaignPixelId(platform, campaign) {
  if (!campaign) return null;
  return (platform === 'meta' ? campaign.metaPixelId : campaign.tiktokPixelId) || null;
}

/** Destination snapshot at planning: campaign pixel → env pixel → NULL (§3.3.1). */
function snapshotPixelId(platform, campaign) {
  return campaignPixelId(platform, campaign) || platformEnvPixelId(platform) || null;
}

/** Is the platform's sender configured (master flag + token)? Sending-only gate. */
export function platformConfigured(platform) {
  if (platform === 'meta') {
    return process.env.META_CAPI_ENABLED === 'true' && Boolean(process.env.META_CAPI_ACCESS_TOKEN);
  }
  return process.env.TIKTOK_EVENTS_API_ENABLED === 'true' && Boolean(process.env.TIKTOK_ACCESS_TOKEN);
}

function eventNameForKey(eventKey) {
  if (eventKey === 'lead') return 'Lead';
  if (eventKey === 'complete_registration') return 'CompleteRegistration';
  return eventNameFor(eventKey);
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * Plan the submit-time delivery rows (§3.3.1) inside the caller's SAVEPOINT
 * (prospectCreateTx wraps this in a nested transaction — a planning failure
 * must never fail capture; the caller then leaves this prospect to the legacy
 * direct senders).
 *
 * eventTime/dedupeAnchorAt: lead = now/now; complete_registration = the
 * browser-supplied reveal timestamp (registrationEventAt) for BOTH — absent ⇒
 * capture time (the conservative CReg fallback horizon then applies at
 * deadline time, keyed off the missing sourceMetadata.registrationEventAt).
 */
export async function planSubmitDeliveriesTx(t, { prospect, sourceCampaign, eventId, registrationEventId, registrationEventAt }) {
  if (!submitPlanningApplies({ prospect })) return { planned: false };
  if (!eventId) {
    // Intake server-generates a UUID when the client omitted one (§3.3.1), so
    // this is a wiring bug, not a data condition — fail the savepoint loudly.
    throw new Error('planSubmitDeliveriesTx: eventId is required');
  }
  const now = new Date();
  const regAnchorMs = registrationEventAt ? Date.parse(registrationEventAt) : NaN;
  const regAnchor = Number.isNaN(regAnchorMs) ? null : new Date(Math.min(regAnchorMs, now.getTime()));
  const rows = [];
  for (const platform of PLATFORMS) {
    rows.push({
      prospectId: prospect.id,
      platform,
      eventKey: 'lead',
      eventId,
      eventTime: now,
      dedupeAnchorAt: now,
      pixelId: snapshotPixelId(platform, sourceCampaign),
      state: 'pending',
    });
    if (registrationEventId) {
      rows.push({
        prospectId: prospect.id,
        platform,
        eventKey: 'complete_registration',
        eventId: registrationEventId,
        eventTime: regAnchor || now,
        dedupeAnchorAt: regAnchor || now,
        pixelId: snapshotPixelId(platform, sourceCampaign),
        state: 'pending',
      });
    }
  }
  await PlatformDelivery.bulkCreate(rows, { transaction: t });
  return { planned: true, rows: rows.length };
}

/**
 * Plan Meta outcome delivery rows (§3.3.2) — the ONE shared in-txn helper for
 * all three outcome entry points (admin edit txn, processLeadOutcome's managed
 * txn, the invariant sweep). Takes NO timestamp: it re-reads the prospect
 * inside the caller's transaction and uses each key's PERSISTED winning fact
 * as eventTime/dedupeAnchorAt — an admin `won` replay can never stamp a later
 * time onto an older confirmed_resident fact. Aborts on erased / absent fact;
 * skips keys whose exact legacy marker exists (old-binary sends are not
 * re-planned). Idempotent (ON CONFLICT DO NOTHING). TikTok outcome rows never
 * exist (§3).
 */
export async function planOutcomeDeliveriesTx(t, { prospectId, keys, campaign }) {
  if (!planningEnabled()) return { planned: false, reason: 'flag_off' };
  const validKeys = (keys || []).filter((k) => OUTCOME_KEYS.includes(k));
  if (!validKeys.length) return { planned: false, reason: 'no_keys' };
  const prospect = await Prospect.findByPk(prospectId, { transaction: t, raw: true });
  if (!prospect) return { planned: false, reason: 'no_prospect' };
  if (prospect.sourceMetadata?.erased === true) return { planned: false, reason: 'erased' };
  if (!originEligible(prospect)) return { planned: false, reason: 'origin_excluded' };

  let resolvedCampaign = campaign;
  if (resolvedCampaign === undefined && prospect.campaignId) {
    resolvedCampaign = await Campaign.findByPk(prospect.campaignId, { transaction: t, raw: true });
  }

  const facts = prospect.sourceMetadata?.outcomes || {};
  const markers = prospect.sourceMetadata?.capi || {};
  let inserted = 0;
  for (const key of validKeys) {
    const factMs = facts[key] ? Date.parse(facts[key]) : NaN;
    if (Number.isNaN(factMs)) continue; // absent/unparseable persisted fact ⇒ plan nothing for this key
    if (markers[OUTCOME_EVENTS[key].markerKey]) continue; // exact legacy marker ⇒ already delivered pre-ledger
    // Raw INSERT names "createdAt"/"updatedAt" explicitly (house rule — the
    // baseline declares them NOT NULL with no database default).
    const [, meta] = await sequelize.query(
      `INSERT INTO platform_deliveries
         (id, "prospectId", platform, "eventKey", "eventId", "eventTime", "dedupeAnchorAt", "pixelId",
          state, "sendAttempts", "createdAt", "updatedAt")
       VALUES
         (gen_random_uuid(), :prospectId, 'meta', :eventKey, :eventId, :eventTime, :eventTime, :pixelId,
          'pending', 0, now(), now())
       ON CONFLICT ("prospectId", platform, "eventKey") DO NOTHING`,
      {
        replacements: {
          prospectId,
          eventKey: key,
          eventId: `${key}:${prospectId}`,
          eventTime: new Date(factMs),
          pixelId: snapshotPixelId('meta', resolvedCampaign),
        },
        transaction: t,
      }
    );
    // Sequelize returns the affected count for INSERT as a bare number
    // (UPDATE/DELETE metadata carries .rowCount instead).
    inserted += typeof meta === 'number' ? meta : (meta?.rowCount ?? 0);
  }
  return { planned: true, inserted };
}

// ---------------------------------------------------------------------------
// Claim + settle primitives
// ---------------------------------------------------------------------------

/**
 * Fenced claim (§3.3.3): due pending/retry_wait/config_blocked rows, or a
 * STALE sending lease. Never touches sendAttempts. Returns { row, token } or
 * null on a claim miss.
 */
async function claimDelivery(id) {
  const token = randomUUID();
  const [rows] = await sequelize.query(
    `UPDATE platform_deliveries
        SET state = 'sending', "claimedAt" = now(), "claimToken" = :token, "updatedAt" = now()
      WHERE id = :id AND (
        (state IN ('pending','retry_wait','config_blocked') AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now()))
        OR (state = 'sending' AND "claimedAt" < now() - ${STALE_LEASE_SQL})
      )
      RETURNING *`,
    { replacements: { id, token } }
  );
  return rows?.[0] ? { row: rows[0], token } : null;
}

/**
 * CAS transition out of `sending`, fenced on the claim token. Returns whether
 * the transition applied (false = a reclaimer owns the row now; the caller's
 * result is discarded — the reclaimer's own attempt governs).
 */
async function settleFromSending(id, token, fields, { transaction } = {}) {
  const cols = {
    nextAttemptAt: '"nextAttemptAt"',
    sentAt: '"sentAt"',
    lastStatus: '"lastStatus"',
    errorCode: '"errorCode"',
    providerRequestId: '"providerRequestId"',
  };
  const sets = ['state = :state', '"updatedAt" = now()'];
  const replacements = { id, token, state: fields.state };
  for (const [key, col] of Object.entries(cols)) {
    if (key in fields) {
      sets.push(`${col} = :${key}`);
      replacements[key] = fields[key];
    }
  }
  const [, meta] = await sequelize.query(
    `UPDATE platform_deliveries SET ${sets.join(', ')}
      WHERE id = :id AND state = 'sending' AND "claimToken" = :token`,
    { replacements, transaction }
  );
  return (meta?.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Send-result classification (§3.3.4.7 taxonomy)
// ---------------------------------------------------------------------------

const META_AUTH_CODES = new Set([190, 102, 104]);
// TikTok auth-class: HTTP 401/403, or the 401xx access-token body codes the
// Business API returns (sometimes on HTTP 200).
const TIKTOK_AUTH_CODES = new Set([40100, 40101, 40102, 40103, 40104, 40105]);

/**
 * Normalize a sender result ({ sent, status?, body?, error?, reason? }) into
 * a settle decision. Pure — unit-tested as the settle taxonomy.
 */
export function classifySendResult(platform, result, { retryAfterMs = null } = {}) {
  if (result?.sent) {
    return {
      kind: 'sent',
      status: result.status ?? null,
      providerRequestId:
        (platform === 'meta' ? result.body?.fbtrace_id : result.body?.request_id) || null,
    };
  }
  // Sender-internal guards (defensive — config is checked before the wire).
  if (result?.reason === 'guarded' || result?.reason === 'no_pixel_id') {
    return { kind: 'config_blocked', errorCode: result.reason };
  }
  // Network / timeout (AbortError lands here via the sender's catch).
  if (result?.error != null) {
    return { kind: 'retry_wait', errorCode: 'network', retryAfterMs };
  }
  const status = typeof result?.status === 'number' ? result.status : null;
  if (status !== null) {
    if (status >= 500 || status === 408 || status === 429) {
      return {
        kind: 'retry_wait',
        errorCode: status >= 500 ? 'http_5xx' : `http_${status}`,
        retryAfterMs,
        status,
      };
    }
    if (platform === 'tiktok' && (status === 401 || status === 403 || TIKTOK_AUTH_CODES.has(result?.body?.code))) {
      return { kind: 'retry_wait', errorCode: 'auth', authClass: true, status };
    }
    if (platform === 'meta' && status >= 400 && META_AUTH_CODES.has(result?.body?.error?.code)) {
      return { kind: 'retry_wait', errorCode: 'auth', authClass: true, status };
    }
    if (status >= 400) {
      return { kind: 'failed_permanent', errorCode: 'http_4xx', status };
    }
    // 2xx with sent=false: TikTok logical failure (body.code !== 0).
    return { kind: 'failed_permanent', errorCode: 'logical_reject', status };
  }
  return { kind: 'failed_permanent', errorCode: 'unknown' };
}

/**
 * Retry backoff (ms): min(60s·2^(sendAttempts−1), 1h) + jitter ≤30s;
 * auth-class uses the long ladder 30min·2^(n−1) capped at 4h (no jitter);
 * a provider Retry-After extends (never shortens) the wait. Pure.
 */
export function computeBackoffMs(sendAttempts, { authClass = false, retryAfterMs = null, jitterRatio } = {}) {
  const n = Math.max(1, sendAttempts);
  let ms;
  if (authClass) {
    ms = Math.min(30 * 60_000 * 2 ** (n - 1), 4 * 3600_000);
  } else {
    const jitter = Math.floor((jitterRatio ?? Math.random()) * 30_000);
    ms = Math.min(60_000 * 2 ** (n - 1), 3600_000) + jitter;
  }
  if (retryAfterMs != null && Number.isFinite(retryAfterMs)) ms = Math.max(ms, retryAfterMs);
  return ms;
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into ms. */
export function parseRetryAfterMs(value, now = Date.now()) {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, Math.floor(secs * 1000));
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * Injected-fetch adapter (§3.3.6): enforces PLATFORM_DELIVERY_HTTP_TIMEOUT_MS
 * via AbortController (20s default — well under the 10-min claim lease) and
 * captures Retry-After out-of-band for the settle classification.
 */
function makeDeliveryFetch(capture) {
  const timeoutMs = httpTimeoutMs();
  return async (url, opts = {}) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ac.signal });
      capture.retryAfterMs = parseRetryAfterMs(res.headers?.get?.('retry-after'));
      return res;
    } finally {
      clearTimeout(timer);
    }
  };
}

// ---------------------------------------------------------------------------
// The per-row attempt pipeline (§3.3.4)
// ---------------------------------------------------------------------------

const defaultSendDeps = {
  canMarketTo: ledgerCanMarketTo,
  metaSend: metaSendConversionEvent,
  tiktokSend: tiktokSendConversionEvent,
  setSourceMetadataPath,
  fetch: null, // null ⇒ per-attempt instrumented fetch
  jitterRatio: undefined,
};

/**
 * Attempt ONE delivery end-to-end: fenced claim → rescreen → deadline →
 * config → consent → final erased check → pre-wire reservation → send →
 * settle. Returns { outcome, ... } where outcome ∈ 'sent' | 'retry_wait' |
 * 'config_blocked' | 'failed_permanent' | 'expired' | 'skipped' |
 * 'claim_miss' | 'paused'.
 *
 * marketingConsent: pass a snapshot for inline batches (one canMarketTo per
 * batch — §3.3.4.4); omit for worker retries (fresh per-row read).
 */
export async function processDelivery(id, { marketingConsent, deps = {} } = {}) {
  const d = { ...defaultSendDeps, ...deps };
  if (deliveryPaused()) return { outcome: 'paused' };

  const claimed = await claimDelivery(id);
  if (!claimed) {
    const current = await PlatformDelivery.findByPk(id, { raw: true });
    return { outcome: 'claim_miss', state: current?.state || null };
  }
  const { row, token } = claimed;
  const isOutcomeKey = OUTCOME_KEYS.includes(row.eventKey);

  // 1. Rescreen: reload prospect (+ campaign only when the destination is unpinned).
  const prospect = await Prospect.findByPk(row.prospectId, { raw: true });
  if (!prospect) {
    await settleFromSending(row.id, token, { state: 'skipped', errorCode: 'no_prospect' });
    return { outcome: 'skipped', errorCode: 'no_prospect' };
  }
  if (prospect.sourceMetadata?.erased === true) {
    await settleFromSending(row.id, token, { state: 'skipped', errorCode: 'erased' });
    return { outcome: 'skipped', errorCode: 'erased' };
  }
  let campaign = null;
  if (!row.pixelId && prospect.campaignId) {
    campaign = await Campaign.findByPk(prospect.campaignId, { raw: true });
  }

  // 2. Deadline (anchor + wire window). A past-deadline claimed row expires
  //    under OUR OWN lease — the §3.3.7 rule protects other holders' leases.
  const hasRegistrationAnchor = Boolean(prospect.sourceMetadata?.registrationEventAt);
  const deadlineMs = computeDeadlineMs({
    eventKey: row.eventKey,
    dedupeAnchorAt: row.dedupeAnchorAt,
    firstWireAt: row.firstWireAt,
    hasRegistrationAnchor,
  });
  if (Date.now() > deadlineMs) {
    await settleFromSending(row.id, token, { state: 'expired', errorCode: 'deadline' });
    return { outcome: 'expired' };
  }

  // 3. Config check — NO attempt fields touched. Only the deadline ends a
  //    config-blocked row.
  const resolvedNow = row.pixelId || campaignPixelId(row.platform, campaign) || platformEnvPixelId(row.platform) || null;
  if (!platformConfigured(row.platform) || !resolvedNow) {
    await settleFromSending(row.id, token, {
      state: 'config_blocked',
      nextAttemptAt: new Date(Date.now() + CONFIG_BLOCKED_RETRY_MS),
      errorCode: !platformConfigured(row.platform) ? 'platform_off' : 'no_destination',
    });
    return { outcome: 'config_blocked' };
  }

  // 4. Consent — snapshot for inline batches, per-row on worker retries;
  //    fail-closed to no-PII.
  let consent = marketingConsent;
  if (consent === undefined) {
    consent = false;
    try {
      consent = (await d.canMarketTo({
        consumerId: prospect.consumerId || null,
        phone: prospect.phone || null,
        channel: 'all',
        campaignId: prospect.campaignId || null,
      })) === true;
    } catch (err) {
      logger.warn({ id: row.id, error: err?.message || String(err) }, 'platform_delivery.consent_check_failed');
    }
  }

  // 5. Final fresh erased SELECT, then the pre-wire reservation CAS — the
  //    guarantee is "no NEW send begins after this check observes erasure";
  //    an in-flight request can't be recalled (the Google posture,
  //    googleOfflineConversionsService.js:335).
  const [freshRows] = await sequelize.query(
    `SELECT COALESCE("sourceMetadata"::jsonb->>'erased','false') AS erased FROM prospects WHERE id = :id`,
    { replacements: { id: row.prospectId } }
  );
  if (!freshRows?.[0] || freshRows[0].erased === 'true') {
    await settleFromSending(row.id, token, { state: 'skipped', errorCode: 'erased' });
    return { outcome: 'skipped', errorCode: 'erased' };
  }

  const [reserved] = await sequelize.query(
    `UPDATE platform_deliveries
        SET "pixelId" = COALESCE("pixelId", :resolvedNow),
            "sendAttempts" = "sendAttempts" + 1,
            "firstWireAt" = COALESCE("firstWireAt", now()),
            "lastAttemptAt" = now(),
            "updatedAt" = now()
      WHERE id = :id AND state = 'sending' AND "claimToken" = :token AND "sendAttempts" < :max
      RETURNING "pixelId", "sendAttempts"`,
    { replacements: { id: row.id, token, resolvedNow, max: maxAttempts() } }
  );
  if (!reserved?.[0]) {
    // Reservation miss: cap reached (§3.3.4.5) — or the claim was lost, in
    // which case this CAS misses too and the reclaimer owns the row.
    const capped = await settleFromSending(row.id, token, { state: 'failed_permanent', errorCode: 'retry_cap' });
    return capped ? { outcome: 'failed_permanent', errorCode: 'retry_cap' } : { outcome: 'claim_miss' };
  }
  const pixelId = reserved[0].pixelId;
  const sendAttempts = Number(reserved[0].sendAttempts);

  // 6. Send via the existing senders — payload rebuilt from the row (§1.1);
  //    epoch-seconds eventTime; pinned pixel override; injected fetch.
  const capture = { retryAfterMs: null };
  const fetchImpl = d.fetch || makeDeliveryFetch(capture);
  const ctx = {
    eventId: row.eventId,
    eventTime: Math.floor(new Date(row.eventTime).getTime() / 1000),
    marketingConsent: consent,
    pixelIdOverride: pixelId,
  };
  const send = row.platform === 'meta' ? d.metaSend : d.tiktokSend;
  let result;
  try {
    result = await send(prospect, ctx, { eventName: eventNameForKey(row.eventKey) }, { fetch: fetchImpl });
  } catch (err) {
    // The senders never throw by contract; belt-and-braces for injected seams.
    result = { sent: false, error: err?.message || String(err) };
  }

  // 7. Settle (CAS on claimToken).
  const cls = classifySendResult(row.platform, result, { retryAfterMs: capture.retryAfterMs });
  if (cls.kind === 'sent') {
    const fields = {
      state: 'sent',
      sentAt: new Date(),
      lastStatus: cls.status,
      errorCode: null,
      providerRequestId: cls.providerRequestId,
    };
    if (isOutcomeKey) {
      // The legacy capi.{markerKey} write shares the settle's DB transaction
      // (§3.3.4.7) — marker and sent-state commit or roll back together.
      const markerKey = OUTCOME_EVENTS[row.eventKey].markerKey;
      await sequelize.transaction(async (tx) => {
        const applied = await settleFromSending(row.id, token, fields, { transaction: tx });
        if (applied) {
          await d.setSourceMetadataPath(row.prospectId, ['capi', markerKey], new Date().toISOString(), {
            transaction: tx,
          });
        }
      });
    } else {
      await settleFromSending(row.id, token, fields);
    }
    logger.info(
      { id: row.id, platform: row.platform, eventKey: row.eventKey, attempts: sendAttempts },
      'platform_delivery.sent'
    );
    return { outcome: 'sent' };
  }
  if (cls.kind === 'retry_wait') {
    if (cls.authClass && row.errorCode !== 'auth') {
      // Sentry once per row on entering the auth-failure ladder.
      Sentry.captureException(new Error(`platform delivery auth failure (${row.platform})`), {
        tags: { source: 'platform_delivery', platform: row.platform },
        extra: { delivery_id: row.id, status: cls.status },
      });
    }
    await settleFromSending(row.id, token, {
      state: 'retry_wait',
      nextAttemptAt: new Date(
        Date.now() + computeBackoffMs(sendAttempts, { authClass: cls.authClass === true, retryAfterMs: cls.retryAfterMs, jitterRatio: d.jitterRatio })
      ),
      lastStatus: cls.status ?? null,
      errorCode: cls.errorCode,
    });
    return { outcome: 'retry_wait', errorCode: cls.errorCode };
  }
  if (cls.kind === 'config_blocked') {
    await settleFromSending(row.id, token, {
      state: 'config_blocked',
      nextAttemptAt: new Date(Date.now() + CONFIG_BLOCKED_RETRY_MS),
      errorCode: cls.errorCode,
    });
    return { outcome: 'config_blocked', errorCode: cls.errorCode };
  }
  await settleFromSending(row.id, token, {
    state: 'failed_permanent',
    lastStatus: cls.status ?? null,
    errorCode: cls.errorCode,
  });
  logger.warn(
    { id: row.id, platform: row.platform, eventKey: row.eventKey, errorCode: cls.errorCode, status: cls.status },
    'platform_delivery.failed_permanent'
  );
  return { outcome: 'failed_permanent', errorCode: cls.errorCode };
}

// ---------------------------------------------------------------------------
// Dispatch integration (§3.3.5)
// ---------------------------------------------------------------------------

function isDueNow(row, now = new Date()) {
  if (row.state === 'pending') return true;
  if (row.state === 'retry_wait' || row.state === 'config_blocked') {
    return !row.nextAttemptAt || new Date(row.nextAttemptAt) <= now;
  }
  return false;
}

/**
 * Submit-time dispatch (replaces prospectDispatch's four direct sends at the
 * same statement position; invoked FIRE-AND-FORGET — zero new awaited work on
 * the capture path):
 *  (a) ownership query across ALL states for the four intended pairs (skipped
 *      when plannedOk=false: planning is the sole row creator and it just ran
 *      for this brand-new prospect, so rows cannot exist — §3.4's planning-off
 *      zero-new-queries budget);
 *  (b) claimable-due rows attempted in deterministic order (meta lead → meta
 *      creg → tiktok lead → tiktok creg), ONE consent snapshot, sends
 *      floating; other-state rows are left to the worker;
 *  (c) pairs WITHOUT rows: the caller-supplied legacy closures fire — exactly
 *      today's direct sends.
 */
export async function dispatchSubmitDeliveries({ prospect, plannedOk, marketingConsent, legacy = {}, deps = {} }) {
  const pairs = [
    ['meta', 'lead', legacy.metaLead],
    ['meta', 'complete_registration', legacy.metaCompleteRegistration],
    ['tiktok', 'lead', legacy.tiktokLead],
    ['tiktok', 'complete_registration', legacy.tiktokCompleteRegistration],
  ];
  let owned = new Set();
  if (plannedOk) {
    const rows = await PlatformDelivery.findAll({
      where: { prospectId: prospect.id, eventKey: SUBMIT_KEYS },
      raw: true,
    });
    owned = new Set(rows.map((r) => `${r.platform}:${r.eventKey}`));
    if (!deliveryPaused()) {
      const byPair = new Map(rows.map((r) => [`${r.platform}:${r.eventKey}`, r]));
      for (const [platform, key] of pairs) {
        const row = byPair.get(`${platform}:${key}`);
        if (!row || !isDueNow(row)) continue;
        processDelivery(row.id, { marketingConsent, deps }).catch((err) => {
          logger.warn({ id: row.id, error: err?.message || String(err) }, 'platform_delivery.inline_dispatch_failed');
        });
      }
    }
  }
  for (const [platform, key, fireLegacy] of pairs) {
    if (owned.has(`${platform}:${key}`)) continue;
    if (typeof fireLegacy === 'function') fireLegacy();
  }
  return { owned: [...owned] };
}

/** §3.3.5 outcome return-contract mapping (complete). */
export function mapDeliveryOutcomeToLegacy(res) {
  switch (res?.outcome) {
    case 'sent':
      return 'dispatched';
    case 'config_blocked':
      return 'guarded';
    case 'retry_wait':
    case 'paused':
    case 'claim_miss':
      return 'transientFailed';
    case 'failed_permanent':
    case 'expired':
    case 'skipped':
      return 'permanentFailed';
    default:
      return 'transientFailed';
  }
}

/**
 * Inline ledger dispatch for ONE outcome key (called from processLeadOutcome
 * after planning). Returns { owned:false } when no row exists (legacy path),
 * else { owned:true, legacyOutcome } per the §3.3.5 mapping:
 * pre-existing sent → duplicate · config_blocked → guarded · retry_wait /
 * paused / held sending / claim-miss → transientFailed · terminal failures →
 * permanentFailed.
 */
export async function dispatchOutcomeDelivery({ prospectId, key, marketingConsent, deps = {} }) {
  const row = await PlatformDelivery.findOne({
    where: { prospectId, platform: 'meta', eventKey: key },
    raw: true,
  });
  if (!row) return { owned: false };
  if (row.state === 'sent') return { owned: true, legacyOutcome: 'duplicate' };
  if (TERMINAL_STATES.includes(row.state)) return { owned: true, legacyOutcome: 'permanentFailed' };
  if (deliveryPaused()) return { owned: true, legacyOutcome: 'transientFailed' };
  if (row.state === 'sending') {
    const stale = row.claimedAt && new Date(row.claimedAt).getTime() < Date.now() - STALE_LEASE_MS;
    if (!stale) return { owned: true, legacyOutcome: 'transientFailed' }; // held by an active lease
  } else if (!isDueNow(row)) {
    return { owned: true, legacyOutcome: row.state === 'config_blocked' ? 'guarded' : 'transientFailed' };
  }
  const res = await processDelivery(row.id, { marketingConsent, deps });
  return { owned: true, legacyOutcome: mapDeliveryOutcomeToLegacy(res) };
}

// ---------------------------------------------------------------------------
// Worker + expiry + invariant sweep + retention (§3.3.7, §3.5, §3.6)
// ---------------------------------------------------------------------------

let lastInvariantSweepAt = 0;
let lastRetentionPurgeAt = 0;

/** Test hook: reset the sub-cadence clocks. */
export function _resetWorkerCadence() {
  lastInvariantSweepAt = 0;
  lastRetentionPurgeAt = 0;
}

/**
 * One worker tick under advisory lock 'pd:worker' (§7.6). Scheduled whenever
 * the ledger exists — NOT provider-flag-gated: with providers off, attempts
 * classify config_blocked and the expiry pass still runs. Honours
 * PLATFORM_DELIVERY_PAUSED for send work only. The §3.5 invariant sweep and
 * §3.6 retention purge ride the tick on hourly/daily sub-cadences.
 */
export async function runDeliveryWorker({ deps = {}, forceInvariantSweep = false, forceRetentionPurge = false } = {}) {
  return withAdvisoryLock('pd:worker', async () => {
    const summary = { attempted: 0, outcomes: {}, expired: 0, invariantPlanned: null, purged: null };

    if (!deliveryPaused()) {
      const [due] = await sequelize.query(
        `SELECT id FROM platform_deliveries
          WHERE (state = 'pending' AND "createdAt" < now() - interval '2 minutes')
             OR (state IN ('retry_wait','config_blocked') AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now()))
             OR (state = 'sending' AND "claimedAt" < now() - ${STALE_LEASE_SQL})
          ORDER BY COALESCE("nextAttemptAt", "createdAt") ASC
          LIMIT 200`
      );
      const queue = [...(due || [])];
      const lanes = Array.from({ length: Math.min(5, queue.length) }, async () => {
        for (;;) {
          const next = queue.shift();
          if (!next) return;
          try {
            const res = await processDelivery(next.id, { deps });
            summary.attempted += 1;
            summary.outcomes[res.outcome] = (summary.outcomes[res.outcome] || 0) + 1;
          } catch (err) {
            logger.error({ id: next.id, error: err?.message || String(err) }, 'platform_delivery.worker_attempt_failed');
          }
        }
      });
      await Promise.all(lanes);
    }

    summary.expired = await runExpiryPass();

    if (forceInvariantSweep || Date.now() - lastInvariantSweepAt > 3600_000) {
      lastInvariantSweepAt = Date.now();
      summary.invariantPlanned = await runOutcomeInvariantSweep();
    }
    if (forceRetentionPurge || Date.now() - lastRetentionPurgeAt > 24 * 3600_000) {
      lastRetentionPurgeAt = Date.now();
      summary.purged = await runRetentionPurge();
    }
    if (summary.attempted || summary.expired || summary.invariantPlanned || summary.purged) {
      logger.info(summary, 'platform_delivery.worker_tick');
    }
    return summary;
  });
}

/**
 * Expiry pass (§3.3.7): transitions ONLY pending/retry_wait/config_blocked
 * past-deadline, plus `sending` when the lease is STALE — never an active
 * lease (an in-flight settle wins; the CAS re-checks staleness at write
 * time). Runs even when paused (pausing past deadlines expires events).
 */
export async function runExpiryPass() {
  // Cheap SQL pre-filter on the smallest configured horizon; the exact
  // per-key deadline (incl. the CReg anchor-vs-fallback split, which needs
  // the prospect's registrationEventAt) is computed in JS per candidate.
  const minHorizonHours = Math.min(
    keyHorizonHours('lead'),
    keyHorizonHours('complete_registration', { hasRegistrationAnchor: true }),
    keyHorizonHours('complete_registration', { hasRegistrationAnchor: false }),
    keyHorizonHours('confirmed_resident')
  );
  const [candidates] = await sequelize.query(
    `SELECT pd.id, pd."eventKey", pd."dedupeAnchorAt", pd."firstWireAt",
            ((p."sourceMetadata"::jsonb ->> 'registrationEventAt') IS NOT NULL) AS "hasRegAnchor"
       FROM platform_deliveries pd
       LEFT JOIN prospects p ON p.id = pd."prospectId"
      WHERE (pd.state IN ('pending','retry_wait','config_blocked')
             OR (pd.state = 'sending' AND pd."claimedAt" < now() - ${STALE_LEASE_SQL}))
        AND (pd."dedupeAnchorAt" < now() - make_interval(hours => :minHorizonHours)
             OR (pd."firstWireAt" IS NOT NULL AND pd."firstWireAt" < now() - interval '${WIRE_DEDUPE_WINDOW_HOURS} hours'))
      LIMIT 500`,
    { replacements: { minHorizonHours } }
  );
  let expired = 0;
  for (const c of candidates || []) {
    const deadlineMs = computeDeadlineMs({
      eventKey: c.eventKey,
      dedupeAnchorAt: c.dedupeAnchorAt,
      firstWireAt: c.firstWireAt,
      hasRegistrationAnchor: c.hasRegAnchor === true,
    });
    if (Date.now() <= deadlineMs) continue;
    const [, meta] = await sequelize.query(
      `UPDATE platform_deliveries
          SET state = 'expired', "errorCode" = 'deadline', "updatedAt" = now()
        WHERE id = :id
          AND (state IN ('pending','retry_wait','config_blocked')
               OR (state = 'sending' AND "claimedAt" < now() - ${STALE_LEASE_SQL}))`,
      { replacements: { id: c.id } }
    );
    expired += meta?.rowCount ?? 0;
  }
  return expired;
}

/**
 * Invariant sweep (§3.5, hourly on the tick): outcome facts younger than the
 * outcome horizon with NO row AND NO exact per-key marker get planned. This
 * is what heals an admin/webhook planning savepoint failure; the fully-failed
 * facts+planning transaction (no fact, no row) is healed upstream by the
 * credentials-based Lyfe reconciler re-writing the fact.
 */
export async function runOutcomeInvariantSweep() {
  if (!planningEnabled()) return 0;
  const horizonMs = keyHorizonHours('confirmed_resident') * 3600_000;
  let planned = 0;
  for (const key of OUTCOME_KEYS) {
    const markerKey = OUTCOME_EVENTS[key].markerKey;
    // key/markerKey are code-owned constants (safe to interpolate).
    const [rows] = await sequelize.query(
      `SELECT p.id, p."sourceMetadata"::jsonb #>> '{outcomes,${key}}' AS fact
         FROM prospects p
        WHERE p."sourceMetadata"::jsonb #>> '{outcomes,${key}}' IS NOT NULL
          AND p."sourceMetadata"::jsonb #>> '{capi,${markerKey}}' IS NULL
          AND COALESCE(p."sourceMetadata"::jsonb ->> 'erased', 'false') <> 'true'
          AND NOT EXISTS (SELECT 1 FROM platform_deliveries pd
                           WHERE pd."prospectId" = p.id AND pd.platform = 'meta' AND pd."eventKey" = '${key}')
        LIMIT 200`
    );
    for (const r of rows || []) {
      const factMs = Date.parse(r.fact);
      if (Number.isNaN(factMs) || Date.now() - factMs > horizonMs) continue;
      try {
        await sequelize.transaction(async (t) => {
          const res = await planOutcomeDeliveriesTx(t, { prospectId: r.id, keys: [key] });
          planned += res.inserted || 0;
        });
      } catch (err) {
        logger.warn({ prospectId: r.id, key, error: err?.message || String(err) }, 'platform_delivery.invariant_plan_failed');
      }
    }
  }
  return planned;
}

/** Retention purge (§3.6, daily on the tick): terminal rows older than PLATFORM_DELIVERY_RETENTION_DAYS, bounded batches. */
export async function runRetentionPurge() {
  const days = numEnv('PLATFORM_DELIVERY_RETENTION_DAYS', 90, 7, 365);
  let total = 0;
  for (let i = 0; i < 20; i++) {
    const [, meta] = await sequelize.query(
      `DELETE FROM platform_deliveries WHERE id IN (
         SELECT id FROM platform_deliveries
          WHERE state IN ('sent','failed_permanent','expired','skipped')
            AND "updatedAt" < now() - make_interval(days => :days)
          LIMIT 1000)`,
      { replacements: { days } }
    );
    const n = meta?.rowCount ?? 0;
    total += n;
    if (n < 1000) break;
  }
  return total;
}
