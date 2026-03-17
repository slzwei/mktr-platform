import crypto from 'crypto';
import { Device, Vehicle, Campaign, sequelize, DeviceCampaignAssignment, VehicleCampaignAssignment } from '../models/index.js';
import { pushService } from './pushService.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

/**
 * List vehicles with device status and hydrated campaign names (reads from join table).
 */
export async function listVehicles(page = 1, limit = 50) {
    const offset = (page - 1) * limit;
    const { count, rows: vehicles } = await Vehicle.findAndCountAll({
        include: [
            { model: Device, as: 'masterDevice', attributes: ['id', 'model', 'status', 'lastSeenAt'] },
            { model: Device, as: 'slaveDevice', attributes: ['id', 'model', 'status', 'lastSeenAt'] },
            {
                association: 'assignedCampaigns',
                attributes: ['id', 'name', 'status'],
                through: { attributes: ['sortOrder'] }
            }
        ],
        order: [['createdAt', 'DESC']],
        limit,
        offset,
        distinct: true
    });

    const data = vehicles.map(v => {
        const vJson = v.toJSON();

        // Sort by join-table sortOrder and strip the through metadata
        const sorted = (vJson.assignedCampaigns || [])
            .sort((a, b) => (a.VehicleCampaignAssignment?.sortOrder ?? 0) - (b.VehicleCampaignAssignment?.sortOrder ?? 0));

        vJson.campaigns = sorted.map(c => ({
            id: c.id,
            name: c.name,
            status: c.status
        }));

        // Keep campaignIds in the response for backward compat
        vJson.campaignIds = sorted.map(c => c.id);

        delete vJson.assignedCampaigns;
        return vJson;
    });

    return {
        data,
        pagination: {
            currentPage: page,
            totalPages: Math.ceil(count / limit),
            totalItems: count,
            itemsPerPage: limit
        }
    };
}

/**
 * Create a new vehicle with auto-generated hotspot credentials.
 */
export async function createVehicle(carplate) {
    if (!carplate) {
        throw new AppError('Carplate is required', 400);
    }

    const hotspotSsid = `MKTR-${carplate.replace(/\s/g, '').toUpperCase()}`;
    const hotspotPassword = crypto.randomBytes(8).toString('hex');

    try {
        return await Vehicle.create({
            carplate: carplate.toUpperCase(),
            hotspotSsid,
            hotspotPassword
        });
    } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') {
            throw new AppError('Carplate already exists', 409);
        }
        throw error;
    }
}

/**
 * Get a single vehicle by ID with device associations.
 */
export async function getVehicle(id) {
    const vehicle = await Vehicle.findByPk(id, {
        include: [
            { model: Device, as: 'masterDevice' },
            { model: Device, as: 'slaveDevice' }
        ]
    });

    if (!vehicle) {
        throw new AppError('Vehicle not found', 404);
    }

    return vehicle;
}

/**
 * Pair devices to a vehicle using an atomic transaction.
 * Fires REFRESH_MANIFEST push events for old and new devices after commit.
 */
export async function pairDevices(vehicleId, { masterDeviceId, slaveDeviceId }) {
    const vehicle = await Vehicle.findByPk(vehicleId);

    if (!vehicle) {
        throw new AppError('Vehicle not found', 404);
    }

    // Validate devices exist and aren't already paired elsewhere
    if (masterDeviceId) {
        const master = await Device.findByPk(masterDeviceId);
        if (!master) {
            throw new AppError('Master device not found', 400);
        }
        if (master.vehicleId && master.vehicleId !== vehicle.id) {
            throw new AppError('Master device already paired to another vehicle', 400);
        }
    }

    if (slaveDeviceId) {
        const slave = await Device.findByPk(slaveDeviceId);
        if (!slave) {
            throw new AppError('Slave device not found', 400);
        }
        if (slave.vehicleId && slave.vehicleId !== vehicle.id) {
            throw new AppError('Slave device already paired to another vehicle', 400);
        }
    }

    // Capture old device IDs for side effects
    const oldMasterId = vehicle.masterDeviceId;
    const oldSlaveId = vehicle.slaveDeviceId;

    // Atomic transaction (dual-write: clear both JSON column and join table)
    await sequelize.transaction(async (t) => {
        // Unpair old master if replaced
        if (masterDeviceId && oldMasterId && oldMasterId !== masterDeviceId) {
            logger.info('Unpairing old master device', { deviceId: oldMasterId });
            await Device.update(
                { vehicleId: null, role: null, campaignIds: [], campaignId: null },
                { where: { id: oldMasterId }, transaction: t }
            );
            await DeviceCampaignAssignment.destroy({ where: { deviceId: oldMasterId }, transaction: t });
        }

        // Unpair old slave if replaced
        if (slaveDeviceId && oldSlaveId && oldSlaveId !== slaveDeviceId) {
            logger.info('Unpairing old slave device', { deviceId: oldSlaveId });
            await Device.update(
                { vehicleId: null, role: null, campaignIds: [], campaignId: null },
                { where: { id: oldSlaveId }, transaction: t }
            );
            await DeviceCampaignAssignment.destroy({ where: { deviceId: oldSlaveId }, transaction: t });
        }

        // Update vehicle
        await vehicle.update({
            masterDeviceId: masterDeviceId || oldMasterId,
            slaveDeviceId: slaveDeviceId || oldSlaveId
        }, { transaction: t });

        // Update new master
        if (masterDeviceId) {
            await Device.update(
                {
                    vehicleId: vehicle.id,
                    role: 'master',
                    campaignIds: [],
                    campaignId: null
                },
                { where: { id: masterDeviceId }, transaction: t }
            );
            await DeviceCampaignAssignment.destroy({ where: { deviceId: masterDeviceId }, transaction: t });
        }

        // Update new slave
        if (slaveDeviceId) {
            await Device.update(
                {
                    vehicleId: vehicle.id,
                    role: 'slave',
                    campaignIds: [],
                    campaignId: null
                },
                { where: { id: slaveDeviceId }, transaction: t }
            );
            await DeviceCampaignAssignment.destroy({ where: { deviceId: slaveDeviceId }, transaction: t });
        }
    });

    // --- Side effects (after commit) ---

    // Refresh OLD replaced devices (stop playing)
    if (masterDeviceId && oldMasterId && oldMasterId !== masterDeviceId) {
        pushService.sendEvent(oldMasterId, 'REFRESH_MANIFEST', {});
    }
    if (slaveDeviceId && oldSlaveId && oldSlaveId !== slaveDeviceId) {
        pushService.sendEvent(oldSlaveId, 'REFRESH_MANIFEST', {});
    }

    // Refresh NEW assigned devices (start playing)
    if (masterDeviceId) pushService.sendEvent(masterDeviceId, 'REFRESH_MANIFEST', {});
    if (slaveDeviceId) pushService.sendEvent(slaveDeviceId, 'REFRESH_MANIFEST', {});

    // Reload with device associations
    await vehicle.reload({
        include: [
            { model: Device, as: 'masterDevice' },
            { model: Device, as: 'slaveDevice' }
        ]
    });

    return vehicle;
}

