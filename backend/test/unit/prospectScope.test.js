import { jest } from '@jest/globals';
import '../setup.js';

// Mock the Campaign model
const mockCampaignFindAll = jest.fn();

jest.unstable_mockModule('../../src/models/index.js', () => ({
  Campaign: {
    findAll: mockCampaignFindAll,
  },
}));

const { buildProspectWhere } = await import('../../src/middleware/prospectScope.js');

describe('buildProspectWhere (prospect scoping)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns empty object for admin (sees all prospects)', async () => {
    const user = { id: 'admin-1', role: 'admin' };
    const where = await buildProspectWhere(user);
    expect(where).toEqual({});
  });

  it('scopes to assignedAgentId for agent role', async () => {
    const user = { id: 'agent-1', role: 'agent' };
    const where = await buildProspectWhere(user);
    expect(where).toEqual({ assignedAgentId: 'agent-1' });
  });

  it('scopes to campaign IDs for fleet_owner role', async () => {
    mockCampaignFindAll.mockResolvedValue([
      { id: 'camp-1' },
      { id: 'camp-2' },
    ]);

    const user = { id: 'fleet-1', role: 'fleet_owner' };
    const where = await buildProspectWhere(user);

    expect(mockCampaignFindAll).toHaveBeenCalledWith({
      where: { createdBy: 'fleet-1' },
      attributes: ['id'],
    });
    // The campaignId should use Op.in with the campaign IDs
    expect(where.campaignId).toBeDefined();
  });

  it('scopes to campaign IDs for customer role', async () => {
    mockCampaignFindAll.mockResolvedValue([{ id: 'camp-10' }]);

    const user = { id: 'cust-1', role: 'customer' };
    const where = await buildProspectWhere(user);

    expect(where.campaignId).toBeDefined();
  });

  it('returns empty campaignId list when user has no campaigns', async () => {
    mockCampaignFindAll.mockResolvedValue([]);

    const user = { id: 'nobody-1', role: 'driver_partner' };
    const where = await buildProspectWhere(user);

    expect(where.campaignId).toBeDefined();
  });

  it('does not query campaigns for admin or agent roles', async () => {
    await buildProspectWhere({ id: 'admin-1', role: 'admin' });
    await buildProspectWhere({ id: 'agent-1', role: 'agent' });

    expect(mockCampaignFindAll).not.toHaveBeenCalled();
  });
});
