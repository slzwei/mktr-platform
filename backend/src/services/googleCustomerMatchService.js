import * as Sentry from '@sentry/node';
import { Prospect, sequelize } from '../models/index.js';
import { hashEmailGoogle, hashPhoneE164 } from '../utils/piiHashing.js';
import { dmRequest, dmRequestGet } from '../utils/googleDataManagerClient.js';
import { logger } from '../utils/logger.js';
import { sendEmail } from './mailer.js';
import { withAdvisoryLock } from '../utils/advisoryLock.js';
import {
  AUDIENCE_POLICIES,
  loadEligibilityContext,
  selectAudiencePopulation,
  filterEligible,
} from './audienceEligibilityService.js';
import { markIngestAccepted, markIngestsSettled, hasUnsettledIngests } from './audienceRemovalService.js';

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
 *  - Ingestion is ASYNCHRONOUS: HTTP accept returns a requestId whose
 *    processing settles later. Every accepted id is polled through
 *    requestStatus:retrieve to a terminal state (bounded backoff); stuck or
 *    FAILED requests alert. Accounting stays aggregate-only — membership is
 *    not tracked per-row locally and the next additive run self-heals.
 *
 * REMOVAL surface (plan §3 removal path): removeAudienceMembers /
 * removeByConsumerId serve the erasure post-commit hook and the
 * applyUnsubscribe post-commit hook (both call in via dynamic import,
 * fire-and-forget). Removal is gated only on removalConfigured() — NOT the
 * sync ENABLED flag: once anything was ever uploaded, honoring erasure/
 * withdrawal must not depend on the sync still being switched on. The list's
 * finite membership duration (Ads UI setting, 180d) is the backstop for
 * anything these hooks miss.
 */

const MAX_BATCH_MEMBERS = 10_000; // Data Manager cap: 10k audience members/request (≤10 identifiers each)
const SYNTHETIC_EMAIL_SUFFIX = '@calls.mktr.sg';
const TERMINAL_STATUSES = new Set(['SUCCESS', 'PARTIAL_SUCCESS', 'FAILED']);

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const defaultDeps = {
  Prospect,
  fetch: globalThis.fetch,
  sendEmail,
  dmRequest,
  dmRequestGet,
  sleep: realSleep,
  now: Date.now,
  // Injectable seams for the §5.1 machinery (unit tests stub these; the
  // DB-backed suites exercise the real table + lock).
  withDestinationLock: withAdvisoryLock,
  markIngestAccepted,
  markIngestsSettled,
  hasUnsettledIngests,
  loadEligibilityContext,
};

/**
 * Guard for the SYNC: no-op cleanly when the master switch is off or config
 * is missing — a misconfigured scheduler exits instead of erroring. Mirrors
 * redeemedAudienceService.shouldSync.
 */
export function shouldSync() {
  if (process.env.GOOGLE_CM_SYNC_ENABLED !== 'true') return false;
  if (!removalConfigured()) return false;
  if (!process.env.GOOGLE_CM_CAMPAIGN_ID) return false;
  return true;
}

/**
 * Guard for the REMOVAL surface: creds + destination only. Deliberately
 * ignores GOOGLE_CM_SYNC_ENABLED — erasure/withdrawal removal must keep
 * working after the sync is switched off.
 */
export function removalConfigured() {
  if (!process.env.GOOGLE_DM_OAUTH_CLIENT_ID) return false;
  if (!process.env.GOOGLE_DM_OAUTH_CLIENT_SECRET) return false;
  if (!process.env.GOOGLE_DM_REFRESH_TOKEN) return false;
  if (!process.env.GOOGLE_ADS_CUSTOMER_ID) return false;
  if (!process.env.GOOGLE_CM_USER_LIST_ID) return false;
  return true;
}

/** Split an array into chunks of `size`. Exported for testing. */
export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** email/phone → HEX-hash identifier array (shared by ingest + removal). */
function identifiersFor(email, phone) {
  const usableEmail =
    email && !String(email).toLowerCase().endsWith(SYNTHETIC_EMAIL_SUFFIX) ? email : null;
  const emHash = hashEmailGoogle(usableEmail);
  const phHash = hashPhoneE164(phone);
  const userIdentifiers = [];
  if (emHash) userIdentifiers.push({ emailAddress: emHash });
  if (phHash) userIdentifiers.push({ phoneNumber: phHash });
  return userIdentifiers;
}

