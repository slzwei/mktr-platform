import { jest } from '@jest/globals';
import '../setup.js';

// ── Helpers ──

function buildMocks() {
  const User = {
    count: jest.fn().mockResolvedValue(10),
    sum: jest.fn().mockResolvedValue(0),
  };

  const Campaign = {
    count: jest.fn().mockResolvedValue(5),
    findAll: jest.fn().mockResolvedValue([]),
  };

  const Prospect = {
    count: jest.fn().mockResolvedValue(100),
    sum: jest.fn().mockResolvedValue(0),
    findAll: jest.fn().mockResolvedValue([]),
  };

  const QrTag = {
    count: jest.fn().mockResolvedValue(20),
    sum: jest.fn().mockResolvedValue(50),
    findAll: jest.fn().mockResolvedValue([]),
  };

  const Commission = {
    sum: jest.fn().mockResolvedValue(1000),
    findAll: jest.fn().mockResolvedValue([]),
  };

  const Car = {
    count: jest.fn().mockResolvedValue(15),
    findAll: jest.fn().mockResolvedValue([]),
  };

  const Driver = {
    count: jest.fn().mockResolvedValue(8),
  };

  const FleetOwner = {
    findOne: jest.fn().mockResolvedValue({ id: 'fleet-1' }),
    count: jest.fn().mockResolvedValue(3),
  };

  const Impression = {
    count: jest.fn().mockResolvedValue(42),
  };

  // Phase B (attention/committed aggregates) deps — inert defaults.
  const WebhookDelivery = {
    count: jest.fn().mockResolvedValue(0),
  };
  const WebhookSubscriber = {
    count: jest.fn().mockResolvedValue(0),
  };
  const LeadPackageAssignment = {
    findAll: jest.fn().mockResolvedValue([]),
  };

  const sequelize = {
    query: jest.fn().mockResolvedValue([[]]),
    fn: jest.fn((fnName, col) => `${fnName}(${col})`),
    col: jest.fn((name) => name),
    literal: jest.fn((expr) => expr),
  };

  return {
    User, Campaign, Prospect, QrTag, Commission,
    Car, Driver, FleetOwner, Impression, sequelize,
    WebhookDelivery, WebhookSubscriber, LeadPackageAssignment,
  };
}

let mocks;
let service;

