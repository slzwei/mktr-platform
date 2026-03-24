import { asyncHandler } from '../middleware/errorHandler.js';
import { verifyMetaSignature, processMetaLead } from '../services/metaLeadService.js';
import { logger } from '../utils/logger.js';

/**
 * GET /api/meta/webhook
 *
 * Meta webhook verification challenge.
 * Meta sends: ?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<challenge>
 * We must return the challenge value if the token matches.
 */
export const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.META_VERIFY_TOKEN;
  if (!verifyToken) {
    logger.warn('[Meta] META_VERIFY_TOKEN not configured, rejecting verification');
    return res.status(503).json({ error: 'Meta integration not configured' });
  }

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('[Meta] Webhook verification successful');
    return res.status(200).send(challenge);
  }

  logger.warn('[Meta] Webhook verification failed', { mode, tokenMatch: token === verifyToken });
  return res.status(403).json({ error: 'Verification failed' });
};

/**
 * POST /api/meta/webhook
 *
 * Receives Meta leadgen webhook events.
 * Verifies X-Hub-Signature-256, then processes each leadgen entry.
 *
 * Meta sends:
 * {
 *   object: "page",
 *   entry: [{
 *     id: "<page_id>",
 *     time: <unix_timestamp>,
 *     changes: [{
 *       field: "leadgen",
 *       value: { leadgen_id, page_id, form_id, created_time, ... }
 *     }]
 *   }]
 * }
 */
export const handleWebhook = asyncHandler(async (req, res) => {
  // -- Signature verification --
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    logger.warn('[Meta] META_APP_SECRET not configured, rejecting webhook');
    return res.status(503).json({ error: 'Meta integration not configured' });
  }

  const signature = req.headers['x-hub-signature-256'];
  const rawBody = req.rawBody;

  if (!rawBody || !signature) {
    return res.status(401).json({ error: 'Missing signature' });
  }

  if (!verifyMetaSignature(rawBody, signature)) {
    logger.warn('[Meta] Signature verification failed', { ip: req.ip });
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // -- Process payload --
  const payload = req.body;

  logger.info('[Meta] Webhook received', {
    object: payload.object,
    entryCount: payload.entry?.length || 0,
  });

  if (payload.object !== 'page') {
    logger.info('[Meta] Ignoring non-page object', { object: payload.object });
    return res.status(200).json({ success: true, status: 'ignored' });
  }

  // Process each leadgen entry
  const results = [];
  for (const entry of (payload.entry || [])) {
    for (const change of (entry.changes || [])) {
      if (change.field !== 'leadgen') continue;

      const { leadgen_id, page_id, form_id, created_time } = change.value || {};
      if (!leadgen_id) {
        logger.warn('[Meta] Missing leadgen_id in change', { entry_id: entry.id });
        continue;
      }

      const result = await processMetaLead(
        leadgen_id,
        page_id || entry.id,
        form_id,
        created_time || entry.time
      );
      results.push({ leadgen_id, ...result });
    }
  }

  logger.info('[Meta] Webhook processed', { resultCount: results.length });

  // Meta expects 200 — always return success to prevent retries
  return res.status(200).json({ success: true, results });
});
