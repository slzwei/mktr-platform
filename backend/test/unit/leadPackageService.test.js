import { jest } from '@jest/globals';
import '../setup.js';

// ── Mock models ──

const mockPackage = {
  id: 'pkg-1',
  name: 'Gold Package',
  price: 500,
  leadCount: 50,
  campaignId: 'camp-1',
  type: 'basic',
  status: 'active',
  isPublic: true,
  createdBy: 'admin-1',
  update: jest.fn().mockResolvedValue(true),
  destroy: jest.fn().mockResolvedValue(true),
  toJSON: jest.fn(function () { return { ...this }; }),
};

const mockAssignment = {
  id: 'assign-1',
  agentId: 'agent-1',
  leadPackageId: 'pkg-1',
  leadsTotal: 50,
  leadsRemaining: 45,
  priceSnapshot: 500,
  status: 'active',
  purchaseDate: new Date(),
  update: jest.fn().mockResolvedValue(true),
  destroy: jest.fn().mockResolvedValue(true),
};

const mockAgent = {
  id: 'agent-1',
  firstName: 'Agent',
  lastName: 'Smith',
  email: 'agent@test.com',
};

const LeadPackage = {
  findAll: jest.fn().mockResolvedValue([mockPackage]),
  findByPk: jest.fn().mockResolvedValue(mockPackage),
  create: jest.fn().mockResolvedValue(mockPackage),
};

const LeadPackageAssignment = {
  findAll: jest.fn().mockResolvedValue([mockAssignment]),
  findByPk: jest.fn().mockResolvedValue(mockAssignment),
  create: jest.fn().mockResolvedValue(mockAssignment),
  count: jest.fn().mockResolvedValue(0),
};

const User = {
  findByPk: jest.fn().mockResolvedValue(mockAgent),
  findOne: jest.fn().mockResolvedValue(mockAgent),
};

const Campaign = {
  findByPk: jest.fn().mockResolvedValue({ id: 'camp-1', name: 'Test Campaign' }),
};

const Prospect = {
  count: jest.fn().mockResolvedValue(0),
};

const sequelize = {
  transaction: jest.fn(async (cb) => cb({})),
  query: jest.fn().mockResolvedValue([]),
};

jest.unstable_mockModule('../../src/models/index.js', () => ({
  LeadPackage,
  LeadPackageAssignment,
  User,
  Campaign,
  Prospect,
  sequelize,
}));

