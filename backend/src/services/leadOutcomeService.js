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
 * Match keys (fbp/fbc/IP/UA/external_id) are sourced from the prospect's
 * persisted sourceMetadata inside metaCapiService._buildPayload; em/ph ride
 * only when ctx.marketingConsent is true — derived HERE at send time from the
 * consent ledger (canMarketTo: verified campaign-scoped grant, no suppression,
 * not erased), so a withdrawal after capture strips them (3sites). We pass the
 * deterministic event_id, the back-dated event_time, the per-campaign pixel
 * override, and that consent flag.
 */

import { Prospect, Campaign, sequelize } from '../models/index.js';
import { setPath as setSourceMetadataPath, mergeFirstWins as mergeSourceMetadataFirstWins } from '../utils/prospectJsonPatch.js';
import {
  dispatchOutcome as dispatchGoogleOutcome,
  uploadsEnabled as googleUploadsEnabled,
  actionIdFor as googleActionIdFor,
} from './googleOfflineConversionsService.js';
import { sendConversionEvent as metaSendConversionEvent } from './metaCapiService.js';
import { canMarketTo as ledgerCanMarketTo } from './consentService.js';
import { planOutcomeDeliveriesTx, dispatchOutcomeDelivery } from './platformDeliveryService.js';
import { OUTCOME_EVENTS as EVENTS, eventNameFor, eventKeysForStatus } from './outcomeEvents.js';
import { logger } from '../utils/logger.js';

