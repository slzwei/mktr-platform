import { Router } from 'express';
import { verifyRetellSignature, processRetellCall } from '../services/retellService.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * POST /api/retell/webhook
 *
 * Receives Retell AI post-call webhooks.
 * Verifies HMAC signature, filters for successful calls,
 * and creates a Prospect in MKTR.
 *
 * The raw body is attached by the rawBodyCapture middleware
 * registered in server_internal.js.
 */
router.post('/webhook', async (req, res) => {
  try {
    // ── Signature verification ──
    const secret = process.env.RETELL_WEBHOOK_SECRET;
    if (!secret) {
      logger.warn('[Retell] RETELL_WEBHOOK_SECRET not configured, rejecting webhook');
      return res.status(503).json({ error: 'Retell integration not configured' });
    }

    const signature = req.headers['x-retell-signature'];
    const rawBody = req.rawBody;

    if (!rawBody || !signature) {
      return res.status(401).json({ error: 'Missing signature' });
    }

    if (!verifyRetellSignature(rawBody, signature)) {
      logger.warn('[Retell] Invalid webhook signature', {
        ip: req.ip
      });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // ── Process the call ──
    const payload = req.body;

    if (!payload.call_id) {
      return res.status(400).json({ error: 'Missing call_id' });
    }

    const result = await processRetellCall(payload);

    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (err) {
    logger.error('[Retell] Webhook processing error', {
      error: err.message,
      call_id: req.body?.call_id
    });
    return res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
