import { jest } from '@jest/globals';
import '../setup.js';

// ── Mock models ──

const Device = { findByPk: jest.fn(), update: jest.fn() };
const Vehicle = { findAndCountAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() };
const Campaign = { findAll: jest.fn() };
const DeviceCampaignAssignment = { destroy: jest.fn() };
const VehicleCampaignAssignment = { destroy: jest.fn(), bulkCreate: jest.fn() };

const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };
const sequelize = { transaction: jest.fn(async (cb) => cb(mockTransaction)) };

const pushService = { sendEvent: jest.fn() };

const AppError = class extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
};

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

jest.unstable_mockModule('../../src/models/index.js', () => ({
  Device, Vehicle, Campaign, DeviceCampaignAssignment, VehicleCampaignAssignment, sequelize,
}));
jest.unstable_mockModule('../../src/middleware/errorHandler.js', () => ({ AppError }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({ logger }));
jest.unstable_mockModule('../../src/services/pushService.js', () => ({ pushService }));

const mod = await import('../../src/services/vehicleService.js');
const { listVehicles, createVehicle, getVehicle, pairDevices, unpairDevices, updateVehicle, setVolume, deleteVehicle } = mod;

// ── Tests ──

describe('vehicleService (unit)', () => {
  let mockVehicle;

  beforeEach(() => {
    jest.clearAllMocks();

    mockVehicle = {
      id: 'veh-1',
      carplate: 'SBA1234A',
      masterDeviceId: 'dev-m1',
      slaveDeviceId: 'dev-s1',
      volume: 50,
      campaignIds: [],
      update: jest.fn().mockResolvedValue(true),
      save: jest.fn().mockResolvedValue(true),
      destroy: jest.fn().mockResolvedValue(true),
      reload: jest.fn().mockResolvedValue(true),
      toJSON() { return { ...this }; },
      dataValues: {},
      assignedCampaigns: [],
    };

    Vehicle.findByPk.mockResolvedValue(mockVehicle);
    Vehicle.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
    Vehicle.create.mockResolvedValue(mockVehicle);
    Device.findByPk.mockResolvedValue({ id: 'dev-m1', vehicleId: null, role: null });
    Device.update.mockResolvedValue([1]);
    Campaign.findAll.mockResolvedValue([]);
    DeviceCampaignAssignment.destroy.mockResolvedValue(0);
    VehicleCampaignAssignment.destroy.mockResolvedValue(0);
    VehicleCampaignAssignment.bulkCreate.mockResolvedValue([]);
  });

  // ── listVehicles ──

  describe('listVehicles', () => {
    it('returns paginated results with campaigns sorted by sortOrder', async () => {
      const v = {
        toJSON: () => ({
          id: 'v1',
          assignedCampaigns: [
            { id: 'c2', name: 'B', status: 'active', VehicleCampaignAssignment: { sortOrder: 1 } },
            { id: 'c1', name: 'A', status: 'active', VehicleCampaignAssignment: { sortOrder: 0 } },
          ],
        }),
      };
      Vehicle.findAndCountAll.mockResolvedValue({ count: 1, rows: [v] });

      const result = await listVehicles();

      expect(result.data[0].campaignIds).toEqual(['c1', 'c2']);
      expect(result.pagination.currentPage).toBe(1);
    });
  });

  // ── createVehicle ──

  describe('createVehicle', () => {
    it('creates vehicle with auto-generated hotspot credentials', async () => {
      await createVehicle('sba 1234a');

      expect(Vehicle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          carplate: 'SBA 1234A',
          hotspotSsid: 'MKTR-SBA1234A',
        })
      );
    });

    it('throws 400 when carplate is missing', async () => {
      await expect(createVehicle('')).rejects.toThrow('Carplate is required');
    });

    it('throws 409 for duplicate carplate', async () => {
      const err = new Error('unique');
      err.name = 'SequelizeUniqueConstraintError';
      Vehicle.create.mockRejectedValue(err);

      await expect(createVehicle('DUP123')).rejects.toThrow('Carplate already exists');
    });
  });

  // ── getVehicle ──

  describe('getVehicle', () => {
    it('returns vehicle with device associations', async () => {
      const result = await getVehicle('veh-1');
      expect(result).toBe(mockVehicle);
    });

    it('throws 404 when vehicle not found', async () => {
      Vehicle.findByPk.mockResolvedValue(null);

      await expect(getVehicle('nonexistent')).rejects.toThrow('Vehicle not found');
    });
  });

  // ── pairDevices ──

  describe('pairDevices', () => {
    it('throws 404 when vehicle not found', async () => {
      Vehicle.findByPk.mockResolvedValue(null);

      await expect(pairDevices('nonexistent', { masterDeviceId: 'dev-1' }))
        .rejects.toThrow('Vehicle not found');
    });

    it('throws 400 when master device not found', async () => {
      Device.findByPk.mockResolvedValue(null);

      await expect(pairDevices('veh-1', { masterDeviceId: 'bad-dev' }))
        .rejects.toThrow('Master device not found');
    });

    it('throws 400 when master device already paired to another vehicle', async () => {
      Device.findByPk.mockResolvedValue({ id: 'dev-m1', vehicleId: 'other-vehicle' });

      await expect(pairDevices('veh-1', { masterDeviceId: 'dev-m1' }))
        .rejects.toThrow('Master device already paired to another vehicle');
    });
  });

  // ── unpairDevices ──

  describe('unpairDevices', () => {
    it('clears both device associations and sends push events', async () => {
      await unpairDevices('veh-1');

      expect(Device.update).toHaveBeenCalledTimes(2);
      expect(pushService.sendEvent).toHaveBeenCalledWith('dev-m1', 'REFRESH_MANIFEST', {});
      expect(pushService.sendEvent).toHaveBeenCalledWith('dev-s1', 'REFRESH_MANIFEST', {});
      expect(mockVehicle.update).toHaveBeenCalledWith({ masterDeviceId: null, slaveDeviceId: null });
    });
  });

  // ── updateVehicle ──

  describe('updateVehicle', () => {
    it('dual-writes campaignIds to vehicle and join table', async () => {
      Campaign.findAll.mockResolvedValue([{ id: 'camp-1' }]);
      // Second findByPk call for reload
      Vehicle.findByPk
        .mockResolvedValueOnce(mockVehicle)
        .mockResolvedValueOnce({ ...mockVehicle, assignedCampaigns: [], dataValues: {} });

      await updateVehicle('veh-1', { campaignIds: ['camp-1'] });

      expect(mockVehicle.update).toHaveBeenCalledWith(expect.objectContaining({ campaignIds: ['camp-1'] }));
      expect(VehicleCampaignAssignment.destroy).toHaveBeenCalled();
      expect(VehicleCampaignAssignment.bulkCreate).toHaveBeenCalledWith(
        [{ vehicleId: 'veh-1', campaignId: 'camp-1', sortOrder: 0 }],
        { ignoreDuplicates: true }
      );
    });

    it('throws 400 when some campaigns not found', async () => {
      Campaign.findAll.mockResolvedValue([]);

      await expect(updateVehicle('veh-1', { campaignIds: ['bad'] }))
        .rejects.toThrow('Some campaigns not found');
    });
  });

  // ── setVolume ──

  describe('setVolume', () => {
    it('updates volume and pushes to both devices', async () => {
      const result = await setVolume('veh-1', 75);

      expect(result).toBe(75);
      expect(mockVehicle.save).toHaveBeenCalled();
      expect(pushService.sendEvent).toHaveBeenCalledWith('dev-m1', 'SET_VOLUME', { volume: 75 });
      expect(pushService.sendEvent).toHaveBeenCalledWith('dev-s1', 'SET_VOLUME', { volume: 75 });
    });

    it('throws 400 for volume out of range', async () => {
      await expect(setVolume('veh-1', 150)).rejects.toThrow('Volume must be between 0 and 100');
    });
  });

  // ── deleteVehicle ──

  describe('deleteVehicle', () => {
    it('unpairs devices and destroys vehicle', async () => {
      await deleteVehicle('veh-1');

      expect(Device.update).toHaveBeenCalledTimes(2);
      expect(mockVehicle.destroy).toHaveBeenCalled();
    });

    it('throws 404 when vehicle not found', async () => {
      Vehicle.findByPk.mockResolvedValue(null);

      await expect(deleteVehicle('nonexistent')).rejects.toThrow('Vehicle not found');
    });
  });
});
