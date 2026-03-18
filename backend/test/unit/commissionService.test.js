import { jest } from '@jest/globals';
import '../setup.js';
import { Op } from 'sequelize';
import { makeCommissionService } from '../../src/services/commissionService.js';

// ── Helpers ──

function buildMocks() {
  const mockCommission = {
    id: 'comm-1',
    agentId: 'agent-1',
    amount: 100,
    baseAmount: 1000,
    rate: 0.1,
    type: 'conversion',
    status: 'pending',
    description: 'Test commission',
    campaignId: 'camp-1',
    prospectId: 'prospect-1',
    leadPackageId: null,
    earnedDate: new Date('2026-01-15'),
    approvedBy: null,
    processedBy: null,
    paidDate: null,
    paymentInfo: null,
    metadata: {},
    update: jest.fn().mockResolvedValue(true),
    toJSON: jest.fn(function () { return { ...this }; }),
  };

  const mockAgent = {
    id: 'agent-1',
    firstName: 'Agent',
    lastName: 'Smith',
    email: 'agent@test.com',
    phone: '+6590000001',
    role: 'agent',
    isActive: true,
  };

  const mockCampaign = {
    id: 'camp-1',
    name: 'Test Campaign',
    type: 'lead_gen',
  };

  const mockLeadPackage = {
    id: 'pkg-1',
    name: 'Basic',
    type: 'standard',
    price: 500,
    commissionStructure: { agentCommission: 0.15 },
  };

  // --- Models ---

  const Commission = {
    create: jest.fn().mockResolvedValue(mockCommission),
    findOne: jest.fn().mockResolvedValue(null),
    findByPk: jest.fn().mockResolvedValue(mockCommission),
    findAll: jest.fn().mockResolvedValue([]),
    findAndCountAll: jest.fn().mockResolvedValue({ count: 0, rows: [] }),
    count: jest.fn().mockResolvedValue(0),
    sum: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue([0]),
  };

  const User = {
    findOne: jest.fn().mockResolvedValue(mockAgent),
    findByPk: jest.fn().mockResolvedValue(mockAgent),
  };

  const Campaign = {
    findAll: jest.fn().mockResolvedValue([]),
    findByPk: jest.fn().mockResolvedValue(mockCampaign),
  };

  const LeadPackage = {
    findByPk: jest.fn().mockResolvedValue(mockLeadPackage),
  };

  // --- Non-model deps ---

  const sequelize = {
    fn: jest.fn((fnName, col) => `${fnName}(${col})`),
    col: jest.fn((name) => name),
    literal: jest.fn((expr) => expr),
    query: jest.fn().mockResolvedValue([[]]),
  };

  const AppError = class extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
    }
  };

  return {
    mockCommission,
    mockAgent,
    mockCampaign,
    mockLeadPackage,
    models: { Commission, User, Campaign, LeadPackage },
    sequelize,
    AppError,
  };
}

function makeService(mocks) {
  return makeCommissionService({
    models: mocks.models,
    sequelize: mocks.sequelize,
    AppError: mocks.AppError,
  });
}

// ── Tests ──

