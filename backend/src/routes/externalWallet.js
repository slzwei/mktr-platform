/**
 * MKTR Leads agent app → wallet (balance, ledger, catalog, commit).
 *
 * Mounted at `/api/external/wallet`, HMAC-SHA256 over the raw body
 * (EXTERNAL_APP_SECRET) like the other external surfaces; rawBody capture +
 * the rate-limiter exemption for `/api/external/` are wired in
 * server_internal.js. Gated behind AGENT_WALLET_ENABLED so the route stays
 * UNMOUNTED until the wallet goes live (deploy-inert). Top-ups are NOT here —
 * they ride /api/external/billing (kind:'wallet_topup') for HitPay settlement.
 * There is deliberately no cancel endpoint (no self-cancel of commitments).
 */
import express from 'express';
import {
  requireExternalHmac,
  summary,
  ledger,
  catalog,
  commitHandler,
} from '../controllers/externalWalletController.js';

const router = express.Router();

export const meta = {
  path: '/api/external/wallet',
  flag: 'AGENT_WALLET_ENABLED',
  flagDefault: 'false',
};

// POST so the body carries the signed `timestamp` (same as external billing).
router.post('/summary', requireExternalHmac, summary);
router.post('/ledger', requireExternalHmac, ledger);
router.post('/catalog', requireExternalHmac, catalog);
router.post('/commit', requireExternalHmac, commitHandler);

export default router;
