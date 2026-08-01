import { jest } from '@jest/globals';
import '../setup.js';

// ── Mock the models before importing the service ──

const mockSequelize = {
  fn: jest.fn((fnName, col) => `${fnName}(${col})`),
  col: jest.fn((name) => name),
  literal: jest.fn((expr) => expr),
  query: jest.fn().mockResolvedValue([]),
  QueryTypes: { SELECT: 'SELECT' },
};

const mockProspect = {
  findAll: jest.fn().mockResolvedValue([]),
};

jest.unstable_mockModule('../../src/models/index.js', () => ({
  Prospect: mockProspect,
  sequelize: mockSequelize,
}));

const {
  getAgentMonthlyPerformance,
  getConversionLeaderboard,
  getProspectLeaderboard,
  getLeaderboard,
} = await import('../../src/services/agentLeaderboardService.js');

// ── Tests ──

describe('agentLeaderboard (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ────────────────────────────────────────────────
  // getAgentMonthlyPerformance
  // ────────────────────────────────────────────────

  describe('getAgentMonthlyPerformance', () => {
    it('returns 12 months of performance data', async () => {
      mockSequelize.query.mockResolvedValue([]);

      const result = await getAgentMonthlyPerformance('agent-1');

      expect(result).toHaveLength(12);
      expect(result[0]).toHaveProperty('month');
      expect(result[0]).toHaveProperty('prospects');
      expect(result[0]).toHaveProperty('conversions');
      expect(result[0]).toHaveProperty('conversionRate');
    });

    it('handles empty data gracefully (all zeros)', async () => {
      mockSequelize.query.mockResolvedValue([]);

      const result = await getAgentMonthlyPerformance('agent-1');

      for (const month of result) {
        expect(month.prospects).toBe(0);
        expect(month.conversions).toBe(0);
        expect(month.conversionRate).toBe(0);
      }
    });

    it('maps prospect and conversion data to correct months', async () => {
      const now = new Date();
      // Use the same key derivation as the service (local-time based Date → toISOString)
      const monthDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentMonth = monthDate.toISOString().slice(0, 7);

      mockSequelize.query
        .mockResolvedValueOnce([{ month: monthDate, count: 10 }])
        .mockResolvedValueOnce([{ month: monthDate, count: 3 }]);

      const result = await getAgentMonthlyPerformance('agent-1');

      const current = result.find(r => r.month === currentMonth);
      expect(current).toBeDefined();
      expect(current.prospects).toBe(10);
      expect(current.conversions).toBe(3);
      expect(current.conversionRate).toBe('30.00');
    });

    it('calculates conversion rate correctly', async () => {
      const now = new Date();
      const monthDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentMonth = monthDate.toISOString().slice(0, 7);

      mockSequelize.query
        .mockResolvedValueOnce([{ month: monthDate, count: 20 }])
        .mockResolvedValueOnce([{ month: monthDate, count: 5 }]);

      const result = await getAgentMonthlyPerformance('agent-1');

      const current = result.find(r => r.month === currentMonth);
      expect(current).toBeDefined();
      expect(current.conversionRate).toBe('25.00');
    });

    it('returns 0 conversion rate when no prospects', async () => {
      mockSequelize.query.mockResolvedValue([]);

      const result = await getAgentMonthlyPerformance('agent-1');

      for (const month of result) {
        expect(month.conversionRate).toBe(0);
      }
    });
  });

  // ────────────────────────────────────────────────
  // getConversionLeaderboard
  // ────────────────────────────────────────────────

  describe('getConversionLeaderboard', () => {
    it('returns ranked results by conversion count', async () => {
      mockProspect.findAll.mockResolvedValue([
        {
          assignedAgentId: 'agent-1',
          assignedAgent: { id: 'agent-1', firstName: 'Alice' },
          dataValues: { conversions: '15' },
        },
        {
          assignedAgentId: 'agent-2',
          assignedAgent: { id: 'agent-2', firstName: 'Bob' },
          dataValues: { conversions: '8' },
        },
      ]);

      const result = await getConversionLeaderboard(new Date(), new Date(), 10);

      expect(result).toHaveLength(2);
      expect(result[0].value).toBe(15);
      expect(result[0].metric).toBe('Conversions');
      expect(result[1].value).toBe(8);
    });

    it('handles empty results', async () => {
      mockProspect.findAll.mockResolvedValue([]);

      const result = await getConversionLeaderboard(new Date(), new Date(), 10);

      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────
  // getProspectLeaderboard
  // ────────────────────────────────────────────────

  describe('getProspectLeaderboard', () => {
    it('returns ranked results by prospect count', async () => {
      mockProspect.findAll.mockResolvedValue([
        {
          assignedAgentId: 'agent-1',
          assignedAgent: { id: 'agent-1', firstName: 'Alice' },
          dataValues: { prospects: '30' },
        },
      ]);

      const result = await getProspectLeaderboard(new Date(), new Date(), 10);

      expect(result).toHaveLength(1);
      expect(result[0].value).toBe(30);
      expect(result[0].metric).toBe('New Prospects');
    });

    it('handles empty results', async () => {
      mockProspect.findAll.mockResolvedValue([]);

      const result = await getProspectLeaderboard(new Date(), new Date(), 10);

      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────
  // getLeaderboard (combined)
  // ────────────────────────────────────────────────

  describe('getLeaderboard', () => {
    it('defaults to conversions metric and month period', async () => {
      mockProspect.findAll.mockResolvedValue([]);

      const result = await getLeaderboard({});

      expect(result.period).toBe('month');
      expect(result.metric).toBe('conversions');
      expect(result.leaderboard).toEqual([]);
    });

    it('falls back to conversions for the retired commissions metric', async () => {
      mockProspect.findAll.mockResolvedValue([]);

      const result = await getLeaderboard({ metric: 'commissions' });

      expect(result.leaderboard).toEqual([]);
      expect(mockProspect.findAll).toHaveBeenCalled();
    });

    it('dispatches to conversion leaderboard when metric is conversions', async () => {
      mockProspect.findAll.mockResolvedValue([]);

      const result = await getLeaderboard({ metric: 'conversions', period: 'year' });

      expect(result.metric).toBe('conversions');
      expect(result.period).toBe('year');
    });

    it('dispatches to prospect leaderboard when metric is prospects', async () => {
      mockProspect.findAll.mockResolvedValue([]);

      const result = await getLeaderboard({ metric: 'prospects', period: 'week' });

      expect(result.metric).toBe('prospects');
    });

    it('falls back to the conversion leaderboard for unknown metric', async () => {
      mockProspect.findAll.mockResolvedValue([]);

      const result = await getLeaderboard({ metric: 'unknown' });

      expect(result.leaderboard).toEqual([]);
      expect(mockProspect.findAll).toHaveBeenCalled();
    });

    it('respects limit parameter', async () => {
      mockProspect.findAll.mockResolvedValue([]);

      await getLeaderboard({ limit: 5 });

      const callArgs = mockProspect.findAll.mock.calls[0][0];
      expect(callArgs.limit).toBe(5);
    });
  });
});
