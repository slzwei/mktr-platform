import { jest } from '@jest/globals';
import '../setup.js';
import { Op } from 'sequelize';

// ── Mock models ──

const mockCampaign = {
  id: 'camp-1',
  name: 'Test Campaign',
  status: 'active',
  is_active: true,
  createdBy: 'admin-1',
  update: jest.fn().mockResolvedValue(true),
  toJSON: jest.fn(function () { return { ...this }; }),
  destroy: jest.fn().mockResolvedValue(true),
};

const mockMediaItems = [];
const mockAgentRows = [];

const Campaign = {
  create: jest.fn().mockResolvedValue({ ...mockCampaign, toJSON: () => ({ ...mockCampaign }) }),
  findOne: jest.fn().mockResolvedValue(mockCampaign),
  findAll: jest.fn().mockResolvedValue([]),
  findAndCountAll: jest.fn().mockResolvedValue({ count: 0, rows: [] }),
  rawAttributes: {},
};

const Device = {
  findAll: jest.fn().mockResolvedValue([]),
  update: jest.fn().mockResolvedValue([1]),
};

const QrTag = {
  findAll: jest.fn().mockResolvedValue([]),
  sum: jest.fn().mockResolvedValue(0),
  update: jest.fn().mockResolvedValue([1]),
};

const Prospect = {
  count: jest.fn().mockResolvedValue(0),
  findAll: jest.fn().mockResolvedValue([]),
};

const Commission = {
  sum: jest.fn().mockResolvedValue(0),
  count: jest.fn().mockResolvedValue(0),
};

const CampaignMediaItem = {
  findAll: jest.fn().mockResolvedValue(mockMediaItems),
  destroy: jest.fn().mockResolvedValue(0),
  bulkCreate: jest.fn().mockResolvedValue([]),
};

const CampaignAgentAssignment = {
  findAll: jest.fn().mockResolvedValue(mockAgentRows),
  destroy: jest.fn().mockResolvedValue(0),
  bulkCreate: jest.fn().mockResolvedValue([]),
};

const mockTransaction = {
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
};

const sequelize = {
  transaction: jest.fn(async (callback) => callback(mockTransaction)),
  literal: jest.fn((expr) => expr),
  fn: jest.fn((fnName, col) => `${fnName}(${col})`),
  col: jest.fn((name) => name),
};

jest.unstable_mockModule('../../src/models/index.js', () => ({
  Campaign,
  Device,
  QrTag,
  Prospect,
  Commission,
  CampaignMediaItem,
  CampaignAgentAssignment,
  sequelize,
}));

jest.unstable_mockModule('../../src/middleware/tenant.js', () => ({
  getTenantId: jest.fn().mockReturnValue('tenant-1'),
}));

jest.unstable_mockModule('../../src/services/storage.js', () => ({
  storageService: {
    isEnabled: jest.fn().mockReturnValue(false),
    uploadBuffer: jest.fn(),
    deleteObject: jest.fn(),
  },
}));

