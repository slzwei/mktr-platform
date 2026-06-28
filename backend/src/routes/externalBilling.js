/**
 * MKTR Leads buyer app → lead-package PURCHASE (HitPay checkout).
 *
 * Mounted at `/api/external/billing`. The four agent-facing actions are HMAC-SHA256
 * over the raw body (EXTERNAL_APP_SECRET); `/hitpay-webhook` is authed by HitPay's own
 * signature inside the handler. rawBody capture + the rate-limiter exemption for the
 * `/api/external/` prefix are wired in server_internal.js (same as the other external surfaces).
 *
 * Gated behind BILLING_ENABLED so the route stays UNMOUNTED until HitPay + the broker are
 * provisioned (deploy-inert). The route auto-loader (routes/index.js) only mounts modules
 * exporting BOTH `meta` and a default router.
 */
import express from 'express';
import {
  requireExternalHmac,
  catalog,
  checkout,
  status,
  history,
  hitpayWebhook,
} from '../controllers/externalBillingController.js';

const router = express.Router();

export const meta = {
  path: '/api/external/billing',
  flag: 'BILLING_ENABLED',
  flagDefault: 'false',
};

// Agent-facing (broker, HMAC). POST so the body carries the signed `timestamp`.
router.post('/catalog', requireExternalHmac, catalog);
router.post('/checkout', requireExternalHmac, checkout);
router.post('/status', requireExternalHmac, status);
router.post('/history', requireExternalHmac, history);

// HitPay settlement — authed by HitPay's signature inside the handler (NOT EXTERNAL_APP_SECRET).
router.post('/hitpay-webhook', hitpayWebhook);

export default router;
