import { jest } from '@jest/globals';
import '../setup.js';
import { makeReleaseSweep } from '../../src/services/releaseSweep.js';

// NOTE: destinationForAgent / externalIdForDestination are intentionally NOT
// overridden — the real (pure) helpers run, so these tests verify the ACTUAL
// destination routing (the P0-4 fix), not a mock's echo.
function buildMocks(campaignOverrides = {}) {
  const mockTx = { commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn().mockResolvedValue(undefined) };
  const campaign = { id: 'camp-1', enforceLeadQuota: true, ...campaignOverrides };
  // Default agent is a Lyfe agent (lyfeId set) → destination 'lyfe'.
  const agent = { id: 'a1', lyfeId: 'lyfe-a1', mktrLeadsId: null, phone: '+65', email: 'a@x', firstName: 'A', lastName: 'B' };

  const deps = {
    Campaign: { findByPk: jest.fn().mockResolvedValue(campaign) },
    Prospect: {
      findOne: jest.fn().mockResolvedValue(null),
      findByPk: jest.fn().mockResolvedValue({ campaign: { id: 'camp-1', name: 'C' } }),
      findAll: jest.fn().mockResolvedValue([]),
    },
    ProspectActivity: { create: jest.fn().mockResolvedValue({}) },
    User: { findByPk: jest.fn().mockResolvedValue(agent) },
    sequelize: { transaction: jest.fn().mockResolvedValue(mockTx), query: jest.fn().mockResolvedValue([[{ id: 'h' }]]) },
    resolveLeadRouting: jest.fn().mockResolvedValue({ agentId: 'a1', via: 'package' }),
    chargeLeadCredit: jest.fn().mockResolvedValue(true),
    persistEventDeliveries: jest.fn().mockResolvedValue([{ delivery: { id: 'd' }, subscriber: { id: 's' } }]),
    flushDeliveries: jest.fn(),
    buildLeadCreatedPayload: jest.fn(() => ({})),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  };
  return { deps, mockTx, agent };
}

const held = (id) => ({ id, reload: jest.fn().mockResolvedValue(true) });

describe('releaseSweep.sweepCampaign (unit)', () => {
  it('skips soft (non-quota) campaigns and does no work', async () => {
    const { deps } = buildMocks({ enforceLeadQuota: false });
    const n = await makeReleaseSweep(deps).sweepCampaign('camp-1');
    expect(n).toBe(0);
    expect(deps.Prospect.findOne).not.toHaveBeenCalled();
  });

  it('fences off external holds: the FIFO query matches only internal quota holds', async () => {
    const { deps } = buildMocks();
    deps.Prospect.findOne.mockResolvedValue(null); // empty queue — we only inspect the query shape
    await makeReleaseSweep(deps).sweepCampaign('camp-1');
    expect(deps.Prospect.findOne).toHaveBeenCalled();
    expect(deps.Prospect.findOne.mock.calls[0][0].where).toMatchObject({
      quarantineReason: 'no_funded_agent',
    });
  });

  it('drains the held queue FIFO: releases each funded lead, charges, persists+flushes lead.created', async () => {
    const { deps, mockTx } = buildMocks();
    deps.Prospect.findOne
      .mockResolvedValueOnce(held('h1'))
      .mockResolvedValueOnce(held('h2'))
      .mockResolvedValue(null); // queue drained
    deps.sequelize.query.mockResolvedValue([[{ id: 'claimed' }]]); // claim won
    deps.chargeLeadCredit.mockResolvedValue(true);

    const n = await makeReleaseSweep(deps).sweepCampaign('camp-1');

    expect(n).toBe(2);
    expect(deps.chargeLeadCredit).toHaveBeenCalledTimes(2);
    expect(deps.chargeLeadCredit).toHaveBeenCalledWith('a1', 'camp-1', mockTx);
    // Transactional outbox: the delivery row is persisted INSIDE the tx, then flushed.
    expect(deps.persistEventDeliveries).toHaveBeenCalledTimes(2);
    expect(deps.persistEventDeliveries).toHaveBeenCalledWith(
      'lead.created', expect.any(Function), { destination: 'lyfe' }, mockTx
    );
    expect(deps.flushDeliveries).toHaveBeenCalledTimes(2);
  });

  it('mktr-leads agent: routes lead.created to mktr_leads (destination-scoped) — never a broadcast (P0-4)', async () => {
    const { deps, mockTx } = buildMocks();
    const mktrAgent = { id: 'a1', lyfeId: null, mktrLeadsId: 'ml-a1', phone: '65', email: 'a@x', firstName: 'A', lastName: 'B' };
    deps.User.findByPk.mockResolvedValue(mktrAgent);
    deps.Prospect.findOne.mockResolvedValueOnce(held('h1')).mockResolvedValue(null);
    deps.sequelize.query.mockResolvedValue([[{ id: 'claimed' }]]);
    deps.chargeLeadCredit.mockResolvedValue(true);

    await makeReleaseSweep(deps).sweepCampaign('camp-1');

    // Destination MUST be present (mktr_leads) so delivery is scoped to the agent's
    // own app — not the legacy event-type-only broadcast that leaked PII to Lyfe.
    expect(deps.persistEventDeliveries).toHaveBeenCalledWith(
      'lead.created', expect.any(Function), { destination: 'mktr_leads' }, mockTx
    );
  });

  it('stops when no funded agent is available (via=fallback) — releases nothing', async () => {
    const { deps } = buildMocks();
    deps.Prospect.findOne.mockResolvedValueOnce(held('h1')).mockResolvedValue(null);
    deps.resolveLeadRouting.mockResolvedValue({ agentId: 'system', via: 'fallback' });

    const n = await makeReleaseSweep(deps).sweepCampaign('camp-1');

    expect(n).toBe(0);
    expect(deps.chargeLeadCredit).not.toHaveBeenCalled();
    expect(deps.persistEventDeliveries).not.toHaveBeenCalled();
    expect(deps.flushDeliveries).not.toHaveBeenCalled();
  });

  it('credits run out mid-drain: charge fails → rolls back the claim and stops', async () => {
    const { deps, mockTx } = buildMocks();
    deps.Prospect.findOne.mockResolvedValueOnce(held('h1')).mockResolvedValue(null);
    deps.sequelize.query.mockResolvedValue([[{ id: 'claimed' }]]); // claim won
    deps.chargeLeadCredit.mockResolvedValue(false); // no credit

    const n = await makeReleaseSweep(deps).sweepCampaign('camp-1');

    expect(n).toBe(0);
    expect(mockTx.rollback).toHaveBeenCalledTimes(1);
    expect(mockTx.commit).not.toHaveBeenCalled();
    expect(deps.persistEventDeliveries).not.toHaveBeenCalled();
    expect(deps.flushDeliveries).not.toHaveBeenCalled();
  });

  it('lost the claim race (0 rows) → rolls back, skips, no double delivery', async () => {
    const { deps, mockTx } = buildMocks();
    deps.Prospect.findOne.mockResolvedValueOnce(held('h1')).mockResolvedValue(null);
    deps.sequelize.query.mockResolvedValue([[]]); // claim lost

    const n = await makeReleaseSweep(deps).sweepCampaign('camp-1');

    expect(n).toBe(0);
    expect(mockTx.rollback).toHaveBeenCalled();
    expect(deps.chargeLeadCredit).not.toHaveBeenCalled();
    expect(deps.persistEventDeliveries).not.toHaveBeenCalled();
    expect(deps.flushDeliveries).not.toHaveBeenCalled();
  });
});
