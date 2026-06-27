/**
 * @file externalAdminLeadOpsController — the MKTR Leads admin app's lead-ops surface.
 *
 * ── Endpoints (mounted at /api/external/admin-lead-ops) ─────────────────────
 *   POST /reassign       → move an ASSIGNED lead to another mktr-leads agent
 *   POST /return-to-held → return an ASSIGNED lead to the held queue (vanishes from the agent)
 *
 * ── Auth ────────────────────────────────────────────────────────────────────
 * HMAC-SHA256 over the RAW BODY using EXTERNAL_APP_SECRET — the SAME scheme as
 * /api/external/held-leads + /api/external/lead-outcomes (header `X-Webhook-Signature:
 * sha256=<hex>`, freshness on the signed body `timestamp`, ±5 min). NOT the platform JWT. The
 * mktr-leads `mktr-held-leads` broker edge function (admin-JWT gated, re-checks the live admin
 * role, holds the secret server-side) is the only intended caller. The whole route is gated
 * behind ADMIN_LEAD_OPS_EXTERNAL_ENABLED so it stays unmounted until provisioned.
 */

import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { reassignProspectExternal, returnProspectToHeld } from '../services/prospectService.js';

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
 * Verify HMAC + freshness. Returns null on success, or { code, error } to send. Mirrors
 * externalHeldLeadsController so all external channels share one wire contract (rawBody is
 * captured by the /api/external/ verify hook in server_internal.js).
 */
function verifyExternalHmac(req) {
  const secret = process.env.EXTERNAL_APP_SECRET;
  if (!secret) {
    logger.error('[external-admin-ops] EXTERNAL_APP_SECRET not configured');
    return { code: 500, error: 'Server misconfigured' };
  }
  if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
    logger.error('[external-admin-ops] req.rawBody missing — verify hook not wired for this path');
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

export async function reassignLead(req, res) {
  const authErr = verifyExternalHmac(req);
  if (authErr) return res.status(authErr.code).json({ success: false, error: authErr.error });

  const { prospectId, agentMktrUserId, idempotencyKey } = req.body || {};
  if (!prospectId || !agentMktrUserId) {
    return res.status(400).json({ success: false, error: 'prospectId and agentMktrUserId are required' });
  }
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return res.status(400).json({ success: false, error: 'idempotencyKey is required' });
  }

  try {
    // agentMktrUserId is the app's agents.mktr_user_id (== MKTR users.mktrLeadsId).
    const result = await reassignProspectExternal(prospectId, agentMktrUserId, { idempotencyKey, actorUserId: null });
    const codeByStatus = { reassigned: 200, invalid_agent: 400, not_found: 404, not_assignable: 409 };
    const code = codeByStatus[result.status] || 500;
    return res.status(code).json({ success: code < 400, ...result });
  } catch (err) {
    logger.error('[external-admin-ops] reassign failed', { error: err?.message || String(err) });
    return res.status(500).json({ success: false, error: 'Failed to reassign lead' });
  }
}

export async function returnToHeld(req, res) {
  const authErr = verifyExternalHmac(req);
  if (authErr) return res.status(authErr.code).json({ success: false, error: authErr.error });

  const { prospectId, idempotencyKey } = req.body || {};
  if (!prospectId) {
    return res.status(400).json({ success: false, error: 'prospectId is required' });
  }
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return res.status(400).json({ success: false, error: 'idempotencyKey is required' });
  }

  try {
    const result = await returnProspectToHeld(prospectId, { idempotencyKey, actorUserId: null });
    const codeByStatus = { returned: 200, already_handled: 200, not_assignable: 409, not_found: 404, undeliverable: 503 };
    const code = codeByStatus[result.status] || 500;
    return res.status(code).json({ success: code < 400, ...result });
  } catch (err) {
    logger.error('[external-admin-ops] return-to-held failed', { error: err?.message || String(err) });
    return res.status(500).json({ success: false, error: 'Failed to return lead to held queue' });
  }
}
