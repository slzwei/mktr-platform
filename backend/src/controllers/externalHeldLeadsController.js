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
import { listDispatchableOrphans, releaseHeldProspect } from '../services/prospectService.js';
import { parseBatchContext } from '../services/prospectHelpers.js';

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

// The list keeps the masked fields (firstName + lastInitial + maskedPhone) for the queue row
// and back-compat with older app builds, AND additively returns the FULL name / phone / email
// so the admin can open a held lead and contact/qualify it. This surface is admin-only — the
// broker EF re-checks the LIVE admin role — so the unmasked PII never reaches a non-admin.
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
    const { campaignId, summary } = req.body || {};
    // Fleet-wide orphans = no_funded_agent HOLDS + leads parked on the phantom System
    // Agent (soft-campaign fallback). Both need a real owner; the queue surfaces both.
    const { orphans } = await listDispatchableOrphans({ campaignId, limit: 50 });

    // NON-PII summary projection for the server-side safety-net sweep
    // (sweep-held-leads): ids + campaign + age ONLY. Lead phone/email/name never
    // enter the cron path — the sweep only needs the dedup id + campaign for the ping.
    if (summary === true) {
      const held = (orphans || []).map((o) => ({ id: o.id, campaignName: o.campaignName, since: o.since }));
      return res.json({ success: true, count: held.length, held });
    }

    const rows = (orphans || []).map((o) => ({
      id: o.id,
      firstName: o.firstName || null,
      lastName: o.lastName || null,
      lastInitial: o.lastName ? String(o.lastName).trim().charAt(0).toUpperCase() : null,
      phone: o.phone || null,
      maskedPhone: maskPhone(o.phone),
      email: o.email || null,
      // Full personal / firmographic detail for the admin lead view (DOB raw → app formats
      // it; `details` is the ordered display-ready enrichment). Admin-only surface.
      birthday: o.birthday || null,
      details: Array.isArray(o.details) ? o.details : [],
      campaignId: o.campaignId,
      campaignName: o.campaignName,
      leadSource: o.leadSource,
      sourceLabel: o.sourceLabel || null,
      reason: o.reason,
      since: o.since,
      createdAt: o.createdAt,
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

  // Optional bulk batch context — echoed into the delivery webhook so the receiver
  // coalesces N per-lead pushes into one summary. Malformed → null (per-lead pushes).
  const batch = parseBatchContext(req.body?.batch);

  try {
    // agentMktrUserId is the app's agents.mktr_user_id (== MKTR users.mktrLeadsId).
    const result = await releaseHeldProspect(prospectId, agentMktrUserId, {
      idempotencyKey,
      actorUserId: null,
      batch,
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
