import { jest } from '@jest/globals';
import '../setup.js';

// ── Helpers ──

function buildMocks() {
  const mockQrTag = {
    id: 'qr-1',
    slug: 'abc1234567',
    label: 'Test QR',
    type: 'campaign',
    campaignId: 'camp-1',
    carId: null,
    ownerUserId: 'user-1',
    active: true,
    status: 'active',
    scanCount: 10,
    qrCode: '<svg></svg>',
    qrImageUrl: '/uploads/image/qr-abc1234567.png',
    analytics: {},
    update: jest.fn().mockResolvedValue(true),
    destroy: jest.fn().mockResolvedValue(true),
    toJSON: jest.fn(function () { return { ...this }; }),
  };

  const QrTag = {
    findAndCountAll: jest.fn().mockResolvedValue({ count: 1, rows: [mockQrTag] }),
    findOne: jest.fn().mockResolvedValue(null),
    findByPk: jest.fn().mockResolvedValue(mockQrTag),
    findAll: jest.fn().mockResolvedValue([mockQrTag]),
    create: jest.fn().mockResolvedValue(mockQrTag),
    update: jest.fn().mockResolvedValue([1]),
  };

  const Campaign = {
    findOne: jest.fn().mockResolvedValue({ id: 'camp-1', name: 'Test', status: 'active' }),
  };

  const Car = {
    findByPk: jest.fn().mockResolvedValue({ id: 'car-1', fleetOwner: { userId: 'user-1' } }),
  };

  const QrScan = {
    count: jest.fn().mockResolvedValue(5),
    destroy: jest.fn().mockResolvedValue(1),
  };

  const Attribution = {
    findAll: jest.fn().mockResolvedValue([]),
    destroy: jest.fn().mockResolvedValue(1),
  };

  const Prospect = {
    count: jest.fn().mockResolvedValue(3),
    update: jest.fn().mockResolvedValue([1]),
  };

  const SessionVisit = {
    findAll: jest.fn().mockResolvedValue([]),
  };

  const User = {
    findOne: jest.fn().mockResolvedValue({ id: 'agent-1' }),
  };

  const AgentGroupMember = {
    count: jest.fn().mockResolvedValue([]),
  };

  const sequelize = {
    literal: jest.fn((expr) => expr),
  };

  const AppError = class extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
    }
  };

  return {
    mockQrTag,
    QrTag, Campaign, Car, QrScan, Attribution, Prospect, SessionVisit, User, AgentGroupMember,
    sequelize, AppError,
  };
}

let mocks;
let service;

