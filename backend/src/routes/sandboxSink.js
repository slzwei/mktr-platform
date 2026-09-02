import express from 'express';
import crypto from 'crypto';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { tagAuthGate } from './routeGates.js';
import { logger } from '../utils/logger.js';
import { isSandbox } from '../utils/deployEnv.js';

/**
 * Sandbox-only signed webhook sink (docs/plans/mktr-production-sandbox.md §8).
 *
 * It is the sandbox's ONE delivery destination, and it exists to exercise MKTR's
 * own outbox end to end: transactional persistence, commit-before-flush, HMAC
 * construction, the replay window, retry/backoff, subscriber auto-disable, and
 * the fail-closed `no_subscriber` path. It has no credential and no network
 * route to production Lyfe.
 *
 * It deliberately does NOT emulate Lyfe receiver semantics (agent lookup,
 * receiver-side idempotency, receiver-specific 4xx handling) — the plan calls for
 * a separate pass against Lyfe staging if those are needed.
 *
 * `SANDBOX_SINK_MODE` (or the admin toggle below) switches the response between
 * success, a retryable 503 and a terminal 400 so the retry ladder and the
 * auto-disable path can both be demonstrated.
 */

const router = express.Router();

const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const MAX_EVIDENCE = 50;

/** Ring buffer of minimal, synthetic delivery evidence. Never persisted. */
const evidence = [];
const seenDeliveries = new Map(); // deliveryId → first-seen timestamp

let modeOverride = null;
const mode = () => modeOverride || (process.env.SANDBOX_SINK_MODE || 'success').toLowerCase();

function verifySignature({ rawBody, signature, timestamp, secret }) {
  if (!signature || !secret) return { ok: false, reason: 'missing_signature' };
  const candidates = [
    crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex'), // v2
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex'), // v1 legacy
  ];
  const presented = String(signature).replace(/^sha256=/, '');
  const presentedBuf = Buffer.from(presented);
  for (const expected of candidates) {
    const expectedBuf = Buffer.from(expected);
    if (expectedBuf.length === presentedBuf.length && crypto.timingSafeEqual(expectedBuf, presentedBuf)) {
      return { ok: true, version: expected === candidates[0] ? 'v2' : 'v1' };
    }
  }
  return { ok: false, reason: 'bad_signature' };
}

router.post('/webhook-sink', (req, res) => {
  if (!isSandbox()) return res.status(404).json({ success: false, message: 'Not found.' });

  const secret = process.env.SANDBOX_WEBHOOK_SINK_SECRET;
  const signature = req.get('x-webhook-signature');
  const timestamp = req.get('x-webhook-timestamp');
  const deliveryId = req.get('x-webhook-delivery-id');
  const event = req.get('x-webhook-event');
  const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});

  const verdict = verifySignature({ rawBody, signature, timestamp, secret });
  if (!verdict.ok) {
    logger.warn({ reason: verdict.reason, deliveryId, event }, 'sandbox_sink.rejected');
    return res.status(401).json({ success: false, message: 'Invalid signature.' });
  }

  // Replay window — the same bound the production receiver enforces.
  const skewMs = Math.abs(Date.now() - Number(timestamp || 0));
  if (!timestamp || !Number.isFinite(skewMs) || skewMs > REPLAY_WINDOW_MS) {
    logger.warn({ deliveryId, event, skewMs }, 'sandbox_sink.stale_timestamp');
    return res.status(401).json({ success: false, message: 'Timestamp outside the replay window.' });
  }

  const duplicate = deliveryId ? seenDeliveries.has(deliveryId) : false;
  if (deliveryId && !duplicate) seenDeliveries.set(deliveryId, Date.now());

  evidence.unshift({
    receivedAt: new Date().toISOString(),
    event,
    deliveryId,
    signatureVersion: verdict.version,
    duplicate,
    mode: mode(),
    // Synthetic-only shape evidence — never the payload itself.
    payloadKeys: Object.keys(req.body || {}),
    bodyBytes: rawBody.length,
  });
  evidence.length = Math.min(evidence.length, MAX_EVIDENCE);

  logger.info({ event, deliveryId, duplicate, mode: mode(), signatureVersion: verdict.version }, 'sandbox_sink.received');

  if (mode() === 'retryable') return res.status(503).json({ success: false, message: 'Sandbox sink: simulated retryable failure.' });
  if (mode() === 'terminal') return res.status(400).json({ success: false, message: 'Sandbox sink: simulated terminal failure.' });
  return res.status(200).json({ success: true, duplicate });
});

router.get('/webhook-sink/deliveries', tagAuthGate(authenticateToken), tagAuthGate(requireAdmin), (req, res) => {
  res.json({ success: true, data: { mode: mode(), count: evidence.length, deliveries: evidence } });
});

router.post('/webhook-sink/mode', tagAuthGate(authenticateToken), tagAuthGate(requireAdmin), (req, res) => {
  const next = String(req.body?.mode || '').toLowerCase();
  if (!['success', 'retryable', 'terminal'].includes(next)) {
    return res.status(400).json({ success: false, message: 'mode must be success | retryable | terminal' });
  }
  modeOverride = next;
  logger.warn({ mode: next }, 'sandbox_sink.mode_changed');
  res.json({ success: true, data: { mode: next } });
});

export const meta = {
  path: '/api/sandbox',
  flag: 'SANDBOX_WEBHOOK_SINK_ENABLED',
  flagDefault: 'false',
  // The sink verifies the outbox HMAC INSIDE the handler (it is a webhook
  // receiver, not a session surface) and additionally 404s outside a sandbox
  // deployment. The two admin endpoints below it are authenticateToken+requireAdmin.
  public: ['POST /webhook-sink'],
};

export default router;
