/**
 * @file externalLeadOutcomeController — receives lead-outcome events from the
 * MKTR Leads buyer app (its report-lead-outcome Supabase edge function).
 *
 * ── Wire format (sender: mktr-leads supabase/functions/report-lead-outcome) ─
 *
 *   POST /api/external/lead-outcomes
 *   Content-Type: application/json
 *   X-Webhook-Event: lead.outcome
 *   X-Webhook-Timestamp: <ISO 8601, informational — the SIGNED copy is in the body>
 *   X-Webhook-Signature: sha256=<hex hmac of the raw body using EXTERNAL_OUTCOME_WEBHOOK_SECRET>
 *   {
 *     "event": "lead.outcome",
 *     "eventId": "<leadId>:<status>",          // stable across re-fires → idempotency key
 *     "timestamp": "<ISO 8601>",               // signed; freshness is gated on THIS
 *     "data": { "externalId", "sourceName", "deliveryId", "mktrLeadsStatus" }
 *   }
 *
 * ── Auth ────────────────────────────────────────────────────────────────────
 *
 * HMAC-SHA256 over the RAW BODY ONLY (MKTR_LEADS_PLAN.md §0.8 — matches the
 * lead-delivery direction, NOT the Lyfe lead-outcome channel which signs
 * `${ts}.${body}` with a different secret). Freshness is gated on the signed
 * body `timestamp` (±5 min): a re-fire from the mktr-leads reconciliation
 * sweep re-signs with a fresh timestamp, so only true replays are rejected.
 *
 * ── Response contract ───────────────────────────────────────────────────────
 *
 * The sender stamps leads.outcome_reported_at only on 2xx and does NOT
 * auto-retry on failure (pg_net is fire-and-forget; a bounded DB sweep
 * re-invokes unreported outcomes). So unlike the Lyfe channel there is no
 * retry-storm risk, and non-2xx answers are honest: 401 bad auth, 400
 * malformed, 413 oversized, 422 unknown / non-MKTR-Leads prospect, 500
 * transient processing failure (the sweep retries it later).
 */

import crypto from 'crypto';
import * as Sentry from '@sentry/node';
import { logger } from '../utils/logger.js';
import { processExternalLeadOutcome, MKTR_LEADS_STATUSES } from '../services/externalLeadOutcomeService.js';

const MAX_AGE_MS = 5 * 60 * 1000;
const MAX_FUTURE_MS = 2 * 60 * 1000; // tolerate clock skew
// The global JSON parser accepts 1mb, so enforce this endpoint's budget on the
// captured raw body (a route-level express.json limit would never run — the
// body is already parsed by the time routes mount).
const MAX_BODY_BYTES = 64 * 1024;

function unauthorized(res, reason) {
  logger.warn({ event: 'external_outcome_unauthorized', reason }, '[external-outcome] auth failed');
  return res.status(401).json({ success: false, error: 'Unauthorized' });
}

function badRequest(res, reason) {
  return res.status(400).json({ success: false, error: reason });
}

function timingSafeHexEq(receivedHex, expectedHex) {
  if (typeof receivedHex !== 'string' || typeof expectedHex !== 'string') return false;
  if (receivedHex.length !== expectedHex.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(receivedHex, 'hex'), Buffer.from(expectedHex, 'hex'));
  } catch {
    return false;
  }
}

export async function handleExternalLeadOutcome(req, res) {
  const secret = process.env.EXTERNAL_OUTCOME_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('[external-outcome] EXTERNAL_OUTCOME_WEBHOOK_SECRET not configured');
    return res.status(500).json({ success: false, error: 'Server misconfigured' });
  }

  // rawBody is captured by the verify hook in server_internal.js for paths
  // under /api/external/.
  if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
    logger.error('[external-outcome] req.rawBody missing — verify hook not wired for this path');
    return res.status(500).json({ success: false, error: 'Server misconfigured' });
  }
  if (req.rawBody.length > MAX_BODY_BYTES) {
    return res.status(413).json({ success: false, error: 'Payload too large' });
  }

  // ── Auth: HMAC-SHA256 over the raw body only ─────────────────────────
  const sigHeader = req.headers['x-webhook-signature'] || '';
  if (typeof sigHeader !== 'string' || !sigHeader.startsWith('sha256=')) {
    return unauthorized(res, 'missing_or_malformed_signature');
  }
  const receivedHex = sigHeader.slice(7);
  const expectedHex = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  if (!timingSafeHexEq(receivedHex, expectedHex)) {
    return unauthorized(res, 'bad_signature');
  }

  // ── Freshness on the signed body timestamp ───────────────────────────
  const { event, eventId, timestamp, data } = req.body || {};
  const tsMs = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
  if (Number.isNaN(tsMs)) {
    return unauthorized(res, 'invalid_timestamp');
  }
  const ageMs = Date.now() - tsMs;
  if (ageMs > MAX_AGE_MS) {
    return unauthorized(res, 'timestamp_too_old');
  }
  if (ageMs < -MAX_FUTURE_MS) {
    return unauthorized(res, 'timestamp_in_future');
  }

  // ── Payload validation ───────────────────────────────────────────────
  if (event !== 'lead.outcome') return badRequest(res, 'unsupported event');
  if (typeof eventId !== 'string' || !eventId) return badRequest(res, 'missing eventId');
  if (!data || typeof data !== 'object') return badRequest(res, 'missing data');
  if (!data.externalId) return badRequest(res, 'missing data.externalId');
  if (!MKTR_LEADS_STATUSES.includes(data.mktrLeadsStatus)) {
    // A status outside the shared contract is a cross-repo drift bug — fail
    // loudly (the sender won't stamp, so the outcome stays visibly unreported).
    return badRequest(res, 'unknown mktrLeadsStatus');
  }

  try {
    const { statusCode, body } = await processExternalLeadOutcome({ event, eventId, timestamp, data });
    logger.info(
      { event: 'external_outcome_processed', eventId, statusCode, ...body },
      `[external-outcome] ${data.mktrLeadsStatus} ${data.externalId} → ${statusCode}`
    );
    return res.status(statusCode).json(body);
  } catch (err) {
    logger.error(
      { event: 'external_outcome_failed', eventId, err },
      '[external-outcome] failed to process outcome'
    );
    Sentry.captureException(err, {
      tags: { component: 'external_lead_outcome', service: 'mktr-backend' },
      extra: { eventId, externalId: data?.externalId, mktrLeadsStatus: data?.mktrLeadsStatus },
    });
    // 500 → sender does not stamp; the mktr-leads sweep re-fires it later.
    return res.status(500).json({ success: false, error: 'Processing failed' });
  }
}
