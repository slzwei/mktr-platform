import express from 'express';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { authenticateDevice, guardFlags } from '../middleware/deviceAuth.js';
import { incCounter, logEvent, timeMs } from '../services/observability.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load schema file path (for ETag consistency and future validation)
const schemaPath = path.join(__dirname, '../schemas/manifest_v1.json');

function computeEtagFromJson(jsonObj) {
  const s = JSON.stringify(jsonObj);
  const hash = crypto.createHash('sha256').update(s).digest('hex');
  return `W/"${hash}"`;
}

function buildManifestForDevice(device) {
  // Placeholder minimal manifest. Real content will be added in later PRs.
  const refreshSec = parseInt(process.env.MANIFEST_REFRESH_SECONDS || '300');
  return {
    version: 1,
    device_id: device.id,
    refresh_seconds: refreshSec,
    assets: [],
    playlist: []
  };
}

// GET /api/adtech/v1/manifest
const manifestLimiter = rateLimit({
  windowMs: 1000,
  limit: parseInt(process.env.MANIFEST_RPS_PER_DEVICE || '2'),
  keyGenerator: (req) => (req.device?.id || req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.set('Retry-After', '1');
    return res.status(429).json({ success: false, message: 'Too Many Requests' });
  }
});

router.get('/v1/manifest', guardFlags('MANIFEST_ENABLED'), authenticateDevice, manifestLimiter, async (req, res) => {
  const started = Date.now();
  const manifest = buildManifestForDevice(req.device);
  const etag = computeEtagFromJson(manifest);
  res.set('ETag', etag);
  res.set('Cache-Control', 'private, max-age=0, must-revalidate');

  const inm = req.headers['if-none-match'];
  if (inm && inm === etag) {
    incCounter('manifest_not_modified_count');
    logEvent('manifest_304', { device_id: req.device.id });
    return res.status(304).end();
  }

  incCounter('manifest_200_count');
  logEvent('manifest_200', { device_id: req.device.id, latency_ms: timeMs(started) });
  return res.status(200).json({ success: true, data: manifest });
});

export default router;


