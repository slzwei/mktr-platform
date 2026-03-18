import { jest } from '@jest/globals';
import '../setup.js';

// Mock the models import so we don't trigger DB connection
jest.unstable_mockModule('../../src/models/index.js', () => ({
  LeadPackage: {},
  LeadPackageAssignment: { findAll: jest.fn().mockResolvedValue([]) },
}));

const { getAssignedCampaignCounts, computeAgentStats, computeAgentStatsFromCounts } =
  await import('../../src/services/agentStatsHelpers.js');
const { LeadPackageAssignment } = await import('../../src/models/index.js');

describe('agentStatsHelpers', () => {
  // ──────────────────────────────────────────────
  // getAssignedCampaignCounts
  // ──────────────────────────────────────────────

  describe('getAssignedCampaignCounts', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns empty object when no active assignments exist', async () => {
      LeadPackageAssignment.findAll.mockResolvedValue([]);
      const result = await getAssignedCampaignCounts();
      expect(result).toEqual({});
    });

    it('counts unique campaigns per agent', async () => {
      LeadPackageAssignment.findAll.mockResolvedValue([
        { agentId: 'a-1', package: { campaignId: 'c-1' } },
        { agentId: 'a-1', package: { campaignId: 'c-2' } },
        { agentId: 'a-1', package: { campaignId: 'c-1' } }, // duplicate campaign
        { agentId: 'a-2', package: { campaignId: 'c-3' } },
      ]);

      const result = await getAssignedCampaignCounts();
      expect(result['a-1']).toBe(2);
      expect(result['a-2']).toBe(1);
    });

    it('skips assignments with null package or null campaignId', async () => {
      LeadPackageAssignment.findAll.mockResolvedValue([
        { agentId: 'a-1', package: null },
        { agentId: 'a-2', package: { campaignId: null } },
        { agentId: 'a-3', package: { campaignId: 'c-1' } },
      ]);

      const result = await getAssignedCampaignCounts();
      expect(result['a-1']).toBeUndefined();
      expect(result['a-2']).toBeUndefined();
      expect(result['a-3']).toBe(1);
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
