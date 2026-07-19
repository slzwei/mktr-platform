/**
 * @file leadOutcomeService — turns a Lyfe "lead outcome" webhook into one or
 * more down-funnel Meta CAPI conversion events.
 *
 * The reverse path: a Lyfe agent advances a lead's status; a Supabase trigger
 * POSTs to /api/integrations/lyfe/lead-outcome; the controller hands the payload
 * here. We look up the originating Prospect (external_id === prospect.id) and
 * dispatch the verified, server-side CAPI event(s) back-dated to the status
 * change.
 *
 * SC/PR semantics — in this funnel `qualified` means "the agent CONFIRMED the
 * lead is a Singapore Citizen / PR" (the liar-proof version of the self-declared
 * form gate), NOT buyer-intent. So:
 *   - status → qualified  ⇒  ConfirmedResident                       (META_EVENT_QUALIFIED)
 *   - status → won        ⇒  ConfirmedResident (if not already) + ClosedWon  (META_EVENT_WON)
 * A `contacted → won` jump still implies SC/PR, so `won` also lands the lead in
 * the ConfirmedResident pool (the Lookalike seed) — hence two events.
 *
 * Reliability:
 *   - Events are keyed by a STABLE internal id (`confirmed_resident`/`closed_won`),
 *     independent of which Lyfe status triggered them, so the CAPI `event_id`
 *     (`confirmed_resident:{prospectId}`) is identical whether the lead reached
 *     "confirmed resident" via `qualified` or by jumping to `won`. Meta dedups
 *     any duplicate send on that event_id — that IS our concurrency guard (no
 *     separate idempotency row needed).
 *   - MARK ON SUCCESS: the `sourceMetadata.capi.{confirmedResidentAt|closedWonAt}`
 *     marker is written only AFTER a confirmed send, so a never-sent event stays
 *     re-tryable (by a pg_net retry or the reconciliation backfill) while a sent
 *     one never re-fires. The marker doubles as a reporting timestamp.
 *   - Bounded retry on transient (5xx/network) failures.
 *
 * Match keys (fbp/fbc/IP/UA/external_id, consent-gated em/ph) are sourced from
 * the prospect's persisted sourceMetadata inside metaCapiService._buildPayload,
 * so we only pass the deterministic event_id, the back-dated event_time, and the
 * per-campaign pixel override here.
 */

import { Prospect, Campaign } from '../models/index.js';
import { sendConversionEvent as metaSendConversionEvent } from './metaCapiService.js';
import { logger } from '../utils/logger.js';

// CAPI events keyed by a stable internal id (NOT the Lyfe status), so event_id +
// marker are consistent across the qualified/won triggers.
const EVENTS = {
  confirmed_resident: { envVar: 'META_EVENT_QUALIFIED', defaultName: 'ConfirmedResident', markerKey: 'confirmedResidentAt' },
  closed_won: { envVar: 'META_EVENT_WON', defaultName: 'ClosedWon', markerKey: 'closedWonAt' },
};

/** Resolve the configured CAPI event_name for an internal event key (env-overridable). */
export function eventNameFor(key) {
  const e = EVENTS[key];
  return e ? process.env[e.envVar] || e.defaultName : null;
}

/**
 * Ordered list of internal event keys a Lyfe status should emit.
 *   - qualified ("agent confirmed SC/PR") → ConfirmedResident
 *   - won (bought a policy; implies SC/PR) → ConfirmedResident (if new) + ClosedWon
 */
