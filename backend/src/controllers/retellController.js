import { asyncHandler } from '../middleware/errorHandler.js';
import { verifyRetellSignature, processRetellCall, getRecordingUrl } from '../services/retellService.js';
import { logger } from '../utils/logger.js';

/**
 * POST /api/retell/webhook
 *
 * Receives Retell AI post-call webhooks.
 * Verifies HMAC signature, filters for successful calls,
 * and creates a Prospect in MKTR.
 *
 * Retell sends: { event: "call_ended", call: { call_id, ... } }
 * Signature format: x-retell-signature: v=<timestamp>,d=<hmac>
 */
export const handleWebhook = asyncHandler(async (req, res) => {
  // -- Signature verification --
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
    logger.warn('[Retell] Signature verification failed', { ip: req.ip });
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // -- Extract call data --
  const payload = req.body;

  // Log raw payload keys so we can diagnose format changes
  logger.info('[Retell] Webhook received', {
    event: payload.event,
    topLevelKeys: Object.keys(payload),
    hasCall: !!payload.call,
    hasData: !!payload.data
  });

  // Retell wraps as { event, call: {...} } or sends flat call object
  const callData = payload.call || payload.data || payload;
  const callId = callData.call_id || payload.call_id;

  if (!callId) {
    logger.warn('[Retell] Missing call_id in payload', { topLevelKeys: Object.keys(payload) });
    return res.status(400).json({ error: 'Missing call_id' });
  }

  // Event type rides alongside the unwrapped call: the screening branch acts
  // on call_ended vs call_analyzed differently (verdicts live on analyzed).
  const result = await processRetellCall(callData, { event: payload.event || null });

  logger.info('[Retell] Webhook result', { call_id: callId, ...result });

  return res.status(200).json({
    success: true,
    ...result
  });
});

/**
 * GET /api/retell/recording/:prospectId
 *
 * Returns the Retell call recording URL for a prospect.
 * First checks sourceMetadata, then fetches from Retell API if missing.
 */
export const fetchRecordingUrl = asyncHandler(async (req, res) => {
  const result = await getRecordingUrl(req.params.prospectId);
  return res.json(result);
});
