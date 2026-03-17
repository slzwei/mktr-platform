import { asyncHandler } from '../middleware/errorHandler.js';
import * as vehicleService from '../services/vehicleService.js';

export const listVehicles = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const result = await vehicleService.listVehicles(page, limit);

    res.json({ success: true, data: result.data, pagination: result.pagination });
});

export const createVehicle = asyncHandler(async (req, res) => {
    const vehicle = await vehicleService.createVehicle(req.body.carplate);

    res.status(201).json({ success: true, data: vehicle });
});

export const getVehicle = asyncHandler(async (req, res) => {
    const vehicle = await vehicleService.getVehicle(req.params.id);

    res.json({ success: true, data: vehicle });
});

export const pairDevices = asyncHandler(async (req, res) => {
    const vehicle = await vehicleService.pairDevices(req.params.id, req.body);

    res.json({ success: true, data: vehicle });
});

export const unpairDevices = asyncHandler(async (req, res) => {
    await vehicleService.unpairDevices(req.params.id);

    res.json({ success: true, message: 'Devices unpaired' });
});

export const updateVehicle = asyncHandler(async (req, res) => {
    const vehicle = await vehicleService.updateVehicle(req.params.id, req.body);

    res.json({ success: true, data: vehicle });
});

export const setVolume = asyncHandler(async (req, res) => {
    const vol = await vehicleService.setVolume(req.params.id, req.body.volume);

    res.json({ success: true, message: `Volume set to ${vol}%` });
});

export const deleteVehicle = asyncHandler(async (req, res) => {
    await vehicleService.deleteVehicle(req.params.id);

    res.json({ success: true, message: 'Vehicle deleted' });
});
