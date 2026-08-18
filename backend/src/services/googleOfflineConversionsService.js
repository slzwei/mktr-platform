import * as Sentry from '@sentry/node';
import { QueryTypes } from 'sequelize';
import { sequelize, Prospect } from '../models/index.js';
import { hashEmailGoogle, hashPhoneE164 } from '../utils/piiHashing.js';
import { dmRequest, dmRequestGet } from '../utils/googleDataManagerClient.js';
import { mergeFirstWins, setPath } from '../utils/prospectJsonPatch.js';
import { canMarketTo as ledgerCanMarketTo } from './consentService.js';
import { logger } from '../utils/logger.js';

/**
 * Google offline outcomes — the down-funnel "CAPI parity" arc
 * (plan google-ads-signal-levers §4): ConfirmedResident / ClosedWon uploaded
 * through Data Manager `events:ingest` so Google learns what a GOOD lead is,
 * not just a lead.
 *
 * Truth model (§4.3):
 *  - `sourceMetadata.outcomes.{eventKey} = RFC3339` is the DURABLE FACT,
 *    written first-wins by the inbound paths (leadOutcomeService for
 *    Lyfe/external, the admin edit transaction, the Lyfe reconciler).
 *  - `sourceMetadata.gads.{eventKey}` is the delivery STATE MACHINE, every
 *    transition an atomic CAS write (prospectJsonPatch): pending →
 *    delivered / retryWait / failedPermanent, plus skippedPermanent for
 *    facts that can never send. Key absence is never the retry ledger.
 *  - Google's diagnostics window is 30min→24h, so settlement is DEFERRED to
 *    the worker; in-run truth is acceptance-only.
 *
 * Eligibility is GOOGLE-specific, not a shouldFireCapi clone: upload ALL
 * outcomes (Meta-Lead-Ads-origin leads included — unmatched events are
 *  expected and free); skip call_bot for data quality. A missing
 * conversion-action id is deployment CONFIG — a per-key preflight that
 * aborts the key's pass without mutating rows, so supplying the env later
 * sends the untouched facts.
 */

const TERMINAL = new Set(['SUCCESS', 'PARTIAL_SUCCESS', 'FAILED']);

const defaultDeps = {
  Prospect,
  sequelize,
  dmRequest,
  dmRequestGet,
  canMarketTo: ledgerCanMarketTo,
  mergeFirstWins,
  setPath,
  now: Date.now,
};

/** Env-mapped conversion actions per event key (destination productDestinationId). */
export function actionIdFor(eventKey) {
  if (eventKey === 'confirmed_resident') return process.env.GOOGLE_CONV_ACTION_QUALIFIED || null;
  if (eventKey === 'closed_won') return process.env.GOOGLE_CONV_ACTION_WON || null;
  return null;
}

