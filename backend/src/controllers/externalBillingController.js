/**
 * @file externalBillingController — the MKTR Leads buyer app's lead-package PURCHASE flow.
 *
 * ── Endpoints (mounted at /api/external/billing, gated by BILLING_ENABLED) ──────
 *   POST /catalog        → buyable packages + checkoutMode (kill switch)
 *   POST /checkout       → create a HitPay payment → { checkoutUrl, purchaseId }
 *   POST /status         → poll one of the agent's purchases → { status }
 *   POST /history        → the agent's purchase history → { purchases }
 *   POST /hitpay-webhook → HitPay settlement → fulfill (grant the LeadPackageAssignment)
 *
 * ── Auth ────────────────────────────────────────────────────────────────────
 * The four agent-facing actions use the SAME HMAC-SHA256-over-rawBody scheme as the
 * other /api/external/ surfaces (header `X-Webhook-Signature: sha256=<hex>`, freshness
 * on the signed body `timestamp`, ±5 min) keyed by EXTERNAL_APP_SECRET — the mktr-leads
 * `mktr-agent-store` broker edge function (agent-JWT gated, self-scopes the caller's own
 * mktr_user_id, holds the secret) is the only intended caller. The webhook is authed
 * separately by HitPay's own signature (hitpayClient.verifyWebhook). rawBody capture +
 * the rate-limiter exemption for `/api/external/` are wired in server_internal.js.
 */
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { verifyWebhook as verifyHitpayWebhook } from '../services/hitpayClient.js';
import { getCatalog, createCheckout, getPurchaseStatus, getHistory, fulfillFromWebhook } from '../services/billingService.js';

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
    logger.error('[external-billing] EXTERNAL_APP_SECRET not configured');
    return { code: 500, error: 'Server misconfigured' };
  }
  if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
    logger.error('[external-billing] req.rawBody missing — verify hook not wired for this path');
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

/** Express middleware — apply on the agent-facing routes (NOT the HitPay webhook). */
export function requireExternalHmac(req, res, next) {
  const authErr = verifyExternalHmac(req);
  if (authErr) return res.status(authErr.code).json({ success: false, error: authErr.error });
  next();
}

function sendError(res, err, op) {
  logger.error(`[external-billing] ${op} failed`, { error: err?.message || String(err) });
  return res.status(500).json({ success: false, error: 'Internal server error' });
}

// ── Catalog ─────────────────────────────────────────────────────────────────────
export async function catalog(req, res) {
  try {
    const data = await getCatalog();
    return res.json({ success: true, ...data });
  } catch (err) {
    return sendError(res, err, 'catalog');
  }
}

// ── Checkout (create purchase) ────────────────────────────────────────────────
export async function checkout(req, res) {
  const { agentMktrUserId, packageId } = req.body || {};
  if (!agentMktrUserId || !packageId) {
    return res.status(400).json({ success: false, error: 'agentMktrUserId and packageId are required' });
  }
  try {
    const r = await createCheckout({ agentMktrUserId, packageId });
    if (r.status === 'created') {
      return res.status(201).json({ success: true, checkoutUrl: r.url, purchaseId: r.purchaseId });
    }
    const codeByStatus = { invalid_agent: 400, package_inactive: 409, package_unpriced: 409, provider_error: 502 };
    const code = codeByStatus[r.status] || 500;
    return res.status(code).json({ success: false, status: r.status });
  } catch (err) {
    return sendError(res, err, 'checkout');
  }
}

// ── Status ────────────────────────────────────────────────────────────────────
export async function status(req, res) {
  const { agentMktrUserId, purchaseId } = req.body || {};
  if (!agentMktrUserId || !purchaseId) {
    return res.status(400).json({ success: false, error: 'agentMktrUserId and purchaseId are required' });
  }
  try {
    const r = await getPurchaseStatus({ agentMktrUserId, purchaseId });
    return res.json({ success: true, status: r.status });
  } catch (err) {
    return sendError(res, err, 'status');
  }
}

// ── History ───────────────────────────────────────────────────────────────────
export async function history(req, res) {
  const { agentMktrUserId } = req.body || {};
  if (!agentMktrUserId) {
    return res.status(400).json({ success: false, error: 'agentMktrUserId is required' });
  }
  try {
    const r = await getHistory({ agentMktrUserId });
    return res.json({ success: true, purchases: r.purchases });
  } catch (err) {
    return sendError(res, err, 'history');
  }
}

// ── HitPay webhook (settlement → fulfillment) ─────────────────────────────────
export async function hitpayWebhook(req, res) {
  const payload = verifyHitpayWebhook(req);
  if (!payload) return res.status(401).json({ success: false, error: 'invalid signature' });
  try {
    const r = await fulfillFromWebhook(payload);
    // 200 on any DURABLE outcome (fulfilled / replay / rejected / ignored / unknown / not_pending)
    // so HitPay stops retrying. A thrown error below is transient → 5xx → HitPay retries.
    return res.status(200).json({ success: true, status: r.status });
  } catch (err) {
    logger.error('[external-billing] webhook fulfillment error (transient → 5xx for retry)', { error: err?.message || String(err) });
    return res.status(500).json({ success: false, error: 'processing error' });
  }
}
