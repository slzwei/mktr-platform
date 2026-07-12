import { jest } from '@jest/globals';
import '../setup.js';
import { Op } from 'sequelize';

// ── Stable mock objects ──
// ESM imports are resolved once at import time, so we must use the SAME
// object references throughout all tests. We reset individual mock fns
// in beforeEach instead of rebuilding the whole mock tree.

const mockTransaction = {
  commit: jest.fn(),
  rollback: jest.fn(),
};

const Campaign = {
  create: jest.fn(),
  findOne: jest.fn(),
  findByPk: jest.fn(),
  findAndCountAll: jest.fn(),
  rawAttributes: {},
};

const QrTag = {
  findAll: jest.fn(),
  sum: jest.fn(),
  update: jest.fn(),
};

const Prospect = {
  count: jest.fn(),
  findAll: jest.fn(),
};

const Commission = {
  count: jest.fn(),
  sum: jest.fn(),
};

const Device = {
  findAll: jest.fn(),
};

const CampaignMediaItem = {
  findAll: jest.fn(),
  destroy: jest.fn(),
  bulkCreate: jest.fn(),
};

const CampaignAgentAssignment = {
  findAll: jest.fn(),
  destroy: jest.fn(),
  bulkCreate: jest.fn(),
};

const sequelize = {
  transaction: jest.fn(async (cb) => cb(mockTransaction)),
  fn: jest.fn((fnName, col) => `${fnName}(${col})`),
  col: jest.fn((name) => name),
  literal: jest.fn((expr) => expr),
};

const getTenantId = jest.fn().mockReturnValue('tenant-1');

const storageService = {
  isEnabled: jest.fn().mockReturnValue(false),
  deleteObject: jest.fn(),
};

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

const pushSendEvent = jest.fn();

// ── Register module mocks ──

jest.unstable_mockModule('../../src/models/index.js', () => ({
  Campaign, QrTag, Prospect, Commission, Device,
  CampaignMediaItem, CampaignAgentAssignment, sequelize,
  // Draw-terms versioning dep (lucky draw) — inert stub; drawTermsVersioning.test.js
  // covers the real logic through the DI seam.
  DrawTermsVersion: {
    findOne: async () => null,
    max: async () => null,
    create: async (fields) => ({ id: 'dtv-mock', ...fields }),
  },
  Op,
}));

jest.unstable_mockModule('../../src/middleware/tenant.js', () => ({
  getTenantId,
}));

jest.unstable_mockModule('../../src/services/storage.js', () => ({
  storageService,
}));

jest.unstable_mockModule('../../src/middleware/errorHandler.js', () => ({
  AppError,
}));

jest.unstable_mockModule('../../src/services/pushService.js', () => ({
  pushService: { sendEvent: pushSendEvent },
}));

// Dynamic import AFTER mocks are registered
const campaignService = await import('../../src/services/campaignService.js');

// ── Helpers ──

