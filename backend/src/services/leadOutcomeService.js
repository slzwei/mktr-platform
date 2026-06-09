/**
 * @file leadOutcomeService — turns a Lyfe "lead outcome" webhook into a
 * down-funnel Meta CAPI conversion event.
 *
 * The reverse path: a Lyfe agent advances a lead's status; a Supabase trigger
 * POSTs to /api/integrations/lyfe/lead-outcome; the controller hands the
 * payload here. We look up the originating Prospect (external_id === prospect.id),
 * guard against re-firing, and dispatch a server-side CAPI event back-dated to
 * the qualification time.
 *
 * Events (env-overridable so `won` can later become a standard `Purchase`):
 *   - status → qualified  ⇒  QualifiedLead   (META_EVENT_QUALIFIED)
 *   - status → won        ⇒  ClosedWon       (META_EVENT_WON)
 *
 * Idempotency: a marker is persisted on prospect.sourceMetadata.capi
 * ({ qualifiedAt, wonAt }) so a status toggle (qualified → contacted →
 * qualified) does NOT refire. The marker travels with the prospect and doubles
 * as a reporting signal.
 *
 * Match keys (fbp/fbc/IP/UA/external_id, consent-gated em/ph) are sourced from
 * the prospect's persisted sourceMetadata inside metaCapiService._buildPayload,
 * so we only need to pass the deterministic event_id, the back-dated event_time,
 * and the per-campaign pixel override here.
 */

import { Prospect, Campaign } from '../models/index.js';
import { sendConversionEvent as metaSendConversionEvent } from './metaCapiService.js';
import { logger } from '../utils/logger.js';

const STATUS_MARKER = { qualified: 'qualifiedAt', won: 'wonAt' };

/** Resolve the CAPI event_name for a Lyfe status (env-overridable). */
export function eventNameForStatus(status) {
  if (status === 'qualified') return process.env.META_EVENT_QUALIFIED || 'QualifiedLead';
  if (status === 'won') return process.env.META_EVENT_WON || 'ClosedWon';
  return null;
}

const defaultDeps = {
  models: { Prospect, Campaign },
  sendConversionEvent: metaSendConversionEvent,
  logger,
};

export function makeLeadOutcomeService(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };
  const m = { ...defaultDeps.models, ...(overrides.models || {}) };

  /**
   * Process a single lead-outcome event.
   *
   * Never throws — the controller responds 200 regardless so the Supabase
   * trigger does not retry-storm. Returns a small result describing the action
   * taken (for logging/tests).
   *
   * @param {object} payload { external_id, new_status, old_status, lead_id, agent_id, occurred_at }
   * @returns {Promise<{action?: string, skipped?: string, eventName?: string}>}
   */
  async function processLeadOutcome(payload = {}) {
    const { external_id: externalId, new_status: newStatus, occurred_at: occurredAt } = payload;

    const eventName = eventNameForStatus(newStatus);
    const markerKey = STATUS_MARKER[newStatus];
    if (!eventName || !markerKey) {
      return { skipped: 'unmapped_status' };
    }
    if (!externalId) {
      return { skipped: 'missing_external_id' };
    }

    const prospect = await m.Prospect.findByPk(externalId);
    if (!prospect) {
      return { skipped: 'no_prospect' };
    }

    // Idempotency: first transition only.
    const existingMarker = prospect.sourceMetadata?.capi?.[markerKey];
    if (existingMarker) {
      return { skipped: 'duplicate', eventName };
    }

    // Per-campaign pixel override (mirrors prospectService submit-time dispatch).
    let pixelIdOverride;
    if (prospect.campaignId) {
      const campaign = await m.Campaign.findByPk(prospect.campaignId);
      pixelIdOverride = campaign?.metaPixelId || undefined;
    }

    const parsedTime = occurredAt ? Date.parse(occurredAt) : NaN;
    const eventTime = Number.isNaN(parsedTime) ? undefined : Math.floor(parsedTime / 1000);

    const ctx = {
      eventId: `${newStatus}:${prospect.id}`,
      eventTime,
      ...(pixelIdOverride ? { pixelIdOverride } : {}),
    };

    // Persist the marker BEFORE dispatch so a trigger retry after our 200 is a
    // clean no-op. Dispatch itself is fire-and-forget (guard + error handling
    // live inside sendConversionEvent), matching the submit-time Lead event.
    const capi = { ...(prospect.sourceMetadata?.capi || {}), [markerKey]: new Date().toISOString() };
    prospect.sourceMetadata = { ...(prospect.sourceMetadata || {}), capi };
    if (typeof prospect.changed === 'function') prospect.changed('sourceMetadata', true);
    await prospect.save();

    d.sendConversionEvent(prospect, ctx, { eventName }).catch((err) => {
      d.logger.error(
        { err: err?.message || String(err), prospect_id: prospect.id, event_name: eventName },
        '[lead-outcome] sendConversionEvent error'
      );
    });

    return { action: 'dispatched', eventName };
  }

  return { processLeadOutcome };
}

export const { processLeadOutcome } = makeLeadOutcomeService();
