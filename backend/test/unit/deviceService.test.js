import { jest } from '@jest/globals';
import '../setup.js';

// ── Mock models (set up once before import) ──

const Device = {
  findAndCountAll: jest.fn(),
  findByPk: jest.fn(),
};

const Campaign = {
  findAll: jest.fn(),
};

const BeaconEvent = {
  findAll: jest.fn(),
};

const Impression = {
  findAll: jest.fn(),
};

const DeviceCampaignAssignment = {
  destroy: jest.fn(),
  bulkCreate: jest.fn(),
};

const CampaignMediaItem = { name: 'CampaignMediaItem' };

const AppError = class extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
};

jest.unstable_mockModule('../../src/models/index.js', () => ({
  Device,
  Campaign,
  BeaconEvent,
  Impression,
  DeviceCampaignAssignment,
  CampaignMediaItem,
}));

jest.unstable_mockModule('../../src/middleware/errorHandler.js', () => ({
  AppError,
}));

const { listDevices, getDevice, getDeviceLogs, updateDevice } = await import('../../src/services/deviceService.js');

// ── Tests ──

describe('deviceService (unit)', () => {
  let mockDevice;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDevice = {
      id: 'dev-1',
      status: 'online',
      campaignIds: ['camp-1'],
      campaignId: null,
      lastSeenAt: new Date().toISOString(),
      toJSON() {
        return { ...this, assignedCampaigns: this.assignedCampaigns || [] };
      },
      update: jest.fn().mockResolvedValue(true),
      assignedCampaigns: [],
    };

    Device.findByPk.mockResolvedValue(mockDevice);
    Device.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
    Campaign.findAll.mockResolvedValue([{ id: 'camp-1', name: 'Test Campaign', status: 'active', type: 'lead_gen', mediaItems: [{ id: 'media-1' }] }]);
    BeaconEvent.findAll.mockResolvedValue([]);
    Impression.findAll.mockResolvedValue([]);
    DeviceCampaignAssignment.destroy.mockResolvedValue(1);
    DeviceCampaignAssignment.bulkCreate.mockResolvedValue([]);
  });

  // ── listDevices ──

  describe('listDevices', () => {
    it('returns paginated device list with default page/limit', async () => {
      const device = {
        toJSON: () => ({
          id: 'dev-1',
          assignedCampaigns: [
            { id: 'c1', name: 'C1', status: 'active', type: 'lead_gen', DeviceCampaignAssignment: { sortOrder: 0 } },
          ],
        }),
      };
      Device.findAndCountAll.mockResolvedValue({ count: 1, rows: [device] });

      const result = await listDevices();

      expect(Device.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50, offset: 0, distinct: true })
      );
      expect(result.pagination.currentPage).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].campaigns).toEqual([{ id: 'c1', name: 'C1', status: 'active', type: 'lead_gen' }]);
      expect(result.data[0].campaignIds).toEqual(['c1']);
    });

    it('applies correct offset for page 3', async () => {
      Device.findAndCountAll.mockResolvedValue({ count: 200, rows: [] });

      const result = await listDevices(3, 20);

      const arg = Device.findAndCountAll.mock.calls[0][0];
      expect(arg.offset).toBe(40);
      expect(arg.limit).toBe(20);
      expect(result.pagination.totalPages).toBe(10);
    });

    it('sorts assignedCampaigns by sortOrder', async () => {
      const device = {
        toJSON: () => ({
          id: 'dev-1',
          assignedCampaigns: [
            { id: 'c2', name: 'Second', status: 'active', type: 'x', DeviceCampaignAssignment: { sortOrder: 1 } },
            { id: 'c1', name: 'First', status: 'active', type: 'x', DeviceCampaignAssignment: { sortOrder: 0 } },
          ],
        }),
      };
      Device.findAndCountAll.mockResolvedValue({ count: 1, rows: [device] });

      const result = await listDevices();

      expect(result.data[0].campaignIds).toEqual(['c1', 'c2']);
    });
  });

  // ── getDevice ──

  describe('getDevice', () => {
    it('returns device when found', async () => {
      const result = await getDevice('dev-1');
      expect(result).toBe(mockDevice);
    });

    it('throws 404 when device not found', async () => {
      Device.findByPk.mockResolvedValue(null);

      await expect(getDevice('nonexistent')).rejects.toThrow('Device not found');
      try { await getDevice('nonexistent'); } catch (e) { expect(e.statusCode).toBe(404); }
    });
  });

  // ── getDeviceLogs ──

  describe('getDeviceLogs', () => {
    it('merges and sorts beacon events and impressions', async () => {
      const beaconLog = {
        toJSON: () => ({ id: 'b1', type: 'HEARTBEAT', createdAt: '2025-06-01T10:00:00Z', deviceId: 'dev-1' }),
      };
      const impression = {
        id: 'imp-1',
        occurredAt: '2025-06-01T10:05:00Z',
        deviceId: 'dev-1',
        adId: 'ad-1',
        mediaType: 'video',
        durationMs: 30000,
        campaignId: 'camp-1',
        campaign: { name: 'Test' },
      };

      BeaconEvent.findAll.mockResolvedValue([beaconLog]);
      Impression.findAll.mockResolvedValue([impression]);

      const result = await getDeviceLogs('dev-1', { page: 1, limit: 50 });

      expect(result.data).toHaveLength(2);
      // Impression is newer so should be first
      expect(result.data[0].id).toBe('imp_imp-1');
      expect(result.data[0].type).toBe('PLAYBACK');
      expect(result.data[1].id).toBe('b1');
    });

    it('throws 400 when page exceeds 20', async () => {
      await expect(getDeviceLogs('dev-1', { page: 21 })).rejects.toThrow('Log history depth exceeded');
    });

    it('throws 404 when device not found', async () => {
      Device.findByPk.mockResolvedValue(null);

      await expect(getDeviceLogs('nonexistent', { page: 1 })).rejects.toThrow('Device not found');
    });
  });

  // ── updateDevice ──

  describe('updateDevice', () => {
    it('updates status only without touching campaigns', async () => {
      await updateDevice('dev-1', { status: 'offline' });

      expect(mockDevice.update).toHaveBeenCalledWith({ status: 'offline' });
      expect(DeviceCampaignAssignment.destroy).not.toHaveBeenCalled();
    });

    it('throws 404 when device not found', async () => {
      Device.findByPk.mockResolvedValue(null);

      await expect(updateDevice('nonexistent', {})).rejects.toThrow('Device not found');
    });

    it('dual-writes campaignIds to JSON column and join table', async () => {
      const result = await updateDevice('dev-1', { campaignIds: ['camp-1'] });

      expect(mockDevice.update).toHaveBeenCalledWith(
        expect.objectContaining({ campaignIds: ['camp-1'], campaignId: null })
      );
      expect(DeviceCampaignAssignment.destroy).toHaveBeenCalledWith(
        { where: { deviceId: 'dev-1' } }
      );
      expect(DeviceCampaignAssignment.bulkCreate).toHaveBeenCalledWith(
        [{ deviceId: 'dev-1', campaignId: 'camp-1', sortOrder: 0 }],
        { ignoreDuplicates: true }
      );
      expect(result.campaignIdsChanged).toBe(true);
    });

    it('throws 400 when a campaign is not found', async () => {
      Campaign.findAll.mockResolvedValue([]); // 0 campaigns found vs 1 requested

      await expect(updateDevice('dev-1', { campaignIds: ['nonexistent'] }))
        .rejects.toThrow('One or more campaigns not found');
    });

    it('throws 400 when a campaign has no media', async () => {
      Campaign.findAll.mockResolvedValue([
        { id: 'camp-1', name: 'Empty', mediaItems: [] },
      ]);

      await expect(updateDevice('dev-1', { campaignIds: ['camp-1'] }))
        .rejects.toThrow('has no media');
    });
  });
});