function makeCampaignInstance(overrides = {}) {
  return {
    id: 'camp-1',
    name: 'Test Campaign',
    type: 'lead_generation',
    status: 'active',
    is_active: true,
    createdBy: 'user-1',
    min_age: 18,
    max_age: 65,
    spentAmount: 100,
    metrics: { leads: 5 },
    toJSON() {
      const { toJSON: _toJSON, update: _update, save: _save, destroy: _destroy, ...rest } = this;
      return { ...rest };
    },
    update: jest.fn().mockResolvedValue(true),
    save: jest.fn().mockResolvedValue(true),
    destroy: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function makeReq(overrides = {}) {
  return {
    user: { id: 'user-1', role: 'admin' },
    ...overrides,
  };
}

function resetAllMocks() {
  Campaign.create.mockReset();
  Campaign.findOne.mockReset().mockResolvedValue(null);
  Campaign.findByPk.mockReset();
  Campaign.findAndCountAll.mockReset().mockResolvedValue({ count: 0, rows: [] });

  QrTag.findAll.mockReset().mockResolvedValue([]);
  QrTag.sum.mockReset().mockResolvedValue(0);
  QrTag.update.mockReset().mockResolvedValue([1]);

  Prospect.count.mockReset().mockResolvedValue(0);
  Prospect.findAll.mockReset().mockResolvedValue([]);

  Commission.count.mockReset().mockResolvedValue(0);
  Commission.sum.mockReset().mockResolvedValue(0);

  Device.findAll.mockReset().mockResolvedValue([]);

  CampaignMediaItem.findAll.mockReset().mockResolvedValue([]);
  CampaignMediaItem.destroy.mockReset().mockResolvedValue(0);
  CampaignMediaItem.bulkCreate.mockReset().mockResolvedValue([]);

  CampaignAgentAssignment.findAll.mockReset().mockResolvedValue([]);
  CampaignAgentAssignment.destroy.mockReset().mockResolvedValue(0);
  CampaignAgentAssignment.bulkCreate.mockReset().mockResolvedValue([]);

  sequelize.transaction.mockReset().mockImplementation(async (cb) => cb(mockTransaction));

  storageService.isEnabled.mockReset().mockReturnValue(false);
  storageService.deleteObject.mockReset();

  pushSendEvent.mockReset();
}

// ── Tests ──

describe('campaignService (unit)', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  // ────────────────────────────────────────────────
  // computeCampaignMetrics
  // ────────────────────────────────────────────────

  describe('computeCampaignMetrics', () => {
    it('returns total leads count from Prospect.count', async () => {
      Prospect.count.mockResolvedValueOnce(15).mockResolvedValueOnce(0);
      QrTag.sum.mockResolvedValue(0);
      Commission.sum.mockResolvedValue(0);

      const result = await campaignService.computeCampaignMetrics('camp-1');

      expect(result.leads).toBe(15);
      expect(Prospect.count).toHaveBeenCalledWith({
        where: { campaignId: 'camp-1' },
      });
    });

    it('returns conversion count for won leads', async () => {
      Prospect.count
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(5);
      QrTag.sum.mockResolvedValue(0);
      Commission.sum.mockResolvedValue(0);

      const result = await campaignService.computeCampaignMetrics('camp-1');

      expect(result.conversions).toBe(5);
      expect(Prospect.count).toHaveBeenCalledWith({
        where: { campaignId: 'camp-1', leadStatus: 'won' },
      });
    });

    it('returns scan count from QrTag.sum, defaulting null to 0', async () => {
      Prospect.count.mockResolvedValue(0);
      QrTag.sum.mockResolvedValue(null);
      Commission.sum.mockResolvedValue(0);

      const result = await campaignService.computeCampaignMetrics('camp-1');

      expect(result.views).toBe(0);
      expect(result.clicks).toBe(0);
    });

    it('returns scan count from QrTag.sum when value exists', async () => {
      Prospect.count.mockResolvedValue(0);
      QrTag.sum.mockResolvedValue(42);
      Commission.sum.mockResolvedValue(0);

      const result = await campaignService.computeCampaignMetrics('camp-1');

      expect(result.views).toBe(42);
      expect(result.clicks).toBe(42);
    });

    it('returns revenue from paid commissions, defaulting null to 0', async () => {
      Prospect.count.mockResolvedValue(0);
      QrTag.sum.mockResolvedValue(0);
      Commission.sum.mockResolvedValue(null);

      const result = await campaignService.computeCampaignMetrics('camp-1');

      expect(result.revenue).toBe(0);
    });

    it('returns correct revenue when paid commissions exist', async () => {
      Prospect.count.mockResolvedValue(0);
      QrTag.sum.mockResolvedValue(0);
      Commission.sum.mockResolvedValue(2500.50);

      const result = await campaignService.computeCampaignMetrics('camp-1');

      expect(result.revenue).toBe(2500.50);
      expect(result.referrals).toBe(0);
    });
  });

  // ────────────────────────────────────────────────
  // listCampaigns
  // ────────────────────────────────────────────────

  describe('listCampaigns', () => {
    it('applies pagination defaults (page 1, limit 10)', async () => {
      const mockRow = {
        toJSON: () => ({ id: 'camp-1', name: 'C1', mediaItems: [], assignedAgents: [] }),
      };
      Campaign.findAndCountAll.mockResolvedValue({ count: 1, rows: [mockRow] });

      const result = await campaignService.listCampaigns(
        { id: 'user-1', role: 'admin' },
        {},
        makeReq()
      );

      const callArg = Campaign.findAndCountAll.mock.calls[0][0];
      expect(callArg.offset).toBe(0);
      expect(callArg.limit).toBe(10);
      expect(result.pagination.currentPage).toBe(1);
    });

    it('applies custom pagination', async () => {
      Campaign.findAndCountAll.mockResolvedValue({ count: 30, rows: [] });

      const result = await campaignService.listCampaigns(
        { id: 'user-1', role: 'admin' },
        { page: 3, limit: 5 },
        makeReq()
      );

      const callArg = Campaign.findAndCountAll.mock.calls[0][0];
      expect(callArg.offset).toBe(10);
      expect(callArg.limit).toBe(5);
      expect(result.pagination.totalPages).toBe(6);
      expect(result.pagination.totalItems).toBe(30);
    });

    it('filters by status when provided', async () => {
      Campaign.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await campaignService.listCampaigns(
        { id: 'user-1', role: 'admin' },
        { status: 'active' },
        makeReq()
      );

      const whereArg = Campaign.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.status).toBe('active');
    });

    it('applies search with iLike on name and description', async () => {
      Campaign.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await campaignService.listCampaigns(
        { id: 'user-1', role: 'admin' },
        { search: 'luggage' },
        makeReq()
      );

      const whereArg = Campaign.findAndCountAll.mock.calls[0][0].where;
      const orConditions = whereArg[Op.or];
      expect(orConditions).toBeDefined();
      expect(orConditions).toHaveLength(2);
    });

    it('scopes non-admin users to own + public campaigns', async () => {
      Campaign.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await campaignService.listCampaigns(
        { id: 'agent-1', role: 'agent' },
        {},
        makeReq({ user: { id: 'agent-1', role: 'agent' } })
      );

      const whereArg = Campaign.findAndCountAll.mock.calls[0][0].where;
      const orConditions = whereArg[Op.or];
      expect(orConditions).toEqual([
        { createdBy: 'agent-1' },
        { isPublic: true },
      ]);
    });

    it('sorts by createdAt DESC', async () => {
      Campaign.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await campaignService.listCampaigns(
        { id: 'user-1', role: 'admin' },
        {},
        makeReq()
      );

      const callArg = Campaign.findAndCountAll.mock.calls[0][0];
      expect(callArg.order).toEqual([['createdAt', 'DESC']]);
    });

    it('includes creator, mediaItems, and assignedAgents associations', async () => {
      Campaign.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await campaignService.listCampaigns(
        { id: 'user-1', role: 'admin' },
        {},
        makeReq()
      );

      const callArg = Campaign.findAndCountAll.mock.calls[0][0];
      const includeAssociations = callArg.include.map(i => i.association);
      expect(includeAssociations).toContain('creator');
      expect(includeAssociations).toContain('mediaItems');
      expect(includeAssociations).toContain('assignedAgents');
    });
  });

  // ────────────────────────────────────────────────
  // getCampaign
  // ────────────────────────────────────────────────

  describe('getCampaign', () => {
    it('returns campaign with backward-compatible fields when found', async () => {
      const mockRow = {
        toJSON: () => ({
          id: 'camp-1',
          name: 'Test Campaign',
          mediaItems: [{ id: 'mi-1', mediaType: 'video', url: 'https://cdn.example.com/v.mp4', durationSecs: 10, sortOrder: 0 }],
          assignedAgents: [{ id: 'agent-1' }],
        }),
      };
      Campaign.findOne.mockResolvedValue(mockRow);

      const result = await campaignService.getCampaign('camp-1', makeReq());

      expect(result.id).toBe('camp-1');
      expect(result.ad_playlist).toHaveLength(1);
      expect(result.ad_playlist[0].type).toBe('video');
      expect(result.ad_playlist[0].duration).toBe(10000); // seconds * 1000
      expect(result.assigned_agents).toEqual(['agent-1']);
    });

    it('throws 404 when campaign not found', async () => {
      Campaign.findOne.mockResolvedValue(null);

      await expect(campaignService.getCampaign('nonexistent', makeReq()))
        .rejects.toThrow('Campaign not found');

      try {
        await campaignService.getCampaign('nonexistent', makeReq());
      } catch (err) {
        expect(err.statusCode).toBe(404);
      }
    });

    it('includes qrTags, prospects, leadPackages, and other associations', async () => {
      Campaign.findOne.mockResolvedValue({
        toJSON: () => ({ id: 'camp-1', mediaItems: [], assignedAgents: [] }),
      });

      await campaignService.getCampaign('camp-1', makeReq());

      const callArg = Campaign.findOne.mock.calls[0][0];
      const includeAssociations = callArg.include.map(i => i.association);
      expect(includeAssociations).toContain('creator');
      expect(includeAssociations).toContain('qrTags');
      expect(includeAssociations).toContain('prospects');
      expect(includeAssociations).toContain('leadPackages');
      expect(includeAssociations).toContain('mediaItems');
      expect(includeAssociations).toContain('assignedAgents');
    });
  });

  // ────────────────────────────────────────────────
  // createCampaign
  // ────────────────────────────────────────────────

  describe('createCampaign', () => {
    it('creates campaign with all provided fields', async () => {
      const inst = makeCampaignInstance();
      Campaign.create.mockResolvedValue(inst);

      const body = {
        name: 'New Campaign',
        min_age: 21,
        max_age: 55,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        is_active: true,
        commission_amount_driver: 50,
        commission_amount_fleet: 100,
      };

      await campaignService.createCampaign(body, { id: 'user-1', role: 'admin' });

      const createArg = Campaign.create.mock.calls[0][0];
      expect(createArg.name).toBe('New Campaign');
      expect(createArg.min_age).toBe(21);
      expect(createArg.max_age).toBe(55);
      expect(createArg.commission_amount_driver).toBe(50);
      expect(createArg.commission_amount_fleet).toBe(100);
    });

    it('sets createdBy from user.id', async () => {
      Campaign.create.mockResolvedValue(makeCampaignInstance());

      await campaignService.createCampaign({ name: 'C' }, { id: 'user-99', role: 'admin' });

      const createArg = Campaign.create.mock.calls[0][0];
      expect(createArg.createdBy).toBe('user-99');
    });

    it('defaults status to active when is_active is true', async () => {
      Campaign.create.mockResolvedValue(makeCampaignInstance());

      await campaignService.createCampaign({ name: 'C', is_active: true }, { id: 'u1' });

      const createArg = Campaign.create.mock.calls[0][0];
      expect(createArg.status).toBe('active');
    });

    it('defaults status to draft when is_active is false', async () => {
      Campaign.create.mockResolvedValue(makeCampaignInstance());

      await campaignService.createCampaign({ name: 'C', is_active: false }, { id: 'u1' });

      const createArg = Campaign.create.mock.calls[0][0];
      expect(createArg.status).toBe('draft');
    });

    it('defaults is_active to true when not provided', async () => {
      Campaign.create.mockResolvedValue(makeCampaignInstance());

      await campaignService.createCampaign({ name: 'C' }, { id: 'u1' });

      const createArg = Campaign.create.mock.calls[0][0];
      expect(createArg.is_active).toBe(true);
      // Note: status uses the destructured is_active (undefined → falsy → 'draft')
      expect(createArg.status).toBe('draft');
    });
  });

  // ────────────────────────────────────────────────
  // updateCampaign
  // ────────────────────────────────────────────────

  describe('updateCampaign', () => {
    it('updates campaign fields and returns result', async () => {
      const inst = makeCampaignInstance();
      Campaign.findOne.mockResolvedValue(inst);

      const body = { name: 'Updated Name', min_age: 25 };
      const result = await campaignService.updateCampaign('camp-1', body, makeReq());

      expect(inst.update).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Updated Name', min_age: 25 })
      );
      expect(result).toBeDefined();
    });

    it('throws 404 when campaign not found', async () => {
      Campaign.findOne.mockResolvedValue(null);

      await expect(campaignService.updateCampaign('nonexistent', { name: 'X' }, makeReq()))
        .rejects.toThrow('Campaign not found or access denied');

      try {
        await campaignService.updateCampaign('nonexistent', {}, makeReq());
      } catch (err) {
        expect(err.statusCode).toBe(404);
      }
    });

    it('notifies devices after update (fan-out)', async () => {
      Campaign.findOne.mockResolvedValue(makeCampaignInstance());
      Device.findAll.mockResolvedValue([{ id: 'device-1' }]);

      await campaignService.updateCampaign('camp-1', { name: 'X' }, makeReq());

      expect(Device.findAll).toHaveBeenCalled();
    });

    it('syncs agent assignments when assigned_agents provided', async () => {
      Campaign.findOne.mockResolvedValue(makeCampaignInstance());

      await campaignService.updateCampaign(
        'camp-1',
        { assigned_agents: ['agent-1', 'agent-2'] },
        makeReq()
      );

      expect(CampaignAgentAssignment.destroy).toHaveBeenCalled();
      expect(CampaignAgentAssignment.bulkCreate).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // archiveCampaign
  // ────────────────────────────────────────────────

  describe('archiveCampaign', () => {
    it('sets status to archived on success', async () => {
      const inst = makeCampaignInstance({ status: 'active' });
      Campaign.findOne.mockResolvedValue(inst);

      await campaignService.archiveCampaign('camp-1', makeReq());

      expect(inst.update).toHaveBeenCalledWith({ status: 'archived' });
    });

    it('throws 400 when campaign is already archived', async () => {
      Campaign.findOne.mockResolvedValue(makeCampaignInstance({ status: 'archived' }));

      await expect(campaignService.archiveCampaign('camp-1', makeReq()))
        .rejects.toThrow('Campaign is already archived');

      try {
        await campaignService.archiveCampaign('camp-1', makeReq());
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('throws 404 when campaign not found', async () => {
      Campaign.findOne.mockResolvedValue(null);

      await expect(campaignService.archiveCampaign('nonexistent', makeReq()))
        .rejects.toThrow('Campaign not found or access denied');
    });

    it('detaches car QR tags on archive', async () => {
      Campaign.findOne.mockResolvedValue(makeCampaignInstance({ status: 'active' }));

      await campaignService.archiveCampaign('camp-1', makeReq());

      expect(QrTag.update).toHaveBeenCalledWith(
        { campaignId: null },
        { where: { campaignId: 'camp-1', type: 'car' } }
      );
    });
  });

  // ────────────────────────────────────────────────
  // restoreCampaign
  // ────────────────────────────────────────────────

  describe('restoreCampaign', () => {
    it('restores archived campaign to draft status', async () => {
      const inst = makeCampaignInstance({ status: 'archived' });
      Campaign.findOne.mockResolvedValue(inst);

      const result = await campaignService.restoreCampaign('camp-1', makeReq());

      expect(inst.update).toHaveBeenCalledWith({ status: 'draft' });
      expect(result).toBeDefined();
    });

    it('throws 400 when campaign is not archived', async () => {
      Campaign.findOne.mockResolvedValue(makeCampaignInstance({ status: 'active' }));

      await expect(campaignService.restoreCampaign('camp-1', makeReq()))
        .rejects.toThrow('Campaign is not archived');

      try {
        await campaignService.restoreCampaign('camp-1', makeReq());
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('throws 404 when campaign not found', async () => {
      Campaign.findOne.mockResolvedValue(null);

      await expect(campaignService.restoreCampaign('nonexistent', makeReq()))
        .rejects.toThrow('Campaign not found or access denied');
    });
  });

  // ────────────────────────────────────────────────
  // permanentlyDeleteCampaign
  // ────────────────────────────────────────────────

  describe('permanentlyDeleteCampaign', () => {
    it('deletes an archived campaign with no pending commissions', async () => {
      const inst = makeCampaignInstance({ status: 'archived' });
      Campaign.findOne.mockResolvedValue(inst);
      Commission.count.mockResolvedValue(0);

      await campaignService.permanentlyDeleteCampaign('camp-1', makeReq());

      expect(inst.destroy).toHaveBeenCalled();
    });

    it('throws 409 when campaign has pending/approved commissions', async () => {
      Campaign.findOne.mockResolvedValue(makeCampaignInstance({ status: 'archived' }));
      Commission.count.mockResolvedValue(3);

      await expect(campaignService.permanentlyDeleteCampaign('camp-1', makeReq()))
        .rejects.toThrow('Cannot delete campaign with pending/approved commissions');

      try {
        await campaignService.permanentlyDeleteCampaign('camp-1', makeReq());
      } catch (err) {
        expect(err.statusCode).toBe(409);
      }
    });

    it('throws 400 when campaign is not archived', async () => {
      Campaign.findOne.mockResolvedValue(makeCampaignInstance({ status: 'active' }));

      await expect(campaignService.permanentlyDeleteCampaign('camp-1', makeReq()))
        .rejects.toThrow('Campaign must be archived before permanent deletion');
    });

    it('throws 404 when campaign not found', async () => {
      Campaign.findOne.mockResolvedValue(null);

      await expect(campaignService.permanentlyDeleteCampaign('nonexistent', makeReq()))
        .rejects.toThrow('Campaign not found or access denied');
    });
  });

  // ────────────────────────────────────────────────
  // duplicateCampaign
  // ────────────────────────────────────────────────

  describe('duplicateCampaign', () => {
    it('clones campaign with reset metrics and draft status', async () => {
      const original = makeCampaignInstance({
        name: 'Original',
        toJSON() {
          return {
            id: 'camp-1',
            name: 'Original',
            status: 'active',
            createdBy: 'user-1',
            metrics: { leads: 10 },
            spentAmount: 500,
          };
        },
      });
      const copy = makeCampaignInstance({
        id: 'camp-2',
        name: 'Original (Copy)',
        status: 'draft',
        toJSON() {
          return { id: 'camp-2', name: 'Original (Copy)', status: 'draft', spentAmount: 0 };
        },
      });
      Campaign.findOne.mockResolvedValue(original);
      Campaign.create.mockResolvedValue(copy);

      const result = await campaignService.duplicateCampaign('camp-1', {}, makeReq());

      const createArg = Campaign.create.mock.calls[0][0];
      expect(createArg.status).toBe('draft');
      expect(createArg.spentAmount).toBe(0);
      expect(createArg.id).toBeUndefined();
      expect(createArg.createdBy).toBe('user-1');
      expect(result.id).toBe('camp-2');
    });

    it('uses custom name when provided in body', async () => {
      const original = makeCampaignInstance({
        toJSON() {
          return { id: 'camp-1', name: 'Original', metrics: {} };
        },
      });
      const copy = makeCampaignInstance({
        id: 'camp-2',
        toJSON() { return { id: 'camp-2', name: 'My Copy' }; },
      });
      Campaign.findOne.mockResolvedValue(original);
      Campaign.create.mockResolvedValue(copy);

      await campaignService.duplicateCampaign('camp-1', { name: 'My Copy' }, makeReq());

      const createArg = Campaign.create.mock.calls[0][0];
      expect(createArg.name).toBe('My Copy');
    });

    it('throws 404 when original campaign not found', async () => {
      Campaign.findOne.mockResolvedValue(null);

      await expect(campaignService.duplicateCampaign('nonexistent', {}, makeReq()))
        .rejects.toThrow('Campaign not found or access denied');
    });
  });

  // ────────────────────────────────────────────────
  // getCampaignAnalytics
  // ────────────────────────────────────────────────

  describe('getCampaignAnalytics', () => {
    it('returns QR + prospect funnel data', async () => {
      Campaign.findOne.mockResolvedValue(makeCampaignInstance());

      const qrTags = [
        {
          id: 'qr-1', name: 'QR A', scanCount: 20, uniqueScanCount: 15,
          lastScanned: '2026-01-01', analytics: { conversions: 4 },
        },
        {
          id: 'qr-2', name: 'QR B', scanCount: 0, uniqueScanCount: 0,
          lastScanned: null, analytics: {},
        },
      ];
      QrTag.findAll.mockResolvedValue(qrTags);

      // Prospect stats (findAll for group-by)
      Prospect.findAll.mockResolvedValue([
        { leadStatus: 'new', dataValues: { count: 10 } },
        { leadStatus: 'won', dataValues: { count: 3 } },
      ]);

      // Prospect.count calls order:
      // 1-3: getCampaignAnalytics direct calls (totalProspects, qualified, converted)
      // 4-5: computeCampaignMetrics (total leads, won conversions)
      Prospect.count
        .mockResolvedValueOnce(13)   // totalProspects (analytics)
        .mockResolvedValueOnce(5)    // qualifiedProspects (analytics)
        .mockResolvedValueOnce(3)    // convertedProspects (analytics)
        .mockResolvedValueOnce(20)   // computeCampaignMetrics: total leads
        .mockResolvedValueOnce(3);   // computeCampaignMetrics: conversions (won)

      QrTag.sum.mockResolvedValue(20);
      Commission.sum.mockResolvedValue(1000);

      const result = await campaignService.getCampaignAnalytics('camp-1', makeReq());

      expect(result.campaign.totalQrTags).toBe(2);
      expect(result.campaign.totalScans).toBe(20);
      expect(result.campaign.metrics).toBeDefined();
      expect(result.campaign.metrics.leads).toBe(20);

      expect(result.prospects.total).toBe(13);
      expect(result.prospects.qualified).toBe(5);
      expect(result.prospects.converted).toBe(3);
      expect(result.prospects.byStatus).toHaveLength(2);

      expect(result.qrTags).toHaveLength(2);
      expect(result.qrTags[0].conversionRate).toBe('20.00');
      expect(result.qrTags[1].conversionRate).toBe(0);
    });

    it('returns 0 conversion rate when no prospects exist', async () => {
      Campaign.findOne.mockResolvedValue(makeCampaignInstance());
      QrTag.findAll.mockResolvedValue([]);
      Prospect.findAll.mockResolvedValue([]);
      Prospect.count.mockResolvedValue(0);
      QrTag.sum.mockResolvedValue(0);
      Commission.sum.mockResolvedValue(0);

      const result = await campaignService.getCampaignAnalytics('camp-1', makeReq());

      expect(result.prospects.conversionRate).toBe(0);
    });

    it('throws 404 when campaign not found', async () => {
      Campaign.findOne.mockResolvedValue(null);

      await expect(campaignService.getCampaignAnalytics('nonexistent', makeReq()))
        .rejects.toThrow('Campaign not found or access denied');
    });
  });

  // ────────────────────────────────────────────────
  // updateCampaignMetrics
  // ────────────────────────────────────────────────

  describe('updateCampaignMetrics', () => {
    it('computes and returns metrics from real data', async () => {
      const inst = makeCampaignInstance();
      Campaign.findOne.mockResolvedValue(inst);

      Prospect.count
        .mockResolvedValueOnce(30)
        .mockResolvedValueOnce(8);
      QrTag.sum.mockResolvedValue(100);
      Commission.sum.mockResolvedValue(5000);

      const result = await campaignService.updateCampaignMetrics('camp-1', {}, makeReq());

      expect(result.metrics.leads).toBe(30);
      expect(result.metrics.conversions).toBe(8);
      expect(result.metrics.views).toBe(100);
      expect(result.metrics.revenue).toBe(5000);
    });

    it('throws 404 when campaign not found', async () => {
      Campaign.findOne.mockResolvedValue(null);

      await expect(campaignService.updateCampaignMetrics('nonexistent', {}, makeReq()))
        .rejects.toThrow('Campaign not found or access denied');
    });
  });
});
