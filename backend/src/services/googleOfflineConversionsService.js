import * as Sentry from '@sentry/node';
import crypto from 'crypto';
import { QueryTypes } from 'sequelize';
import { sequelize, Prospect } from '../models/index.js';
import { hashEmailGoogle, hashPhoneE164 } from '../utils/piiHashing.js';
import { dmRequest, dmRequestGet } from '../utils/googleDataManagerClient.js';
import { setPath } from '../utils/prospectJsonPatch.js';
import { canMarketTo as ledgerCanMarketTo } from './consentService.js';
import { logger } from '../utils/logger.js';

/**
 * Google offline outcomes — the down-funnel "CAPI parity" arc
 * (plan google-ads-signal-levers §4): ConfirmedResident / ClosedWon uploaded
 * through Data Manager `events:ingest` so Google learns what a GOOD lead is,
 * not just a lead.
 *
 * Truth model (§4.3):
 *  - `sourceMetadata.outcomes.{eventKey}` is the DURABLE FACT (first-wins,
 *    written by the inbound paths + the Lyfe reconciler).
 *  - `sourceMetadata.gads.{eventKey}` is the delivery STATE MACHINE. Every
 *    dispatch first CLAIMS the key with an atomic CAS write (state:
 *    'sending' + a random claimToken) — the claim is what makes inline
 *    dispatch and the worker race-safe: whichever loses the CAS walks away.
 *    All post-send transitions CAS against that exact claim, so a stale
 *    writer can never regress a newer marker or reset retry history. The
 *    claim write carries the erased guard, so a freshly scrubbed row
 *    rejects the claim and nothing sends (dispatch also reloads FRESH state
 *    before building the envelope).
 *  - States: sending → pending → delivered | retryWait | failedPermanent,
 *    plus skippedPermanent for facts that can never send. retryCount rides
 *    through sending AND pending. Key absence is never the retry ledger.
 *  - Settlement classifies the diagnostics ERROR TAXONOMY, not just the
 *    status enum: duplicate-transaction evidence = delivered; permanent
 *    validation/consent/age reasons = failedPermanent; the rest retry.
 *
 * Eligibility is GOOGLE-specific: upload ALL outcomes (Meta-Lead-Ads-origin
 * leads included); skip call_bot for data quality. Identifier usability is
 * decided AFTER the consent ledger: a click id always counts; PII counts
 * only with a live grant. PII-only + ledger OUTAGE → retryWait (never send
 * blind, never skip permanently); PII-only + actual denial → terminal skip.
 * A missing conversion-action id is deployment CONFIG — a per-key worker
 * preflight, never a row marker.
 */

const defaultDeps = {
  Prospect,
  sequelize,
  dmRequest,
  dmRequestGet,
  canMarketTo: ledgerCanMarketTo,
  setPath,
  now: Date.now,
  randomUUID: () => crypto.randomUUID(),
};

const GADS = 'gads';
const SENDING_LEASE_MS = 10 * 60_000; // stale-claim reclaim window (crash recovery)
// Deterministic processing enums that a retry of the UNCHANGED event cannot
// repair (official Data Manager status reasons; extend as observed).
const PERMANENT_REASONS = new Set([
  'INVALID_ARGUMENT',
  'INVALID_EVENT',
  'INVALID_TIMESTAMP',
  'EVENT_TOO_OLD',
  'CONSENT_DENIED',
  'MISSING_CONSENT',
  'DESTINATION_ACCOUNT_ENHANCED_CONVERSIONS_TERMS_NOT_SIGNED',
  'DESTINATION_ACCOUNT_CUSTOMER_MATCH_TERMS_NOT_SIGNED',
  'OPERATING_ACCOUNT_MISMATCH_FOR_AD_IDENTIFIER',
  'ONE_PER_CLICK_CONVERSION_ACTION_NOT_PERMITTED_WITH_BRAID',
  'UNSUPPORTED_EVENT_SOURCE',
  'MALFORMED_IDENTIFIER',
]);
const EVENT_KEYS = ['confirmed_resident', 'closed_won'];
const DEFAULT_VALUES = { confirmed_resident: 40, closed_won: 500 };

/** Env-mapped conversion actions per event key (destination productDestinationId). */
export function actionIdFor(eventKey) {
  if (eventKey === 'confirmed_resident') return process.env.GOOGLE_CONV_ACTION_QUALIFIED || null;
  if (eventKey === 'closed_won') return process.env.GOOGLE_CONV_ACTION_WON || null;
  return null;
}

