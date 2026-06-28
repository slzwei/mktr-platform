/**
 * HitPay provider adapter — the ONLY place that knows HitPay's wire format, so the
 * exact contract (which is a SANDBOX-CONFIRM item — see below) is a one-file change.
 * Two operations:
 *   - createPaymentRequest(): outbound, creates a hosted checkout, returns { id, url }
 *   - verifyWebhook(): inbound, verifies the settlement webhook and returns the payload
 *
 * Env: HITPAY_API_KEY (secret), HITPAY_WEBHOOK_SALT (secret), HITPAY_API_BASE
 *      (prod https://api.hit-pay.com/v1 · sandbox https://api.sandbox.hit-pay.com/v1),
 *      HITPAY_PAYMENT_METHODS (default "paynow_online,card").
 */
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

const DEFAULT_BASE = 'https://api.hit-pay.com/v1';
const DEFAULT_METHODS = 'paynow_online,card';

function apiBase() {
  return (process.env.HITPAY_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
}
function paymentMethods() {
  return (process.env.HITPAY_PAYMENT_METHODS || DEFAULT_METHODS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function timingSafeHexEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Create a HitPay payment request → { id, url }. `referenceNumber` is OUR Payment.id,
 * so the webhook correlates back to the row we wrote.
 *
 * ⚠️ SANDBOX-CONFIRM: HitPay's create contract (form-encoded vs JSON, the exact field
 * names, `paynow_online` slug, and the response shape) was not doc-verifiable (docs
 * 403 to automated fetch). Implemented per the documented v1 form-encoded style;
 * confirm against the HitPay sandbox before go-live.
 */
export async function createPaymentRequest({ amount, referenceNumber, name, email, redirectUrl, webhookUrl, purpose }) {
  const apiKey = process.env.HITPAY_API_KEY;
  if (!apiKey) throw new Error('HITPAY_API_KEY not configured');
  if (!(Number(amount) > 0) || !referenceNumber) throw new Error('createPaymentRequest: amount and referenceNumber required');

  const body = new URLSearchParams();
  body.set('amount', String(amount));
  body.set('currency', 'SGD');
  body.set('reference_number', String(referenceNumber));
  if (purpose) body.set('purpose', String(purpose));
  if (name) body.set('name', String(name));
  if (email) body.set('email', String(email));
  if (redirectUrl) body.set('redirect_url', String(redirectUrl));
  if (webhookUrl) body.set('webhook', String(webhookUrl));
  for (const m of paymentMethods()) body.append('payment_methods[]', m);

  let res;
  try {
    res = await fetch(`${apiBase()}/payment-requests`, {
      method: 'POST',
      headers: {
        'X-BUSINESS-API-KEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body,
    });
  } catch (err) {
    logger.error('[hitpay] createPaymentRequest network error', { error: err?.message || String(err) });
    throw new Error('HitPay request failed (network)');
  }

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  if (!res.ok || !json?.id || !json?.url) {
    logger.error('[hitpay] createPaymentRequest failed', { status: res.status, body: text?.slice(0, 500) });
    throw new Error(`HitPay payment-request failed (${res.status})`);
  }
  return { id: String(json.id), url: String(json.url) };
}

/**
 * Verify an inbound HitPay webhook. Returns the parsed JSON payload on success, or
 * null on any failure (bad/absent signature, missing salt, unparseable body).
 *
 * ⚠️ SANDBOX-CONFIRM: HitPay has TWO webhook styles and the docs weren't fetchable.
 * LEGACY per-request scheme (what the `webhook` param we pass to createPaymentRequest triggers,
 * keyed by the account SALT): an `application/x-www-form-urlencoded` POST with an `hmac` field that
 * is HMAC-SHA256 over the OTHER fields sorted by key and concatenated as `key1value1key2value2...`,
 * keyed by HITPAY_WEBHOOK_SALT. The body is the PARSED form (`req.body`, via the global
 * express.urlencoded) — no rawBody needed. Confirm the exact field set against a real HitPay
 * webhook before go-live; the verifier is isolated so the scheme is a one-function change.
 */
export function verifyWebhook(req) {
  const salt = process.env.HITPAY_WEBHOOK_SALT;
  if (!salt) {
    logger.error('[hitpay] HITPAY_WEBHOOK_SALT not configured');
    return null;
  }
  const body = req?.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.hmac !== 'string') {
    logger.error('[hitpay] webhook body missing or unsigned (no hmac field)');
    return null;
  }
  const { hmac, ...fields } = body;
  const concatenated = Object.keys(fields)
    .sort()
    .map((k) => `${k}${fields[k] ?? ''}`)
    .join('');
  const expected = crypto.createHmac('sha256', salt).update(concatenated).digest('hex');
  if (!timingSafeHexEq(hmac, expected)) {
    logger.warn('[hitpay] webhook signature mismatch');
    return null;
  }
  return fields;
}

export default { createPaymentRequest, verifyWebhook };
