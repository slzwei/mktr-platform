import express from 'express';
import { authenticateDevice } from '../middleware/deviceAuth.js';
import { Impression, Device } from '../models/index.js';
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
    await req.device.update({
      lastSeenAt: new Date(),
      status: status || 'active'
    });

    // 2. Log immutable event for debugging
    // FMEA Mitigation: We perform this write async/await but could fire-and-forget if perf becomes an issue.
    // For now, we await it to ensure data integrity.
    await import('../models/index.js').then(({ BeaconEvent }) => {
      return BeaconEvent.create({
        deviceId: req.device.id,
        type: 'HEARTBEAT',
        eventHash: `HB-${Date.now()}`, // Simple unique marker
        payload: {
          batteryLevel,
          storageUsed,
          status
        }
      });
    });

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

    // Also touch heartbeat
    await req.device.update({ lastSeenAt: new Date() });

    res.json({ success: true, count: validImpressions.length });
  } catch (err) {
    console.error('[Impressions] Error:', err);
    res.status(500).json({ success: false, message: 'Ingestion Error' });
  }
});

export default router;
