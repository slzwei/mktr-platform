/**
 * @file externalHeldLeadsController — the MKTR Leads buyer app's admin "held queue".
 *
 * ── Endpoints (mounted at /api/external/held-leads) ─────────────────────────
 *   POST /                 → list held (no_funded_agent) leads, fleet-wide, FIFO
 *   POST /assign           → release a held lead to a mktr-leads agent + deliver
 *
 * ── Auth ────────────────────────────────────────────────────────────────────
 * HMAC-SHA256 over the RAW BODY using EXTERNAL_APP_SECRET — the SAME scheme as
 * /api/external/lead-outcomes (header `X-Webhook-Signature: sha256=<hex>`,
 * freshness gated on the signed body `timestamp`, ±5 min). NOT the platform JWT.
 * The mktr-leads broker edge function (admin-JWT gated, holds the secret
 * server-side) is the only intended caller. The whole route is gated behind the
 * HELD_LEADS_EXTERNAL_ENABLED flag, so it stays unmounted until provisioned.
 */

import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { listHeldProspects, releaseHeldProspect } from '../services/prospectService.js';

const MAX_AGE_MS = 5 * 60 * 1000;
const MAX_FUTURE_MS = 2 * 60 * 1000; // tolerate clock skew
const MAX_BODY_BYTES = 64 * 1024;

function timingSafeHexEq(receivedHex, expectedHex) {
  if (typeof receivedHex !== 'string' || typeof expectedHex !== 'string') return false;
  if (receivedHex.length !== expectedHex.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(receivedHex, 'hex'), Buffer.from(expectedHex, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verify HMAC + freshness. Returns null on success, or { code, error } to send.
 * Mirrors externalLeadOutcomeController so the two external channels share one
 * wire contract (rawBody is captured by the /api/external/ verify hook).
 */
function verifyExternalHmac(req) {
  const secret = process.env.EXTERNAL_APP_SECRET;
  if (!secret) {
    logger.error('[external-held] EXTERNAL_APP_SECRET not configured');
    return { code: 500, error: 'Server misconfigured' };
  }
  if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
    logger.error('[external-held] req.rawBody missing — verify hook not wired for this path');
    return { code: 500, error: 'Server misconfigured' };
  }
  if (req.rawBody.length > MAX_BODY_BYTES) return { code: 413, error: 'Payload too large' };

  const sigHeader = req.headers['x-webhook-signature'] || '';
  if (typeof sigHeader !== 'string' || !sigHeader.startsWith('sha256=')) {
    return { code: 401, error: 'Unauthorized' };
  }
  const expectedHex = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  if (!timingSafeHexEq(sigHeader.slice(7), expectedHex)) {
    return { code: 401, error: 'Unauthorized' };
  }

  const tsMs = typeof req.body?.timestamp === 'string' ? Date.parse(req.body.timestamp) : NaN;
  if (Number.isNaN(tsMs)) return { code: 401, error: 'Unauthorized' };
  const ageMs = Date.now() - tsMs;
  if (ageMs > MAX_AGE_MS || ageMs < -MAX_FUTURE_MS) return { code: 401, error: 'Unauthorized' };

  return null;
}

// PII is minimised for the queue view — the admin dispatches by name + campaign,
// and does not need to contact the lead from this surface.
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `••••${digits.slice(-4)}`;
}

export async function listHeldLeads(req, res) {
  const authErr = verifyExternalHmac(req);
  if (authErr) return res.status(authErr.code).json({ success: false, error: authErr.error });

  try {
    const { campaignId } = req.body || {};
    // `{ role: 'admin' }` → buildProspectWhere returns {} (fleet-wide). The reason
    // filter is applied IN the query (before the 50-row limit) so assignable holds
    // are never hidden behind a page of external-buyer holds.
    const { held } = await listHeldProspects(
      { role: 'admin' },
      { campaignId, quarantineReason: 'no_funded_agent', limit: 50 },
    );
    const rows = (held || [])
      .filter((h) => h.quarantineReason === 'no_funded_agent')
      .map((h) => ({
        id: h.id,
        firstName: h.firstName || null,
        lastInitial: h.lastName ? String(h.lastName).trim().charAt(0).toUpperCase() : null,
        maskedPhone: maskPhone(h.phone),
        campaignId: h.campaignId,
        campaignName: h.campaignName,
        leadSource: h.leadSource,
        quarantinedAt: h.quarantinedAt,
        createdAt: h.createdAt,
      }));
    return res.json({ success: true, count: rows.length, held: rows });
  } catch (err) {
    logger.error('[external-held] list failed', { error: err?.message || String(err) });
    return res.status(500).json({ success: false, error: 'Failed to list held leads' });
  }
}

export async function assignHeldLead(req, res) {
  const authErr = verifyExternalHmac(req);
  if (authErr) return res.status(authErr.code).json({ success: false, error: authErr.error });

  const { prospectId, agentMktrUserId, idempotencyKey } = req.body || {};
  if (!prospectId || !agentMktrUserId) {
    return res.status(400).json({ success: false, error: 'prospectId and agentMktrUserId are required' });
  }
  // Mandatory so an exact retry replays the original result (the broker EF always
  // sends one). HMAC + held-only release still guarantee no double effect without it.
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return res.status(400).json({ success: false, error: 'idempotencyKey is required' });
  }

  try {
    // agentMktrUserId is the app's agents.mktr_user_id (== MKTR users.mktrLeadsId).
    const result = await releaseHeldProspect(prospectId, agentMktrUserId, {
      idempotencyKey,
      actorUserId: null,
    });
    const codeByStatus = {
      assigned: 200,
      already_handled: 200,
      invalid_agent: 400,
      not_found: 404,
      not_assignable_external: 409,
      undeliverable: 503,
    };
    const code = codeByStatus[result.status] || 500;
    return res.status(code).json({ success: code < 400, ...result });
  } catch (err) {
    logger.error('[external-held] assign failed', { error: err?.message || String(err) });
    return res.status(500).json({ success: false, error: 'Failed to assign held lead' });
  }
}
