/**
 * @file externalLeadActivitiesController — a lead's MKTR ProspectActivity history for the
 * mktr-leads app's unified timeline (the admin held detail merges this with the lead's
 * Supabase lead_activities).
 *
 * ── Endpoint (mounted at /api/external/lead-activities) ──────────────────────
 *   POST /   { prospectId } → { success, count, activities: [{ id, type, description,
 *                              actorUserId, metadata, createdAt }] } (oldest-first)
 *
 * ── Auth ────────────────────────────────────────────────────────────────────
 * HMAC-SHA256 over the RAW BODY using EXTERNAL_APP_SECRET — the SAME scheme as
 * /api/external/held-leads + /api/external/lead-outcomes (header
 * `X-Webhook-Signature: sha256=<hex>`, freshness on the signed body `timestamp`, ±5min).
 * The mktr-leads broker EF (admin-JWT gated, holds the secret) is the only caller.
 * Gated behind LEAD_TIMELINE_EXTERNAL_ENABLED so the route stays unmounted until provisioned.
 */

import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { getProspectActivities } from '../services/prospectService.js';

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

/** Verify HMAC + freshness. Returns null on success, or { code, error } to send. */
function verifyExternalHmac(req) {
  const secret = process.env.EXTERNAL_APP_SECRET;
  if (!secret) {
    logger.error('[external-lead-activities] EXTERNAL_APP_SECRET not configured');
    return { code: 500, error: 'Server misconfigured' };
  }
  if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
    logger.error('[external-lead-activities] req.rawBody missing — verify hook not wired for this path');
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

export async function listLeadActivities(req, res) {
  const authErr = verifyExternalHmac(req);
  if (authErr) return res.status(authErr.code).json({ success: false, error: authErr.error });

  const { prospectId } = req.body || {};
  if (!prospectId || typeof prospectId !== 'string') {
    return res.status(400).json({ success: false, error: 'prospectId is required' });
  }

  try {
    const activities = await getProspectActivities(prospectId);
    return res.json({ success: true, count: activities.length, activities });
  } catch (err) {
    logger.error('[external-lead-activities] list failed', { error: err?.message || String(err) });
    return res.status(500).json({ success: false, error: 'Failed to list lead activities' });
  }
}