/** Plan-contracted defaults (S$40 / S$500) survive missing/garbage env. */
export function valueFor(eventKey) {
  const raw =
    eventKey === 'confirmed_resident'
      ? process.env.GOOGLE_VALUE_QUALIFIED
      : eventKey === 'closed_won'
        ? process.env.GOOGLE_VALUE_WON
        : null;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return DEFAULT_VALUES[eventKey] ?? null;
}

/** Master switch + creds. Action ids are a per-key PREFLIGHT, not gated here. */
export function uploadsEnabled() {
  if (process.env.GOOGLE_ADS_UPLOADS_ENABLED !== 'true') return false;
  if (!process.env.GOOGLE_DM_OAUTH_CLIENT_ID) return false;
  if (!process.env.GOOGLE_DM_OAUTH_CLIENT_SECRET) return false;
  if (!process.env.GOOGLE_DM_REFRESH_TOKEN) return false;
  if (!process.env.GOOGLE_ADS_CUSTOMER_ID) return false;
  return true;
}

function maxAgeMs() {
  return Math.max(1, Number(process.env.GOOGLE_CONV_MAX_AGE_DAYS) || 60) * 24 * 60 * 60 * 1000;
}
function maxRetries() {
  return Math.max(0, Number(process.env.GOOGLE_SEND_MAX_RETRIES) || 5);
}
function pendingMaxMs() {
  return Math.max(1, Number(process.env.GOOGLE_PENDING_MAX_DAYS) || 7) * 24 * 60 * 60 * 1000;
}
function firstPollMs() {
  return Math.max(1, Number(process.env.GOOGLE_CM_FIRST_POLL_MINUTES) || 30) * 60_000;
}

/**
 * CONSENT-INDEPENDENT permanent screens: bot origin, erased skeleton, click
 * age. Identifier usability is decided later, after the ledger. The age
 * anchor is the CLICK capture (or signup for click-less rows) and future
 * anchors are clamped to `now` at intake — a forged future timestamp cannot
 * extend the window.
 */
export function factScreen(prospect, deps = {}) {
  const d = { ...defaultDeps, ...deps };
  if (prospect?.sourceMetadata?.erased === true) return { ok: false, reason: 'erased', terminal: false };
  if (prospect?.leadSource === 'call_bot' || prospect?.retellCallId) {
    return { ok: false, reason: 'call_bot', terminal: true };
  }
  const gcl = prospect?.sourceMetadata?.gcl || null;
  const anchor = gcl?.capturedAt || prospect?.createdAt;
  const anchorMs = anchor ? Date.parse(anchor) : NaN;
  const effectiveAnchor = Number.isNaN(anchorMs) ? d.now() : Math.min(anchorMs, d.now());
  if (d.now() - effectiveAnchor > maxAgeMs()) {
    return { ok: false, reason: 'age_window_expired', terminal: true };
  }
  return { ok: true };
}

/**
 * Build the single-event ingest envelope from a FRESH row. `identifiers`
 * comes from the post-ledger decision — the envelope always carries at
 * least one match surface by construction. `eventSource` is REQUIRED for
 * offline conversions; consent enums ride ONLY with userData.
 */
