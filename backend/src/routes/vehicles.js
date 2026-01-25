import express from 'express';
import crypto from 'crypto';
import { Device, Vehicle, Campaign } from '../models/index.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { pushService } from '../services/pushService.js';

const router = express.Router();

// Middleware: All routes require Admin access
router.use(authenticateToken, requireAdmin);

// GET /api/vehicles - List all vehicles with device status
router.get('/', async (req, res) => {
    try {
        const vehicles = await Vehicle.findAll({
            include: [
                { model: Device, as: 'masterDevice', attributes: ['id', 'model', 'status', 'lastSeenAt'] },
                { model: Device, as: 'slaveDevice', attributes: ['id', 'model', 'status', 'lastSeenAt'] }
            ],
            order: [['createdAt', 'DESC']]
        });

        // Hydrate campaign names
        const allCampaignIds = new Set();
        vehicles.forEach(v => {
            if (v.campaignIds && Array.isArray(v.campaignIds)) {
                v.campaignIds.forEach(id => allCampaignIds.add(id));
            }
        });

        const campaigns = await Campaign.findAll({
            where: { id: Array.from(allCampaignIds) },
            attributes: ['id', 'name', 'status']
        });
        const campaignMap = new Map(campaigns.map(c => [c.id, c]));

        const vehiclesWithCampaigns = vehicles.map(v => {
            const vJson = v.toJSON();
            vJson.campaigns = (v.campaignIds || [])
                .map(id => campaignMap.get(id))
                .filter(Boolean);
            return vJson;
        });

        res.json({ success: true, data: vehiclesWithCampaigns });
    } catch (error) {
        console.error('Error fetching vehicles:', error);
        res.status(500).json({ message: 'Error fetching vehicles' });
    }
});

// POST /api/vehicles - Create a new vehicle
router.post('/', async (req, res) => {
    try {
        const { carplate } = req.body;

        if (!carplate) {
            return res.status(400).json({ message: 'Carplate is required' });
        }

        // Generate hotspot credentials
        const hotspotSsid = `MKTR-${carplate.replace(/\s/g, '').toUpperCase()}`;
        const hotspotPassword = crypto.randomBytes(8).toString('hex');

        const vehicle = await Vehicle.create({
            carplate: carplate.toUpperCase(),
            hotspotSsid,
            hotspotPassword
        });

        res.status(201).json({ success: true, data: vehicle });
    } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({ message: 'Carplate already exists' });
        }
        console.error('Error creating vehicle:', error);
        res.status(500).json({ message: 'Error creating vehicle' });
    }
});

// GET /api/vehicles/:id - Get single vehicle
router.get('/:id', async (req, res) => {
    try {
        const vehicle = await Vehicle.findByPk(req.params.id, {
            include: [
                { model: Device, as: 'masterDevice' },
                { model: Device, as: 'slaveDevice' }
            ]
        });

        if (!vehicle) {
            return res.status(404).json({ message: 'Vehicle not found' });
        }

        res.json({ success: true, data: vehicle });
    } catch (error) {
        console.error('Error fetching vehicle:', error);
        res.status(500).json({ message: 'Error fetching vehicle' });
    }
});

// PUT /api/vehicles/:id/pair - Pair devices to vehicle
router.put('/:id/pair', async (req, res) => {
    try {
        const { masterDeviceId, slaveDeviceId } = req.body;
        const vehicle = await Vehicle.findByPk(req.params.id);

        if (!vehicle) {
            return res.status(404).json({ message: 'Vehicle not found' });
        }

        // Validate devices exist and aren't already paired
        if (masterDeviceId) {
            const master = await Device.findByPk(masterDeviceId);
            if (!master) {
                return res.status(400).json({ message: 'Master device not found' });
            }
            if (master.vehicleId && master.vehicleId !== vehicle.id) {
                return res.status(400).json({ message: 'Master device already paired to another vehicle' });
            }
        }

        if (slaveDeviceId) {
            const slave = await Device.findByPk(slaveDeviceId);
            if (!slave) {
                return res.status(400).json({ message: 'Slave device not found' });
            }
            if (slave.vehicleId && slave.vehicleId !== vehicle.id) {
                return res.status(400).json({ message: 'Slave device already paired to another vehicle' });
            }
        }

        // Update vehicle
        await vehicle.update({
            masterDeviceId: masterDeviceId || vehicle.masterDeviceId,
            slaveDeviceId: slaveDeviceId || vehicle.slaveDeviceId
        });

        // Update devices with role and vehicleId
        if (masterDeviceId) {
            await Device.update(
                { vehicleId: vehicle.id, role: 'master' },
                { where: { id: masterDeviceId } }
            );
        }

        if (slaveDeviceId) {
            await Device.update(
                { vehicleId: vehicle.id, role: 'slave' },
                { where: { id: slaveDeviceId } }
            );
        }

        // Trigger manifest refresh for both devices
        if (masterDeviceId) {
            pushService.sendEvent(masterDeviceId, 'REFRESH_MANIFEST', {});
        }
        if (slaveDeviceId) {
            pushService.sendEvent(slaveDeviceId, 'REFRESH_MANIFEST', {});
        }

        // Reload with devices
        await vehicle.reload({
            include: [
                { model: Device, as: 'masterDevice' },
                { model: Device, as: 'slaveDevice' }
            ]
        });

        res.json({ success: true, data: vehicle });
    } catch (error) {
        console.error('Error pairing devices:', error);
        res.status(500).json({ message: 'Error pairing devices' });
    }
});

