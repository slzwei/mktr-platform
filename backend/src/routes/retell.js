import { Router } from 'express';
import { verifyRetellSignature, processRetellCall } from '../services/retellService.js';
import { authenticateToken } from '../middleware/auth.js';
import { Prospect } from '../models/index.js';
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

/**
 * GET /api/retell/recording/:prospectId
 *
 * Returns the Retell call recording URL for a prospect.
 * First checks sourceMetadata, then fetches from Retell API if missing.
 */
router.get('/recording/:prospectId', authenticateToken, async (req, res) => {
  try {
    const prospect = await Prospect.findByPk(req.params.prospectId);
    if (!prospect) return res.status(404).json({ error: 'Prospect not found' });

    const meta = prospect.sourceMetadata || {};
    if (!meta.retellCallId) {
      return res.status(404).json({ error: 'Not a Retell prospect' });
    }

    // Return stored URL if available
    if (meta.recordingUrl) {
      return res.json({ recordingUrl: meta.recordingUrl });
    }

    // Fetch from Retell API
    const apiKey = process.env.RETELL_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Retell API not configured' });
    }

    const response = await fetch(`https://api.retellai.com/v2/get-call/${meta.retellCallId}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });

    if (!response.ok) {
      return res.status(404).json({ error: 'Call not found in Retell' });
    }

    const call = await response.json();
    const recordingUrl = call.recording_url || null;

    // Cache it in sourceMetadata for next time
    if (recordingUrl) {
      await prospect.update({
        sourceMetadata: { ...meta, recordingUrl }
      });
    }

    return res.json({ recordingUrl });
  } catch (err) {
    logger.error('[Retell] Recording fetch error', { error: err.message });
    return res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
