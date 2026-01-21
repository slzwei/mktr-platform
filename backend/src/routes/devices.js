import express from 'express';
import { Device, Campaign } from '../models/index.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Middleware: All routes require Admin access
router.use(authenticateToken, requireAdmin);

// GET /api/devices - List all devices
router.get('/', async (req, res) => {
    try {
        const devices = await Device.findAll({
            order: [['lastSeenAt', 'DESC']],
            include: [
                {
                    model: Campaign,
                    as: 'campaign',
                    attributes: ['id', 'name', 'status']
                }
            ]
        });
        res.json(devices);
    } catch (error) {
        console.error('Error fetching devices:', error);
        res.status(500).json({ message: 'Error fetching devices' });
    }
});

// PATCH /api/devices/:id - Update device (Assign Campaign)
router.patch('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { campaignId, status, notes } = req.body;

        const device = await Device.findByPk(id);
        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        // Validation: Check if campaign exists if being assigned
        if (campaignId) {
            const campaign = await Campaign.findByPk(campaignId);
            if (!campaign) {
                return res.status(400).json({ message: 'Campaign not found' });
            }
        }

        // Whitelist updates: Only allow specific fields
        const updates = {};
        if (campaignId !== undefined) updates.campaignId = campaignId; // Allow null to unassign
        if (status !== undefined) updates.status = status;
        // Notes field doesn't exist on schema yet, ignoring for now or added if needed.
        // Assuming schema only has campaignId and status from previous steps.

        await device.update(updates);

        // Reload to return fresh data including campaign
        await device.reload({
            include: [{ model: Campaign, as: 'campaign', attributes: ['id', 'name'] }]
        });

        res.json(device);
    } catch (error) {
        console.error('Error updating device:', error);
        res.status(500).json({ message: 'Error updating device' });
    }
});

export default router;