/**
 * (Filtering lives in the eligibility engine now — ads-centralisation §5.2.
 * The historical fail-closed rules, in engine order:
 *  - erased skeletons out
 *  - unverified / stale-binding phones out (phoneVerificationIsCurrent)
 *  - no ledger contact grant in scope {row campaign, global} → out (no hatch;
 *    grantMap keyed BY PHONE like the Meta service so spine-unlinked rows
 *    still enforce; missing map/phone/entry → excluded)
 *  - suppressed phones out
 *  - synthetic Retell emails dropped from the email key
 *  - neither usable identifier → out
 */
/**
 * Identifier SHAPING for eligibility-engine output (§5.2): the engine owns
 * selection + policy filtering (erased / edit-suppressed / verified-binding /
 * grant / suppression); this owns the Data Manager wire shape.
 */
export function shapeGoogleMemberRows(prospects) {
  const rows = [];
  for (const p of prospects || []) {
    const userIdentifiers = identifiersFor(p?.email, p?.phone);
    if (userIdentifiers.length === 0) continue;
    rows.push({ userIdentifiers });
  }
  return rows;
}

/**
 * RAW {email, phone} pairs → identifier rows for REMOVAL. No consent /
 * verification gates: removing someone from an ad audience is always
 * permitted and erasure-time callers hold pre-scrub values that are about to
 * be destroyed. Synthetic emails still dropped (they never matched anyway).
 * Renamed from `buildRemovalIdentifiers` (ads-centralisation §5.5): the name
 * now says what it consumes — the HASH-accepting entry point for the durable
 * removal outbox is removeHashedIdentifiers below.
 */
export function buildRemovalIdentifiersFromRaw(pairs) {
  const rows = [];
  for (const p of pairs || []) {
    const userIdentifiers = identifiersFor(p?.email, p?.phone);
    if (userIdentifiers.length === 0) continue;
    rows.push({ userIdentifiers });
  }
  return rows;
}

/**
 * HASH-accepting removal transport for the durable outbox (§5.5): ONE
 * request for one person's already-normalized identifier rows. Unlike the
 * legacy removeAudienceMembers it reports a classification instead of
 * queueing an in-memory settle — the OUTBOX row is the durable settle state
 * (the drainer polls requestStatus:retrieve until confirmed).
 *
 * Returns { ok:true, requestId } | { ok:false, transient|authClass|permanent, errorCode }.
 */
export async function removeHashedIdentifiers(identifierRows, deps = {}) {
  const d = { ...defaultDeps, ...deps };
  if (!removalConfigured()) return { ok: false, permanent: true, errorCode: 'unconfigured' };
  const rows = (identifierRows || []).filter((r) => r?.userIdentifiers?.length);
  if (rows.length === 0) return { ok: false, permanent: true, errorCode: 'empty_identifiers' };
  try {
    // ONE wire attempt per outbox reservation (Codex P4 review #10): the DM
    // client's internal 429/5xx retry loop is disabled here — the outbox row's
    // submitAttempts IS the retry accounting, and its backoff ladder governs.
    // (The DM client's own GOOGLE_DM_TIMEOUT_MS bounds the exchange; at 30s
    // default it sits far under the 10-minute claim lease.)
    const res = await d.dmRequest('audienceMembers:remove', buildRemoveBody(rows), { ...d, attempts: 1 });
    if (res?.requestId) return { ok: true, requestId: res.requestId };
    // An accept without a requestId cannot be settled — retry it.
    return { ok: false, transient: true, errorCode: 'missing_request_id' };
  } catch (err) {
    const status = err?.status ?? err?.statusCode;
    if (status === 401 || status === 403) return { ok: false, authClass: true, errorCode: 'auth' };
    if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429) {
      return { ok: false, permanent: true, errorCode: `http_${status}` };
    }
    return { ok: false, transient: true, errorCode: 'network', message: err?.message };
  }
}

function destinations() {
  return [
    {
      operatingAccount: {
        product: 'GOOGLE_ADS',
        accountId: process.env.GOOGLE_ADS_CUSTOMER_ID,
      },
      productDestinationId: process.env.GOOGLE_CM_USER_LIST_ID,
    },
  ];
}

/**
 * The ingest envelope for one batch. Exported for golden-envelope tests —
 * field names are pinned from the plan's round-2/3 doc checks and re-verified
 * by the opt-in validateOnly smoke script before the first live flip.
 */
