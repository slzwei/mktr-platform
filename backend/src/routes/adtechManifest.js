import express from 'express';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { authenticateDevice, guardFlags } from '../middleware/deviceAuth.js';
import { incCounter, logEvent, timeMs } from '../services/observability.js';
import { Campaign } from '../models/index.js';

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
    assets: [
      {
        id: "asset_001",
        url: "https://picsum.photos/seed/ad1/1920/1080", // Random reliable image
        sha256: "mock_hash_1", // We'll skip real hash checks for now in the client or mock them
        size_bytes: 1024
      },
      {
        id: "asset_002",
        url: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4", // Reliable Google sample video
        sha256: "mock_hash_2",
        size_bytes: 1024
      }
    ],
    playlist: [
      {
        id: "pl_001",
        asset_id: "asset_001",
        duration_ms: 10000,
        type: "image"
      },
      {
        id: "pl_002",
        asset_id: "asset_002",
        duration_ms: 15000,
        type: "video"
      }
    ]
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
    const limit = parseInt(process.env.MANIFEST_RPS_PER_DEVICE || '2');
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', '0');
    res.set('RateLimit-Reset', '1');
    res.set('Retry-After', '1');
    return res.status(429).json({ success: false, message: 'Too Many Requests' });
  }
});

router.get('/v1/manifest', guardFlags('MANIFEST_ENABLED'), authenticateDevice, manifestLimiter, async (req, res) => {
  const started = Date.now();

  // Reload device with Campaign data (since middleware might not fetch relations)
  const device = await req.device.reload({
    include: [{ model: Campaign, as: 'campaign' }]
  });

  // [HEARTBEAT] Update lastSeenAt (async, don't block response)
  device.update({ lastSeenAt: new Date() }).catch(err =>
    console.error(`[Manifest] Failed to update heartbeat for ${device.id}`, err)
  );

  // [LOG] Log this fetch as a visible event for debugging
  const { BeaconEvent } = await import('../models/index.js');
  BeaconEvent.create({
    deviceId: device.id,
    type: 'HEARTBEAT', // We categorize manifest fetch as a heartbeat for visibility
    payload: {
      source: 'manifest_fetch',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }
  }).catch(err => console.error('[Manifest] Failed to log event', err));

  const refreshSec = parseInt(process.env.MANIFEST_REFRESH_SECONDS || '300');
  const baseManifest = {
    version: 1,
    device_id: device.id,
    refresh_seconds: refreshSec,
    assets: [],
    playlist: []
  };

  if (device.campaign && device.campaign.ad_playlist) {
    // Logic to extract unique assets from the playlist
    const playlist = device.campaign.ad_playlist; // Assumed structure: [{ type, url, duration, id }]

    // 1. Build Playlist linked to Assets
    // We assume the DB 'ad_playlist' stores the URL directly.
    // We need to deduplicate URLs to create the 'assets' list.
    const uniqueAssets = new Map();

    const manifestPlaylist = playlist.map((item, index) => {
      const assetId = `asset_${crypto.createHash('md5').update(item.url).digest('hex').substring(0, 8)}`;

      if (!uniqueAssets.has(assetId)) {
        uniqueAssets.set(assetId, {
          id: assetId,
          url: item.url,
          sha256: "skip_check", // TODO: Real hash
          size_bytes: 0        // TODO: Real size
        });
      }

      return {
        id: `pl_${index}`,
        asset_id: assetId,
        duration_ms: (item.duration || 10) * 1000,
        type: item.type
      };
    });

    baseManifest.assets = Array.from(uniqueAssets.values());
    baseManifest.playlist = manifestPlaylist;
  } else {
    // Fallback/Default: Show a 'Wait for Assignment' placeholder or empty
    // For now, we return empty so the screen stays blank or shows default logo
  }

  const etag = computeEtagFromJson(baseManifest);
  res.set('ETag', etag);
  res.set('Cache-Control', 'private, max-age=0, must-revalidate');

  const limit = parseInt(process.env.MANIFEST_RPS_PER_DEVICE || '2');
  res.set('RateLimit-Limit', String(limit));

  const inm = req.headers['if-none-match'];
  if (inm && inm === etag) {
    incCounter('manifest_not_modified_count');
    logEvent('manifest_304', { device_id: device.id });
    return res.status(304).end();
  }

  incCounter('manifest_200_count');
  logEvent('manifest_200', { device_id: device.id, latency_ms: timeMs(started) });
  return res.status(200).json(baseManifest);
});

export default router;