export function buildOutcomeEnvelope(prospect, eventKey, occurredAtIso, identifiers) {
  const event = {
    eventSource: 'OTHER',
    eventTimestamp: new Date(occurredAtIso).toISOString(),
    transactionId: `${eventKey}:${prospect.id}`,
  };
  const value = valueFor(eventKey);
  if (value !== null) {
    event.conversionValue = value;
    event.currency = 'SGD';
  }
  if (Object.keys(identifiers.adIdentifiers).length) event.adIdentifiers = identifiers.adIdentifiers;
  const hasUserData = identifiers.userIdentifiers.length > 0;
  if (hasUserData) event.userData = { userIdentifiers: identifiers.userIdentifiers };

  return {
    destinations: [
      {
        operatingAccount: { product: 'GOOGLE_ADS', accountId: process.env.GOOGLE_ADS_CUSTOMER_ID },
        productDestinationId: actionIdFor(eventKey),
      },
    ],
    events: [event],
    ...(hasUserData
      ? {
          encoding: 'HEX',
          consent: { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' },
        }
      : {}),
  };
}

function retryWaitState(retryCount, lastReason, d) {
  const backoff = Math.min(5 * 60_000 * 2 ** Math.max(0, retryCount - 1), 6 * 60 * 60_000);
  return {
    state: 'retryWait',
    retryCount,
    lastReason,
    nextSendAt: new Date(d.now() + backoff + Math.floor(Math.random() * 60_000)).toISOString(),
  };
}

/**
 * CLAIM-then-send dispatch for ONE (prospect, eventKey). Race-safe by
 * construction: the claim is an atomic CAS (absent → sending, or the exact
 * due retryWait → sending), so inline dispatch and the worker can both call
 * this concurrently and exactly one proceeds. Every subsequent transition
 * CASes against the claim token; a zero-row CAS is logged and NEVER
 * reported as success. Never throws.
 */
export async function dispatchOutcome(prospectId, eventKey, deps = {}) {
  const d = { ...defaultDeps, ...deps };
  const claimToken = d.randomUUID();

  // FRESH row — stale callers must not upload stale identifiers (B2), and
  // the durable fact is the canonical occurred_at.
  const prospect = await d.Prospect.findByPk(prospectId, { raw: true });
  if (!prospect) return { sent: false, reason: 'missing_row' };
  const fact = prospect.sourceMetadata?.outcomes?.[eventKey];
  if (!fact) return { sent: false, reason: 'no_fact' };

  const existing = prospect.sourceMetadata?.gads?.[eventKey];
  let retryCount = 0;
  let claimCas;
  if (existing === undefined) {
    claimCas = { path: [GADS, eventKey], absent: true };
  } else if (existing?.state === 'retryWait') {
    const due = Date.parse(existing.nextSendAt || 0) <= d.now();
    if (!due) return { sent: false, reason: 'not_due' };
    retryCount = Number(existing.retryCount) || 0;
    claimCas = { path: [GADS, eventKey], contains: { state: 'retryWait', retryCount: existing.retryCount } };
  } else if (existing?.state === 'sending') {
    // The claim is a LEASE: a crash between claim and transition must not
    // strand the fact forever. A stale lease (older than SENDING_LEASE_MS)
    // is reclaimable, carrying its retryCount forward.
    const age = d.now() - Date.parse(existing.claimedAt || 0);
    if (age < SENDING_LEASE_MS) return { sent: false, reason: 'claim_held' };
    retryCount = Number(existing.retryCount) || 0;
    claimCas = { path: [GADS, eventKey], contains: { state: 'sending', claimToken: existing.claimToken } };
  } else {
    return { sent: false, reason: 'marker_present' };
  }

  const screen = factScreen(prospect, d);
  if (!screen.ok && screen.terminal) {
    const n = await d.setPath(
      prospect.id,
      [GADS, eventKey],
      { state: 'skippedPermanent', reason: screen.reason, at: new Date(d.now()).toISOString() },
      { cas: claimCas }
    );
    if (n > 0) logger.info({ prospectId, eventKey, reason: screen.reason }, 'google_outcomes.skipped');
    return { sent: false, reason: screen.reason };
  }
  if (!screen.ok) return { sent: false, reason: screen.reason }; // erased: guard blocks writes anyway

  if (retryCount >= maxRetries()) {
    const n = await d.setPath(
      prospect.id,
      [GADS, eventKey],
      { state: 'failedPermanent', reason: 'retry_cap', at: new Date(d.now()).toISOString() },
      { cas: claimCas }
    );
    if (n > 0) {
      Sentry.captureMessage('google_outcomes.retry_cap', {
        level: 'warning',
        tags: { source: 'google_outcomes' },
        extra: { prospectId, eventKey, retryCount },
      });
    }
    return { sent: false, reason: 'retry_cap' };
  }

  // THE CLAIM — losing it means someone else owns this send.
  const claimed = await d.setPath(
    prospect.id,
    [GADS, eventKey],
    { state: 'sending', claimToken, retryCount, claimedAt: new Date(d.now()).toISOString() },
    { cas: claimCas }
  );
  if (claimed === 0) return { sent: false, reason: 'claim_lost' };
  const claimGuard = { path: [GADS, eventKey], contains: { state: 'sending', claimToken } };

  try {
    // Identifier decision AFTER the ledger (M1): click ids always usable;
    // PII only with a live grant. Ledger outage + PII-only → retryWait —
    // never send an identifier-less event, never skip permanently on an
    // infrastructure blip.
    const gcl = prospect.sourceMetadata?.gcl || {};
    const adIdentifiers = {};
    if (gcl.gclid) adIdentifiers.gclid = gcl.gclid;
    if (gcl.gbraid) adIdentifiers.gbraid = gcl.gbraid;
    if (gcl.wbraid) adIdentifiers.wbraid = gcl.wbraid;
    const hasClickId = Object.keys(adIdentifiers).length > 0;

    let consent = false;
    let ledgerOutage = false;
    try {
      consent =
        (await d.canMarketTo({
          consumerId: prospect.consumerId,
          phone: prospect.phone,
          channel: 'all',
          campaignId: prospect.campaignId || null,
        })) === true;
    } catch (err) {
      ledgerOutage = true;
      logger.warn({ err: err.message }, 'google_outcomes.canMarketTo_failed');
    }

    const userIdentifiers = [];
    if (consent) {
      const em = hashEmailGoogle(prospect.email);
      const ph = hashPhoneE164(prospect.phone);
      if (em) userIdentifiers.push({ emailAddress: em });
      if (ph) userIdentifiers.push({ phoneNumber: ph });
    }

    if (!hasClickId && userIdentifiers.length === 0) {
      if (ledgerOutage) {
        await d.setPath(prospect.id, [GADS, eventKey], retryWaitState(retryCount + 1, 'ledger_outage', d), { cas: claimGuard });
        return { sent: false, reason: 'ledger_outage' };
      }
      await d.setPath(
        prospect.id,
        [GADS, eventKey],
        { state: 'skippedPermanent', reason: 'no_identifier', at: new Date(d.now()).toISOString() },
        { cas: claimGuard }
      );
      return { sent: false, reason: 'no_identifier' };
    }

    // FINAL erased re-check, immediately before the wire (Codex P3-2 #1):
    // shrinks the erasure race to milliseconds. The residual (erasure
    // committing inside this last gap) is accepted and matches the Meta CAPI
    // dispatch path's own unguarded load→send window; a conversion event is
    // a bounded, non-retained disclosure and the CM removal hook clears list
    // memberships independently. A row lock is deliberately NOT held here —
    // PDPA erasure must never block on a Google outage.
    const freshErased = await d.sequelize.query(
      `SELECT COALESCE("sourceMetadata"::jsonb->>'erased','false') AS erased FROM prospects WHERE id = $id`,
      { bind: { id: prospect.id }, type: QueryTypes.SELECT }
    );
    if (!freshErased.length || freshErased[0].erased === 'true') {
      await d.setPath(prospect.id, [GADS, eventKey], retryWaitState(retryCount, 'erased_pre_send', d), { cas: claimGuard });
      return { sent: false, reason: 'erased' };
    }

    const envelope = buildOutcomeEnvelope(prospect, eventKey, fact, { adIdentifiers, userIdentifiers });
    const res = await d.dmRequest('events:ingest', envelope, d);
    if (!res?.requestId) {
      await d.setPath(prospect.id, [GADS, eventKey], retryWaitState(retryCount + 1, 'missing_request_id', d), { cas: claimGuard });
      return { sent: false, reason: 'missing_request_id' };
    }
    const n = await d.setPath(
      prospect.id,
      [GADS, eventKey],
      {
        state: 'pending',
        requestId: res.requestId,
        retryCount,
        sentAt: new Date(d.now()).toISOString(),
        nextPollAt: new Date(d.now() + firstPollMs()).toISOString(),
      },
      { cas: claimGuard }
    );
    if (n === 0) {
      // Claim vanished under us (erasure, or a lease reclaim after a long
      // stall) — the upload DID happen but the marker no longer records it;
      // transactionId dedup absorbs any re-send. Reported distinctly, never
      // as plain success (Codex P3-2 #3).
      logger.warn({ prospectId, eventKey, requestId: res.requestId }, 'google_outcomes.accepted_but_claim_lost');
      return { sent: true, requestId: res.requestId, claimLost: true };
    }
    logger.info({ prospectId, eventKey, requestId: res.requestId }, 'google_outcomes.accepted');
    return { sent: true, requestId: res.requestId };
  } catch (err) {
    const permanent = typeof err.status === 'number' && err.status >= 400 && err.status < 500 && err.status !== 429;
    if (permanent) {
      await d.setPath(
        prospect.id,
        [GADS, eventKey],
        { state: 'failedPermanent', reason: `http_${err.status}`, at: new Date(d.now()).toISOString() },
        { cas: claimGuard }
      );
      Sentry.captureException(err, { tags: { source: 'google_outcomes' } });
      return { sent: false, reason: 'permanent' };
    }
    await d.setPath(prospect.id, [GADS, eventKey], retryWaitState(retryCount + 1, 'transient', d), { cas: claimGuard });
    logger.warn({ prospectId, eventKey, err: err.message }, 'google_outcomes.transient');
    return { sent: false, reason: 'transient' };
  }
}

/**
 * Classify a diagnostics response (M2): the reason TAXONOMY decides, not the
 * bare status enum. Returns 'delivered' | 'permanent' | 'transient' |
 * 'processing'. Exported for testing; exact field names re-pinned by the
 * validateOnly smoke before flip (§9).
 */
export function classifyStatusBody(body) {
  const dest = body?.requestStatusPerDestination?.[0];
  const status = String(dest?.requestStatus ?? body?.requestStatus ?? body?.status ?? '').toUpperCase();
  const countBuckets = [];
  const collect = (info) => {
    const counts = info?.errorCounts || info?.errors || [];
    for (const c of Array.isArray(counts) ? counts : []) {
      countBuckets.push(String(c?.reason ?? c?.errorReason ?? c?.code ?? '').toLowerCase());
    }
  };
  collect(dest?.errorInfo);
  collect(dest?.eventsIngestionStatus?.errorInfo);
  collect(body?.errorInfo);
  const reasons = countBuckets.filter(Boolean);
  const hasDuplicate = reasons.some((r) => r.includes('duplicate'));
  // EXACT enum matching for permanence (Codex P3-2 #4): substring guessing
  // misclassifies deterministic processing enums as transient (retrying an
  // unchanged event cannot sign terms or fix an account mismatch) and broad
  // substrings are unsafe against future enums. Unknown reasons default to
  // RETRY. Set re-pinned by the validateOnly smoke / first live failures.
  const hasPermanent = reasons.some((r) => PERMANENT_REASONS.has(r.toUpperCase()));
  if (status === 'SUCCESS') return 'delivered';
  if (status === 'PARTIAL_SUCCESS' || status === 'FAILED') {
    if (hasDuplicate) return 'delivered';
    if (hasPermanent) return 'permanent';
    return 'transient';
  }
  return 'processing';
}

/**
 * Worker job (a): RE-SEND — rows holding an `outcomes.{key}` fact whose gads
 * marker is absent or in a due retryWait. Per-key config preflight: a
 * missing action id aborts THAT key's pass (no row mutation). Dispatch does
 * its own claiming, so overlap with inline sends is safe.
 */
export async function resendDueOutcomes(deps = {}) {
  const d = { ...defaultDeps, ...deps };
  if (!uploadsEnabled()) return { ran: false, reason: 'guarded' };
  const summary = { ran: true, sent: 0, skipped: 0, failed: 0 };
  for (const eventKey of EVENT_KEYS) {
    if (!actionIdFor(eventKey)) {
      logger.warn({ eventKey }, 'google_outcomes.preflight_missing_action_id (key pass aborted)');
      continue;
    }
    const rows = await d.sequelize.query(
      `SELECT id FROM prospects
        WHERE ("sourceMetadata"::jsonb -> 'outcomes') ? $key
          AND COALESCE("sourceMetadata"::jsonb ->> 'erased', 'false') <> 'true'
          AND (
            ("sourceMetadata"::jsonb -> 'gads' -> $key) IS NULL
            OR (
              ("sourceMetadata"::jsonb -> 'gads' -> $key ->> 'state') = 'retryWait'
              AND ("sourceMetadata"::jsonb -> 'gads' -> $key ->> 'nextSendAt') <= $nowIso
            )
            OR (
              ("sourceMetadata"::jsonb -> 'gads' -> $key ->> 'state') = 'sending'
              AND ("sourceMetadata"::jsonb -> 'gads' -> $key ->> 'claimedAt') <= $staleIso
            )
          )
        LIMIT 200`,
      {
        bind: {
          key: eventKey,
          nowIso: new Date(d.now()).toISOString(),
          staleIso: new Date(d.now() - SENDING_LEASE_MS).toISOString(),
        },
        type: QueryTypes.SELECT,
      }
    );
    for (const { id } of rows) {
      const res = await dispatchOutcome(id, eventKey, d);
      if (res.sent) summary.sent += 1;
      else if (['transient', 'missing_request_id', 'ledger_outage'].includes(res.reason)) summary.failed += 1;
      else summary.skipped += 1;
    }
  }
  if (summary.sent || summary.failed) logger.info(summary, 'google_outcomes.resend.done');
  return summary;
}

/**
 * Worker job (b): SETTLE — poll due pending markers by requestId. CAS on the
 * exact pending marker everywhere; classification via the reason taxonomy.
 */
export async function settleDueOutcomes(deps = {}) {
  const d = { ...defaultDeps, ...deps };
  if (!uploadsEnabled()) return { ran: false, reason: 'guarded' };
  const summary = { ran: true, delivered: 0, retried: 0, failedPermanent: 0, stillPending: 0 };
  const nowIso = new Date(d.now()).toISOString();
  for (const eventKey of EVENT_KEYS) {
    const rows = await d.sequelize.query(
      `SELECT id,
              "sourceMetadata"::jsonb -> 'gads' -> $key AS marker
         FROM prospects
        WHERE ("sourceMetadata"::jsonb -> 'gads' -> $key ->> 'state') = 'pending'
          AND ("sourceMetadata"::jsonb -> 'gads' -> $key ->> 'nextPollAt') <= $nowIso
        LIMIT 200`,
      { bind: { key: eventKey, nowIso }, type: QueryTypes.SELECT }
    );
    for (const { id, marker } of rows) {
      const requestId = marker?.requestId;
      if (!requestId) continue;
      const cas = { path: [GADS, eventKey], contains: { state: 'pending', requestId } };
      const pendingAgeMs = d.now() - Date.parse(marker.sentAt || nowIso);
      let classification = 'processing';
      try {
        const body = await d.dmRequestGet(
          `requestStatus:retrieve?requestId=${encodeURIComponent(requestId)}`,
          d
        );
        classification = classifyStatusBody(body);
      } catch (err) {
        if (/duplicate/i.test(err.message || '')) classification = 'delivered';
        else logger.warn({ requestId, err: err.message }, 'google_outcomes.settle.retrieve_failed');
      }
      if (classification === 'delivered') {
        const n = await d.setPath(id, [GADS, eventKey], { state: 'delivered', requestId, deliveredAt: nowIso }, { cas });
        if (n > 0) summary.delivered += 1;
      } else if (classification === 'permanent') {
        const n = await d.setPath(id, [GADS, eventKey], { state: 'failedPermanent', reason: 'ingest_rejected', at: nowIso }, { cas });
        if (n > 0) summary.failedPermanent += 1;
        Sentry.captureMessage('google_outcomes.ingest_rejected', {
          level: 'warning',
          tags: { source: 'google_outcomes' },
          extra: { prospectId: id, eventKey, requestId },
        });
      } else if (classification === 'transient') {
        const retryCount = (Number(marker.retryCount) || 0) + 1;
        const n = await d.setPath(id, [GADS, eventKey], retryWaitState(retryCount, 'ingest_failed', d), { cas });
        if (n > 0) summary.retried += 1;
        Sentry.captureMessage('google_outcomes.ingest_failed', {
          level: 'warning',
          tags: { source: 'google_outcomes' },
          extra: { prospectId: id, eventKey, requestId },
        });
      } else if (pendingAgeMs > pendingMaxMs()) {
        const n = await d.setPath(id, [GADS, eventKey], { state: 'failedPermanent', reason: 'pending_timeout', at: nowIso }, { cas });
        if (n > 0) summary.failedPermanent += 1;
        Sentry.captureMessage('google_outcomes.pending_timeout', {
          level: 'warning',
          tags: { source: 'google_outcomes' },
          extra: { prospectId: id, eventKey, requestId },
        });
      } else {
        const nextDelay = Math.min(
          Math.round((Date.parse(marker.nextPollAt) - Date.parse(marker.sentAt) || firstPollMs()) * 1.3),
          60 * 60_000
        );
        await d.setPath(
          id,
          [GADS, eventKey],
          { ...marker, nextPollAt: new Date(d.now() + nextDelay + Math.floor(Math.random() * 30_000)).toISOString() },
          { cas }
        );
        summary.stillPending += 1;
      }
    }
  }
  if (summary.delivered || summary.retried || summary.failedPermanent) {
    logger.info(summary, 'google_outcomes.settle.done');
  }
  return summary;
}
