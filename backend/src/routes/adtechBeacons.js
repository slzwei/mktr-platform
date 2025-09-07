import express from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { authenticateDevice, guardFlags } from '../middleware/deviceAuth.js';
import { BeaconEvent, IdempotencyKey } from '../models/index.js';
import { incCounter, logEvent, timeMs } from '../services/observability.js';

const router = express.Router();

function perDeviceLimiter(envKey, defaultRps) {
  const rps = parseInt(process.env[envKey] || String(defaultRps));
  return rateLimit({
    windowMs: 1000,
    limit: rps,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.device?.id || req.ip),
    handler: (req, res) => {
      res.set('Retry-After', '1');
      return res.status(429).json({ success: false, message: 'Too Many Requests' });
    }
  });
}

async function withIdempotency(req, res, scope, ttlSeconds, handler) {
  const key = req.headers['idempotency-key'];
  if (!key) {
    const resp = await handler();
    return res.status(resp.code).json(resp.body);
  }
  const deviceId = req.device?.id || null;
  const now = Date.now();
  const expiresAt = new Date(now + (ttlSeconds * 1000));
  const existing = await IdempotencyKey.findByPk(key);
  if (existing && existing.expiresAt > new Date()) {
    const code = existing.responseCode || 200;
    return res.status(code).json(existing.responseBody || { success: true });
  }
  const response = await handler();
  try {
    await IdempotencyKey.upsert({ key, scope, deviceId, responseBody: response.body, responseCode: response.code, expiresAt });
  } catch (_) {}
  return res.status(response.code).json(response.body);
}

function hashEvent(deviceId, type, payload) {
  const s = JSON.stringify({ deviceId, type, payload });
  return crypto.createHash('sha256').update(s).digest('hex');
}

// POST /api/adtech/v1/beacons/heartbeat
router.post('/v1/beacons/heartbeat', guardFlags('BEACONS_ENABLED'), authenticateDevice, perDeviceLimiter('BEACON_RPS_PER_DEVICE', 2), async (req, res, next) => {
  const scope = 'beacon:heartbeat';
  const ttl = (parseInt(process.env.BEACON_IDEMP_WINDOW_MIN || '10') * 60);
  return withIdempotency(req, res, scope, ttl, async () => {
    const started = Date.now();
    const device = req.device;
    const payload = { ts: new Date().toISOString(), ...req.body };
    const eventHash = hashEvent(device.id, 'heartbeat', payload);
    const windowStart = new Date(Date.now() - (parseInt(process.env.BEACON_IDEMP_WINDOW_MIN || '10') * 60 * 1000));
    const recent = await BeaconEvent.findOne({ where: { deviceId: device.id, type: 'heartbeat', eventHash }, order: [['createdAt', 'DESC']] });
    if (recent && recent.createdAt > windowStart) {
      incCounter('beacon_heartbeat_deduped_total');
      return { code: 200, body: { success: true, deduped: true } };
    }
    await BeaconEvent.create({ deviceId: device.id, type: 'heartbeat', eventHash, payload });
    await device.update({ lastSeenAt: new Date() });
    incCounter('beacon_heartbeat_count');
    logEvent('beacon_heartbeat', { device_id: device.id, latency_ms: timeMs(started) });
    return { code: 200, body: { success: true } };
  });
});

// POST /api/adtech/v1/beacons/impressions
router.post('/v1/beacons/impressions', guardFlags('BEACONS_ENABLED'), authenticateDevice, perDeviceLimiter('BEACON_RPS_PER_DEVICE', 5), async (req, res, next) => {
  const scope = 'beacon:impressions';
  const ttl = (parseInt(process.env.BEACON_IDEMP_WINDOW_MIN || '10') * 60);
  return withIdempotency(req, res, scope, ttl, async () => {
    const started = Date.now();
    const device = req.device;
    const body = req.body;
    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0) {
      return { code: 400, body: { success: false, message: 'items[] required' } };
    }
    let deduped = 0;
    const windowStart = new Date(Date.now() - (parseInt(process.env.BEACON_IDEMP_WINDOW_MIN || '10') * 60 * 1000));
    for (const it of items) {
      const payload = { ...it };
      const eventHash = hashEvent(device.id, 'impression', payload);
      const recent = await BeaconEvent.findOne({ where: { deviceId: device.id, type: 'impression', eventHash }, order: [['createdAt', 'DESC']] });
      if (recent && recent.createdAt > windowStart) { deduped++; continue; }
      await BeaconEvent.create({ deviceId: device.id, type: 'impression', eventHash, payload });
    }
    incCounter('beacon_impressions_count', items.length - deduped);
    incCounter('beacon_impressions_deduped_total', deduped);
    logEvent('beacon_impressions', { device_id: device.id, count: items.length, deduped_total: deduped, latency_ms: timeMs(started) });
    return { code: 200, body: { success: true, deduped_total: deduped } };
  });
});

export default router;


