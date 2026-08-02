import { jest } from '@jest/globals';
import '../setup.js';

// Mock the models import so we don't trigger DB connection
jest.unstable_mockModule('../../src/models/index.js', () => ({
  LeadPackage: {},
  LeadPackageAssignment: { findAll: jest.fn().mockResolvedValue([]) },
  sequelize: {
    query: jest.fn().mockResolvedValue([]),
    QueryTypes: { SELECT: 'SELECT' },
  },
}));

const { getAssignedCampaignCounts, computeAgentStats, computeAgentStatsFromCounts } =
  await import('../../src/services/agentStatsHelpers.js');
const { sequelize } = await import('../../src/models/index.js');

describe('agentStatsHelpers', () => {
  // ──────────────────────────────────────────────
  // getAssignedCampaignCounts
  // ──────────────────────────────────────────────

  describe('getAssignedCampaignCounts', () => {
    beforeEach(() => jest.clearAllMocks());

    // P4-10: one grouped COUNT(DISTINCT) replaced loading every assignment
    // row into JS — dedupe and the null-campaign skip now live in the SQL,
    // so the unit asserts the query's guards plus the row→object mapping.
    it('returns empty object when the grouped query yields no rows', async () => {
      sequelize.query.mockResolvedValue([]);
      const result = await getAssignedCampaignCounts();
      expect(result).toEqual({});
    });

    it('maps grouped rows to per-agent integer counts', async () => {
      sequelize.query.mockResolvedValue([
        { agentId: 'a-1', campaignCount: 2 },
        { agentId: 'a-2', campaignCount: 1 },
      ]);

      const result = await getAssignedCampaignCounts();
      expect(result).toEqual({ 'a-1': 2, 'a-2': 1 });
    });

    it('the SQL dedupes campaigns and excludes null campaignIds + inactive/spent assignments', async () => {
      sequelize.query.mockResolvedValue([]);
      await getAssignedCampaignCounts();
      const sql = sequelize.query.mock.calls[0][0];
      expect(sql).toContain('COUNT(DISTINCT p."campaignId")');
      expect(sql).toContain('"campaignId" IS NOT NULL');
      expect(sql).toContain("a.status = 'active'");
      expect(sql).toContain('a."leadsRemaining" > 0');
    });
  });

  // ──────────────────────────────────────────────
  // computeAgentStats
  // ──────────────────────────────────────────────

  describe('computeAgentStats', () => {
    function buildAgent(overrides = {}) {
      return {
        id: 'a-1',
        assignedProspects: [],
        commissions: [],
        createdCampaigns: [],
        assignedPackages: [],
        owed_leads_count: 0,
        toJSON() { return { ...this }; },
        ...overrides,
      };
    }

    it('computes zero stats for agent with no data', () => {
      const agent = buildAgent();
      const result = computeAgentStats(agent, {});

      expect(result.stats.totalProspects).toBe(0);
      expect(result.stats.convertedProspects).toBe(0);
      expect(result.stats.conversionRate).toBe(0);
      expect(result.stats.totalCommissions).toBe(0);
      expect(result.stats.paidCommissions).toBe(0);
      expect(result.stats.pendingCommissions).toBe(0);
      expect(result.stats.totalCampaigns).toBe(0);
      expect(result.stats.activeCampaigns).toBe(0);
      expect(result.stats.tiedCampaignsCount).toBe(0);
    });

    it('calculates conversion rate correctly', () => {
      const agent = buildAgent({
        assignedProspects: [
          { leadStatus: 'won' },
          { leadStatus: 'won' },
          { leadStatus: 'new' },
          { leadStatus: 'contacted' },
        ],
      });
      const result = computeAgentStats(agent, {});

      expect(result.stats.totalProspects).toBe(4);
      expect(result.stats.convertedProspects).toBe(2);
      expect(result.stats.conversionRate).toBe('50.00');
    });

    it('returns 0 conversion rate when totalProspects is 0 (division by zero)', () => {
      const agent = buildAgent({ assignedProspects: [] });
      const result = computeAgentStats(agent, {});

      expect(result.stats.conversionRate).toBe(0);
    });

    it('sums commissions and separates paid from pending', () => {
      const agent = buildAgent({
        commissions: [
          { amount: '100.50', status: 'paid' },
          { amount: '200.00', status: 'pending' },
          { amount: '50.00', status: 'paid' },
        ],
      });
      const result = computeAgentStats(agent, {});

      expect(result.stats.totalCommissions).toBeCloseTo(350.50);
      expect(result.stats.paidCommissions).toBeCloseTo(150.50);
      expect(result.stats.pendingCommissions).toBeCloseTo(200.00);
    });

    it('adds assignedCampaignsCount from the counts map to tiedCampaignsCount', () => {
      const agent = buildAgent({
        createdCampaigns: [{ status: 'active' }, { status: 'draft' }],
      });
      const counts = { 'a-1': 3 };
      const result = computeAgentStats(agent, counts);

      expect(result.stats.totalCampaigns).toBe(2);
      expect(result.stats.tiedCampaignsCount).toBe(5); // 2 created + 3 assigned
    });

    it('sums manual and package leads for owed_leads_count', () => {
      const agent = buildAgent({
        owed_leads_count: 5,
        assignedPackages: [
          { leadsRemaining: 10 },
          { leadsRemaining: 3 },
        ],
      });
      const result = computeAgentStats(agent, {});

      expect(result.owed_leads_count).toBe(18); // 5 + 10 + 3
      expect(result.owed_leads_manual_count).toBe(5);
    });

    it('handles null assignedPackages gracefully', () => {
      const agent = buildAgent({ assignedPackages: null, owed_leads_count: 2 });
      const result = computeAgentStats(agent, {});

      expect(result.owed_leads_count).toBe(2);
    });
  });

  // ──────────────────────────────────────────────
  // computeAgentStatsFromCounts
  // ──────────────────────────────────────────────

  describe('computeAgentStatsFromCounts', () => {
    function buildCountAgent(overrides = {}) {
      const data = {
        id: 'a-1',
        prospectCount: '10',
        convertedCount: '3',
        totalCommissions: '500.00',
        paidCommissions: '200.00',
        createdCampaignsCount: '2',
        activeCampaignsCount: '1',
        owed_leads_count: 0,
        assignedPackages: [],
        ...overrides,
      };
      return { ...data, toJSON() { return { ...data }; } };
    }

    it('parses string counts correctly', () => {
      const agent = buildCountAgent();
      const result = computeAgentStatsFromCounts(agent, {});

      expect(result.stats.totalProspects).toBe(10);
      expect(result.stats.convertedProspects).toBe(3);
      expect(result.stats.conversionRate).toBe('30.00');
      expect(result.stats.totalCommissions).toBe(500);
      expect(result.stats.paidCommissions).toBe(200);
      expect(result.stats.pendingCommissions).toBe(300);
    });

    it('returns 0 conversion rate when prospectCount is 0', () => {
      const agent = buildCountAgent({ prospectCount: '0', convertedCount: '0' });
      const result = computeAgentStatsFromCounts(agent, {});

      expect(result.stats.conversionRate).toBe(0);
    });
  });
});
