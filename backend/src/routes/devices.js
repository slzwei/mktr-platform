import express from 'express';
import { Device, Campaign, BeaconEvent, Impression } from '../models/index.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Middleware: All routes require Admin access
router.use(authenticateToken, requireAdmin);

// GET /api/devices - List all devices
// GET /api/devices - List all devices
router.get('/', async (req, res) => {
    try {
        const devices = await Device.findAll({
            order: [['lastSeenAt', 'DESC']]
        });

        // Hydrate campaigns manually since Sequelize association is complex with JSON arrays
        // We will fetch all relevant campaigns in one go and map them
        const allCampaignIds = new Set();
        devices.forEach(d => {
            if (d.campaignIds && Array.isArray(d.campaignIds)) {
                d.campaignIds.forEach(id => allCampaignIds.add(id));
            }
            // Legacy fallback
            if (d.campaignId) allCampaignIds.add(d.campaignId);
        });

        const campaigns = await Campaign.findAll({
            where: {
                id: Array.from(allCampaignIds)
            },
            attributes: ['id', 'name', 'status', 'type']
        });

        const campaignMap = new Map(campaigns.map(c => [c.id, c]));

        // Attach mapped campaigns to devices
        const devicesWithCampaigns = devices.map(d => {
            const deviceJson = d.toJSON();

            // Build list of assigned campaigns
            const assignedIds = [];
            if (d.campaignIds && Array.isArray(d.campaignIds)) {
                assignedIds.push(...d.campaignIds);
            } else if (d.campaignId) {
                // Fallback for non-migrated rows
                assignedIds.push(d.campaignId);
            }

            deviceJson.campaigns = assignedIds
                .map(id => campaignMap.get(id))
                .filter(Boolean); // Filter out nulls if campaign deleted

            // Legacy single-object support for old frontend (optional, maybe just return array)
            // But we will return 'campaigns' array now. 
            // The frontend expects 'campaign' object in the old code. We will leave 'campaign' undefined or null
            // and let the frontend adapt to 'campaigns' array.

            return deviceJson;
        });

        res.json({
            success: true,
            data: devicesWithCampaigns
        });
    } catch (error) {
        console.error('Error fetching devices:', error);
        res.status(500).json({ message: 'Error fetching devices' });
    }
});

// GET /api/devices/:id - Get single device details
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const device = await Device.findByPk(id);

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        res.json({
            success: true,
            data: device
        });
    } catch (error) {
        console.error('Error fetching device:', error);
        res.status(500).json({ message: 'Error fetching device' });
    }
});

// GET /api/devices/:id/logs - Get device logs/events (Merged History)
router.get('/:id/logs', async (req, res) => {
    try {
        const { id } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;

        // Guardrails: Cap max history to prevent memory explosion
        // We fetch (page * limit) from BOTH tables to ensure correct interleaving
        // So page 10 (500 items) means fetching 500 + 500 = 1000 items, merging, sorting, then slicing.
        if (page > 20) {
            return res.status(400).json({ message: 'Log history depth exceeded. Please filter by date (future feature).' });
        }

        const device = await Device.findByPk(id);
        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const fetchLimit = page * limit;

        // 1. Fetch Standard Logs (BeaconEvents)
        const beaconLogsPromise = BeaconEvent.findAll({
            where: { deviceId: id },
            order: [['createdAt', 'DESC']],
            limit: fetchLimit
        });

        // 2. Fetch Playback Logs (Impressions)
        const impressionsPromise = Impression.findAll({
            where: { deviceId: id },
            order: [['occurredAt', 'DESC']],
            limit: fetchLimit,
            include: [{
                model: Campaign,
                as: 'campaign',
                attributes: ['name']
            }]
        });

        const [beaconLogs, impressions] = await Promise.all([beaconLogsPromise, impressionsPromise]);

        // 3. Transform Impressions to "Log" format
        const playbackLogs = impressions.map(imp => ({
            id: `imp_${imp.id}`,
            type: 'PLAYBACK', // Special type for frontend
            createdAt: imp.occurredAt,
            deviceId: imp.deviceId,
            payload: {
                assetId: imp.adId,
                mediaType: imp.mediaType,
                durationMs: imp.durationMs,
                campaignId: imp.campaignId,
                campaignName: imp.campaign?.name || 'Unknown Campaign'
            }
        }));

        // 4. Merge
        const allLogs = [...beaconLogs.map(l => l.toJSON()), ...playbackLogs];

        // 5. Sort Descending
        allLogs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // 6. Paginate (Slice)
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedLogs = allLogs.slice(startIndex, endIndex);

        res.json({
            success: true,
            data: paginatedLogs,
            pagination: {
                page,
                limit,
                // Approximate total since we are not doing a full COUNT(*) on both tables for speed
                // We just say "plenty more" if we hit the limit, otherwise (page * limit) + remaining
                total: (page * limit) + (allLogs.length > fetchLimit ? 100 : 0),
                pages: 20 // Hard cap visualization
            }
        });
    } catch (error) {
        console.error('Error fetching device logs:', error);
        res.status(500).json({ message: 'Error fetching device logs' });
    }
});

// PATCH /api/devices/:id - Update device (Assign Campaign)
router.patch('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { campaignIds, status } = req.body; // Expecting array of IDs

        const device = await Device.findByPk(id);
        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        // Validation: Check if campaigns exist and are PHV type
        if (campaignIds && Array.isArray(campaignIds) && campaignIds.length > 0) {
            const campaigns = await Campaign.findAll({
                where: {
                    id: campaignIds
                }
            });

            if (campaigns.length !== campaignIds.length) {
                return res.status(400).json({ message: 'One or more campaigns not found' });
            }

            // Enforce Rule: All must be PHV (brand_awareness)
            const invalidType = campaigns.find(c => c.type !== 'brand_awareness');
            if (invalidType) {
                return res.status(400).json({
                    message: `Campaign "${invalidType.name}" is not a PHV campaign. Only PHV campaigns can be assigned to tablets.`
                });
            }

            // Enforce Usage Rule: All MUST have media
            const emptyMedia = campaigns.find(c => !c.ad_playlist || !Array.isArray(c.ad_playlist) || c.ad_playlist.length === 0);
            if (emptyMedia) {
                return res.status(400).json({
                    message: `Campaign "${emptyMedia.name}" has no media. All assigned campaigns must have media content.`
                });
            }
        }

        // Whitelist updates
        const updates = {};
        if (campaignIds !== undefined) {
            updates.campaignIds = campaignIds; // Save as JSON array
            // Clear legacy field to avoid confusion
            updates.campaignId = null;
        }
        if (status !== undefined) updates.status = status;

        await device.update(updates);

        // [PUSH] Trigger Real-time Manifest Refresh
        if (campaignIds !== undefined) {
            // Dynamically import to avoid circular dependency issues if any, though regular import is fine here
            const { pushService } = await import('../services/pushService.js');
            pushService.sendEvent(id, 'REFRESH_MANIFEST', {
                timestamp: Date.now(),
                reason: 'campaign_assignment'
            });
        }

        // Fetch fresh names for response
        const finalCampaignIds = updates.campaignIds || device.campaignIds || [];
        const finalCampaigns = await Campaign.findAll({
            where: { id: finalCampaignIds },
            attributes: ['id', 'name']
        });

        const deviceJson = device.toJSON();
        deviceJson.campaigns = finalCampaigns;

        res.json({
            success: true,
            data: deviceJson
        });
    } catch (error) {
        console.error('Error updating device:', error);
        res.status(500).json({ message: 'Error updating device' });
    }
});

export default router;