export function buildIngestBody(members, { validateOnly = false } = {}) {
  return {
    destinations: destinations(),
    audienceMembers: members.map((m) => ({ userData: { userIdentifiers: m.userIdentifiers } })),
    consent: { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' },
    encoding: 'HEX',
    termsOfService: { customerMatchTermsOfServiceStatus: 'ACCEPTED' },
    ...(validateOnly ? { validateOnly: true } : {}),
  };
}

/** The removal envelope. encoding:HEX is required with hashed userData; the
 * Customer Match terms block is an INGEST requirement and is omitted here. */
export function buildRemoveBody(members) {
  return {
    destinations: destinations(),
    audienceMembers: members.map((m) => ({ userData: { userIdentifiers: m.userIdentifiers } })),
    encoding: 'HEX',
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

function extractStatus(body) {
  const raw =
    body?.requestStatusPerDestination?.[0]?.requestStatus ??
    body?.requestStatus ??
    body?.status ??
    null;
  return raw ? String(raw).toUpperCase() : null;
}

/**
 * DEFERRED settlement (Codex P2b round 3): Google's diagnostics guidance is
 * first poll ~30 MINUTES after acceptance, polling up to 24 hours — an
 * in-run settle would classify every normal request as stuck. Accepted
 * requestIds therefore join a module-level pending queue; a lightweight
 * interval (bootstrap, GOOGLE_CM_SETTLE_INTERVAL_MINUTES, default 15) drains
 * due entries with ~1.3× backoff capped at 1h + jitter, out to a 24h horizon.
 *
 * Consequence: sync/removal results report ACCEPTANCE truth in-run
 * (settlement: 'queued'); OUTCOME truth lands asynchronously here — terminal
 * FAILED and horizon-expired entries alert + Sentry. A process restart drops
 * pending ids (accepted loss: accounting is aggregate-only and the nightly
 * additive re-ingest self-heals; removal is backstopped by the membership TTL).
 */
const pendingSettles = []; // { requestId, kind: 'ingest'|'remove', acceptedAt, nextPollAt, delayMs }

// Ingest entries a pass has SPLICED OUT and is currently polling. The
// watermark close must count these as unsettled — the due-splice makes them
// invisible to the queue scan, and an overlapping pass (or the same pass's
// own tail) closing on an "empty" queue while a poll is in flight would
// dispatch removals into an unsettled ingest (Codex P4 review #1).
let inFlightIngestPolls = 0;

/** Test seam — clears the pending-settlement queue. */
export function __resetPendingSettlesForTests() {
  pendingSettles.length = 0;
  inFlightIngestPolls = 0;
}

function firstPollDelayMs() {
  return Math.max(1, Number(process.env.GOOGLE_CM_FIRST_POLL_MINUTES) || 30) * 60_000;
}

const SETTLE_HORIZON_MS = 24 * 60 * 60 * 1000;
const SETTLE_BACKOFF_FACTOR = 1.3;
const SETTLE_MAX_DELAY_MS = 60 * 60 * 1000;

function queueSettles(requestIds, kind, now) {
  for (const id of new Set((requestIds || []).filter(Boolean))) {
    const delayMs = firstPollDelayMs();
    pendingSettles.push({
      requestId: id,
      kind,
      acceptedAt: now,
      nextPollAt: now + delayMs,
      delayMs,
    });
  }
}

/**
 * Drain due pending settlements: one poll each; terminal states are counted
 * and logged; non-terminal entries reschedule with backoff until the 24h
 * horizon (then counted stuck). FAILED/stuck raise the alert email + Sentry.
 * Never throws. Exported for the bootstrap interval and tests.
 */
export async function settlePendingStatuses(deps = {}) {
  const d = { ...defaultDeps, ...deps };
  const now = d.now ? d.now() : Date.now();
  // removePartial tracked separately: a PARTIAL_SUCCESS *removal* left people
  // on the list (alert-worthy); a PARTIAL_SUCCESS ingest self-heals nightly.
  const summary = { polled: 0, succeeded: 0, partialSuccess: 0, removePartial: 0, failed: 0, stuck: 0, pending: 0 };
  // Partition SYNCHRONOUSLY, due entries ONLY: not-yet-due entries stay in
  // the shared queue, so a pass stalled on a hung retrieve (Google outage)
  // can never hide later-due entries from subsequent drainer runs — and
  // because the take happens before any await, an overlapping pass cannot
  // double-poll the same entry.
  const due = [];
  for (let i = pendingSettles.length - 1; i >= 0; i--) {
    if (pendingSettles[i].nextPollAt <= now) due.push(...pendingSettles.splice(i, 1));
  }
  // Spliced-out ingest entries are still UNSETTLED until their poll resolves —
  // count them so the watermark close (here and in any overlapping pass) can
  // never mistake in-flight for empty (Codex P4 review #1).
  const ingestInFlightHere = due.filter((e) => e.kind === 'ingest').length;
  inFlightIngestPolls += ingestInFlightHere;
  let ingestSettledThisPass = 0;
  const keep = [];
  for (const entry of due) {
    summary.polled += 1;
    let status = null;
    let retrieveFailed = false;
    try {
      const body = await d.dmRequestGet(
        `requestStatus:retrieve?requestId=${encodeURIComponent(entry.requestId)}`,
        d
      );
      status = extractStatus(body);
    } catch (err) {
      retrieveFailed = true;
      logger.warn({ requestId: entry.requestId, err: err.message }, 'google_cm.status.retrieve_failed');
    }
    if (status && TERMINAL_STATUSES.has(status)) {
      if (status === 'SUCCESS') summary.succeeded += 1;
      else if (status === 'PARTIAL_SUCCESS') {
        summary.partialSuccess += 1;
        if (entry.kind === 'remove') summary.removePartial += 1;
      } else summary.failed += 1;
      if (entry.kind === 'ingest') {
        inFlightIngestPolls -= 1;
        ingestSettledThisPass += 1;
      }
      logger.info({ requestId: entry.requestId, kind: entry.kind, status }, 'google_cm.status.terminal');
      continue;
    }
    if (now - entry.acceptedAt >= SETTLE_HORIZON_MS) {
      summary.stuck += 1;
      if (entry.kind === 'ingest') {
        // Past Google's own 24h processing window: settled server-side
        // whether we could observe it or not — the entry leaves the queue
        // (already alerted above) and stops counting as unsettled.
        inFlightIngestPolls -= 1;
        ingestSettledThisPass += 1;
      }
      logger.warn({ requestId: entry.requestId, kind: entry.kind, retrieveFailed }, 'google_cm.status.stuck');
      continue;
    }
    const nextDelay = Math.min(Math.round(entry.delayMs * SETTLE_BACKOFF_FACTOR), SETTLE_MAX_DELAY_MS);
    keep.push({
      ...entry,
      delayMs: nextDelay,
      nextPollAt: now + nextDelay + Math.floor(Math.random() * 30_000),
    });
  }
  pendingSettles.push(...keep);
  // Kept (rescheduled) ingest entries are visible in the queue again — they
  // stop counting as in-flight.
  inFlightIngestPolls -= keep.filter((e) => e.kind === 'ingest').length;
  summary.pending = pendingSettles.length;

  // Settlement watermark (ads-centralisation §5.1): close it on settlement
  // EVIDENCE, never hope. Preconditions: no ingest entries queued AND none
  // in flight in ANY pass (Codex P4 review #1 — the due-splice hides polled
  // entries from the queue scan). Then two evidence branches:
  //  (a) positive knowledge — THIS pass settled ingest entries and none
  //      remain: every accepted ingest we watched reached a terminal status
  //      (or its 24h stuck horizon — beyond Google's own processing window,
  //      already alerted);
  //  (b) the provider bound — a redeploy drops this in-memory queue, and an
  //      open watermark with nothing left to poll would otherwise hold every
  //      removal until the 30d escalation. Google's diagnostics window caps
  //      processing at 24h, so once the NEWEST accept
  //      (lastIngestAcceptedAt, NOT the oldest — an old stuck ingest must
  //      never vouch for a fresh one, Codex P4 review #2) is >25h old, every
  //      accepted ingest has settled server-side whether we watched or not.
  if (process.env.GOOGLE_CM_USER_LIST_ID) {
    const ingestStillPending = pendingSettles.some((e) => e.kind === 'ingest') || inFlightIngestPolls > 0;
    if (!ingestStillPending) {
      try {
        const readState =
          d.readDestinationState ||
          (async (platform, dest) => {
            const [state] = await sequelize.query(
              `SELECT "oldestUnsettledAcceptAt", "lastIngestAcceptedAt" FROM audience_destination_state
                WHERE platform = :platform AND "destinationId" = :dest`,
              { replacements: { platform, dest } }
            );
            return state?.[0] || null;
          });
        const state = await readState('google', process.env.GOOGLE_CM_USER_LIST_ID);
        const openSince = state?.oldestUnsettledAcceptAt;
        if (openSince) {
          const watchedDrain = ingestSettledThisPass > 0; // (a)
          const lastAccept = state?.lastIngestAcceptedAt ? new Date(state.lastIngestAcceptedAt).getTime() : null;
          const beyondBound =
            lastAccept !== null && (d.now ? d.now() : Date.now()) - lastAccept > 25 * 3600_000; // (b)
          if (watchedDrain || beyondBound) {
            await d.markIngestsSettled('google', process.env.GOOGLE_CM_USER_LIST_ID);
            logger.info({ watchedDrain, beyondBound }, 'google_cm.watermark_closed');
          }
        }
      } catch (err) {
        logger.warn({ err: err?.message }, 'google_cm.watermark_close_failed');
      }
    }
  }
  if (summary.failed > 0 || summary.stuck > 0 || summary.removePartial > 0) {
    Sentry.captureMessage('google_cm.settle.troubled', {
      level: 'warning',
      tags: { source: 'google_cm_sync' },
      extra: summary,
    });
    await sendBadRunAlert(
      d,
      '⚠️ MKTR Google Customer Match — settlement failures',
      [
        'Accepted Data Manager requests ended FAILED, partially-removed, or never settled inside 24h.',
        '',
        `Summary: ${JSON.stringify(summary)}`,
        `Time:    ${new Date().toISOString()}`,
        '',
        'Ingest coverage self-heals on the nightly additive re-ingest; removals',
        'are backstopped by the list membership TTL.',
        'Check Render logs (mktr-backend-jo6r, search "google_cm") + Sentry.',
      ].join('\n')
    );
  } else if (summary.polled > 0) {
    logger.info(summary, 'google_cm.settle.done');
  }
  return summary;
}

// In-process single-flight: the scheduler's interval and a deploy's initial
// run must never overlap (single-instance backend — this is the whole lock).
// Held through status settling, not just the uploads.
let syncInFlight = false;

/**
 * Orchestrate a full sync. Never throws — errors land in Sentry + structured
 * logs (counts only, never PII) + an optional alert email. Per-batch
 * accounting: an accepted batch is never un-reported because a later batch
 * failed, and alerts distinguish partial transport failure from wholesale
 * failure.
 */
export async function syncGoogleCustomerMatch(deps = {}) {
  const d = { ...defaultDeps, ...deps };

  if (!shouldSync()) {
    logger.info('google_cm.sync.skipped (disabled or missing config)');
    return { submitted: false, reason: 'guarded' };
  }
  if (syncInFlight) {
    logger.warn('google_cm.sync.overlap_skipped');
    return { submitted: false, reason: 'overlap' };
  }
  syncInFlight = true;

  try {
    // The sync and the removal drainer share this destination's advisory lock
    // (ads-centralisation §5.1 layer 1), held from eligibility selection
    // through acceptance.
    const lockRes = await d.withDestinationLock(
      `aud:google:${process.env.GOOGLE_CM_USER_LIST_ID}`,
      async () => {
    // Fail-closed by construction: loadEligibilityContext returns a COMPLETE
    // snapshot or THROWS — never upload while blind to withdrawals (§5.1).
    const policy = AUDIENCE_POLICIES.google;
    const ctx = await d.loadEligibilityContext({ requireConsent: policy.requireConsent });
    const prospects = await selectAudiencePopulation(
      { scope: policy.scope, campaignId: process.env.GOOGLE_CM_CAMPAIGN_ID },
      d
    );
    const eligible = filterEligible(prospects, ctx, policy);
    const rows = shapeGoogleMemberRows(eligible);
    logger.info(
      { selected: prospects.length, eligible: rows.length, campaignId: process.env.GOOGLE_CM_CAMPAIGN_ID },
      'google_cm.sync.start'
    );

    if (rows.length === 0) {
      logger.warn('google_cm.sync.empty (no eligible members)');
      // ok distinguishes a healthy no-op from failure; submitted stays
      // acceptance-only (zero requests were made).
      return { submitted: false, ok: true, reason: 'empty', eligible: 0, batches: 0, accepted: 0, failedBatches: 0, settlement: null };
    }

    // Settlement watermark (§5.1): opened BEFORE the first wire attempt —
    // an accept followed by a crash/DB error must never leave an unsettled
    // ingest with the removal gate reading closed (Codex P4 review #3). If
    // nothing ends up accepted AND the watermark was closed before this run,
    // we close it again (safe: we hold the destination lock, and no accept
    // happened). A pre-existing open watermark is NEVER cleared here.
    const watermarkWasOpen = await d.hasUnsettledIngests(
      'google',
      process.env.GOOGLE_CM_USER_LIST_ID
    );
    await d.markIngestAccepted('google', process.env.GOOGLE_CM_USER_LIST_ID);

    const batches = chunk(rows, MAX_BATCH_MEMBERS);
    const acceptedIds = [];
    let failedBatches = 0;
    for (let i = 0; i < batches.length; i++) {
      try {
        const body = buildIngestBody(batches[i]);
        const res = await d.dmRequest('audienceMembers:ingest', body, d);
        if (!res?.requestId) {
          // An accept without a requestId cannot be settled — count it failed
          // rather than assuming success (the next additive run re-covers it).
          failedBatches += 1;
          logger.warn({ batch: i + 1 }, 'google_cm.sync.batch_missing_request_id');
          continue;
        }
        acceptedIds.push(res.requestId);
        logger.info(
          { batch: i + 1, members: batches[i].length, requestId: res.requestId },
          'google_cm.sync.batch'
        );
      } catch (err) {
        failedBatches += 1;
        logger.error({ batch: i + 1, err: err.message }, 'google_cm.sync.batch_failed');
        Sentry.captureException(err, { tags: { source: 'google_cm_sync' } });
      }
    }

    // Acceptance truth in-run; OUTCOME truth arrives via the deferred
    // settlement queue (Google: first diagnostics poll ~30min out). No
    // in-run claim of confirmed delivery is made.
    queueSettles(acceptedIds, 'ingest', d.now ? d.now() : Date.now());

    // Zero accepts does NOT close the pre-opened watermark: a timed-out or
    // transport-errored ingest attempt is an AMBIGUOUS accept (Google may
    // have taken it without us seeing the requestId), so the gate stays
    // conservatively open and heals via the settle pass — positive drain
    // knowledge or the 25h provider bound. `watermarkWasOpen` is kept for
    // observability of that ambiguity.
    if (acceptedIds.length === 0 && !watermarkWasOpen) {
      logger.warn(
        { failedBatches },
        'google_cm.sync.watermark_held_on_ambiguous_accept (settle pass / 25h bound heals)'
      );
    }

    const wholesale = acceptedIds.length === 0;
    // "submitted", not "synced": acceptance-only truth. Whether the accepted
    // requests actually landed is the settler's story, hours later.
    const summary = {
      submitted: !wholesale,
      eligible: rows.length,
      batches: batches.length,
      accepted: acceptedIds.length,
      failedBatches,
      settlement: acceptedIds.length ? 'queued' : null,
    };
    logger.info(summary, 'google_cm.sync.done');

    if (wholesale || failedBatches > 0) {
      await sendBadRunAlert(
        d,
        wholesale
          ? '⚠️ MKTR Google Customer Match sync FAILED (nothing uploaded)'
          : '⚠️ MKTR Google Customer Match sync — partial failure',
        [
          wholesale
            ? 'Every ingest batch failed at the transport layer — nothing was accepted.'
            : 'Some batches failed at the transport layer; accepted batches settle asynchronously.',
          '',
          `Eligible:        ${rows.length}`,
          `Batches:         ${batches.length}`,
          `Accepted:        ${acceptedIds.length}`,
          `Failed batches:  ${failedBatches}`,
          `List:            ${process.env.GOOGLE_CM_USER_LIST_ID}`,
          `Campaign:        ${process.env.GOOGLE_CM_CAMPAIGN_ID}`,
          `Time:            ${new Date().toISOString()}`,
          '',
          'The nightly additive re-ingest self-heals partial coverage.',
          'Check Render logs (mktr-backend-jo6r, search "google_cm") + Sentry (source:google_cm_sync).',
        ].join('\n')
      );
    }
    return summary;
      }
    );
    if (!lockRes.acquired) {
      logger.warn('google_cm.sync.locked (destination busy — drainer or another run holds the lock)');
      return { submitted: false, reason: 'locked' };
    }
    return lockRes.value;
  } catch (err) {
    Sentry.captureException(err, { tags: { source: 'google_cm_sync' } });
    logger.error({ err: err.message }, 'google_cm.sync.failed');
    await sendBadRunAlert(
      d,
      '⚠️ MKTR Google Customer Match sync FAILED (nothing uploaded)',
      [
        'The Google Customer Match exclusion sync aborted — nothing was submitted this run.',
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
    return { submitted: false, error: err.message };
  } finally {
    syncInFlight = false;
  }
}

/**
 * Remove identifier rows from the list. Never throws — erasure/withdrawal
 * must never fail on Google availability; failures land in Sentry/logs and
 * the finite membership duration mops up. Gated on removalConfigured() only.
 */
export async function removeAudienceMembers(identifierRows, deps = {}) {
  const d = { ...defaultDeps, ...deps };
  if (!removalConfigured()) return { accepted: 0, reason: 'unconfigured' };
  const rows = (identifierRows || []).filter((r) => r?.userIdentifiers?.length);
  if (rows.length === 0) return { accepted: 0, reason: 'empty' };
  try {
    // Removal is as asynchronous as ingestion: HTTP accept only returns a
    // requestId. A missing id is a failed batch; accepted ids join the
    // deferred settlement queue — no removal success is ever claimed in-run.
    const batches = chunk(rows, MAX_BATCH_MEMBERS);
    const acceptedIds = [];
    let failedBatches = 0;
    for (const batch of batches) {
      try {
        const res = await d.dmRequest('audienceMembers:remove', buildRemoveBody(batch), d);
        if (res?.requestId) acceptedIds.push(res.requestId);
        else failedBatches += 1;
      } catch (err) {
        failedBatches += 1;
        Sentry.captureException(err, { tags: { source: 'google_cm_remove' } });
        logger.error({ err: err.message }, 'google_cm.remove.batch_failed');
      }
    }
    // Removal outcomes settle asynchronously like ingests (first poll ~30min
    // out). In-run we report ACCEPTANCE only — never removed:true — and the
    // settler alerts on FAILED/stuck (a PARTIAL_SUCCESS or FAILED removal
    // left people on the list; the membership TTL is the healer). accepted
    // means "Google took the removal request", nothing stronger.
    queueSettles(acceptedIds, 'remove', d.now ? d.now() : Date.now());
    const summary = {
      accepted: acceptedIds.length,
      members: rows.length,
      failedBatches,
      settlement: acceptedIds.length ? 'queued' : null,
    };
    if (failedBatches > 0 || acceptedIds.length === 0) {
      Sentry.captureMessage('google_cm.remove.transport_failures', {
        level: 'warning',
        tags: { source: 'google_cm_remove' },
        extra: summary,
      });
      logger.warn(summary, 'google_cm.remove.transport_failures (membership TTL backstops)');
    } else {
      logger.info(summary, 'google_cm.remove.accepted');
    }
    return summary;
  } catch (err) {
    Sentry.captureException(err, { tags: { source: 'google_cm_remove' } });
    logger.error({ err: err.message }, 'google_cm.remove.failed');
    return { accepted: 0, error: err.message };
  }
}

/**
 * Withdrawal-time removal: look up the person's rows in the target campaign
 * and remove their identifiers. Called post-commit from
 * consentService.applyUnsubscribe (dynamic import, fire-and-forget).
 */
export async function removeByConsumerId(consumerId, deps = {}) {
  const d = { ...defaultDeps, ...deps };
  if (!removalConfigured() || !process.env.GOOGLE_CM_CAMPAIGN_ID || !consumerId) {
    return { accepted: 0, reason: 'unconfigured' };
  }
  try {
    const rows = await d.Prospect.findAll({
      attributes: ['email', 'phone'],
      where: { consumerId, campaignId: process.env.GOOGLE_CM_CAMPAIGN_ID },
      raw: true,
    });
    return removeAudienceMembers(buildRemovalIdentifiersFromRaw(rows), d);
  } catch (err) {
    Sentry.captureException(err, { tags: { source: 'google_cm_remove' } });
    logger.error({ err: err.message }, 'google_cm.remove.lookup_failed');
    return { accepted: 0, error: err.message };
  }
}