// DELETE /api/vehicles/:id/pair - Unpair devices from vehicle
router.delete('/:id/pair', async (req, res) => {
    try {
        const vehicle = await Vehicle.findByPk(req.params.id);

        if (!vehicle) {
            return res.status(404).json({ message: 'Vehicle not found' });
        }

        // Clear device associations
        if (vehicle.masterDeviceId) {
            await Device.update(
                { vehicleId: null, role: null },
                { where: { id: vehicle.masterDeviceId } }
            );
        }

        if (vehicle.slaveDeviceId) {
            await Device.update(
                { vehicleId: null, role: null },
                { where: { id: vehicle.slaveDeviceId } }
            );
        }

        // Trigger refresh for both
        if (vehicle.masterDeviceId) {
            pushService.sendEvent(vehicle.masterDeviceId, 'REFRESH_MANIFEST', {});
        }
        if (vehicle.slaveDeviceId) {
            pushService.sendEvent(vehicle.slaveDeviceId, 'REFRESH_MANIFEST', {});
        }

        await vehicle.update({
            masterDeviceId: null,
            slaveDeviceId: null
        });

        res.json({ success: true, message: 'Devices unpaired' });
    } catch (error) {
        console.error('Error unpairing devices:', error);
        res.status(500).json({ message: 'Error unpairing devices' });
    }
});

// PATCH /api/vehicles/:id - Update vehicle (assign campaigns)
router.patch('/:id', async (req, res) => {
    try {
        const { campaignIds, carplate, status } = req.body;
        const vehicle = await Vehicle.findByPk(req.params.id);

        if (!vehicle) {
            return res.status(404).json({ message: 'Vehicle not found' });
        }

        const updates = {};

        if (campaignIds !== undefined) {
            // Validate campaigns exist
            if (campaignIds.length > 0) {
                const campaigns = await Campaign.findAll({
                    where: { id: campaignIds }
                });
                if (campaigns.length !== campaignIds.length) {
                    return res.status(400).json({ message: 'Some campaigns not found' });
                }
            }
            updates.campaignIds = campaignIds;
        }

        if (carplate) {
            updates.carplate = carplate.toUpperCase();
            updates.hotspotSsid = `MKTR-${carplate.replace(/\s/g, '').toUpperCase()}`;
        }

        if (status) {
            updates.status = status;
        }

        await vehicle.update(updates);

        // Trigger manifest refresh for both devices
        if (vehicle.masterDeviceId) {
            pushService.sendEvent(vehicle.masterDeviceId, 'REFRESH_MANIFEST', {});
        }
        if (vehicle.slaveDeviceId) {
            pushService.sendEvent(vehicle.slaveDeviceId, 'REFRESH_MANIFEST', {});
        }

        // Reload with campaigns
        const updatedVehicle = await Vehicle.findByPk(vehicle.id, {
            include: [
                { model: Device, as: 'masterDevice' },
                { model: Device, as: 'slaveDevice' }
            ]
        });

        // Hydrate campaign names
        if (updatedVehicle.campaignIds?.length) {
            const campaigns = await Campaign.findAll({
                where: { id: updatedVehicle.campaignIds },
                attributes: ['id', 'name', 'status']
            });
            updatedVehicle.dataValues.campaigns = campaigns;
        }

        res.json({ success: true, data: updatedVehicle });
    } catch (error) {
        console.error('Error updating vehicle:', error);
        res.status(500).json({ message: 'Error updating vehicle' });
    }
});

// DELETE /api/vehicles/:id - Delete vehicle
router.delete('/:id', async (req, res) => {
    try {
        const vehicle = await Vehicle.findByPk(req.params.id);

        if (!vehicle) {
            return res.status(404).json({ message: 'Vehicle not found' });
        }

        // Unpair devices first
        if (vehicle.masterDeviceId) {
            await Device.update(
                { vehicleId: null, role: null },
                { where: { id: vehicle.masterDeviceId } }
            );
        }
        if (vehicle.slaveDeviceId) {
            await Device.update(
                { vehicleId: null, role: null },
                { where: { id: vehicle.slaveDeviceId } }
            );
        }

        await vehicle.destroy();

        res.json({ success: true, message: 'Vehicle deleted' });
    } catch (error) {
        console.error('Error deleting vehicle:', error);
        res.status(500).json({ message: 'Error deleting vehicle' });
    }
});

export default router;