jest.unstable_mockModule('../../src/middleware/errorHandler.js', () => ({
  AppError: class AppError extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const {
  listPackages,
  createPackage,
  updatePackage,
  assignPackage,
  getAgentAssignments,
  getExternalAgentPackages,
  deleteAssignment,
  updateAssignment,
  deletePackage,
} = await import('../../src/services/leadPackageService.js');

// ── Tests ──

describe('leadPackageService (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    LeadPackage.findAll.mockResolvedValue([mockPackage]);
    LeadPackage.findByPk.mockResolvedValue({ ...mockPackage, campaign: { name: 'Test Campaign' } });
    LeadPackageAssignment.findByPk.mockResolvedValue({ ...mockAssignment, update: jest.fn().mockResolvedValue(true), destroy: jest.fn().mockResolvedValue(true) });
    LeadPackageAssignment.count.mockResolvedValue(0);
    User.findByPk.mockResolvedValue(mockAgent);
  });

  // ────────────────────────────────────────────────
  // listPackages
  // ────────────────────────────────────────────────

  describe('listPackages', () => {
    it('returns all packages for admin', async () => {
      const result = await listPackages({ userRole: 'admin' });

      expect(result.packages).toHaveLength(1);
    });

    it('filters to active+public for agent role', async () => {
      await listPackages({ userRole: 'agent' });

      const whereArg = LeadPackage.findAll.mock.calls[0][0].where;
      expect(whereArg.status).toBe('active');
      expect(whereArg.isPublic).toBe(true);
    });

    it('applies status filter', async () => {
      await listPackages({ status: 'archived' });

      const whereArg = LeadPackage.findAll.mock.calls[0][0].where;
      expect(whereArg.status).toBe('archived');
    });

    it('applies campaignId filter', async () => {
      await listPackages({ campaignId: 'camp-1' });

      const whereArg = LeadPackage.findAll.mock.calls[0][0].where;
      expect(whereArg.campaignId).toBe('camp-1');
    });
  });

  // ────────────────────────────────────────────────
  // createPackage
  // ────────────────────────────────────────────────

  describe('createPackage', () => {
    it('creates a package with required fields', async () => {
      const result = await createPackage({
        name: 'Silver Package',
        price: 200,
        leadCount: 20,
        campaignId: 'camp-1',
        createdBy: 'admin-1',
      });

      expect(LeadPackage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Silver Package',
          price: 200,
          leadCount: 20,
          status: 'active',
        })
      );
      expect(result.package).toBeDefined();
    });

    it('throws when required fields are missing', async () => {
      await expect(createPackage({ name: 'Incomplete' }))
        .rejects.toThrow('Missing required fields');
    });

    it('defaults type to basic', async () => {
      await createPackage({
        name: 'Test',
        price: 100,
        leadCount: 10,
        campaignId: 'camp-1',
      });

      const createArg = LeadPackage.create.mock.calls[0][0];
      expect(createArg.type).toBe('basic');
    });
  });

  // ────────────────────────────────────────────────
  // updatePackage
  // ────────────────────────────────────────────────

  describe('updatePackage', () => {
    it('updates only whitelisted fields', async () => {
      const pkg = { ...mockPackage, update: jest.fn().mockResolvedValue(true) };
      LeadPackage.findByPk.mockResolvedValue(pkg);

      await updatePackage('pkg-1', {
        name: 'Renamed',
        price: 999,
        leadCount: 75,
        campaignId: 'camp-2',
        type: 'premium',
        isPublic: false,
        status: 'inactive',
        // Non-whitelisted fields must be ignored:
        id: 'hacked-id',
        createdBy: 'someone-else',
      });

      expect(pkg.update).toHaveBeenCalledTimes(1);
      const updateArg = pkg.update.mock.calls[0][0];
      expect(updateArg).toEqual({
        name: 'Renamed',
        price: 999,
        leadCount: 75,
        campaignId: 'camp-2',
        type: 'premium',
        isPublic: false,
        status: 'inactive',
      });
      expect(updateArg).not.toHaveProperty('id');
      expect(updateArg).not.toHaveProperty('createdBy');
    });

    it('skips the update call when no whitelisted fields are present', async () => {
      const pkg = { ...mockPackage, update: jest.fn().mockResolvedValue(true) };
      LeadPackage.findByPk.mockResolvedValue(pkg);

      const result = await updatePackage('pkg-1', { id: 'x', createdBy: 'y' });

      expect(pkg.update).not.toHaveBeenCalled();
      expect(result.package).toBeDefined();
    });

    it('ignores undefined fields (partial update)', async () => {
      const pkg = { ...mockPackage, update: jest.fn().mockResolvedValue(true) };
      LeadPackage.findByPk.mockResolvedValue(pkg);

      await updatePackage('pkg-1', { name: 'Only Name', price: undefined });

      expect(pkg.update).toHaveBeenCalledWith({ name: 'Only Name' });
    });

    it('throws when package not found', async () => {
      LeadPackage.findByPk.mockResolvedValue(null);

      await expect(updatePackage('nonexistent', { name: 'x' }))
        .rejects.toThrow('Package not found');
    });
  });

  // ────────────────────────────────────────────────
  // assignPackage
  // ────────────────────────────────────────────────

  describe('assignPackage', () => {
    it('assigns a package to an agent', async () => {
      const result = await assignPackage({ agentId: 'agent-1', packageId: 'pkg-1' });

      expect(LeadPackageAssignment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          leadPackageId: 'pkg-1',
          status: 'active',
        })
      );
      expect(result.agent).toBeDefined();
      expect(result.packageInfo.name).toBe('Gold Package');
    });

    it('throws when agent not found', async () => {
      User.findByPk.mockResolvedValue(null);

      await expect(assignPackage({ agentId: 'bad-agent', packageId: 'pkg-1' }))
        .rejects.toThrow('Agent not found');
    });

    it('throws when package not found', async () => {
      LeadPackage.findByPk.mockResolvedValue(null);

      await expect(assignPackage({ agentId: 'agent-1', packageId: 'bad-pkg' }))
        .rejects.toThrow('Package not found');
    });

    it('throws when agentId or packageId missing', async () => {
      await expect(assignPackage({ agentId: 'agent-1' }))
        .rejects.toThrow('Agent ID and Package ID are required');
    });
  });

  // ────────────────────────────────────────────────
  // getAgentAssignments
  // ────────────────────────────────────────────────

  describe('getAgentAssignments', () => {
    it('returns assignments for own agent', async () => {
      const result = await getAgentAssignments({
        agentId: 'agent-1',
        requesterId: 'agent-1',
        requesterRole: 'agent',
      });

      expect(result.assignments).toBeDefined();
    });

    it('allows admin to view any agent assignments', async () => {
      const result = await getAgentAssignments({
        agentId: 'agent-1',
        requesterId: 'admin-1',
        requesterRole: 'admin',
      });

      expect(result.assignments).toBeDefined();
    });

    it('blocks agent from viewing other agent assignments', async () => {
      await expect(getAgentAssignments({
        agentId: 'agent-2',
        requesterId: 'agent-1',
        requesterRole: 'agent',
      })).rejects.toThrow('Access denied');
    });
  });

  // ────────────────────────────────────────────────
  // getExternalAgentPackages (mktr-leads "My Packages")
  // ────────────────────────────────────────────────

  describe('getExternalAgentPackages', () => {
    const assignmentWithPkg = {
      id: 'assign-1',
      agentId: 'agent-1',
      status: 'active',
      leadsRemaining: 37,
      leadsTotal: 100,
      purchaseDate: new Date('2026-06-01T00:00:00.000Z'),
      package: {
        name: 'Premium SG Leads',
        type: 'premium',
        qualityScore: 8,
        currency: 'SGD',
        commissionStructure: { agentCommission: 12, referralBonus: 0, tierBonuses: {} },
        validityPeriod: 30,
        campaign: { name: 'Retirement Income' },
      },
    };

    it('self-scopes: resolves the agent by mktrLeadsId + role=agent + isActive, then scopes assignments to that id', async () => {
      User.findOne.mockResolvedValue({ id: 'agent-1' });
      LeadPackageAssignment.findAll.mockResolvedValue([assignmentWithPkg]);

      await getExternalAgentPackages('mktr-user-123');

      expect(User.findOne.mock.calls[0][0].where).toEqual({
        mktrLeadsId: 'mktr-user-123',
        role: 'agent',
        isActive: true,
      });
      expect(LeadPackageAssignment.findAll.mock.calls[0][0].where).toEqual({
        agentId: 'agent-1',
        status: ['active', 'completed', 'exhausted'],
      });
    });

    it('returns an empty list for an unknown / ineligible id — no throw, no DB read for assignments', async () => {
      User.findOne.mockResolvedValue(null);
      LeadPackageAssignment.findAll.mockClear();

      const result = await getExternalAgentPackages('not-an-agent');

      expect(result).toEqual({ packages: [] });
      expect(LeadPackageAssignment.findAll).not.toHaveBeenCalled();
    });

    it('returns an empty list for a blank id without touching the DB', async () => {
      User.findOne.mockClear();
      const result = await getExternalAgentPackages('');
      expect(result).toEqual({ packages: [] });
      expect(User.findOne).not.toHaveBeenCalled();
    });

    it('maps assignment + package to a flat DTO with a derived expiry (purchase + validity days)', async () => {
      User.findOne.mockResolvedValue({ id: 'agent-1' });
      LeadPackageAssignment.findAll.mockResolvedValue([assignmentWithPkg]);

      const { packages } = await getExternalAgentPackages('mktr-user-123');

      expect(packages).toHaveLength(1);
      expect(packages[0]).toMatchObject({
        id: 'assign-1',
        name: 'Premium SG Leads',
        type: 'premium',
        status: 'active',
        leadsRemaining: 37,
        leadsTotal: 100,
        qualityScore: 8,
        commissionPerLead: 12,
        currency: 'SGD',
        campaignName: 'Retirement Income',
        validityDays: 30,
      });
      expect(packages[0].expiresAt).toBe(new Date('2026-07-01T00:00:00.000Z').toISOString());
    });

    it('hides a zero/absent commission and null validity (no misleading $0, no fake expiry)', async () => {
      User.findOne.mockResolvedValue({ id: 'agent-1' });
      LeadPackageAssignment.findAll.mockResolvedValue([
        {
          ...assignmentWithPkg,
          package: {
            ...assignmentWithPkg.package,
            commissionStructure: { agentCommission: 0 },
            validityPeriod: null,
            qualityScore: null,
          },
        },
      ]);

      const { packages } = await getExternalAgentPackages('mktr-user-123');

      expect(packages[0].commissionPerLead).toBeNull();
      expect(packages[0].qualityScore).toBeNull();
      expect(packages[0].validityDays).toBeNull();
      expect(packages[0].expiresAt).toBeNull();
    });
  });

  // ────────────────────────────────────────────────
  // updateAssignment
  // ────────────────────────────────────────────────

  describe('updateAssignment', () => {
    it('updates leadsRemaining', async () => {
      const assignment = { ...mockAssignment, update: jest.fn().mockResolvedValue(true) };
      LeadPackageAssignment.findByPk.mockResolvedValue(assignment);

      await updateAssignment('assign-1', { leadsRemaining: 30 });

      expect(assignment.update).toHaveBeenCalledWith(
        expect.objectContaining({ leadsRemaining: 30, status: 'active' })
      );
    });

    it('sets status to completed when leadsRemaining is 0', async () => {
      const assignment = { ...mockAssignment, update: jest.fn().mockResolvedValue(true) };
      LeadPackageAssignment.findByPk.mockResolvedValue(assignment);

      await updateAssignment('assign-1', { leadsRemaining: 0 });

      expect(assignment.update).toHaveBeenCalledWith(
        expect.objectContaining({ leadsRemaining: 0, status: 'completed' })
      );
    });

    it('throws for invalid lead count', async () => {
      const assignment = { ...mockAssignment, update: jest.fn() };
      LeadPackageAssignment.findByPk.mockResolvedValue(assignment);

      await expect(updateAssignment('assign-1', { leadsRemaining: -5 }))
        .rejects.toThrow('Invalid lead count');
    });

    it('throws when assignment not found', async () => {
      LeadPackageAssignment.findByPk.mockResolvedValue(null);

      await expect(updateAssignment('nonexistent', { leadsRemaining: 10 }))
        .rejects.toThrow('Assignment not found');
    });
  });

  // ────────────────────────────────────────────────
  // deleteAssignment
  // ────────────────────────────────────────────────

  describe('deleteAssignment', () => {
    it('deletes an assignment', async () => {
      const assignment = { destroy: jest.fn().mockResolvedValue(true) };
      LeadPackageAssignment.findByPk.mockResolvedValue(assignment);

      await deleteAssignment('assign-1');

      expect(assignment.destroy).toHaveBeenCalled();
    });

    it('throws when assignment not found', async () => {
      LeadPackageAssignment.findByPk.mockResolvedValue(null);

      await expect(deleteAssignment('nonexistent'))
        .rejects.toThrow('Assignment not found');
    });
  });

  // ────────────────────────────────────────────────
  // createPackage edge cases
  // ────────────────────────────────────────────────

  describe('createPackage (edge cases)', () => {
    it('throws when price is null', async () => {
      await expect(createPackage({ name: 'Test', price: null, leadCount: 10, campaignId: 'camp-1' }))
        .rejects.toThrow('Missing required fields');
    });

    it('throws when leadCount is missing', async () => {
      await expect(createPackage({ name: 'Test', price: 100, campaignId: 'camp-1' }))
        .rejects.toThrow('Missing required fields');
    });

    it('throws when campaignId is missing', async () => {
      await expect(createPackage({ name: 'Test', price: 100, leadCount: 10 }))
        .rejects.toThrow('Missing required fields');
    });

    it('accepts custom type', async () => {
      await createPackage({
        name: 'Premium',
        price: 1000,
        leadCount: 100,
        campaignId: 'camp-1',
        type: 'premium',
      });

      const createArg = LeadPackage.create.mock.calls[0][0];
      expect(createArg.type).toBe('premium');
    });
  });

  // ────────────────────────────────────────────────
  // updateAssignment edge cases
  // ────────────────────────────────────────────────

  describe('updateAssignment (edge cases)', () => {
    it('throws for NaN leadsRemaining', async () => {
      const assignment = { ...mockAssignment, update: jest.fn() };
      LeadPackageAssignment.findByPk.mockResolvedValue(assignment);

      await expect(updateAssignment('assign-1', { leadsRemaining: 'abc' }))
        .rejects.toThrow('Invalid lead count');
    });

    it('does nothing when leadsRemaining is undefined', async () => {
      const assignment = { ...mockAssignment, update: jest.fn() };
      LeadPackageAssignment.findByPk.mockResolvedValue(assignment);

      const result = await updateAssignment('assign-1', {});

      expect(assignment.update).not.toHaveBeenCalled();
      expect(result.assignment).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────
  // deletePackage
  // ────────────────────────────────────────────────

  describe('deletePackage', () => {
    it('deletes package when no assignments exist', async () => {
      const pkg = { ...mockPackage, destroy: jest.fn().mockResolvedValue(true) };
      LeadPackage.findByPk.mockResolvedValue(pkg);
      LeadPackageAssignment.count.mockResolvedValue(0);

      const result = await deletePackage('pkg-1');

      expect(pkg.destroy).toHaveBeenCalled();
      expect(result.archived).toBe(false);
    });

    it('archives package when assignments exist', async () => {
      const pkg = { ...mockPackage, update: jest.fn().mockResolvedValue(true) };
      LeadPackage.findByPk.mockResolvedValue(pkg);
      LeadPackageAssignment.count.mockResolvedValue(3);

      const result = await deletePackage('pkg-1');

      expect(pkg.update).toHaveBeenCalledWith({ status: 'archived' });
      expect(result.archived).toBe(true);
    });

    it('throws when package not found', async () => {
      LeadPackage.findByPk.mockResolvedValue(null);

      await expect(deletePackage('nonexistent'))
        .rejects.toThrow('Package not found');
    });
  });
});
