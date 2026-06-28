import { jest } from '@jest/globals';
import '../setup.js';

// Isolated mocks for the external admin surface (catalog + assignment ops).
const LeadPackage = { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() };
const LeadPackageAssignment = {
  findAll: jest.fn(),
  findByPk: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  count: jest.fn(),
};
const User = { findByPk: jest.fn(), findOne: jest.fn() };
const Campaign = { findByPk: jest.fn(), findAll: jest.fn() };
const Prospect = { count: jest.fn() };
const sequelize = {
  transaction: jest.fn(async (cb) => cb({})),
  query: jest.fn().mockResolvedValue([]),
  fn: jest.fn((f, c) => ({ _fn: f, _col: c })),
  col: jest.fn((c) => ({ _col: c })),
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
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
// releaseSweep is dynamically imported (fire-and-forget) — mock so the no-op sweep is deterministic.
jest.unstable_mockModule('../../src/services/releaseSweep.js', () => ({
  sweepCampaign: jest.fn().mockResolvedValue(undefined),
}));

const {
  normalizeQuality,
  normalizeValidity,
  normalizeCommission,
  getExternalAdminCatalog,
  listCampaignsForPicker,
  getExternalAdminAgentAssignments,
  assignPackageExternal,
  topUpAssignment,
  cancelAssignment,
  removeAssignmentExternal,
  resolveCreator,
} = await import('../../src/services/leadPackageService.js');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('field normalizers', () => {
  it('quality clamps 1..10, null when empty/invalid', () => {
    expect(normalizeQuality(8)).toBe(8);
    expect(normalizeQuality(0)).toBe(1);
    expect(normalizeQuality(99)).toBe(10);
    expect(normalizeQuality(null)).toBeNull();
    expect(normalizeQuality('')).toBeNull();
    expect(normalizeQuality('abc')).toBeNull();
  });
  it('validity ≥1 days, null when empty/<1', () => {
    expect(normalizeValidity(30)).toBe(30);
    expect(normalizeValidity('60')).toBe(60);
    expect(normalizeValidity(0)).toBeNull();
    expect(normalizeValidity(null)).toBeNull();
  });
  it('commission is a positive number, else 0', () => {
    expect(normalizeCommission(12)).toBe(12);
    expect(normalizeCommission(0)).toBe(0);
    expect(normalizeCommission(-5)).toBe(0);
    expect(normalizeCommission('x')).toBe(0);
  });
});

describe('getExternalAdminCatalog', () => {
  it('maps full fields + a per-package assignmentCount from one grouped COUNT', async () => {
    LeadPackage.findAll.mockResolvedValue([
      {
        id: 'pkg-1', name: 'Starter', type: 'basic', status: 'active', description: null,
        price: '150.00', leadCount: 50, currency: 'SGD', qualityScore: 7,
        commissionStructure: { agentCommission: 3 }, validityPeriod: 30,
        campaignId: 'camp-1', isPublic: true, campaign: { id: 'camp-1', name: 'Retire', status: 'active' },
      },
    ]);
    LeadPackageAssignment.findAll.mockResolvedValue([{ leadPackageId: 'pkg-1', n: '4' }]);

    const { packages } = await getExternalAdminCatalog();

    expect(sequelize.fn).toHaveBeenCalledWith('COUNT', expect.anything());
    expect(packages[0]).toMatchObject({
      id: 'pkg-1', price: 150, leadCount: 50, currency: 'SGD', qualityScore: 7,
      commissionPerLead: 3, validityDays: 30, campaignName: 'Retire', assignmentCount: 4,
    });
  });

  it('hides a zero commission and reports 0 assignments when none', async () => {
    LeadPackage.findAll.mockResolvedValue([
      { id: 'pkg-2', name: 'X', type: 'basic', status: 'draft', price: '0.00', leadCount: 1,
        currency: 'SGD', commissionStructure: { agentCommission: 0 }, validityPeriod: null, isPublic: false, campaign: null },
    ]);
    LeadPackageAssignment.findAll.mockResolvedValue([]);

    const { packages } = await getExternalAdminCatalog();
    expect(packages[0].commissionPerLead).toBeNull();
    expect(packages[0].assignmentCount).toBe(0);
    expect(packages[0].campaignName).toBeNull();
  });
});

describe('listCampaignsForPicker', () => {
  it('returns active campaigns and appends a still-selected inactive one', async () => {
    Campaign.findAll.mockResolvedValue([{ id: 'c1', name: 'Active', status: 'active' }]);
    Campaign.findByPk.mockResolvedValue({ id: 'c9', name: 'Paused', status: 'inactive' });

    const { campaigns } = await listCampaignsForPicker('c9');

    expect(Campaign.findAll.mock.calls[0][0].where).toEqual({ is_active: true });
    expect(campaigns.map((c) => c.id)).toEqual(['c9', 'c1']);
  });

  it('does not double-add the selected campaign when already active', async () => {
    Campaign.findAll.mockResolvedValue([{ id: 'c1', name: 'Active', status: 'active' }]);
    const { campaigns } = await listCampaignsForPicker('c1');
    expect(campaigns).toHaveLength(1);
    expect(Campaign.findByPk).not.toHaveBeenCalled();
  });
});

describe('getExternalAdminAgentAssignments', () => {
  it('returns ALL statuses incl. priceSnapshot, capped at 100, for a synced agent', async () => {
    User.findOne.mockResolvedValue({ id: 'agent-1' });
    LeadPackageAssignment.findAll.mockResolvedValue([
      {
        id: 'a1', status: 'cancelled', leadsRemaining: 0, leadsTotal: 50, priceSnapshot: '150.00',
        purchaseDate: new Date('2026-06-01T00:00:00.000Z'),
        package: { name: 'Starter', type: 'basic', qualityScore: 7, currency: 'SGD',
          commissionStructure: { agentCommission: 0 }, validityPeriod: null, campaign: { name: 'Retire' } },
      },
    ]);

    const { packages } = await getExternalAdminAgentAssignments('mktr-1');

    expect(LeadPackageAssignment.findAll.mock.calls[0][0].where).toEqual({ agentId: 'agent-1' });
    expect(LeadPackageAssignment.findAll.mock.calls[0][0].limit).toBe(100);
    expect(packages[0]).toMatchObject({ id: 'a1', status: 'cancelled', priceSnapshot: 150, commissionPerLead: null });
  });

  it('returns empty for an unknown agent without querying assignments', async () => {
    User.findOne.mockResolvedValue(null);
    const result = await getExternalAdminAgentAssignments('nope');
    expect(result).toEqual({ packages: [] });
    expect(LeadPackageAssignment.findAll).not.toHaveBeenCalled();
  });
});

describe('assignPackageExternal', () => {
  const activePkg = { id: 'pkg-1', status: 'active', leadCount: 50, price: 100, campaignId: 'camp-1' };

  it('assigns and snapshots price; inherits leadCount', async () => {
    User.findOne.mockResolvedValue({ id: 'agent-1' });
    LeadPackage.findByPk.mockResolvedValue(activePkg);
    LeadPackageAssignment.findOne.mockResolvedValue(null);
    LeadPackageAssignment.create.mockResolvedValue({ id: 'new-1' });

    const result = await assignPackageExternal({ agentMktrUserId: 'mktr-1', packageId: 'pkg-1' });

    expect(result).toEqual({ status: 'assigned', assignmentId: 'new-1' });
    const createArg = LeadPackageAssignment.create.mock.calls[0][0];
    expect(createArg).toMatchObject({ leadsTotal: 50, leadsRemaining: 50, priceSnapshot: 100, status: 'active' });
  });

  it('honours a custom leadsTotalOverride', async () => {
    User.findOne.mockResolvedValue({ id: 'agent-1' });
    LeadPackage.findByPk.mockResolvedValue(activePkg);
    LeadPackageAssignment.findOne.mockResolvedValue(null);
    LeadPackageAssignment.create.mockResolvedValue({ id: 'new-1' });

    await assignPackageExternal({ agentMktrUserId: 'mktr-1', packageId: 'pkg-1', leadsTotalOverride: 25 });
    const createArg = LeadPackageAssignment.create.mock.calls[0][0];
    expect(createArg).toMatchObject({ leadsTotal: 25, leadsRemaining: 25 });
  });

  it('returns exists when the agent already holds an active assignment (dup guard)', async () => {
    User.findOne.mockResolvedValue({ id: 'agent-1' });
    LeadPackage.findByPk.mockResolvedValue(activePkg);
    LeadPackageAssignment.findOne.mockResolvedValue({ id: 'existing-1' });

    const result = await assignPackageExternal({ agentMktrUserId: 'mktr-1', packageId: 'pkg-1' });
    expect(result).toEqual({ status: 'exists', assignmentId: 'existing-1' });
    expect(LeadPackageAssignment.create).not.toHaveBeenCalled();
  });

  it('rejects a non-active package', async () => {
    User.findOne.mockResolvedValue({ id: 'agent-1' });
    LeadPackage.findByPk.mockResolvedValue({ ...activePkg, status: 'draft' });
    const result = await assignPackageExternal({ agentMktrUserId: 'mktr-1', packageId: 'pkg-1' });
    expect(result).toEqual({ status: 'package_inactive' });
  });

  it('rejects an unknown/inactive agent', async () => {
    User.findOne.mockResolvedValue(null);
    const result = await assignPackageExternal({ agentMktrUserId: 'ghost', packageId: 'pkg-1' });
    expect(result).toEqual({ status: 'invalid_agent' });
  });
});

describe('topUpAssignment', () => {
  it('delta adds to BOTH remaining and total (fixes the 150/100 bug)', async () => {
    const a = { id: 'a1', status: 'active', leadsRemaining: 10, leadsTotal: 100, leadPackageId: 'pkg-1', update: jest.fn().mockResolvedValue(true) };
    LeadPackageAssignment.findOne.mockResolvedValue(a);

    await topUpAssignment({ assignmentId: 'a1', addLeads: 50 });
    expect(a.update).toHaveBeenCalledWith({ leadsRemaining: 60, leadsTotal: 150, status: 'active' });
  });

  it('absolute setRemaining correction sets status by count', async () => {
    const a = { id: 'a1', status: 'completed', leadsRemaining: 0, leadsTotal: 100, leadPackageId: 'pkg-1', update: jest.fn().mockResolvedValue(true) };
    LeadPackageAssignment.findOne.mockResolvedValue(a);

    await topUpAssignment({ assignmentId: 'a1', setRemaining: 5 });
    expect(a.update).toHaveBeenCalledWith({ leadsRemaining: 5, status: 'active' });
  });

  it('refuses to resurrect a cancelled/expired assignment', async () => {
    LeadPackageAssignment.findOne.mockResolvedValue({ id: 'a1', status: 'cancelled', leadsRemaining: 0, leadsTotal: 10, update: jest.fn() });
    await expect(topUpAssignment({ assignmentId: 'a1', addLeads: 5 })).rejects.toThrow('cancelled or expired');
  });

  it('404s when the assignment is not a mktr-leads one (scope guard returns null)', async () => {
    LeadPackageAssignment.findOne.mockResolvedValue(null);
    await expect(topUpAssignment({ assignmentId: 'x', addLeads: 5 })).rejects.toThrow('Assignment not found');
  });
});

describe('cancelAssignment', () => {
  it('sets status cancelled', async () => {
    const a = { id: 'a1', status: 'active', update: jest.fn().mockResolvedValue(true) };
    LeadPackageAssignment.findOne.mockResolvedValue(a);
    await cancelAssignment('a1');
    expect(a.update).toHaveBeenCalledWith({ status: 'cancelled' });
  });
  it('is idempotent (already cancelled → no update)', async () => {
    const a = { id: 'a1', status: 'cancelled', update: jest.fn() };
    LeadPackageAssignment.findOne.mockResolvedValue(a);
    await cancelAssignment('a1');
    expect(a.update).not.toHaveBeenCalled();
  });
});

describe('removeAssignmentExternal', () => {
  it('destroys the row when scoped to a mktr-leads agent', async () => {
    const a = { id: 'a1', destroy: jest.fn().mockResolvedValue(true) };
    LeadPackageAssignment.findOne.mockResolvedValue(a);
    await removeAssignmentExternal('a1');
    expect(a.destroy).toHaveBeenCalled();
  });
  it('404s when not a mktr-leads assignment', async () => {
    LeadPackageAssignment.findOne.mockResolvedValue(null);
    await expect(removeAssignmentExternal('x')).rejects.toThrow('Assignment not found');
  });
});

describe('resolveCreator', () => {
  const ORIGINAL = process.env.ADMIN_PACKAGES_CREATOR_USER_ID;
  afterEach(() => { process.env.ADMIN_PACKAGES_CREATOR_USER_ID = ORIGINAL; });

  it('prefers the acting admin when synced', async () => {
    User.findOne.mockResolvedValue({ id: 'mktr-admin-uuid' });
    expect(await resolveCreator('actor-mktr-1')).toBe('mktr-admin-uuid');
  });
  it('falls back to the configured system creator', async () => {
    User.findOne.mockResolvedValue(null);
    process.env.ADMIN_PACKAGES_CREATOR_USER_ID = 'sys-creator';
    expect(await resolveCreator('actor-mktr-1')).toBe('sys-creator');
  });
  it('falls back to the oldest admin when no actor and no env', async () => {
    delete process.env.ADMIN_PACKAGES_CREATOR_USER_ID;
    User.findOne.mockResolvedValue({ id: 'web-admin' });
    expect(await resolveCreator(null)).toBe('web-admin');
  });
  it('throws when nothing resolves (no actor, no env, no admin)', async () => {
    User.findOne.mockResolvedValue(null);
    delete process.env.ADMIN_PACKAGES_CREATOR_USER_ID;
    await expect(resolveCreator(null)).rejects.toThrow('No package creator');
  });
});