export function eventKeysForStatus(status) {
  if (status === 'qualified') return ['confirmed_resident'];
  if (status === 'won') return ['confirmed_resident', 'closed_won'];
  return [];
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const defaultDeps = {
  models: { Prospect, Campaign },
  sendConversionEvent: metaSendConversionEvent,
  logger,
  sleep: realSleep,
  retries: 2, // total attempts = retries + 1
  retryBaseMs: 250,
};

export function makeLeadOutcomeService(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };
  const m = { ...defaultDeps.models, ...(overrides.models || {}) };

  /**
   * Dispatch one CAPI event with bounded retry on transient failure.
   * Returns the sendConversionEvent result of the final attempt ({ sent, ... }).
   * Does not retry a `guarded` (CAPI disabled / ineligible) or a 4xx result.
   */
  async function dispatchWithRetry(prospect, ctx, options) {
    let result;
    for (let attempt = 0; attempt <= d.retries; attempt++) {
      result = await d.sendConversionEvent(prospect, ctx, options);
      if (result?.sent) return result;
      if (result?.reason === 'guarded') return result;
      const transient = result?.error != null || (typeof result?.status === 'number' && result.status >= 500);
      if (!transient) return result;
      if (attempt < d.retries) await d.sleep(d.retryBaseMs * 2 ** attempt);
    }
    return result;
  }

  /**
   * Process a single lead-outcome event. Never throws — the controller responds
   * 200 regardless so the Supabase trigger does not retry-storm.
   *
   * @param {object} payload { external_id, new_status, old_status, lead_id, agent_id, occurred_at }
   * @returns {Promise<{dispatched?: string[], duplicate?: string[], failed?: string[], skipped?: string}>}
   */
  async function processLeadOutcome(payload = {}) {
    const { external_id: externalId, new_status: newStatus, occurred_at: occurredAt } = payload;

    const keys = eventKeysForStatus(newStatus);
    if (keys.length === 0) return { skipped: 'unmapped_status' };
    if (!externalId) return { skipped: 'missing_external_id' };

    const prospect = await m.Prospect.findByPk(externalId);
    if (!prospect) return { skipped: 'no_prospect' };

    // Send-time consent gate (PR B, Codex R1 #12): a withdrawal AFTER capture
    // must strip contact identifiers from these DELAYED down-funnel events —
    // the stored signup boolean alone is stale. On a positive suppression
    // match we hand the dispatcher a clone with consent_contact:false, so
    // metaCapiService omits em/ph (fbp/fbc/ip/ua/external_id still ride —
    // browser/session identifiers, not contact PII). Lookup errors keep the
    // stored behavior (byte-identical when consent tables are unreachable).
    let sendProspect = prospect;
    try {
      const { isSuppressed } = await import('./consentService.js');
      const suppressed = await isSuppressed({
        consumerId: prospect.consumerId, phone: prospect.phone, channel: 'all', purpose: 'marketing',
      });
      if (suppressed) {
        const plain = typeof prospect.get === 'function' ? prospect.get({ plain: true }) : { ...prospect };
        sendProspect = { ...plain, sourceMetadata: { ...(plain.sourceMetadata || {}), consent_contact: false } };
      }
    } catch (err) {
      logger.warn('[lead-outcome] suppression lookup failed — sending with stored consent', {
        error: err?.message || String(err),
      });
    }

    // Per-campaign pixel override (mirrors prospectService submit-time dispatch).
    let pixelIdOverride;
    if (prospect.campaignId) {
      const campaign = await m.Campaign.findByPk(prospect.campaignId);
      pixelIdOverride = campaign?.metaPixelId || undefined;
    }

    const parsedTime = occurredAt ? Date.parse(occurredAt) : NaN;
    const eventTime = Number.isNaN(parsedTime) ? undefined : Math.floor(parsedTime / 1000);

    const dispatched = [];
    const duplicate = [];
    const failed = []; // back-compat: union of all not-sent (incl. guarded)
    // Granular classification so callers (e.g. the external path) can decide
    // whether a not-sent result is worth retrying.
    const guarded = []; // CAPI disabled / ineligible — never retry
    const transientFailed = []; // 5xx / network — retryable
    const permanentFailed = []; // 4xx (or unknown not-sent) — do not auto-retry

    for (const key of keys) {
      const { markerKey } = EVENTS[key];
      const eventName = eventNameFor(key);

      // Permanent first-transition dedup. Marker is written only on success
      // (below), so a never-sent event stays re-tryable.
      if (prospect.sourceMetadata?.capi?.[markerKey]) {
        duplicate.push(eventName);
        continue;
      }

      const ctx = {
        // Stable across qualified/won → Meta dedups any duplicate send.
        eventId: `${key}:${prospect.id}`,
        eventTime,
        ...(pixelIdOverride ? { pixelIdOverride } : {}),
      };

      const result = await dispatchWithRetry(sendProspect, ctx, { eventName });

      if (result?.sent) {
        const capi = { ...(prospect.sourceMetadata?.capi || {}), [markerKey]: new Date().toISOString() };
        prospect.sourceMetadata = { ...(prospect.sourceMetadata || {}), capi };
        if (typeof prospect.changed === 'function') prospect.changed('sourceMetadata', true);
        await prospect.save();
        dispatched.push(eventName);
      } else {
        // Not marked → reconciliation / next trigger can retry. (`guarded` = CAPI off.)
        failed.push(eventName);
        if (result?.reason === 'guarded') {
          guarded.push(eventName);
        } else if (result?.error != null || (typeof result?.status === 'number' && result.status >= 500)) {
          transientFailed.push(eventName);
        } else {
          permanentFailed.push(eventName);
        }
        d.logger.warn(
          { prospect_id: prospect.id, event_name: eventName, reason: result?.reason, status: result?.status },
          '[lead-outcome] dispatch not sent (left re-tryable)'
        );
      }
    }

    return { dispatched, duplicate, failed, guarded, transientFailed, permanentFailed };
  }

  return { processLeadOutcome };
}

export const { processLeadOutcome } = makeLeadOutcomeService();