jest.unstable_mockModule('../../src/middleware/errorHandler.js', () => ({
  AppError: class AppError extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

const mockPushService = {
  sendEvent: jest.fn().mockReturnValue(true),
};

jest.unstable_mockModule('../../src/services/pushService.js', () => ({
  pushService: mockPushService,
}));

const campaignService = await import('../../src/services/campaignService.js');

// ── Tests ──

describe('campaignDeviceSync (unit)', () => {
  const adminReq = {
    user: { id: 'admin-1', role: 'admin' },
    cookies: {},
    headers: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Campaign.findOne.mockResolvedValue({ ...mockCampaign, update: jest.fn().mockResolvedValue(true), toJSON: () => ({ ...mockCampaign }) });
  });

  // ────────────────────────────────────────────────
  // updateCampaign device fan-out
  // ────────────────────────────────────────────────

  describe('updateCampaign (device notification)', () => {
    it('notifies devices assigned to the campaign on update', async () => {
      const device1 = { id: 'device-1' };
      const device2 = { id: 'device-2' };
      Device.findAll.mockResolvedValue([device1, device2]);

      await campaignService.updateCampaign('camp-1', { name: 'Updated' }, adminReq);

      expect(Device.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            [Op.or]: expect.arrayContaining([
              { campaignId: 'camp-1' },
            ]),
          }),
        })
      );
      expect(mockPushService.sendEvent).toHaveBeenCalledTimes(2);
      expect(mockPushService.sendEvent).toHaveBeenCalledWith('device-1', 'REFRESH_MANIFEST', expect.any(Object));
      expect(mockPushService.sendEvent).toHaveBeenCalledWith('device-2', 'REFRESH_MANIFEST', expect.any(Object));
    });

    it('does not crash when no devices are assigned', async () => {
      Device.findAll.mockResolvedValue([]);

      await campaignService.updateCampaign('camp-1', { name: 'Updated' }, adminReq);

      expect(mockPushService.sendEvent).not.toHaveBeenCalled();
    });

    it('continues even if push notification fails', async () => {
      Device.findAll.mockResolvedValue([{ id: 'device-1' }]);
      mockPushService.sendEvent.mockImplementation(() => { throw new Error('Push failed'); });

      // Should not throw
      await campaignService.updateCampaign('camp-1', { name: 'Updated' }, adminReq);
    });
  });

  // ────────────────────────────────────────────────
  // syncAgentAssignments (join table)
  // ────────────────────────────────────────────────

  describe('updateCampaign (agent assignments)', () => {
    it('syncs agent assignments when assigned_agents provided', async () => {
      await campaignService.updateCampaign('camp-1', {
        assigned_agents: ['agent-1', 'agent-2'],
      }, adminReq);

      expect(CampaignAgentAssignment.destroy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { campaignId: 'camp-1' },
        })
      );
      expect(CampaignAgentAssignment.bulkCreate).toHaveBeenCalledWith(
        [
          { campaignId: 'camp-1', agentId: 'agent-1' },
          { campaignId: 'camp-1', agentId: 'agent-2' },
        ],
        expect.any(Object)
      );
    });

    it('deduplicates agent IDs', async () => {
      await campaignService.updateCampaign('camp-1', {
        assigned_agents: ['agent-1', 'agent-1', 'agent-2'],
      }, adminReq);

      const bulkCreateCall = CampaignAgentAssignment.bulkCreate.mock.calls[0][0];
      expect(bulkCreateCall).toHaveLength(2);
    });

    it('handles object-style agent IDs', async () => {
      await campaignService.updateCampaign('camp-1', {
        assigned_agents: [{ id: 'agent-1' }, { id: 'agent-2' }],
      }, adminReq);

      const bulkCreateCall = CampaignAgentAssignment.bulkCreate.mock.calls[0][0];
      expect(bulkCreateCall[0].agentId).toBe('agent-1');
    });

    it('clears all assignments when empty array provided', async () => {
      await campaignService.updateCampaign('camp-1', {
        assigned_agents: [],
      }, adminReq);

      expect(CampaignAgentAssignment.destroy).toHaveBeenCalled();
      expect(CampaignAgentAssignment.bulkCreate).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // syncMediaItems (join table)
  // ────────────────────────────────────────────────

  describe('updateCampaign (media items)', () => {
    it('syncs media items when ad_playlist provided', async () => {
      await campaignService.updateCampaign('camp-1', {
        ad_playlist: [
          { url: 'https://cdn.example.com/video1.mp4', type: 'video', duration: 10000 },
          { url: 'https://cdn.example.com/img.jpg', type: 'image', duration: 5000 },
        ],
      }, adminReq);

      expect(CampaignMediaItem.destroy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { campaignId: 'camp-1' },
        })
      );
      expect(CampaignMediaItem.bulkCreate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            campaignId: 'camp-1',
            mediaType: 'video',
            url: 'https://cdn.example.com/video1.mp4',
            durationSecs: 10,
            sortOrder: 0,
          }),
        ]),
        expect.any(Object)
      );
    });

    it('filters out items without URL', async () => {
      await campaignService.updateCampaign('camp-1', {
        ad_playlist: [
          { url: 'https://cdn.example.com/video1.mp4', type: 'video' },
          { type: 'image' }, // no url
          null,              // null item
        ],
      }, adminReq);

      const bulkCreateCall = CampaignMediaItem.bulkCreate.mock.calls[0]?.[0] || [];
      const validItems = bulkCreateCall.filter(i => i.url);
      expect(validItems).toHaveLength(1);
    });

    it('clears all media items when empty array provided', async () => {
      await campaignService.updateCampaign('camp-1', {
        ad_playlist: [],
      }, adminReq);

      expect(CampaignMediaItem.destroy).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // Campaign not found
  // ────────────────────────────────────────────────

  describe('updateCampaign (not found)', () => {
    it('throws when campaign not found', async () => {
      Campaign.findOne.mockResolvedValue(null);

      await expect(campaignService.updateCampaign('nonexistent', { name: 'X' }, adminReq))
        .rejects.toThrow('Campaign not found or access denied');
    });
  });

  // ────────────────────────────────────────────────
  // createCampaign
  // ────────────────────────────────────────────────

  describe('createCampaign', () => {
    it('creates campaign with agent assignments', async () => {
      Campaign.create.mockResolvedValue({
        ...mockCampaign,
        id: 'new-camp',
        toJSON: () => ({ ...mockCampaign, id: 'new-camp' }),
      });

      await campaignService.createCampaign({
        name: 'New Campaign',
        assigned_agents: ['agent-1', 'agent-2'],
      }, { id: 'admin-1', role: 'admin' });

      expect(CampaignAgentAssignment.bulkCreate).toHaveBeenCalled();
    });

    it('creates campaign with media items', async () => {
      Campaign.create.mockResolvedValue({
        ...mockCampaign,
        id: 'new-camp',
        toJSON: () => ({ ...mockCampaign, id: 'new-camp' }),
      });

      await campaignService.createCampaign({
        name: 'New Campaign',
        ad_playlist: [{ url: 'https://cdn.com/video.mp4', type: 'video', duration: 10000 }],
      }, { id: 'admin-1', role: 'admin' });

      expect(CampaignMediaItem.bulkCreate).toHaveBeenCalled();
    });

    it('creates campaign without agents or media', async () => {
      Campaign.create.mockResolvedValue({
        ...mockCampaign,
        id: 'new-camp',
        toJSON: () => ({ ...mockCampaign, id: 'new-camp' }),
      });

      await campaignService.createCampaign({
        name: 'Bare Campaign',
      }, { id: 'admin-1', role: 'admin' });

      expect(CampaignAgentAssignment.bulkCreate).not.toHaveBeenCalled();
    });

    it('defaults status to active when is_active is true', async () => {
      Campaign.create.mockResolvedValue({
        ...mockCampaign,
        toJSON: () => ({ ...mockCampaign }),
      });

      await campaignService.createCampaign({
        name: 'Active Campaign',
        is_active: true,
      }, { id: 'admin-1' });

      const createArg = Campaign.create.mock.calls[0][0];
      expect(createArg.status).toBe('active');
    });

    it('sets status to draft when is_active is false', async () => {
      Campaign.create.mockResolvedValue({
        ...mockCampaign,
        toJSON: () => ({ ...mockCampaign }),
      });

      await campaignService.createCampaign({
        name: 'Draft Campaign',
        is_active: false,
      }, { id: 'admin-1' });

      const createArg = Campaign.create.mock.calls[0][0];
      expect(createArg.status).toBe('draft');
    });
  });

  // ────────────────────────────────────────────────
  // computeCampaignMetrics
  // ────────────────────────────────────────────────

  describe('computeCampaignMetrics', () => {
    it('computes metrics from live data', async () => {
      Prospect.count
        .mockResolvedValueOnce(100)   // leads
        .mockResolvedValueOnce(10);   // conversions
      QrTag.sum.mockResolvedValue(500);  // scans
      Commission.sum.mockResolvedValue(2000); // revenue

      const metrics = await campaignService.computeCampaignMetrics('camp-1');

      expect(metrics.leads).toBe(100);
      expect(metrics.conversions).toBe(10);
      expect(metrics.views).toBe(500);
      expect(metrics.revenue).toBe(2000);
    });
  });
});
