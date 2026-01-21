import express from 'express';
import { Device, Campaign, BeaconEvent } from '../models/index.js';
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

// GET /api/devices/:id/logs ... (Unchanged)
// ...

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
