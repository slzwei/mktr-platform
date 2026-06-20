import { aggregateDeliveryPoolAgents } from '../services/leadPackageService.js';

// Pure aggregation logic for the campaign-first delivery pool — DB-free.
describe('leadPackageService.aggregateDeliveryPoolAgents', () => {
  const mk = (over = {}) => ({
    id: 'x1',
    leadPackageId: 'p1',
    leadsRemaining: 10,
    leadsTotal: 10,
    purchaseDate: '2026-01-01T00:00:00.000Z',
    agent: { id: 'agent1', firstName: 'A', lastName: 'B', email: 'a@b.com', phone: '6512345678' },
    package: { name: 'Gold' },
    ...over,
  });

  it('returns an empty array for no assignments', () => {
    expect(aggregateDeliveryPoolAgents([])).toEqual([]);
    expect(aggregateDeliveryPoolAgents()).toEqual([]);
  });

  it("sums remaining credits across one agent's assignments", () => {
    const out = aggregateDeliveryPoolAgents([
      mk({ id: 'x1', leadsRemaining: 10 }),
      mk({ id: 'x2', leadsRemaining: 5, leadPackageId: 'p2' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].remainingCredits).toBe(15);
    expect(out[0].assignments).toHaveLength(2);
  });

  it('groups multiple agents separately', () => {
    const out = aggregateDeliveryPoolAgents([
      mk({ agent: { id: 'agentA' } }),
      mk({ agent: { id: 'agentB' } }),
    ]);
    expect(out.map((a) => a.agentId).sort()).toEqual(['agentA', 'agentB']);
  });

  it('tracks the latest purchaseDate as lastPackageAssignedAt', () => {
    const out = aggregateDeliveryPoolAgents([
      mk({ id: 'old', purchaseDate: '2026-01-01T00:00:00.000Z' }),
      mk({ id: 'new', purchaseDate: '2026-03-01T00:00:00.000Z' }),
    ]);
    expect(new Date(out[0].lastPackageAssignedAt).toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('skips rows with no agent', () => {
    const out = aggregateDeliveryPoolAgents([mk({ agent: null }), mk({ agent: { id: 'agentX' } })]);
    expect(out).toHaveLength(1);
    expect(out[0].agentId).toBe('agentX');
  });

  it('derives fullName from first/last when fullName is absent', () => {
    const out = aggregateDeliveryPoolAgents([
      mk({ agent: { id: 'agentY', firstName: 'Jane', lastName: 'Doe' } }),
    ]);
    expect(out[0].fullName).toBe('Jane Doe');
  });
});