describe('commissionService (unit)', () => {
  let mocks, service;

  beforeEach(() => {
    mocks = buildMocks();
    service = makeService(mocks);
  });

  // ────────────────────────────────────────────────
  // periodToStartDate
  // ────────────────────────────────────────────────

  describe('periodToStartDate', () => {
    it('returns 7 days ago for "week"', () => {
      const result = service._periodToStartDate('week');
      const expected = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      // Allow 1 second tolerance
      expect(Math.abs(result.getTime() - expected.getTime())).toBeLessThan(1000);
    });

    it('returns first of current month for "month"', () => {
      const now = new Date();
      const result = service._periodToStartDate('month');
      expect(result.getFullYear()).toBe(now.getFullYear());
      expect(result.getMonth()).toBe(now.getMonth());
      expect(result.getDate()).toBe(1);
    });

    it('returns first of current quarter for "quarter"', () => {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3);
      const result = service._periodToStartDate('quarter');
      expect(result.getFullYear()).toBe(now.getFullYear());
      expect(result.getMonth()).toBe(q * 3);
      expect(result.getDate()).toBe(1);
    });

    it('returns January 1 of current year for "year"', () => {
      const now = new Date();
      const result = service._periodToStartDate('year');
      expect(result.getFullYear()).toBe(now.getFullYear());
      expect(result.getMonth()).toBe(0);
      expect(result.getDate()).toBe(1);
    });

    it('defaults to first of current month for unknown period', () => {
      const now = new Date();
      const result = service._periodToStartDate('all');
      expect(result.getFullYear()).toBe(now.getFullYear());
      expect(result.getMonth()).toBe(now.getMonth());
      expect(result.getDate()).toBe(1);
    });
  });

  // ────────────────────────────────────────────────
  // buildCommissionWhere
  // ────────────────────────────────────────────────

  describe('buildCommissionWhere', () => {
    it('returns empty where for admin (sees all)', async () => {
      const user = { id: 'admin-1', role: 'admin' };
      const result = await service.buildCommissionWhere(user);
      expect(result).toEqual({});
    });

    it('scopes by agentId for agent role', async () => {
      const user = { id: 'agent-1', role: 'agent' };
      const result = await service.buildCommissionWhere(user);
      expect(result).toEqual({ agentId: 'agent-1' });
    });

    it('returns null for driver_partner (empty set)', async () => {
      const user = { id: 'dp-1', role: 'driver_partner' };
      const result = await service.buildCommissionWhere(user);
      expect(result).toBeNull();
    });

    it('scopes by campaignId for non-admin/non-agent roles', async () => {
      const user = { id: 'manager-1', role: 'manager' };
      mocks.models.Campaign.findAll.mockResolvedValue([{ id: 'camp-1' }, { id: 'camp-2' }]);

      const result = await service.buildCommissionWhere(user);

      expect(mocks.models.Campaign.findAll).toHaveBeenCalledWith({
        where: { createdBy: 'manager-1' },
        attributes: ['id'],
      });
      expect(result.campaignId).toEqual({ [Op.in]: ['camp-1', 'camp-2'] });
    });
  });

  // ────────────────────────────────────────────────
  // listCommissions
  // ────────────────────────────────────────────────

  describe('listCommissions', () => {
    const adminUser = { id: 'admin-1', role: 'admin' };
    const agentUser = { id: 'agent-1', role: 'agent' };

    it('applies pagination correctly', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 25, rows: [] });

      const result = await service.listCommissions(adminUser, { page: 3, limit: 5 });

      const callArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0];
      expect(callArg.offset).toBe(10); // (3-1) * 5
      expect(callArg.limit).toBe(5);
      expect(result.pagination.currentPage).toBe(3);
      expect(result.pagination.totalPages).toBe(5);
      expect(result.pagination.totalItems).toBe(25);
      expect(result.pagination.itemsPerPage).toBe(5);
    });

    it('uses default page=1 and limit=10', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(adminUser, {});

      const callArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0];
      expect(callArg.offset).toBe(0);
      expect(callArg.limit).toBe(10);
    });

    it('filters by status', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(adminUser, { status: 'pending' });

      const whereArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.status).toBe('pending');
    });

    it('filters by type', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(adminUser, { type: 'conversion' });

      const whereArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.type).toBe('conversion');
    });

    it('filters by agentId for admin only', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(adminUser, { agentId: 'agent-2' });

      const whereArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.agentId).toBe('agent-2');
    });

    it('ignores agentId filter for non-admin', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(agentUser, { agentId: 'agent-2' });

      const whereArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0].where;
      // Agent role gets scoped to own agentId, not the filter value
      expect(whereArg.agentId).toBe('agent-1');
    });

    it('filters by campaignId', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(adminUser, { campaignId: 'camp-1' });

      const whereArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.campaignId).toBe('camp-1');
    });

    it('applies date range filters', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(adminUser, { dateFrom: '2026-01-01', dateTo: '2026-12-31' });

      const whereArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.earnedDate).toBeDefined();
      expect(whereArg.earnedDate[Op.gte]).toEqual(new Date('2026-01-01'));
      expect(whereArg.earnedDate[Op.lte]).toEqual(new Date('2026-12-31'));
    });

    it('applies period filter (overrides dateFrom/dateTo)', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(adminUser, { period: 'year' });

      const whereArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.earnedDate).toBeDefined();
      expect(whereArg.earnedDate[Op.gte]).toBeDefined();
      expect(whereArg.earnedDate[Op.lte]).toBeDefined();
    });

    it('scopes agent to own commissions', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(agentUser, {});

      const whereArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.agentId).toBe('agent-1');
    });

    it('sorts by earnedDate DESC by default', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(adminUser, {});

      const callArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0];
      expect(callArg.order).toEqual([['earnedDate', 'DESC']]);
    });

    it('returns empty set for driver_partner role', async () => {
      const dpUser = { id: 'dp-1', role: 'driver_partner' };

      const result = await service.listCommissions(dpUser, { limit: 10 });

      expect(result.commissions).toEqual([]);
      expect(result.pagination.totalItems).toBe(0);
      expect(mocks.models.Commission.findAndCountAll).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // getCommission
  // ────────────────────────────────────────────────

  describe('getCommission', () => {
    const adminUser = { id: 'admin-1', role: 'admin' };
    const agentUser = { id: 'agent-1', role: 'agent' };

    it('returns commission when found', async () => {
      mocks.models.Commission.findOne.mockResolvedValue(mocks.mockCommission);

      const result = await service.getCommission('comm-1', adminUser);

      expect(result).toBe(mocks.mockCommission);
      expect(mocks.models.Commission.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'comm-1' }),
        })
      );
    });

    it('throws 404 when not found', async () => {
      mocks.models.Commission.findOne.mockResolvedValue(null);

      await expect(service.getCommission('nonexistent', adminUser))
        .rejects.toThrow('Commission not found or access denied');

      try {
        await service.getCommission('nonexistent', adminUser);
      } catch (err) {
        expect(err.statusCode).toBe(404);
      }
    });

    it('agent can only see own commissions (scoped where)', async () => {
      mocks.models.Commission.findOne.mockResolvedValue(mocks.mockCommission);

      await service.getCommission('comm-1', agentUser);

      const whereArg = mocks.models.Commission.findOne.mock.calls[0][0].where;
      expect(whereArg.id).toBe('comm-1');
      expect(whereArg.agentId).toBe('agent-1');
    });

    it('throws 404 for driver_partner role', async () => {
      const dpUser = { id: 'dp-1', role: 'driver_partner' };

      await expect(service.getCommission('comm-1', dpUser))
        .rejects.toThrow('Commission not found or access denied');
    });
  });

  // ────────────────────────────────────────────────
  // createCommission
  // ────────────────────────────────────────────────

  describe('createCommission', () => {
    it('creates commission with all fields', async () => {
      await service.createCommission({
        agentId: 'agent-1',
        amount: 150,
        type: 'conversion',
        description: 'Sale commission',
        campaignId: 'camp-1',
        prospectId: 'prospect-1',
        leadPackageId: null,
        metadata: { source: 'manual' },
      });

      expect(mocks.models.Commission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          amount: 150,
          type: 'conversion',
          description: 'Sale commission',
          campaignId: 'camp-1',
          prospectId: 'prospect-1',
          earnedDate: expect.any(Date),
        })
      );
    });

    it('throws 400 when agentId is missing', async () => {
      await expect(service.createCommission({ amount: 100, type: 'conversion' }))
        .rejects.toThrow('Agent ID, amount, and type are required');

      try {
        await service.createCommission({ amount: 100, type: 'conversion' });
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('throws 400 when amount is missing', async () => {
      await expect(service.createCommission({ agentId: 'agent-1', type: 'conversion' }))
        .rejects.toThrow('Agent ID, amount, and type are required');
    });

    it('throws 400 when type is missing', async () => {
      await expect(service.createCommission({ agentId: 'agent-1', amount: 100 }))
        .rejects.toThrow('Agent ID, amount, and type are required');
    });

    it('throws 400 for invalid or inactive agent', async () => {
      mocks.models.User.findOne.mockResolvedValue(null);

      await expect(service.createCommission({
        agentId: 'bad-agent',
        amount: 100,
        type: 'conversion',
      })).rejects.toThrow('Invalid or inactive agent');

      try {
        await service.createCommission({ agentId: 'bad-agent', amount: 100, type: 'conversion' });
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('validates agent with correct query', async () => {
      await service.createCommission({
        agentId: 'agent-1',
        amount: 100,
        type: 'conversion',
      });

      expect(mocks.models.User.findOne).toHaveBeenCalledWith({
        where: { id: 'agent-1', role: 'agent', isActive: true },
      });
    });

    it('resolves baseAmount and rate from leadPackage', async () => {
      await service.createCommission({
        agentId: 'agent-1',
        amount: 75,
        type: 'lead_package',
        leadPackageId: 'pkg-1',
      });

      const createArg = mocks.models.Commission.create.mock.calls[0][0];
      expect(createArg.baseAmount).toBe(500);
      expect(createArg.rate).toBe(0.15);
    });

    it('uses default rate 0.1 when leadPackage has no agentCommission', async () => {
      mocks.models.LeadPackage.findByPk.mockResolvedValue({
        ...mocks.mockLeadPackage,
        commissionStructure: {},
      });

      await service.createCommission({
        agentId: 'agent-1',
        amount: 50,
        type: 'lead_package',
        leadPackageId: 'pkg-1',
      });

      const createArg = mocks.models.Commission.create.mock.calls[0][0];
      expect(createArg.rate).toBe(0.1);
    });

    it('sets null baseAmount/rate when no leadPackageId', async () => {
      await service.createCommission({
        agentId: 'agent-1',
        amount: 100,
        type: 'conversion',
      });

      const createArg = mocks.models.Commission.create.mock.calls[0][0];
      expect(createArg.baseAmount).toBeNull();
      expect(createArg.rate).toBeNull();
    });
  });

  // ────────────────────────────────────────────────
  // updateCommission
  // ────────────────────────────────────────────────

  describe('updateCommission', () => {
    it('updates commission successfully', async () => {
      const commission = {
        ...mocks.mockCommission,
        status: 'pending',
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Commission.findByPk.mockResolvedValue(commission);

      const result = await service.updateCommission('comm-1', { amount: 200 });

      expect(commission.update).toHaveBeenCalledWith({ amount: 200 });
      expect(result).toBe(commission);
    });

    it('throws 400 when commission is paid', async () => {
      const paidCommission = {
        ...mocks.mockCommission,
        status: 'paid',
      };
      mocks.models.Commission.findByPk.mockResolvedValue(paidCommission);

      await expect(service.updateCommission('comm-1', { amount: 200 }))
        .rejects.toThrow('Cannot update paid commissions');

      try {
        await service.updateCommission('comm-1', { amount: 200 });
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('throws 404 when commission not found', async () => {
      mocks.models.Commission.findByPk.mockResolvedValue(null);

      await expect(service.updateCommission('nonexistent', { amount: 200 }))
        .rejects.toThrow('Commission not found');

      try {
        await service.updateCommission('nonexistent', { amount: 200 });
      } catch (err) {
        expect(err.statusCode).toBe(404);
      }
    });
  });

  // ────────────────────────────────────────────────
  // approveCommission
  // ────────────────────────────────────────────────

  describe('approveCommission', () => {
    it('approves a pending commission', async () => {
      const commission = {
        ...mocks.mockCommission,
        status: 'pending',
        metadata: {},
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Commission.findByPk.mockResolvedValue(commission);

      const result = await service.approveCommission('comm-1', 'admin-1', 'Looks good');

      expect(commission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'approved',
          approvedBy: 'admin-1',
          metadata: expect.objectContaining({
            approvalNotes: 'Looks good',
            approvedAt: expect.any(Date),
          }),
        })
      );
      expect(result).toBe(commission);
    });

    it('throws 400 when commission is not pending', async () => {
      const approvedCommission = {
        ...mocks.mockCommission,
        status: 'approved',
      };
      mocks.models.Commission.findByPk.mockResolvedValue(approvedCommission);

      await expect(service.approveCommission('comm-1', 'admin-1', 'notes'))
        .rejects.toThrow('Only pending commissions can be approved');

      try {
        await service.approveCommission('comm-1', 'admin-1', 'notes');
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('throws 404 when commission not found', async () => {
      mocks.models.Commission.findByPk.mockResolvedValue(null);

      await expect(service.approveCommission('nonexistent', 'admin-1', 'notes'))
        .rejects.toThrow('Commission not found');

      try {
        await service.approveCommission('nonexistent', 'admin-1', 'notes');
      } catch (err) {
        expect(err.statusCode).toBe(404);
      }
    });

    it('sets approvedBy and approvedAt in metadata', async () => {
      const commission = {
        ...mocks.mockCommission,
        status: 'pending',
        metadata: { existingKey: 'value' },
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Commission.findByPk.mockResolvedValue(commission);

      await service.approveCommission('comm-1', 'admin-1', 'Approved');

      const updateArg = commission.update.mock.calls[0][0];
      expect(updateArg.approvedBy).toBe('admin-1');
      expect(updateArg.metadata.approvedAt).toBeInstanceOf(Date);
      expect(updateArg.metadata.existingKey).toBe('value');
    });
  });

  // ────────────────────────────────────────────────
  // payCommission
  // ────────────────────────────────────────────────

  describe('payCommission', () => {
    it('pays an approved commission', async () => {
      const commission = {
        ...mocks.mockCommission,
        status: 'approved',
        amount: 100,
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Commission.findByPk.mockResolvedValue(commission);

      const result = await service.payCommission('comm-1', 'admin-1', {
        paymentMethod: 'bank_transfer',
        transactionId: 'txn-123',
        processingFee: 5,
        notes: 'Paid via bank',
      });

      expect(commission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'paid',
          paidDate: expect.any(Date),
          processedBy: 'admin-1',
          paymentInfo: expect.objectContaining({
            method: 'bank_transfer',
            transactionId: 'txn-123',
            processingFee: 5,
            netAmount: 95,
            notes: 'Paid via bank',
          }),
        })
      );
      expect(result).toBe(commission);
    });

    it('throws 400 when commission is not approved', async () => {
      const pendingCommission = {
        ...mocks.mockCommission,
        status: 'pending',
      };
      mocks.models.Commission.findByPk.mockResolvedValue(pendingCommission);

      await expect(service.payCommission('comm-1', 'admin-1', {
        paymentMethod: 'bank_transfer',
        transactionId: 'txn-123',
      })).rejects.toThrow('Only approved commissions can be marked as paid');

      try {
        await service.payCommission('comm-1', 'admin-1', {
          paymentMethod: 'bank_transfer',
          transactionId: 'txn-123',
        });
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('throws 404 when commission not found', async () => {
      mocks.models.Commission.findByPk.mockResolvedValue(null);

      await expect(service.payCommission('nonexistent', 'admin-1', {
        paymentMethod: 'bank_transfer',
        transactionId: 'txn-123',
      })).rejects.toThrow('Commission not found');
    });

    it('sets payment details with correct net amount', async () => {
      const commission = {
        ...mocks.mockCommission,
        status: 'approved',
        amount: 200,
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Commission.findByPk.mockResolvedValue(commission);

      await service.payCommission('comm-1', 'admin-1', {
        paymentMethod: 'paypal',
        transactionId: 'pp-456',
        processingFee: 10,
        notes: 'PayPal payment',
      });

      const updateArg = commission.update.mock.calls[0][0];
      expect(updateArg.paymentInfo.netAmount).toBe(190);
      expect(updateArg.paymentInfo.paidDate).toBeInstanceOf(Date);
    });

    it('defaults processingFee to 0', async () => {
      const commission = {
        ...mocks.mockCommission,
        status: 'approved',
        amount: 100,
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Commission.findByPk.mockResolvedValue(commission);

      await service.payCommission('comm-1', 'admin-1', {
        paymentMethod: 'bank_transfer',
        transactionId: 'txn-789',
      });

      const updateArg = commission.update.mock.calls[0][0];
      expect(updateArg.paymentInfo.processingFee).toBe(0);
      expect(updateArg.paymentInfo.netAmount).toBe(100);
    });
  });

  // ────────────────────────────────────────────────
  // bulkApproveCommissions
  // ────────────────────────────────────────────────

  describe('bulkApproveCommissions', () => {
    it('approves multiple pending commissions', async () => {
      mocks.models.Commission.update.mockResolvedValue([3]);

      const result = await service.bulkApproveCommissions(
        ['comm-1', 'comm-2', 'comm-3'],
        'admin-1',
        'Bulk approved'
      );

      expect(result).toBe(3);
      expect(mocks.models.Commission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'approved',
          approvedBy: 'admin-1',
        }),
        expect.objectContaining({
          where: expect.objectContaining({
            id: { [Op.in]: ['comm-1', 'comm-2', 'comm-3'] },
            status: 'pending',
          }),
        })
      );
    });

    it('returns 0 when no pending commissions match (partial success)', async () => {
      mocks.models.Commission.update.mockResolvedValue([0]);

      const result = await service.bulkApproveCommissions(
        ['comm-already-approved'],
        'admin-1',
        'notes'
      );

      expect(result).toBe(0);
    });

    it('throws 400 for non-array input', async () => {
      await expect(service.bulkApproveCommissions('not-an-array', 'admin-1', 'notes'))
        .rejects.toThrow('Commission IDs array is required');

      try {
        await service.bulkApproveCommissions('not-an-array', 'admin-1', 'notes');
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('throws 400 for null input', async () => {
      await expect(service.bulkApproveCommissions(null, 'admin-1', 'notes'))
        .rejects.toThrow('Commission IDs array is required');
    });

    it('handles empty array (updates with no IDs)', async () => {
      mocks.models.Commission.update.mockResolvedValue([0]);

      const result = await service.bulkApproveCommissions([], 'admin-1', 'notes');

      expect(result).toBe(0);
    });

    it('uses sequelize.literal for metadata merge', async () => {
      mocks.models.Commission.update.mockResolvedValue([1]);

      await service.bulkApproveCommissions(['comm-1'], 'admin-1', 'Approved');

      expect(mocks.sequelize.literal).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // getCommissionStats
  // ────────────────────────────────────────────────

  describe('getCommissionStats', () => {
    const adminUser = { id: 'admin-1', role: 'admin' };
    const agentUser = { id: 'agent-1', role: 'agent' };

    it('returns totals by status', async () => {
      mocks.models.Commission.sum.mockResolvedValue(5000);
      mocks.models.Commission.count.mockResolvedValue(10);
      mocks.models.Commission.findAll
        .mockResolvedValueOnce([ // byStatus
          { status: 'pending', dataValues: { count: '5', total: '2500' } },
          { status: 'approved', dataValues: { count: '3', total: '1500' } },
          { status: 'paid', dataValues: { count: '2', total: '1000' } },
        ])
        .mockResolvedValueOnce([ // byType
          { type: 'conversion', dataValues: { count: '10', total: '5000' } },
        ])
        .mockResolvedValueOnce([]); // topCampaigns

      mocks.sequelize.query.mockResolvedValue([[]]);

      const result = await service.getCommissionStats(adminUser, { period: 'month' });

      expect(result.summary.totalAmount).toBe(5000);
      expect(result.summary.totalCount).toBe(10);
      expect(result.summary.averageCommission).toBe('500.00');
      expect(result.byStatus).toHaveLength(3);
      expect(result.byStatus[0]).toEqual({ status: 'pending', count: 5, total: 2500 });
    });

    it('applies period filtering', async () => {
      mocks.models.Commission.sum.mockResolvedValue(null);
      mocks.models.Commission.count.mockResolvedValue(0);
      mocks.models.Commission.findAll.mockResolvedValue([]);
      mocks.sequelize.query.mockResolvedValue([[]]);

      await service.getCommissionStats(adminUser, { period: 'year' });

      // Verify sum was called with a where clause including earnedDate
      const sumCall = mocks.models.Commission.sum.mock.calls[0];
      expect(sumCall[0]).toBe('amount');
      expect(sumCall[1].where.earnedDate).toBeDefined();
    });

    it('scopes to agent for agent role', async () => {
      mocks.models.Commission.sum.mockResolvedValue(null);
      mocks.models.Commission.count.mockResolvedValue(0);
      mocks.models.Commission.findAll.mockResolvedValue([]);
      mocks.sequelize.query.mockResolvedValue([[]]);

      await service.getCommissionStats(agentUser, {});

      const sumCall = mocks.models.Commission.sum.mock.calls[0];
      expect(sumCall[1].where.agentId).toBe('agent-1');
    });

    it('admin can filter by agentId', async () => {
      mocks.models.Commission.sum.mockResolvedValue(null);
      mocks.models.Commission.count.mockResolvedValue(0);
      mocks.models.Commission.findAll.mockResolvedValue([]);
      mocks.sequelize.query.mockResolvedValue([[]]);

      await service.getCommissionStats(adminUser, { agentId: 'agent-2' });

      const sumCall = mocks.models.Commission.sum.mock.calls[0];
      expect(sumCall[1].where.agentId).toBe('agent-2');
    });

    it('returns empty stats when no data', async () => {
      mocks.models.Commission.sum.mockResolvedValue(null);
      mocks.models.Commission.count.mockResolvedValue(0);
      mocks.models.Commission.findAll.mockResolvedValue([]);
      mocks.sequelize.query.mockResolvedValue([[]]);

      const result = await service.getCommissionStats(adminUser, {});

      expect(result.summary.totalAmount).toBe(0);
      expect(result.summary.totalCount).toBe(0);
      expect(result.summary.averageCommission).toBe(0);
      expect(result.byStatus).toEqual([]);
      expect(result.byType).toEqual([]);
      expect(result.topCampaigns).toEqual([]);
      expect(result.monthlyTrend).toHaveLength(12);
      result.monthlyTrend.forEach(m => expect(m.total).toBe(0));
    });

    it('returns monthly trend with 12 entries', async () => {
      mocks.models.Commission.sum.mockResolvedValue(1000);
      mocks.models.Commission.count.mockResolvedValue(5);
      mocks.models.Commission.findAll.mockResolvedValue([]);
      mocks.sequelize.query.mockResolvedValue([[]]);

      const result = await service.getCommissionStats(adminUser, {});

      expect(result.monthlyTrend).toHaveLength(12);
      expect(result.monthlyTrend[0]).toHaveProperty('month');
      expect(result.monthlyTrend[0]).toHaveProperty('total');
    });

    it('maps monthly query results into trend', async () => {
      const now = new Date();
      // Use a Date object for the month key, matching what Sequelize returns
      const monthDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const expectedKey = monthDate.toISOString().slice(0, 7);

      mocks.models.Commission.sum.mockResolvedValue(1000);
      mocks.models.Commission.count.mockResolvedValue(5);
      mocks.models.Commission.findAll.mockResolvedValue([]);
      mocks.sequelize.query.mockResolvedValue([[
        { month: monthDate, total: 500 },
      ]]);

      const result = await service.getCommissionStats(adminUser, {});

      const currentEntry = result.monthlyTrend.find(m => m.month === expectedKey);
      expect(currentEntry).toBeDefined();
      expect(currentEntry.total).toBe(500);
    });
  });

  // ────────────────────────────────────────────────
  // getAgentCommissionSummary
  // ────────────────────────────────────────────────

  describe('getAgentCommissionSummary', () => {
    it('returns monthly breakdown for a year', async () => {
      mocks.models.User.findOne.mockResolvedValue(mocks.mockAgent);
      mocks.models.Commission.sum
        .mockResolvedValueOnce(12000)  // totalEarnings
        .mockResolvedValueOnce(8000)   // paidAmount
        .mockResolvedValueOnce(2000);  // pendingAmount
      mocks.models.Commission.count.mockResolvedValue(24);

      mocks.sequelize.query.mockResolvedValue([[
        { month: 1, total: 1000 },
        { month: 3, total: 2000 },
        { month: 6, total: 3000 },
      ]]);

      const result = await service.getAgentCommissionSummary('agent-1', 2026);

      expect(result.agent).toBe(mocks.mockAgent);
      expect(result.summary.totalEarnings).toBe(12000);
      expect(result.summary.totalCommissions).toBe(24);
      expect(result.summary.paidAmount).toBe(8000);
      expect(result.summary.pendingAmount).toBe(2000);
      expect(result.summary.averageCommission).toBe('500.00');

      expect(result.monthlyBreakdown).toHaveLength(12);
      expect(result.monthlyBreakdown[0]).toEqual({ month: 1, total: 1000 });
      expect(result.monthlyBreakdown[1]).toEqual({ month: 2, total: 0 });
      expect(result.monthlyBreakdown[2]).toEqual({ month: 3, total: 2000 });
      expect(result.monthlyBreakdown[5]).toEqual({ month: 6, total: 3000 });
    });

    it('returns empty months when no data', async () => {
      mocks.models.User.findOne.mockResolvedValue(mocks.mockAgent);
      mocks.models.Commission.sum.mockResolvedValue(null);
      mocks.models.Commission.count.mockResolvedValue(0);
      mocks.sequelize.query.mockResolvedValue([[]]);

      const result = await service.getAgentCommissionSummary('agent-1', 2026);

      expect(result.summary.totalEarnings).toBe(0);
      expect(result.summary.totalCommissions).toBe(0);
      expect(result.summary.paidAmount).toBe(0);
      expect(result.summary.pendingAmount).toBe(0);
      expect(result.summary.averageCommission).toBe(0);
      expect(result.monthlyBreakdown).toHaveLength(12);
      result.monthlyBreakdown.forEach(m => expect(m.total).toBe(0));
    });

    it('throws 404 when agent not found', async () => {
      mocks.models.User.findOne.mockResolvedValue(null);

      await expect(service.getAgentCommissionSummary('bad-agent', 2026))
        .rejects.toThrow('Agent not found');

      try {
        await service.getAgentCommissionSummary('bad-agent', 2026);
      } catch (err) {
        expect(err.statusCode).toBe(404);
      }
    });

    it('queries agent with correct attributes', async () => {
      mocks.models.User.findOne.mockResolvedValue(mocks.mockAgent);
      mocks.models.Commission.sum.mockResolvedValue(null);
      mocks.models.Commission.count.mockResolvedValue(0);
      mocks.sequelize.query.mockResolvedValue([[]]);

      await service.getAgentCommissionSummary('agent-1', 2026);

      expect(mocks.models.User.findOne).toHaveBeenCalledWith({
        where: { id: 'agent-1', role: 'agent' },
        attributes: ['id', 'firstName', 'lastName', 'email'],
      });
    });

    it('scopes queries to the given year', async () => {
      mocks.models.User.findOne.mockResolvedValue(mocks.mockAgent);
      mocks.models.Commission.sum.mockResolvedValue(null);
      mocks.models.Commission.count.mockResolvedValue(0);
      mocks.sequelize.query.mockResolvedValue([[]]);

      await service.getAgentCommissionSummary('agent-1', 2025);

      const sumCall = mocks.models.Commission.sum.mock.calls[0];
      const yearStart = new Date(2025, 0, 1);
      const yearEnd = new Date(2025, 11, 31);
      expect(sumCall[1].where.earnedDate[Op.gte]).toEqual(yearStart);
      expect(sumCall[1].where.earnedDate[Op.lte]).toEqual(yearEnd);
    });
  });
});