/**
 * Unpair all devices from a vehicle.
 * Fires REFRESH_MANIFEST push events for unpaired devices.
 */
export async function unpairDevices(vehicleId) {
    const vehicle = await Vehicle.findByPk(vehicleId);

    if (!vehicle) {
        throw new AppError('Vehicle not found', 404);
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
}

/**
 * Update a vehicle (campaigns, carplate, status).
 * Fires REFRESH_MANIFEST push events for paired devices.
 *
 * Dual-write strategy: writes to both the JSON column (backward compat) and the
 * vehicle_campaign_assignments join table (new canonical source).
 */
export async function updateVehicle(vehicleId, { campaignIds, carplate, status }) {
    const vehicle = await Vehicle.findByPk(vehicleId);

    if (!vehicle) {
        throw new AppError('Vehicle not found', 404);
    }

    const updates = {};

    if (campaignIds !== undefined) {
        // Validate campaigns exist
        if (campaignIds.length > 0) {
            const campaigns = await Campaign.findAll({
                where: { id: campaignIds }
            });
            if (campaigns.length !== campaignIds.length) {
                throw new AppError('Some campaigns not found', 400);
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

    // Dual-write: sync join table when campaignIds change
    if (campaignIds !== undefined) {
        await VehicleCampaignAssignment.destroy({ where: { vehicleId } });
        if (campaignIds.length > 0) {
            const rows = campaignIds.map((cId, idx) => ({
                vehicleId,
                campaignId: cId,
                sortOrder: idx
            }));
            await VehicleCampaignAssignment.bulkCreate(rows, { ignoreDuplicates: true });
        }
    }

    // Trigger manifest refresh for both devices
    if (vehicle.masterDeviceId) {
        pushService.sendEvent(vehicle.masterDeviceId, 'REFRESH_MANIFEST', {});
    }
    if (vehicle.slaveDeviceId) {
        pushService.sendEvent(vehicle.slaveDeviceId, 'REFRESH_MANIFEST', {});
    }

    // Reload with associations
    const updatedVehicle = await Vehicle.findByPk(vehicle.id, {
        include: [
            { model: Device, as: 'masterDevice' },
            { model: Device, as: 'slaveDevice' },
            {
                association: 'assignedCampaigns',
                attributes: ['id', 'name', 'status'],
                through: { attributes: [] }
            }
        ]
    });

    // Map assignedCampaigns to the campaigns key for backward compat
    updatedVehicle.dataValues.campaigns = (updatedVehicle.assignedCampaigns || []).map(c => ({
        id: c.id,
        name: c.name,
        status: c.status
    }));

    return updatedVehicle;
}

/**
 * Set volume for a vehicle and push the new level to paired devices.
 */
export async function setVolume(vehicleId, volume) {
    const vehicle = await Vehicle.findByPk(vehicleId);

    if (!vehicle) {
        throw new AppError('Vehicle not found', 404);
    }

    const vol = parseInt(volume);
    if (isNaN(vol) || vol < 0 || vol > 100) {
        throw new AppError('Volume must be between 0 and 100', 400);
    }

    vehicle.volume = vol;
    await vehicle.save();

    // Send to master
    if (vehicle.masterDeviceId) {
        pushService.sendEvent(vehicle.masterDeviceId, 'SET_VOLUME', { volume: vol });
    }

    // Send to slave
    if (vehicle.slaveDeviceId) {
        pushService.sendEvent(vehicle.slaveDeviceId, 'SET_VOLUME', { volume: vol });
    }

    return vol;
}

/**
 * Delete a vehicle after unpairing its devices.
 */
export async function deleteVehicle(vehicleId) {
    const vehicle = await Vehicle.findByPk(vehicleId);

    if (!vehicle) {
        throw new AppError('Vehicle not found', 404);
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
}