beforeEach(async () => {
  mocks = buildMocks();

  jest.unstable_mockModule('../../src/models/index.js', () => ({
    User: mocks.User,
    Campaign: mocks.Campaign,
    Prospect: mocks.Prospect,
    QrTag: mocks.QrTag,
    Commission: mocks.Commission,
    Car: mocks.Car,
    Driver: mocks.Driver,
    FleetOwner: mocks.FleetOwner,
    Impression: mocks.Impression,
    WebhookDelivery: mocks.WebhookDelivery,
    WebhookSubscriber: mocks.WebhookSubscriber,
    LeadPackageAssignment: mocks.LeadPackageAssignment,
    sequelize: mocks.sequelize,
  }));

  service = await import('../../src/services/dashboardService.js');
  // Always reset cache before each test
  service.resetAdminStatsCache();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

// ── Tests ──

describe('dashboardService (unit)', () => {

  // ── getOverview ──

  describe('getOverview', () => {
    it('returns admin stats for admin role', async () => {
      const result = await service.getOverview('admin-1', 'admin', '30d');

      expect(result).toHaveProperty('users');
      expect(result).toHaveProperty('campaigns');
      expect(result).toHaveProperty('prospects');
      expect(result).toHaveProperty('qrCodes');
      expect(result).toHaveProperty('recentActivities');
      // Fleet-era blocks removed from admin stats (Phase D teardown).
      expect(result).not.toHaveProperty('commissions');
      expect(result).not.toHaveProperty('fleet');
      expect(result).not.toHaveProperty('impressions');
    });

    it('returns agent stats for agent role', async () => {
      mocks.Commission.sum.mockResolvedValue(500);

      const result = await service.getOverview('agent-1', 'agent', '30d');

      expect(result).toHaveProperty('prospects');
      expect(result).toHaveProperty('commissions');
      expect(result).toHaveProperty('campaigns');
      expect(result).toHaveProperty('recentProspects');
    });

    it('scopes agent stats to the given userId', async () => {
      await service.getOverview('agent-1', 'agent', '30d');

      // Prospect.count should have been called with assignedAgentId constraint
      const calls = mocks.Prospect.count.mock.calls;
      const hasAgentScope = calls.some(([opts]) =>
        opts?.where?.assignedAgentId === 'agent-1'
      );
      expect(hasAgentScope).toBe(true);
    });

    it('returns fleet owner stats for fleet_owner role', async () => {
      mocks.Car.findAll.mockResolvedValue([]);

      const result = await service.getOverview('fleet-user-1', 'fleet_owner', '30d');

      expect(result).toHaveProperty('fleet');
      expect(result).toHaveProperty('drivers');
      expect(result).toHaveProperty('qrCodes');
    });

    it('returns error when fleet owner profile not found', async () => {
      mocks.FleetOwner.findOne.mockResolvedValue(null);

      const result = await service.getOverview('unknown', 'fleet_owner', '30d');

      expect(result).toEqual({ error: 'Fleet owner profile not found' });
    });

    it('returns customer stats for unknown role', async () => {
      const result = await service.getOverview('customer-1', 'customer', '30d');

      expect(result).toEqual({ interactions: { total: 0, recent: 0 } });
    });

    it('computes period as 7 days for 7d', async () => {
      // Just verify it does not throw
      const result = await service.getOverview('admin-1', 'admin', '7d');
      expect(result).toHaveProperty('users');
    });
  });

  // ── resetAdminStatsCache ──

  describe('resetAdminStatsCache', () => {
    it('clears cache so next call fetches fresh data', async () => {
      // First call populates cache
      await service.getOverview('admin-1', 'admin', '30d');
      const callCount1 = mocks.User.count.mock.calls.length;

      // Second call should hit cache (no new model calls)
      await service.getOverview('admin-1', 'admin', '30d');
      const callCount2 = mocks.User.count.mock.calls.length;
      expect(callCount2).toBe(callCount1);

      // Reset cache
      service.resetAdminStatsCache();

      // Third call should fetch fresh
      await service.getOverview('admin-1', 'admin', '30d');
      const callCount3 = mocks.User.count.mock.calls.length;
      expect(callCount3).toBeGreaterThan(callCount2);
    });
  });

  // ── getAnalytics ──

  describe('getAnalytics', () => {
    it('returns prospect analytics for type=prospects', async () => {
      const result = await service.getAnalytics('user-1', 'admin', 'prospects', '30d', {});

      expect(result).toHaveProperty('prospectsByStatus');
    });

    it('returns commission analytics for type=commissions', async () => {
      const result = await service.getAnalytics('user-1', 'admin', 'commissions', '30d', {});

      expect(result).toHaveProperty('commissionTrend');
    });

    it('returns campaign analytics for type=campaigns', async () => {
      const result = await service.getAnalytics('user-1', 'admin', 'campaigns', '30d', {});

      expect(result).toHaveProperty('campaignPerformance');
    });

    it('returns QR analytics for type=qr_codes', async () => {
      const result = await service.getAnalytics('user-1', 'admin', 'qr_codes', '30d');

      expect(result).toHaveProperty('qrScanTrend');
    });

    it('returns empty object for unknown type', async () => {
      const result = await service.getAnalytics('user-1', 'admin', 'unknown', '30d');

      expect(result).toEqual({});
    });
  });

  // ── getDriverScans ──

  describe('getDriverScans', () => {
    it('returns trend and total', async () => {
      mocks.Prospect.findAll.mockResolvedValue([]);

      const result = await service.getDriverScans('driver-1', '30d');

      expect(result).toHaveProperty('trend');
      expect(result).toHaveProperty('total');
      expect(result.total).toBe(0);
    });

    it('builds daily trend buckets for 7d period', async () => {
      mocks.Prospect.findAll.mockResolvedValue([]);

      const result = await service.getDriverScans('driver-1', '7d');

      expect(result.trend.length).toBeGreaterThan(0);
    });
  });

  // ── getDriverCommissions ──

  describe('getDriverCommissions', () => {
    it('returns mapped commission data', async () => {
      const mockProspect = {
        id: 'p-1',
        createdAt: new Date().toISOString(),
        campaign: { id: 'camp-1', name: 'Test', commission_amount_driver: 10 },
        qrTag: { car: {} },
      };
      mocks.Prospect.findAll.mockResolvedValue([mockProspect]);

      const result = await service.getDriverCommissions('driver-1', '30d');

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('id', 'p-1');
      expect(result[0]).toHaveProperty('status', 'pending');
      expect(result[0]).toHaveProperty('amount_driver', 10);
    });

    it('returns empty array when no prospects found', async () => {
      mocks.Prospect.findAll.mockResolvedValue([]);

      const result = await service.getDriverCommissions('driver-1', '30d');

      expect(result).toEqual([]);
    });
  });
});
