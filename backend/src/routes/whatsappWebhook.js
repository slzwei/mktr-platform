import express from 'express';
import waWebhookService from '../services/redeemOps/waWebhookService.js';
import { logger } from '../utils/logger.js';

/**
 * Meta WhatsApp Cloud API webhook (docs/plans/wa-delivery-truth.md §B).
 *
 * PUBLIC, signature-authenticated — no bearer auth (Meta sends none). The
 * global express.json verify captures req.rawBody for /api/whatsapp/ paths
 * (server_internal.js) so X-Hub-Signature-256 (HMAC-SHA256 of the raw bytes
 * with the MKTR_wa app secret) can be verified; the path also rides the
 * limiter's server-to-server exemption — the HMAC check IS the rate gate
 * (cheap reject before any processing).
 *
 * Security posture in production: WHATSAPP_APP_SECRET unset → answer 200 but
 * process NOTHING (fail closed — receipt statuses and STOP suppressions must
 * never be forgeable; the WABA repoint is gated on the secret being present
 * anyway). Invalid signature → 401. Outside production the check relaxes to
 * whatever is configured so unit tests and local tinkering can exercise the
 * pipeline without Meta.
 *
 * 200 is sent ONLY after the inbox upsert commits (Meta's retry is the
 * durability story: transient DB failure → 500 → Meta redelivers, and every
 * write in the processor is idempotent).
 */
export const meta = { path: '/api/whatsapp' };

const router = express.Router();

router.get('/webhook', (req, res) => {
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (
    req.query['hub.mode'] === 'subscribe'
    && expected
    && req.query['hub.verify_token'] === expected
  ) {
    return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
  }
  return res.sendStatus(403);
});

router.post('/webhook', async (req, res) => {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const isProd = process.env.NODE_ENV === 'production';

  if (!secret) {
    if (isProd) {
      logger.warn('redeem_ops.wa.webhook_unverifiable', { reason: 'WHATSAPP_APP_SECRET unset — payload dropped' });
      return res.sendStatus(200);
    }
    // Non-prod without a secret: process unverified (local/test pipeline).
  } else if (!waWebhookService.verifySignature(req.rawBody, req.get('x-hub-signature-256'), secret)) {
    logger.warn('redeem_ops.wa.webhook_bad_signature', {});
    return res.sendStatus(401);
  }

  try {
    const counts = await waWebhookService.processPayload(req.body);
    if (counts.statuses || counts.stops || counts.unmatchedForeign || counts.skippedEntries) {
      logger.info('redeem_ops.wa.webhook_processed', counts);
    }
    return res.sendStatus(200);
  } catch (err) {
    logger.error('redeem_ops.wa.webhook_persist_failed', { error: err?.message });
    return res.sendStatus(500);
  }
});

export default router;
