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
    baseAmount: 500,
    rate: 0.1,
    type: 'conversion',
    status: 'pending',
    earnedDate: new Date(),
    campaignId: 'camp-1',
    prospectId: 'prospect-1',
    leadPackageId: null,
    approvedBy: null,
    paidDate: null,
    metadata: {},
    update: jest.fn().mockResolvedValue(true),
    destroy: jest.fn().mockResolvedValue(true),
    toJSON: jest.fn(function () { return { ...this }; }),
  };

  const mockAgent = {
    id: 'agent-1',
    firstName: 'Agent',
    lastName: 'Smith',
    email: 'agent@test.com',
    role: 'agent',
    isActive: true,
  };

  const mockCampaign = {
    id: 'camp-1',
    name: 'Test Campaign',
    createdBy: 'admin-1',
  };

  const mockLeadPackage = {
    id: 'pkg-1',
    name: 'Gold Package',
    price: 500,
    commissionStructure: { agentCommission: 0.15 },
  };

  const Commission = {
    create: jest.fn().mockResolvedValue(mockCommission),
    findByPk: jest.fn().mockResolvedValue(mockCommission),
    findOne: jest.fn().mockResolvedValue(mockCommission),
    findAll: jest.fn().mockResolvedValue([]),
    findAndCountAll: jest.fn().mockResolvedValue({ count: 0, rows: [] }),
    count: jest.fn().mockResolvedValue(0),
    sum: jest.fn().mockResolvedValue(0),
    update: jest.fn().mockResolvedValue([1]),
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

describe('commissionLifecycle (unit)', () => {
  let mocks, service;

  beforeEach(() => {
    mocks = buildMocks();
    service = makeService(mocks);
  });

  // ────────────────────────────────────────────────
  // createCommission
  // ────────────────────────────────────────────────

  describe('createCommission', () => {
    it('creates a commission with pending status by default', async () => {
      await service.createCommission({
        agentId: 'agent-1',
        amount: 100,
        type: 'conversion',
        campaignId: 'camp-1',
      });

      expect(mocks.models.Commission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          amount: 100,
          type: 'conversion',
        })
      );
    });

    it('throws when required fields are missing', async () => {
      await expect(service.createCommission({ agentId: 'agent-1' }))
        .rejects.toThrow('Agent ID, amount, and type are required');
    });

    it('throws when agent is invalid or inactive', async () => {
      mocks.models.User.findOne.mockResolvedValue(null);

      await expect(service.createCommission({
        agentId: 'bad-agent',
        amount: 100,
        type: 'conversion',
      })).rejects.toThrow('Invalid or inactive agent');
    });

    it('sets baseAmount and rate from lead package when provided', async () => {
      await service.createCommission({
        agentId: 'agent-1',
        amount: 75,
        type: 'package_sale',
        leadPackageId: 'pkg-1',
      });

      const createArg = mocks.models.Commission.create.mock.calls[0][0];
      expect(createArg.baseAmount).toBe(500);
      expect(createArg.rate).toBe(0.15);
    });

    it('sets baseAmount/rate to null when no lead package', async () => {
      await service.createCommission({
        agentId: 'agent-1',
        amount: 50,
        type: 'bonus',
      });

      const createArg = mocks.models.Commission.create.mock.calls[0][0];
      expect(createArg.baseAmount).toBeNull();
      expect(createArg.rate).toBeNull();
    });
  });

  // ────────────────────────────────────────────────
  // approveCommission
  // ────────────────────────────────────────────────

  describe('approveCommission', () => {
    it('approves a pending commission and sets approvedBy', async () => {
      const commission = { ...mocks.mockCommission, status: 'pending', metadata: {}, update: jest.fn().mockResolvedValue(true) };
      mocks.models.Commission.findByPk.mockResolvedValue(commission);

      await service.approveCommission('comm-1', 'admin-1', 'Looks good');

      expect(commission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'approved',
          approvedBy: 'admin-1',
        })
      );

      const updateArg = commission.update.mock.calls[0][0];
      expect(updateArg.metadata.approvalNotes).toBe('Looks good');
      expect(updateArg.metadata.approvedAt).toBeDefined();
    });

    it('throws when commission is not pending', async () => {
      const commission = { ...mocks.mockCommission, status: 'approved' };
      mocks.models.Commission.findByPk.mockResolvedValue(commission);

      await expect(service.approveCommission('comm-1', 'admin-1', ''))
        .rejects.toThrow('Only pending commissions can be approved');
    });

    it('throws when commission is not found', async () => {
      mocks.models.Commission.findByPk.mockResolvedValue(null);

      await expect(service.approveCommission('nonexistent', 'admin-1', ''))
        .rejects.toThrow('Commission not found');
    });

    it('cannot re-approve an already approved commission', async () => {
      const commission = { ...mocks.mockCommission, status: 'approved' };
      mocks.models.Commission.findByPk.mockResolvedValue(commission);

      await expect(service.approveCommission('comm-1', 'admin-2', 'Again'))
        .rejects.toThrow('Only pending commissions can be approved');
    });
  });

  // ────────────────────────────────────────────────
  // payCommission
  // ────────────────────────────────────────────────

  describe('payCommission', () => {
    it('pays an approved commission and sets payment info', async () => {
      const commission = { ...mocks.mockCommission, status: 'approved', amount: 100, update: jest.fn().mockResolvedValue(true) };
      mocks.models.Commission.findByPk.mockResolvedValue(commission);

      await service.payCommission('comm-1', 'admin-1', {
        paymentMethod: 'bank_transfer',
        transactionId: 'tx-123',
        processingFee: 5,
        notes: 'Paid via DBS',
      });

      expect(commission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'paid',
          processedBy: 'admin-1',
        })
      );

      const updateArg = commission.update.mock.calls[0][0];
      expect(updateArg.paymentInfo.method).toBe('bank_transfer');
      expect(updateArg.paymentInfo.transactionId).toBe('tx-123');
      expect(updateArg.paymentInfo.processingFee).toBe(5);
      expect(updateArg.paymentInfo.netAmount).toBe(95);
    });

    it('throws when commission is not approved', async () => {
      const commission = { ...mocks.mockCommission, status: 'pending' };
      mocks.models.Commission.findByPk.mockResolvedValue(commission);

      await expect(service.payCommission('comm-1', 'admin-1', { paymentMethod: 'cash' }))
        .rejects.toThrow('Only approved commissions can be marked as paid');
    });

    it('cannot skip from pending to paid directly', async () => {
      const commission = { ...mocks.mockCommission, status: 'pending' };
      mocks.models.Commission.findByPk.mockResolvedValue(commission);

      await expect(service.payCommission('comm-1', 'admin-1', { paymentMethod: 'cash' }))
        .rejects.toThrow('Only approved commissions can be marked as paid');
    });

    it('cannot pay an already paid commission', async () => {
      const commission = { ...mocks.mockCommission, status: 'paid' };
      mocks.models.Commission.findByPk.mockResolvedValue(commission);

      await expect(service.payCommission('comm-1', 'admin-1', { paymentMethod: 'cash' }))
        .rejects.toThrow('Only approved commissions can be marked as paid');
    });

    it('throws when commission not found', async () => {
      mocks.models.Commission.findByPk.mockResolvedValue(null);

      await expect(service.payCommission('nonexistent', 'admin-1', { paymentMethod: 'cash' }))
        .rejects.toThrow('Commission not found');
    });
  });

  // ────────────────────────────────────────────────
  // updateCommission
  // ────────────────────────────────────────────────

  describe('updateCommission', () => {
    it('cannot update paid commissions', async () => {
      const commission = { ...mocks.mockCommission, status: 'paid' };
      mocks.models.Commission.findByPk.mockResolvedValue(commission);

      await expect(service.updateCommission('comm-1', { amount: 200 }))
        .rejects.toThrow('Cannot update paid commissions');
    });

    it('updates pending commission successfully', async () => {
      const commission = { ...mocks.mockCommission, status: 'pending', update: jest.fn().mockResolvedValue(true) };
      mocks.models.Commission.findByPk.mockResolvedValue(commission);

      await service.updateCommission('comm-1', { amount: 200 });

      expect(commission.update).toHaveBeenCalledWith({ amount: 200 });
    });
  });

  // ────────────────────────────────────────────────
  // bulkApproveCommissions
  // ────────────────────────────────────────────────

  describe('bulkApproveCommissions', () => {
    it('bulk approves only pending commissions', async () => {
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
          where: { id: { [Op.in]: ['comm-1', 'comm-2', 'comm-3'] }, status: 'pending' },
        })
      );
    });

    it('throws when commissionIds is not an array', async () => {
      await expect(service.bulkApproveCommissions(null, 'admin-1', ''))
        .rejects.toThrow('Commission IDs array is required');
    });

    it('returns 0 when none are pending', async () => {
      mocks.models.Commission.update.mockResolvedValue([0]);

      const result = await service.bulkApproveCommissions(['comm-paid'], 'admin-1', '');

      expect(result).toBe(0);
    });
  });

  // ────────────────────────────────────────────────
  // getCommissionStats
  // ────────────────────────────────────────────────

  describe('getCommissionStats', () => {
    it('returns correct stat structure for admin', async () => {
      mocks.models.Commission.sum.mockResolvedValue(1000);
      mocks.models.Commission.count.mockResolvedValue(10);
      mocks.models.Commission.findAll
        .mockResolvedValueOnce([
          { status: 'pending', dataValues: { count: '5', total: '500' } },
          { status: 'paid', dataValues: { count: '5', total: '500' } },
        ])
        .mockResolvedValueOnce([
          { type: 'conversion', dataValues: { count: '8', total: '800' } },
          { type: 'bonus', dataValues: { count: '2', total: '200' } },
        ])
        .mockResolvedValueOnce([]);

      const user = { id: 'admin-1', role: 'admin' };
      const result = await service.getCommissionStats(user, { period: 'month' });

      expect(result.summary.totalAmount).toBe(1000);
      expect(result.summary.totalCount).toBe(10);
      expect(result.summary.averageCommission).toBe('100.00');
      expect(result.byStatus).toHaveLength(2);
      expect(result.byType).toHaveLength(2);
      expect(result.monthlyTrend).toHaveLength(12);
    });

    it('scopes to agent when role is agent', async () => {
      mocks.models.Commission.sum.mockResolvedValue(0);
      mocks.models.Commission.count.mockResolvedValue(0);
      mocks.models.Commission.findAll.mockResolvedValue([]);

      const user = { id: 'agent-1', role: 'agent' };
      await service.getCommissionStats(user, { period: 'month' });

      const sumCall = mocks.models.Commission.sum.mock.calls[0];
      expect(sumCall[1].where.agentId).toBe('agent-1');
    });
  });

  // ────────────────────────────────────────────────
  // getAgentCommissionSummary
  // ────────────────────────────────────────────────

  describe('getAgentCommissionSummary', () => {
    it('returns monthly breakdown with 12 months', async () => {
      mocks.models.User.findOne.mockResolvedValue(mocks.mockAgent);
      mocks.models.Commission.sum.mockResolvedValue(0);
      mocks.models.Commission.count.mockResolvedValue(0);

      const result = await service.getAgentCommissionSummary('agent-1', 2025);

      expect(result.agent).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.monthlyBreakdown).toHaveLength(12);
    });

    it('throws when agent not found', async () => {
      mocks.models.User.findOne.mockResolvedValue(null);

      await expect(service.getAgentCommissionSummary('bad-agent'))
        .rejects.toThrow('Agent not found');
    });
  });

  // ────────────────────────────────────────────────
  // getCommission
  // ────────────────────────────────────────────────

  describe('getCommission', () => {
    it('returns commission when found', async () => {
      mocks.models.Commission.findOne.mockResolvedValue(mocks.mockCommission);

      const result = await service.getCommission('comm-1', { id: 'admin-1', role: 'admin' });

      expect(result).toBeDefined();
      expect(result.id).toBe('comm-1');
    });

    it('throws 404 when commission not found', async () => {
      mocks.models.Commission.findOne.mockResolvedValue(null);

      await expect(service.getCommission('nonexistent', { id: 'admin-1', role: 'admin' }))
        .rejects.toThrow('Commission not found or access denied');
    });

    it('throws for driver_partner role (no access)', async () => {
      await expect(service.getCommission('comm-1', { id: 'driver-1', role: 'driver_partner' }))
        .rejects.toThrow('Commission not found or access denied');
    });
  });

  // ────────────────────────────────────────────────
  // listCommissions
  // ────────────────────────────────────────────────

  describe('listCommissions (filtering)', () => {
    const admin = { id: 'admin-1', role: 'admin' };

    it('applies status filter', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(admin, { page: 1, limit: 10, status: 'pending' });

      const whereArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.status).toBe('pending');
    });

    it('applies type filter', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(admin, { page: 1, limit: 10, type: 'conversion' });

      const whereArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.type).toBe('conversion');
    });

    it('applies date range filters', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(admin, {
        page: 1,
        limit: 10,
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
      });

      const whereArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.earnedDate).toBeDefined();
    });

    it('applies period filter', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(admin, { page: 1, limit: 10, period: 'month' });

      const whereArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.earnedDate).toBeDefined();
    });

    it('paginates correctly', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 25, rows: [] });

      const result = await service.listCommissions(admin, { page: 3, limit: 5 });

      const callArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0];
      expect(callArg.offset).toBe(10);
      expect(callArg.limit).toBe(5);
      expect(result.pagination.currentPage).toBe(3);
      expect(result.pagination.totalPages).toBe(5);
    });

    it('allows admin to filter by agentId', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(admin, { page: 1, limit: 10, agentId: 'agent-1' });

      const whereArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.agentId).toBe('agent-1');
    });

    it('ignores agentId filter for non-admin', async () => {
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(
        { id: 'agent-1', role: 'agent' },
        { page: 1, limit: 10, agentId: 'agent-2' }
      );

      const whereArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0].where;
      // Agent should only see their own, not agent-2
      expect(whereArg.agentId).toBe('agent-1');
    });
  });

  // ────────────────────────────────────────────────
  // periodToStartDate
  // ────────────────────────────────────────────────

  describe('periodToStartDate', () => {
    it('today returns start of today', () => {
      const startDate = service._periodToStartDate('today');
      const now = new Date();
      expect(startDate.getFullYear()).toBe(now.getFullYear());
      expect(startDate.getMonth()).toBe(now.getMonth());
      expect(startDate.getDate()).toBe(now.getDate());
    });

    it('week returns 7 days ago', () => {
      const startDate = service._periodToStartDate('week');
      const expected = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      expect(Math.abs(startDate.getTime() - expected.getTime())).toBeLessThan(1000);
    });

    it('month returns first of current month', () => {
      const startDate = service._periodToStartDate('month');
      const now = new Date();
      expect(startDate.getDate()).toBe(1);
      expect(startDate.getMonth()).toBe(now.getMonth());
    });

    it('year returns Jan 1 of current year', () => {
      const startDate = service._periodToStartDate('year');
      const now = new Date();
      expect(startDate.getMonth()).toBe(0);
      expect(startDate.getDate()).toBe(1);
      expect(startDate.getFullYear()).toBe(now.getFullYear());
    });

    it('quarter returns start of current quarter', () => {
      const startDate = service._periodToStartDate('quarter');
      const now = new Date();
      const quarter = Math.floor(now.getMonth() / 3);
      expect(startDate.getMonth()).toBe(quarter * 3);
      expect(startDate.getDate()).toBe(1);
    });

    it('unknown period defaults to month', () => {
      const startDate = service._periodToStartDate('foobar');
      const monthStart = service._periodToStartDate('month');
      expect(startDate.getTime()).toBe(monthStart.getTime());
    });
  });

  // ────────────────────────────────────────────────
  // buildCommissionWhere (role scoping)
  // ────────────────────────────────────────────────

  describe('listCommissions (role scoping)', () => {
    it('returns empty for driver_partner role', async () => {
      const user = { id: 'driver-1', role: 'driver_partner' };
      const result = await service.listCommissions(user, { page: 1, limit: 10 });

      expect(result.commissions).toEqual([]);
      expect(result.pagination.totalItems).toBe(0);
    });

    it('scopes by agentId for agent role', async () => {
      const user = { id: 'agent-1', role: 'agent' };
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(user, { page: 1, limit: 10 });

      const whereArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.agentId).toBe('agent-1');
    });

    it('scopes by created campaigns for non-admin/non-agent role', async () => {
      const user = { id: 'user-1', role: 'fleet_owner' };
      mocks.models.Campaign.findAll.mockResolvedValue([{ id: 'camp-1' }, { id: 'camp-2' }]);
      mocks.models.Commission.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listCommissions(user, { page: 1, limit: 10 });

      const whereArg = mocks.models.Commission.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.campaignId).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────
  // createCommission edge cases
  // ────────────────────────────────────────────────

  describe('createCommission (edge cases)', () => {
    it('parses amount as float', async () => {
      await service.createCommission({
        agentId: 'agent-1',
        amount: '99.50',
        type: 'conversion',
      });

      const createArg = mocks.models.Commission.create.mock.calls[0][0];
      expect(createArg.amount).toBe(99.5);
    });

    it('sets earnedDate to now', async () => {
      const before = Date.now();
      await service.createCommission({
        agentId: 'agent-1',
        amount: 50,
        type: 'bonus',
      });
      const after = Date.now();

      const createArg = mocks.models.Commission.create.mock.calls[0][0];
      expect(createArg.earnedDate.getTime()).toBeGreaterThanOrEqual(before);
      expect(createArg.earnedDate.getTime()).toBeLessThanOrEqual(after);
    });

    it('handles missing leadPackageId gracefully', async () => {
      await service.createCommission({
        agentId: 'agent-1',
        amount: 50,
        type: 'bonus',
        leadPackageId: null,
      });

      const createArg = mocks.models.Commission.create.mock.calls[0][0];
      expect(createArg.baseAmount).toBeNull();
    });

    it('handles leadPackage not found', async () => {
      mocks.models.LeadPackage.findByPk.mockResolvedValue(null);

      await service.createCommission({
        agentId: 'agent-1',
        amount: 50,
        type: 'bonus',
        leadPackageId: 'nonexistent',
      });

      const createArg = mocks.models.Commission.create.mock.calls[0][0];
      expect(createArg.baseAmount).toBeNull();
    });
  });
});