// CAPI events keyed by a stable internal id (NOT the Lyfe status), so event_id +
// marker are consistent across the qualified/won triggers. The vocabulary
// (EVENTS map + eventNameFor + eventKeysForStatus) lives in outcomeEvents.js so
// the platform-delivery ledger shares it without a static import cycle; the
// re-exports below keep this module's public surface unchanged.
export { eventNameFor, eventKeysForStatus };

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const defaultDeps = {
  models: { Prospect, Campaign },
  sequelize,
  sendConversionEvent: metaSendConversionEvent,
  setSourceMetadataPath,
  mergeSourceMetadataFirstWins,
  planOutcomeDeliveriesTx,
  dispatchOutcomeDelivery,
  dispatchGoogleOutcome,
  googleUploadsEnabled,
  googleActionIdFor,
  canMarketTo: ledgerCanMarketTo,
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
  async function processLeadOutcome(payload = {}, context = {}) {
    const { external_id: externalId, new_status: newStatus, occurred_at: occurredAt } = payload;

    const keys = eventKeysForStatus(newStatus);
    if (keys.length === 0) return { skipped: 'unmapped_status' };
    if (!externalId) return { skipped: 'missing_external_id' };

    const prospect = await m.Prospect.findByPk(externalId);
    if (!prospect) return { skipped: 'no_prospect' };

    // Canonical outcome timestamp (plan google-ads-signal-levers §4.3):
    // validated body value → the AUTHENTICATED webhook timestamp (passed
    // explicitly by the Lyfe controller) → receipt time. The body field is
    // caller-supplied and unvalidated upstream.
    const bodyTs = occurredAt ? Date.parse(occurredAt) : NaN;
    const canonicalOccurredAt = !Number.isNaN(bodyTs)
      ? new Date(bodyTs).toISOString()
      : context.signedWebhookAt && !Number.isNaN(Date.parse(context.signedWebhookAt))
        ? new Date(Date.parse(context.signedWebhookAt)).toISOString()
        : new Date().toISOString();

    // DURABLE FACTS FIRST, all keys for this status in ONE first-wins merge —
    // the Google worker re-sends from these, so a crash after this line can
    // never lose the outcome, and a later `won` can never rewrite an earlier
    // qualified timestamp. (The admin path writes the same facts inside its
    // edit transaction; this merge is idempotent against that.)
    // The merge and the delivery-ledger planning share ONE managed transaction
    // (ads-centralisation §3.3.2): the planner re-reads the PERSISTED facts
    // in-txn, so rows and facts commit together — a row can never exist
    // without its fact, and a replayed `won` can never retime an earlier
    // confirmed_resident (the first-wins fact is the row's eventTime).
    let erasedMidFlight = false;
    try {
      await d.sequelize.transaction(async (t) => {
        const factRows = await d.mergeSourceMetadataFirstWins(
          prospect.id,
          ['outcomes'],
          Object.fromEntries(keys.map((k) => [k, canonicalOccurredAt])),
          { transaction: t }
        );
        if (factRows === 0) {
          // The erased guard is the only thing that blocks a plain merge — a
          // concurrent erasure won between our load and this write. Nothing
          // may dispatch from the stale pre-erasure row (B2).
          const fresh = await m.Prospect.findByPk(prospect.id, { raw: true, transaction: t });
          if (!fresh || fresh.sourceMetadata?.erased === true) {
            erasedMidFlight = true;
            return;
          }
        }
        // Idempotent row planning from the persisted facts. A planning
        // failure rolls the whole txn back into the catch below — today's
        // error path (webhook still 200s); the durability net for a fully-
        // failed txn (no fact, no row) is the credentials-based Lyfe
        // reconciler (§3.5), which re-writes the fact for the invariant
        // sweep to plan from.
        await d.planOutcomeDeliveriesTx(t, { prospectId: prospect.id, keys });
      });
    } catch (factErr) {
      d.logger.error('[lead-outcome] outcome facts+planning transaction failed (reconciler heals)', {
        prospectId: prospect.id, error: factErr?.message || String(factErr),
      });
    }
    if (erasedMidFlight) {
      d.logger.warn('[lead-outcome] row erased mid-flight — dispatch aborted', {
        prospectId: prospect.id,
      });
      return { skipped: 'erased' };
    }

    // Send-time em/ph gate (3sites, supersedes the PR B clone hack): derived
    // from the consent ledger at dispatch time — canMarketTo requires a
    // verified campaign-scoped grant, no marketing suppression, not erased —
    // so a withdrawal OR an unverified/unticked signup strips em/ph from these
    // DELAYED events (fbp/fbc/ip/ua/external_id still ride — browser/session
    // identifiers, not contact PII). FAIL CLOSED on lookup error: em/ph are
    // omitted (a deliberate tightening from PR B's keep-stored-behavior); the
    // event itself still fires.
    let marketingConsent = false;
    try {
      marketingConsent = (await d.canMarketTo({
        consumerId: prospect.consumerId,
        phone: prospect.phone,
        channel: 'all',
        campaignId: prospect.campaignId || null,
      })) === true;
    } catch (err) {
      d.logger.warn('[lead-outcome] canMarketTo failed — omitting em/ph (fail-closed)', {
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

      // Permanent first-transition dedup — for the META send only. Google is
      // evaluated independently below (its own marker owns its dedup).
      const metaDuplicate = Boolean(prospect.sourceMetadata?.capi?.[markerKey]);
      if (metaDuplicate) duplicate.push(eventName);

      // Row-ownership routing (ads-centralisation §3.2/§3.3.5): a ledger row
      // in ANY state owns this (prospect, meta, key) pair — the delivery
      // service attempts it (or leaves it to the worker) and the result maps
      // onto this function's legacy return contract. No row ⇒ the PERMANENT
      // legacy direct-send block below (planning off / marker-aware skip /
      // failed planning transaction).
      let ledgerOutcome = null;
      let result = null;
      if (!metaDuplicate) {
        const led = await d.dispatchOutcomeDelivery({ prospectId: prospect.id, key, marketingConsent });
        if (led.owned) {
          ledgerOutcome = led.legacyOutcome;
        } else {
          const ctx = {
            // Stable across qualified/won → Meta dedups any duplicate send.
            eventId: `${key}:${prospect.id}`,
            eventTime,
            marketingConsent,
            ...(pixelIdOverride ? { pixelIdOverride } : {}),
          };
          result = await dispatchWithRetry(prospect, ctx, { eventName });
        }
      }

      if (ledgerOutcome === 'dispatched') dispatched.push(eventName);
      if (ledgerOutcome === 'duplicate') duplicate.push(eventName);

      if (!metaDuplicate && !ledgerOutcome && result?.sent) {
        // Atomic single-key marker write (prospectJsonPatch) — the old
        // read-spread-save of the whole object could delete keys any OTHER
        // writer (google markers, outcome facts, redemption) landed between
        // this handler's load and save (plan google-ads-signal-levers §4.3).
        // (Ledger sends write this marker inside their settle transaction.)
        await d.setSourceMetadataPath(prospect.id, ['capi', markerKey], new Date().toISOString());
        dispatched.push(eventName);
      }

      // Google offline outcome — SEQUENTIAL after Meta (both write disjoint
      // sourceMetadata keys atomically), isolated: a Google failure never
      // blocks the Meta result, the other key, or the 200 to Lyfe. Inline
      // dispatch is the low-latency path; the worker re-sends anything this
      // misses from the durable fact.
      if (d.googleUploadsEnabled() && d.googleActionIdFor(key)) {
        // dispatchOutcome reloads the FRESH row, claims the marker with an
        // atomic CAS (race-safe against the worker), and never throws — the
        // try is belt-and-braces for injected seams.
        try {
          await d.dispatchGoogleOutcome(prospect.id, key);
        } catch (googleErr) {
          d.logger.warn('[lead-outcome] google outcome dispatch error (worker heals)', {
            prospectId: prospect.id, key, error: googleErr?.message || String(googleErr),
          });
        }
      }

      if (ledgerOutcome && ledgerOutcome !== 'dispatched' && ledgerOutcome !== 'duplicate') {
        // Ledger-owned but not delivered on this pass — the row (or the
        // worker) governs the retry; the classification preserves the
        // external path's 503-on-transient contract.
        failed.push(eventName);
        if (ledgerOutcome === 'guarded') guarded.push(eventName);
        else if (ledgerOutcome === 'transientFailed') transientFailed.push(eventName);
        else permanentFailed.push(eventName);
        d.logger.warn(
          { prospect_id: prospect.id, event_name: eventName, ledger_outcome: ledgerOutcome },
          '[lead-outcome] ledger dispatch not sent (row governs retry)'
        );
      }

      if (!metaDuplicate && !ledgerOutcome && !result?.sent) {
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