beforeEach(async () => {
  mocks = buildMocks();

  jest.unstable_mockModule('../../src/models/index.js', () => ({
    QrTag: mocks.QrTag,
    Campaign: mocks.Campaign,
    Car: mocks.Car,
    QrScan: mocks.QrScan,
    Attribution: mocks.Attribution,
    Prospect: mocks.Prospect,
    SessionVisit: mocks.SessionVisit,
    User: mocks.User,
    AgentGroupMember: mocks.AgentGroupMember,
    sequelize: mocks.sequelize,
  }));

  jest.unstable_mockModule('../../src/middleware/errorHandler.js', () => ({
    AppError: mocks.AppError,
  }));

  jest.unstable_mockModule('qrcode', () => ({
    default: {
      toString: jest.fn().mockResolvedValue('<svg>mock</svg>'),
      toBuffer: jest.fn().mockResolvedValue(Buffer.from('png-data')),
    },
  }));

  jest.unstable_mockModule('../../src/services/storage.js', () => ({
    storageService: {
      isEnabled: jest.fn().mockReturnValue(false),
    },
  }));

  jest.unstable_mockModule('fs', () => ({
    default: {
      existsSync: jest.fn().mockReturnValue(true),
      mkdirSync: jest.fn(),
      writeFileSync: jest.fn(),
      unlinkSync: jest.fn(),
    },
  }));

  service = await import('../../src/services/qrCodeService.js');
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

// ── Tests ──

describe('qrCodeService (unit)', () => {
  const adminUser = { id: 'user-1', role: 'admin' };
  const agentUser = { id: 'user-2', role: 'agent' };

  // ── listQrCodes ──

  describe('listQrCodes', () => {
    it('returns qrTags and pagination', async () => {
      const result = await service.listQrCodes(adminUser, { page: 1, limit: 10 });

      expect(result).toHaveProperty('qrTags');
      expect(result).toHaveProperty('pagination');
      expect(result.pagination.currentPage).toBe(1);
    });

    it('applies ownership scoping for non-admin users', async () => {
      await service.listQrCodes(agentUser, { page: 1, limit: 10 });

      const callArg = mocks.QrTag.findAndCountAll.mock.calls[0][0];
      expect(callArg.where.ownerUserId).toBe('user-2');
    });

    it('does not apply ownership scoping for admin', async () => {
      await service.listQrCodes(adminUser, { page: 1, limit: 10 });

      const callArg = mocks.QrTag.findAndCountAll.mock.calls[0][0];
      expect(callArg.where.ownerUserId).toBeUndefined();
    });

    it('applies search filter with iLike', async () => {
      await service.listQrCodes(adminUser, { page: 1, limit: 10, search: 'test' });

      const callArg = mocks.QrTag.findAndCountAll.mock.calls[0][0];
      // Op.or is a Symbol so we check that the where has more keys than just ownerUserId scoping
      const keys = Object.getOwnPropertySymbols(callArg.where);
      expect(keys.length).toBeGreaterThan(0);
    });

    it('applies pagination offset', async () => {
      await service.listQrCodes(adminUser, { page: 3, limit: 5 });

      const callArg = mocks.QrTag.findAndCountAll.mock.calls[0][0];
      expect(callArg.offset).toBe(10); // (3-1) * 5
    });
  });

  // ── createQrCode ──

  describe('createQrCode', () => {
    it('creates a new QR code with generated slug', async () => {
      const result = await service.createQrCode(
        { label: 'New QR', campaignId: 'camp-1' },
        adminUser
      );

      expect(mocks.QrTag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'New QR',
          campaignId: 'camp-1',
          ownerUserId: 'user-1',
          active: true,
        })
      );
      expect(result).toHaveProperty('qrTag');
      expect(result.updated).toBe(false);
    });

    it('throws 404 when campaign not found for non-admin', async () => {
      mocks.Campaign.findOne.mockResolvedValue(null);

      await expect(
        service.createQrCode({ label: 'Test', campaignId: 'bad-camp' }, agentUser)
      ).rejects.toThrow('Campaign not found or access denied');
    });
  });

  // ── getQrCode ──

  describe('getQrCode', () => {
    it('returns QR code with includes', async () => {
      mocks.QrTag.findOne.mockResolvedValue(mocks.mockQrTag);

      const result = await service.getQrCode('qr-1', adminUser);

      expect(result).toBe(mocks.mockQrTag);
    });

    it('throws 404 when not found', async () => {
      mocks.QrTag.findOne.mockResolvedValue(null);

      await expect(service.getQrCode('bad-id', adminUser))
        .rejects.toThrow('QR code not found');
    });
  });

  // ── updateQrCode ──

  describe('updateQrCode', () => {
    it('updates allowed fields only', async () => {
      mocks.QrTag.findOne.mockResolvedValue(mocks.mockQrTag);

      await service.updateQrCode('qr-1', { label: 'Updated', dangerousField: 'nope' }, adminUser);

      const updateArg = mocks.mockQrTag.update.mock.calls[0][0];
      expect(updateArg.label).toBe('Updated');
      expect(updateArg.dangerousField).toBeUndefined();
    });

    it('throws 404 when QR code not found', async () => {
      mocks.QrTag.findOne.mockResolvedValue(null);

      await expect(service.updateQrCode('bad-id', { label: 'X' }, adminUser))
        .rejects.toThrow('QR code not found or access denied');
    });

    it('resolves assignedAgentId from phone', async () => {
      mocks.QrTag.findOne.mockResolvedValue(mocks.mockQrTag);
      mocks.User.findOne.mockResolvedValue({ id: 'agent-resolved' });

      await service.updateQrCode('qr-1', { assignedAgentPhone: '+6590001111' }, adminUser);

      const updateArg = mocks.mockQrTag.update.mock.calls[0][0];
      expect(updateArg.assignedAgentId).toBe('agent-resolved');
    });
  });

  // ── deleteQrCode ──

  describe('deleteQrCode', () => {
    it('cascades cleanup and destroys QR code', async () => {
      mocks.QrTag.findOne.mockResolvedValue(mocks.mockQrTag);

      await service.deleteQrCode('qr-1', adminUser);

      expect(mocks.Prospect.update).toHaveBeenCalled();
      expect(mocks.Attribution.destroy).toHaveBeenCalled();
      expect(mocks.QrScan.destroy).toHaveBeenCalled();
      expect(mocks.mockQrTag.destroy).toHaveBeenCalled();
    });

    it('throws 404 when QR code not found', async () => {
      mocks.QrTag.findOne.mockResolvedValue(null);

      await expect(service.deleteQrCode('bad-id', adminUser))
        .rejects.toThrow('QR code not found or access denied');
    });
  });

  // ── recordScan ──

  describe('recordScan', () => {
    it('increments scan count and returns new count', async () => {
      const result = await service.recordScan('qr-1', {});

      expect(mocks.mockQrTag.update).toHaveBeenCalledWith(
        expect.objectContaining({ scanCount: expect.anything() })
      );
      expect(result.scanCount).toBe(11); // 10 + 1
    });

    it('throws 404 when QR code not found', async () => {
      mocks.QrTag.findByPk.mockResolvedValue(null);

      await expect(service.recordScan('bad-id', {}))
        .rejects.toThrow('QR code not found');
    });

    it('throws 400 when QR code is not active', async () => {
      mocks.QrTag.findByPk.mockResolvedValue({ ...mocks.mockQrTag, status: 'inactive' });

      await expect(service.recordScan('qr-1', {}))
        .rejects.toThrow('QR code is not active');
    });
  });

  // ── getAnalytics ──

  describe('getAnalytics', () => {
    it('returns summary with totalScans, landings, leads', async () => {
      mocks.QrTag.findOne.mockResolvedValue(mocks.mockQrTag);

      const result = await service.getAnalytics('qr-1', adminUser);

      expect(result).toHaveProperty('summary');
      expect(result.summary).toHaveProperty('totalScans');
      expect(result.summary).toHaveProperty('landings');
      expect(result.summary).toHaveProperty('leads');
    });

    it('throws 404 when QR code not found', async () => {
      mocks.QrTag.findOne.mockResolvedValue(null);

      await expect(service.getAnalytics('bad-id', adminUser))
        .rejects.toThrow('QR code not found or access denied');
    });
  });

  // ── bulkOperateQrCodes ──

  describe('bulkOperateQrCodes', () => {
    it('activates multiple QR codes', async () => {
      const result = await service.bulkOperateQrCodes('activate', ['qr-1'], {}, adminUser);

      expect(mocks.QrTag.update).toHaveBeenCalledWith(
        { status: 'active' },
        expect.any(Object)
      );
      expect(result.message).toContain('activated');
    });

    it('deactivates multiple QR codes', async () => {
      const result = await service.bulkOperateQrCodes('deactivate', ['qr-1'], {}, adminUser);

      expect(mocks.QrTag.update).toHaveBeenCalledWith(
        { status: 'inactive' },
        expect.any(Object)
      );
      expect(result.message).toContain('deactivated');
    });

    it('throws 400 for missing operation', async () => {
      await expect(service.bulkOperateQrCodes(null, ['qr-1'], {}, adminUser))
        .rejects.toThrow('Operation and qrTagIds array are required');
    });

    it('throws 400 for invalid operation', async () => {
      await expect(service.bulkOperateQrCodes('nuke', ['qr-1'], {}, adminUser))
        .rejects.toThrow('Invalid operation');
    });

    it('throws 404 when some QR codes not found', async () => {
      mocks.QrTag.findAll.mockResolvedValue([]); // none found

      await expect(service.bulkOperateQrCodes('activate', ['qr-1', 'qr-2'], {}, adminUser))
        .rejects.toThrow('Some QR codes not found or access denied');
    });
  });
});
