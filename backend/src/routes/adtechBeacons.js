import express from 'express';
import { authenticateDevice } from '../middleware/deviceAuth.js';
import { pushService } from '../services/pushService.js';
import { Impression, Device, Campaign } from '../models/index.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Strict rate limiting for analytics ingress
const beaconLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 60, // 1 request per second max per IP/Device
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/adtech/v1/beacons/heartbeat
// Lightweight ping to update "Last Seen" and Status
router.post('/v1/beacons/heartbeat', authenticateDevice, beaconLimiter, async (req, res) => {
  try {
    const { status, batteryLevel, storageUsed } = req.body;

    // 1. Update device metadata
    const updates = { lastSeenAt: new Date() };

    // ANTI-ZOMBIE FIX 2.0:
    // We only want to block heartbeats that are delayed packets from a RECENT disconnect (Zombies).
    // But we MUST ALLOW heartbeats from "Fresh Starts" where the Heartbeat arrives before the SSE connection (Race Condition).

    // Check 1: Is it fully connected?
    const isConnected = pushService && pushService.clients && pushService.clients.has(req.device.id);

    // Check 2: Was it recently disconnected? (Zombie Indicator)
    const isZombie = !isConnected && pushService && pushService.disconnectHistory && pushService.disconnectHistory.has(req.device.id);

    if (isConnected || !isZombie) {
      // Allowed: active connection OR fresh start (no disconnect history)
      updates.status = status || 'active';
    } else {
      // Blocked: Not connected AND in disconnect history -> Zombie Packet.
      if (status) console.warn(`[Heartbeat] Zombie heartbeat from ${req.device.id}. DB Status Update Blocked (History found).`);
    }

    await req.device.update(updates);

    // 2. Log immutable event for debugging
    // FMEA Mitigation: We perform this write async/await but could fire-and-forget if perf becomes an issue.
    // For now, we await it to ensure data integrity.

    // OPTIMIZATION: Do not persist "Keep-Alive" heartbeats to DB to save space.
    // Only persist if there is a distinct state change or error (future).
    // For now, simple heartbeats are purely for 'lastSeenAt' and live stream.
    // await import('../models/index.js').then(({ BeaconEvent }) => {
    //   const payload = {
    //     batteryLevel,
    //     storageUsed,
    //     status
    //   };
    //
    //   // Broadcast to live observers
    //   if (global.pushService) { // Accessed via global for simplicity or imported
    //     // Check import method
    //   }
    //
    //   return BeaconEvent.create({
    //     deviceId: req.device.id,
    //     type: 'HEARTBEAT',
    //     eventHash: `HB-${Date.now()}`,
    //     payload
    //   });
    // });

    // Broadcast (Imported service)
    pushService.broadcastLog(req.device.id, {
      type: 'HEARTBEAT',
      createdAt: new Date(),
      payload: { status, batteryLevel, storageUsed }
    });

    // CRITICAL: Ensure status changes (e.g. Inactive -> Active) are reflected in real-time
    // The SSE connection (addClient) handles 'standby', but the Heartbeat handles 'playing'/'idle'.
    if (status) {
      // ANTI-ZOMBIE: Only broadcast/update status if SSE or Fresh Start.
      // Logic mirrors the DB update above.
      const isConnected = pushService && pushService.clients && pushService.clients.has(req.device.id);
      const isZombie = !isConnected && pushService && pushService.disconnectHistory && pushService.disconnectHistory.has(req.device.id);

      if (isConnected || !isZombie) {
        // PushService broadcast handles the "send only if observers exist" logic internally mostly,
        // but updateDeviceStatus updates memory cache.
        pushService.broadcastStatusChange(req.device.id, status);
        pushService.updateDeviceStatus(req.device.id, status);
      } else {
        console.warn(`[Heartbeat] Zombie heartbeat from ${req.device.id} (Status: ${status}). Ignoring broadcast because SSE is disconnected & history found.`);
      }
    }

    res.json({ success: true, timestamp: Date.now() });
  } catch (err) {
    console.error('[Heartbeat] Error:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// POST /api/adtech/v1/beacons/impressions
// Batch ingestion of ad views
router.post('/v1/beacons/impressions', authenticateDevice, beaconLimiter, async (req, res) => {
  try {
    const { impressions } = req.body; // Expects array: [{ adId, campaignId, durationMs, occurredAt }]

    if (!Array.isArray(impressions) || impressions.length === 0) {
      return res.status(400).json({ success: false, message: 'No impressions provided' });
    }

    // Validate and map data
    // We trust the device timestamp but cap it to not be in the future
    const now = new Date();
    const validImpressions = impressions.map(imp => ({
      deviceId: req.device.id,
      campaignId: imp.campaignId || req.device.campaignId, // Fallback to current if missing
      adId: imp.adId,
      mediaType: imp.mediaType || 'unknown',
      durationMs: imp.durationMs || 0,
      occurredAt: imp.occurredAt ? new Date(imp.occurredAt) : now
    }));

    // Bulk insert
    await Impression.bulkCreate(validImpressions);

    // Also touch heartbeat & Update Status to PLAYING (Proof of Life)
    await req.device.update({
      lastSeenAt: new Date(),
      status: 'playing'
    });

    // Log the batch event for visibility
    await import('../models/index.js').then(({ BeaconEvent }) => {
      return BeaconEvent.create({
        deviceId: req.device.id,
        type: 'IMPRESSIONS',
        eventHash: `IMP-${Date.now()}-${validImpressions.length}`,
        payload: {
          count: validImpressions.length,
          source: 'batch_upload',
          timestamp: Date.now()
        }
      });
    });

    // Broadcast (Imported service)
    // FORCE STATUS UPDATE: If we are receiving impressions, the device is definitely PLAYING.
    // This fixes the "Stuck in READY" issue if the specific Heartbeat packet was missed or generic.
    pushService.updateDeviceStatus(req.device.id, 'playing');
    pushService.broadcastStatusChange(req.device.id, 'playing');

    pushService.broadcastLog(req.device.id, {
      type: 'IMPRESSIONS',
      createdAt: new Date(),
      payload: {
        count: validImpressions.length,
        source: 'live_stream'
      }
    });

    // 🚀 RESTORED: Broadcast granular PLAYBACK events for "Real-Time" feel
    // Fetch campaign names for context
    try {
      const uniqueCampaignIds = [...new Set(validImpressions.map(i => i.campaignId))].filter(Boolean);
      let campaignMap = {};

      if (uniqueCampaignIds.length > 0) {
        const campaigns = await Campaign.findAll({
          where: { id: uniqueCampaignIds },
          attributes: ['id', 'name']
        });
        campaignMap = campaigns.reduce((acc, c) => {
          acc[c.id] = c.name;
          return acc;
        }, {});
      }

      validImpressions.forEach(imp => {
        pushService.broadcastLog(req.device.id, {
          type: 'PLAYBACK',
          // Use the actual occurrence time so order is correct-ish
          createdAt: imp.occurredAt,
          payload: {
            assetId: imp.adId,
            campaignName: campaignMap[imp.campaignId] || 'Unknown Campaign',
            durationMs: imp.durationMs
          }
        });
      });
    } catch (err) {
      console.error('[Impressions] Failed to broadcast playback events', err);
    }

    res.json({ success: true, count: validImpressions.length });
  } catch (err) {
    console.error('[Impressions] Error:', err);
    res.status(500).json({ success: false, message: 'Ingestion Error' });
  }
});

export default router;
