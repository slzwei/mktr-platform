/**
 * @file lyfeLeadOutcomeController — receives down-funnel lead-status changes
 * from Lyfe Supabase and turns them into Meta CAPI conversion events.
 *
 * The reverse of the lead-delivery path: when a Lyfe agent advances a lead to
 * `qualified` or `won`, a Postgres trigger (pg_net) POSTs here. We verify the
 * HMAC, then hand off to leadOutcomeService which looks up the originating
 * Prospect and fires QualifiedLead / ClosedWon back to Meta.
 *
 * ── Wire format (sent by the leads-outcome trigger in Lyfe) ────────────
 *
 *   POST /api/integrations/lyfe/lead-outcome
 *   Content-Type: application/json
 *   X-Webhook-Signature: sha256=<hex hmac of raw body using LYFE_LEAD_OUTCOME_SECRET>
 *   X-Webhook-Timestamp: <ISO 8601 timestamp; rejected if ±5 min outside server clock>
 *   {
 *     "external_id": "<mktr prospect id>",
 *     "lead_id":     "<lyfe lead id>",
 *     "new_status":  "qualified" | "won",
 *     "old_status":  "<previous status>",
 *     "agent_id":    "<lyfe agent uuid>",
 *     "occurred_at": "<ISO 8601 timestamp of the status change>"
 *   }
 *
 * ── Auth ───────────────────────────────────────────────────────────────
 *
 * HMAC-SHA256 over the raw body + a 5-minute timestamp window — identical to
 * the inbound users-webhook (lyfeUsersWebhookController.js). Postgres triggers
 * cannot carry a user JWT, so this is the integrity + replay protection.
 *
 * ── Response contract ──────────────────────────────────────────────────
 *
 * Always 200 on a valid signature, including no-op / duplicate / unknown
 * prospect — the dispatch is fire-and-forget and we never want the Supabase
 * trigger to retry-storm. 401 only for a bad/missing signature or timestamp;
 * 400 only for a malformed body.
 */

import crypto from 'crypto';
import * as Sentry from '@sentry/node';
import { logger } from '../utils/logger.js';
import { processLeadOutcome } from '../services/leadOutcomeService.js';

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
const HANDLED_STATUSES = new Set(['qualified', 'won']);

function unauthorized(res, reason) {
  logger.warn({ event: 'lyfe_lead_outcome_unauthorized', reason }, '[lyfe-lead-outcome] auth failed');
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

export async function handleLyfeLeadOutcome(req, res) {
  // ── Auth: HMAC-SHA256 of raw body + timestamp window ────────────────
  const secret = process.env.LYFE_LEAD_OUTCOME_SECRET;
  if (!secret) {
    logger.error('[lyfe-lead-outcome] LYFE_LEAD_OUTCOME_SECRET not configured');
    return res.status(500).json({ success: false, error: 'Server misconfigured' });
  }

  // rawBody is captured by the verify hook in server_internal.js for paths
  // under /api/integrations/lyfe/.
  if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
    logger.error('[lyfe-lead-outcome] req.rawBody missing — verify hook not wired for this path');
    return res.status(500).json({ success: false, error: 'Server misconfigured' });
  }

  const sigHeader = req.headers['x-webhook-signature'] || '';
  if (typeof sigHeader !== 'string' || !sigHeader.startsWith('sha256=')) {
    return unauthorized(res, 'missing_or_malformed_signature');
  }
  const receivedHex = sigHeader.slice(7);
  const expectedHex = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  if (!timingSafeHexEq(receivedHex, expectedHex)) {
    return unauthorized(res, 'bad_signature');
  }

  const tsHeader = req.headers['x-webhook-timestamp'];
  if (typeof tsHeader !== 'string' || !tsHeader) {
    return unauthorized(res, 'missing_timestamp');
  }
  const tsMs = Date.parse(tsHeader);
  if (Number.isNaN(tsMs)) {
    return unauthorized(res, 'invalid_timestamp');
  }
  if (Math.abs(Date.now() - tsMs) > TIMESTAMP_TOLERANCE_MS) {
    return unauthorized(res, 'timestamp_outside_window');
  }

  // ── Payload validation ─────────────────────────────────────────────
  const { external_id: externalId, new_status: newStatus } = req.body || {};
  if (!externalId) return badRequest(res, 'missing external_id');
  if (!newStatus) return badRequest(res, 'missing new_status');

  // Statuses we don't act on still return 200 (the trigger may loosen its
  // filter in future; a non-target status is simply a no-op, not an error).
  if (!HANDLED_STATUSES.has(newStatus)) {
    return res.status(200).json({ success: true, skipped: 'unhandled_status', status: newStatus });
  }

  try {
    const result = await processLeadOutcome(req.body);
    logger.info(
      { event: 'lyfe_lead_outcome_applied', externalId, newStatus, ...result },
      `[lyfe-lead-outcome] ${newStatus} ${externalId} → ${result.action || result.skipped}`
    );
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    // Defensive: processLeadOutcome is designed not to throw, but if it does we
    // still return 200 (signature was valid; a 5xx would trigger pg_net retries
    // we don't want). The error is surfaced to Sentry/logs for follow-up.
    logger.error(
      { event: 'lyfe_lead_outcome_failed', externalId, newStatus, err },
      '[lyfe-lead-outcome] failed to process outcome'
    );
    Sentry.captureException(err, {
      tags: { component: 'lyfe_lead_outcome', service: 'mktr-backend' },
      extra: { externalId, newStatus },
    });
    return res.status(200).json({ success: true, skipped: 'error' });
  }
}
