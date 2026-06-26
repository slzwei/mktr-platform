/**
 * @file externalAgentPackagesController — the MKTR Leads buyer app's "My Packages".
 *
 * ── Endpoint (mounted at /api/external/agent-packages) ──────────────────────
 *   POST /   → an agent's OWN lead-package assignments (remaining/total, status,
 *              quality, derived commission + expiry). Read-only.
 *
 * ── Auth ────────────────────────────────────────────────────────────────────
 * HMAC-SHA256 over the RAW BODY using EXTERNAL_APP_SECRET — the SAME scheme as
 * /api/external/held-leads + /api/external/lead-outcomes (header
 * `X-Webhook-Signature: sha256=<hex>`, freshness gated on the signed body
 * `timestamp`, ±5 min). NOT the platform JWT. The mktr-leads `mktr-agent-packages`
 * broker edge function (agent-JWT gated, self-scopes the CALLER's own mktr_user_id,
 * holds the secret server-side) is the only intended caller. The whole route is
 * gated behind AGENT_PACKAGES_EXTERNAL_ENABLED so it stays unmounted until the
 * secret + the broker are provisioned.
 *
 * Self-scoping is enforced twice: the broker only ever sends the caller's own id,
 * and getExternalAgentPackages resolves by mktrLeadsId + role='agent' + isActive.
 */

import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { getExternalAgentPackages } from '../services/leadPackageService.js';

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
 * Mirrors externalHeldLeadsController / externalLeadOutcomeController so all three
 * external channels share one wire contract (rawBody is captured by the
 * /api/external/ verify hook in server_internal.js).
 */
function verifyExternalHmac(req) {
  const secret = process.env.EXTERNAL_APP_SECRET;
  if (!secret) {
    logger.error('[external-packages] EXTERNAL_APP_SECRET not configured');
    return { code: 500, error: 'Server misconfigured' };
  }
  if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
    logger.error('[external-packages] req.rawBody missing — verify hook not wired for this path');
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

export async function listAgentPackages(req, res) {
  const authErr = verifyExternalHmac(req);
  if (authErr) return res.status(authErr.code).json({ success: false, error: authErr.error });

  const { agentMktrUserId } = req.body || {};
  if (!agentMktrUserId || typeof agentMktrUserId !== 'string') {
    return res.status(400).json({ success: false, error: 'agentMktrUserId is required' });
  }

  try {
    // agentMktrUserId is the app's agents.mktr_user_id (== MKTR users.mktrLeadsId).
    // The service self-scopes (role='agent' + isActive) and returns an empty list for
    // any unknown / ineligible id — so this surface can neither leak nor cross-read.
    const { packages } = await getExternalAgentPackages(agentMktrUserId);
    return res.json({ success: true, count: packages.length, packages });
  } catch (err) {
    logger.error('[external-packages] list failed', { error: err?.message || String(err) });
    return res.status(500).json({ success: false, error: 'Failed to list agent packages' });
  }
}
