import express from 'express';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { authenticateDevice, guardFlags } from '../middleware/deviceAuth.js';
import { incCounter, logEvent, timeMs } from '../services/observability.js';
import { Campaign } from '../models/index.js';
import { pushService } from '../services/pushService.js';

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
  limit: parseInt(process.env.MANIFEST_RPS_PER_DEVICE || '10'),
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

  // Reload device data (fresh from DB to get latest campaignIds)
  await req.device.reload();
  const device = req.device;

  // [HEARTBEAT] Update lastSeenAt (async, don't block response)
  device.update({ lastSeenAt: new Date() }).catch(err =>
    console.error(`[Manifest] Failed to update heartbeat for ${device.id}`, err)
  );

  // [LOG] Log this fetch as a visible event for debugging
  const { BeaconEvent } = await import('../models/index.js');
  const payload = {
    source: 'manifest_fetch',
    ip: req.ip,
    userAgent: req.headers['user-agent']
  };
  const eventHash = crypto.createHash('sha256')
    .update(JSON.stringify(payload) + Date.now().toString())
    .digest('hex');

  BeaconEvent.create({
    deviceId: device.id,
    type: 'HEARTBEAT',
    eventHash: eventHash,
    payload: payload
  }).catch(err => console.error('[Manifest] Failed to log event', err));

  // Broadcast Live Event
  pushService.broadcastLog(device.id, {
    type: 'HEARTBEAT',
    createdAt: new Date(),
    payload: payload
  });

  // Broadcast Live Event
  if (global.pushService) { // Or imported
    // Safe guard
  }
  // Try dynamic import or assuming top-level import?
  // Let's add top level import.

  // Actually, let's just use the imported service.
  // Assumption: I will add import in next tool call.
  /* 
  pushService.broadcastLog(device.id, {
    type: 'HEARTBEAT',
    createdAt: new Date(),
    payload: payload
  });
  */
  // Doing it in one replacement if possible or splitting.
  // Let's simplify.


  const refreshSec = parseInt(process.env.MANIFEST_REFRESH_SECONDS || '300');
  // Fetch Vehicle if not already loaded (for credentials)
  let wifiCreds = {};
  if (device.vehicleId) {
    // Only import if needed to save perf? We likely need it for credentials anyway.
    // If we haven't loaded it above (we check campaignIds above), we might need to load it here.
    // Let's ensure we have the vehicle object.
    try {
      const { Vehicle } = await import('../models/index.js');
      const vehicle = await Vehicle.findByPk(device.vehicleId);
      if (vehicle) {
        wifiCreds = {
          ssid: vehicle.hotspotSsid,
          password: vehicle.hotspotPassword
        };
      }
    } catch (e) {
      console.error('[Manifest] Failed to load vehicle details:', e);
    }
  }

  const baseManifest = {
    version: 1,
    device_id: device.id,
    refresh_seconds: refreshSec,
    assets: [],
    playlist: [],
    // New Config Fields for Sync
    role: device.role || 'standalone', // master, slave, standalone
    vehicle_id: device.vehicleId || null,
    vehicle_wifi: wifiCreds // { ssid, password }
  };

  // Logic to fetch multiple campaigns
  let assignedCampaigns = [];
  let campaignIds = device.campaignIds || []; // JSON array of UUIDs

  // Backward compatibility: If campaignIds is empty but legacy campaignId exists
  if (campaignIds.length === 0 && device.campaignId) {
    campaignIds.push(device.campaignId);
  }

  // Vehicle-level campaign inheritance (for paired devices)
  // If device is paired to a vehicle, use vehicle's campaigns instead
  if (device.vehicleId && campaignIds.length === 0) {
    try {
      const { Vehicle } = await import('../models/index.js');
      const vehicle = await Vehicle.findByPk(device.vehicleId);
      if (vehicle && vehicle.campaignIds && vehicle.campaignIds.length > 0) {
        campaignIds = vehicle.campaignIds;
        console.log(`[Manifest] Using vehicle ${vehicle.carplate} campaigns for device ${device.id}`);
      }
    } catch (e) {
      console.error('[Manifest] Failed to load vehicle campaigns:', e);
    }
  }

  if (campaignIds.length > 0) {
    assignedCampaigns = await Campaign.findAll({
      where: {
        id: campaignIds,
        status: 'active', // Only show active campaigns
        // [FIX] REMOVED strict `type: 'brand_awareness'` filter.
        // We now allow ALL active campaigns (including PHV/LeadGen) to be delivered to the tablet.
        // type: 'brand_awareness' 
      }
    });
  }

  if (assignedCampaigns.length > 0) {
    // Collect all playlist items from all campaigns
    // We simply concatenate them in the order of campaigns returned (usually sorted by ID or creation if not specified)
    // To respect assignment order, we should map based on campaignIds index, but findAll doesn't guarantee order.
    // For now, simple concatenation is sufficient.

    // Sort campaigns by the order they appear in campaignIds for consistent playback order
    assignedCampaigns.sort((a, b) => {
      return campaignIds.indexOf(a.id) - campaignIds.indexOf(b.id);
    });

    const combinedPlaylist = [];
    assignedCampaigns.forEach(c => {
      if (c.ad_playlist && Array.isArray(c.ad_playlist)) {
        // Inject campaign_id into each item so we can track it
        const itemsWithCampaign = c.ad_playlist.map(item => {
          // [SAFETY] Skip items without URL to prevent manifest generation crashes
          if (!item.url) return null;

          return {
            ...item,
            campaign_id: c.id
          };
        }).filter(Boolean); // Filter out nulls

        combinedPlaylist.push(...itemsWithCampaign);
      }
    });

    // 1. Build Playlist linked to Assets
    // We assume the DB 'ad_playlist' stores the URL directly.
    // We need to deduplicate URLs to create the 'assets' list.
    const uniqueAssets = new Map();

    const manifestPlaylist = combinedPlaylist.map((item, index) => {
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
        campaign_id: item.campaign_id,
        duration_ms: (item.duration > 1000) ? item.duration : (item.duration || 10) * 1000,
        type: item.type
      };
    });

    baseManifest.assets = Array.from(uniqueAssets.values());
    baseManifest.playlist = manifestPlaylist;

    // [SYNC] Calculate Cycle Duration for TQL (Time-Quantized Loop)
    const totalDurationMs = manifestPlaylist.reduce((acc, item) => acc + (item.duration_ms || 0), 0);

    // We quantize the loop to the nearest 60 seconds.
    const QUANTUM_MS = 60000;
    const cycleDurationMs = Math.ceil(totalDurationMs / QUANTUM_MS) * QUANTUM_MS;
    const finalCycleDuration = Math.max(cycleDurationMs, QUANTUM_MS); // Default to 60s if empty

    baseManifest.sync_config = {
      enabled: true, // Enabled Phase-Locked Continuous Sync
      mode: "QUANTIZED_WALL_CLOCK",
      cycle_duration_ms: finalCycleDuration,
      anchor_epoch_ms: 0
    };
  } else {
    // Fallback/Default: Show a 'Wait for Assignment' placeholder or empty
    // Even with empty playlist, we can send sync config (though it won't do much without content)
    baseManifest.sync_config = {
      enabled: true,
      mode: "QUANTIZED_WALL_CLOCK",
      cycle_duration_ms: 60000,
      anchor_epoch_ms: 0
    };
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