function valueFor(eventKey) {
  const raw =
    eventKey === 'confirmed_resident'
      ? process.env.GOOGLE_VALUE_QUALIFIED
      : eventKey === 'closed_won'
        ? process.env.GOOGLE_VALUE_WON
        : null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
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

/**
 * Fact-level eligibility. Returns `{ ok: true }` or
 * `{ ok: false, reason }` where reason is PERMANENT (skippedPermanent):
 * call_bot origin, no identifier ever, click/signup outside the import
 * window. NOT here: missing action id (config preflight), erased rows
 * (the atomic writes' guard blocks them; dispatch also re-checks).
 */
export function factEligibility(prospect, deps = {}) {
  const d = { ...defaultDeps, ...deps };
  if (prospect?.leadSource === 'call_bot' || prospect?.retellCallId) {
    return { ok: false, reason: 'call_bot' };
  }
  const gcl = prospect?.sourceMetadata?.gcl || null;
  const hasClickId = Boolean(gcl?.gclid || gcl?.gbraid || gcl?.wbraid);
  const hasPii = Boolean(hashEmailGoogle(prospect?.email) || hashPhoneE164(prospect?.phone));
  if (!hasClickId && !hasPii) return { ok: false, reason: 'no_identifier' };
  // Age guard measures from the CLICK (capture lands minutes after it), or
  // the signup for PII-only events — never from the outcome (plan §4.2).
  const anchor = gcl?.capturedAt || prospect?.createdAt;
  const anchorMs = anchor ? Date.parse(anchor) : NaN;
  if (!Number.isNaN(anchorMs) && d.now() - anchorMs > maxAgeMs()) {
    return { ok: false, reason: 'age_window_expired' };
  }
  return { ok: true };
}

/**
 * Build the single-event ingest envelope. One event per request BY DESIGN:
 * diagnostics is aggregate-only, so a requestId must map to exactly one
 * marker (plan §4.2). Consent enums ride ONLY with userData — a
 * CONSENT_GRANTED declaration on a click-only event for a withdrawn person
 * would be false. encoding:HEX accompanies hashed userData and is omitted
 * on click-only events.
 */
export function buildOutcomeEnvelope(prospect, eventKey, occurredAtIso, { marketingConsent }) {
  const gcl = prospect?.sourceMetadata?.gcl || {};
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
  const adIdentifiers = {};
  if (gcl.gclid) adIdentifiers.gclid = gcl.gclid;
  if (gcl.gbraid) adIdentifiers.gbraid = gcl.gbraid;
  if (gcl.wbraid) adIdentifiers.wbraid = gcl.wbraid;
  if (Object.keys(adIdentifiers).length) event.adIdentifiers = adIdentifiers;

  let hasUserData = false;
  if (marketingConsent === true) {
    const userIdentifiers = [];
    const em = hashEmailGoogle(prospect?.email);
    const ph = hashPhoneE164(prospect?.phone);
    if (em) userIdentifiers.push({ emailAddress: em });
    if (ph) userIdentifiers.push({ phoneNumber: ph });
    if (userIdentifiers.length) {
      event.userData = { userIdentifiers };
      hasUserData = true;
    }
  }

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

const GADS = 'gads';

/**
 * Dispatch ONE outcome for one prospect. Assumes the caller verified: master
 * switch on, action id present (preflight), a `outcomes.{eventKey}` fact
 * exists, and no terminal/pending marker blocks the send. `retryCount`
 * carries across accepted-then-failed cycles (it rides in BOTH pending and
 * retryWait — plan round-5). Never throws.
 */
export async function dispatchOutcome(prospect, eventKey, occurredAtIso, retryCount, deps = {}) {
  const d = { ...defaultDeps, ...deps };
  const eligible = factEligibility(prospect, d);
  if (!eligible.ok) {
    await d.setPath(prospect.id, [GADS, eventKey], {
      state: 'skippedPermanent',
      reason: eligible.reason,
      at: new Date(d.now()).toISOString(),
    });
    logger.info({ prospectId: prospect.id, eventKey, reason: eligible.reason }, 'google_outcomes.skipped');
    return { sent: false, reason: eligible.reason };
  }
  if (retryCount >= maxRetries()) {
    await d.setPath(prospect.id, [GADS, eventKey], {
      state: 'failedPermanent',
      reason: 'retry_cap',
      at: new Date(d.now()).toISOString(),
    });
    Sentry.captureMessage('google_outcomes.retry_cap', {
      level: 'warning',
      tags: { source: 'google_outcomes' },
      extra: { prospectId: prospect.id, eventKey, retryCount },
    });
    return { sent: false, reason: 'retry_cap' };
  }

  let marketingConsent = false;
  try {
    marketingConsent =
      (await d.canMarketTo({
        consumerId: prospect.consumerId,
        phone: prospect.phone,
        channel: 'all',
        campaignId: prospect.campaignId || null,
      })) === true;
  } catch (err) {
    // FAIL CLOSED on ledger error: click-only event still sends (session
    // identifiers), PII stays home — mirrors the Meta em/ph posture.
    logger.warn({ err: err.message }, 'google_outcomes.canMarketTo_failed (PII omitted)');
  }

  const envelope = buildOutcomeEnvelope(prospect, eventKey, occurredAtIso, { marketingConsent });
  try {
    const res = await d.dmRequest('events:ingest', envelope, d);
    if (!res?.requestId) {
      // Un-settleable accept — schedule a bounded retry, never silent success.
      await d.setPath(prospect.id, [GADS, eventKey], retryWaitState(retryCount + 1, 'missing_request_id', d));
      return { sent: false, reason: 'missing_request_id' };
    }
    await d.setPath(prospect.id, [GADS, eventKey], {
      state: 'pending',
      requestId: res.requestId,
      retryCount,
      sentAt: new Date(d.now()).toISOString(),
      nextPollAt: new Date(d.now() + firstPollMs()).toISOString(),
    });
    logger.info({ prospectId: prospect.id, eventKey, requestId: res.requestId }, 'google_outcomes.accepted');
    return { sent: true, requestId: res.requestId };
  } catch (err) {
    const permanent = typeof err.status === 'number' && err.status >= 400 && err.status < 500 && err.status !== 429;
    if (permanent) {
      await d.setPath(prospect.id, [GADS, eventKey], {
        state: 'failedPermanent',
        reason: `http_${err.status}`,
        at: new Date(d.now()).toISOString(),
      });
      Sentry.captureException(err, { tags: { source: 'google_outcomes' } });
      return { sent: false, reason: 'permanent' };
    }
    await d.setPath(prospect.id, [GADS, eventKey], retryWaitState(retryCount + 1, 'transient', d));
    logger.warn({ prospectId: prospect.id, eventKey, err: err.message }, 'google_outcomes.transient');
    return { sent: false, reason: 'transient' };
  }
}

function firstPollMs() {
  return Math.max(1, Number(process.env.GOOGLE_CM_FIRST_POLL_MINUTES) || 30) * 60_000;
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

const EVENT_KEYS = ['confirmed_resident', 'closed_won'];

/**
 * Worker job (a): RE-SEND — rows holding an `outcomes.{key}` fact whose gads
 * marker is absent or in a due retryWait. Per-key config preflight: a
 * missing action id aborts THAT key's pass with a log (no row mutation) so
 * later config still sends the untouched facts.
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
          )
        LIMIT 200`,
      { bind: { key: eventKey, nowIso: new Date(d.now()).toISOString() }, type: QueryTypes.SELECT }
    );
    for (const { id } of rows) {
      const prospect = await d.Prospect.findByPk(id, { raw: true });
      if (!prospect) continue;
      const fact = prospect.sourceMetadata?.outcomes?.[eventKey];
      if (!fact) continue;
      const marker = prospect.sourceMetadata?.gads?.[eventKey];
      const retryCount = marker?.state === 'retryWait' ? Number(marker.retryCount) || 0 : 0;
      const res = await dispatchOutcome(prospect, eventKey, fact, retryCount, d);
      if (res.sent) summary.sent += 1;
      else if (res.reason === 'transient' || res.reason === 'missing_request_id') summary.failed += 1;
      else summary.skipped += 1;
    }
  }
  if (summary.sent || summary.failed) logger.info(summary, 'google_outcomes.resend.done');
  return summary;
}

/**
 * Worker job (b): SETTLE — poll due pending markers by requestId (deduped by
 * construction: one event per request). CAS on requestId everywhere, so a
 * stale poll can never regress a newer state. Duplicate-transaction error
 * evidence counts as delivered (consistent with transactionId dedup).
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
      const cas = { path: ['gads', eventKey], contains: { state: 'pending', requestId } };
      const pendingAgeMs = d.now() - Date.parse(marker.sentAt || nowIso);
      let status = null;
      try {
        const body = await d.dmRequestGet(
          `requestStatus:retrieve?requestId=${encodeURIComponent(requestId)}`,
          d
        );
        status =
          body?.requestStatusPerDestination?.[0]?.requestStatus ??
          body?.requestStatus ??
          body?.status ??
          null;
        status = status ? String(status).toUpperCase() : null;
      } catch (err) {
        if (/duplicate/i.test(err.message || '')) {
          // Duplicate-transaction evidence: the event already landed.
          await d.setPath(id, [GADS, eventKey], { state: 'delivered', requestId, deliveredAt: nowIso }, { cas });
          summary.delivered += 1;
          continue;
        }
        logger.warn({ requestId, err: err.message }, 'google_outcomes.settle.retrieve_failed');
      }
      if (status === 'SUCCESS' || status === 'PARTIAL_SUCCESS') {
        await d.setPath(id, [GADS, eventKey], { state: 'delivered', requestId, deliveredAt: nowIso }, { cas });
        summary.delivered += 1;
      } else if (status === 'FAILED') {
        const retryCount = (Number(marker.retryCount) || 0) + 1;
        await d.setPath(id, [GADS, eventKey], retryWaitState(retryCount, 'ingest_failed', d), { cas });
        summary.retried += 1;
        Sentry.captureMessage('google_outcomes.ingest_failed', {
          level: 'warning',
          tags: { source: 'google_outcomes' },
          extra: { prospectId: id, eventKey, requestId },
        });
      } else if (pendingAgeMs > pendingMaxMs()) {
        await d.setPath(id, [GADS, eventKey], {
          state: 'failedPermanent',
          reason: 'pending_timeout',
          at: nowIso,
        }, { cas });
        summary.failedPermanent += 1;
        Sentry.captureMessage('google_outcomes.pending_timeout', {
          level: 'warning',
          tags: { source: 'google_outcomes' },
          extra: { prospectId: id, eventKey, requestId },
        });
      } else {
        // PROCESSING (or unknown): CAS-advance nextPollAt so in-flight
        // requests aren't re-polled every tick (backoff toward 1h).
        const nextDelay = Math.min(Math.round((Date.parse(marker.nextPollAt) - Date.parse(marker.sentAt) || firstPollMs()) * 1.3), 60 * 60_000);
        await d.setPath(id, [GADS, eventKey], {
          ...marker,
          nextPollAt: new Date(d.now() + nextDelay + Math.floor(Math.random() * 30_000)).toISOString(),
        }, { cas });
        summary.stillPending += 1;
      }
    }
  }
  if (summary.delivered || summary.retried || summary.failedPermanent) {
    logger.info(summary, 'google_outcomes.settle.done');
  }
  return summary;
}
