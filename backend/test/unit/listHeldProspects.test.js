import { jest } from '@jest/globals';
import '../setup.js';
import { makeProspectService } from '../../src/services/prospectService.js';

// listHeldProspects only touches d.buildProspectWhere + m.Prospect.findAndCountAll, so a
// tiny override is enough (the other real deps are never called → no DB connection).
function svc(findAndCountAll, scope = { assignedAgentId: 'scoped' }) {
  return makeProspectService({
    models: { Prospect: { findAndCountAll } },
    buildProspectWhere: jest.fn().mockResolvedValue(scope),
  });
}

const user = { id: 'admin-1', role: 'admin' };

describe('listHeldProspects (unit)', () => {
  it('returns held leads FIFO with campaign name, scoped + campaign-filtered', async () => {
    const findAndCountAll = jest.fn().mockResolvedValue({
      count: 1,
      rows: [{
        id: 'h1', firstName: 'A', lastName: 'B', phone: '+6591234567', email: null,
        leadSource: 'website', campaignId: 'c1', quarantinedAt: new Date(),
        quarantineReason: 'no_funded_agent', createdAt: new Date(),
        campaign: { id: 'c1', name: 'Camp' },
      }],
    });

    const res = await svc(findAndCountAll).listHeldProspects(user, { campaignId: 'c1' });

    expect(res.count).toBe(1);
    expect(res.held[0]).toMatchObject({ id: 'h1', campaignName: 'Camp', quarantineReason: 'no_funded_agent' });

    const arg = findAndCountAll.mock.calls[0][0];
    expect(arg.where.assignedAgentId).toBe('scoped');         // caller scope applied
    expect(arg.where.campaignId).toBe('c1');                  // campaign filter applied
    expect(arg.where.quarantinedAt).toBeDefined();            // held-only filter
    expect(arg.order).toEqual([['quarantinedAt', 'ASC']]);    // FIFO release order
  });

  it('omits the campaign filter when not provided, and still filters held-only', async () => {
    const findAndCountAll = jest.fn().mockResolvedValue({ count: 0, rows: [] });
    const res = await svc(findAndCountAll).listHeldProspects(user, {});
    const arg = findAndCountAll.mock.calls[0][0];
    expect(arg.where.campaignId).toBeUndefined();
    expect(arg.where.quarantinedAt).toBeDefined();
    expect(res).toEqual({ count: 0, held: [] });
  });

  it('caps the limit at 500', async () => {
    const findAndCountAll = jest.fn().mockResolvedValue({ count: 0, rows: [] });
    await svc(findAndCountAll).listHeldProspects(user, { limit: '99999' });
    expect(findAndCountAll.mock.calls[0][0].limit).toBe(500);
  });
});
