import { jest } from '@jest/globals';
import '../setup.js';
import { makeReleaseSweep } from '../../src/services/releaseSweep.js';

function buildMocks(campaignOverrides = {}) {
  const mockTx = { commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn().mockResolvedValue(undefined) };
  const campaign = { id: 'camp-1', enforceLeadQuota: true, ...campaignOverrides };
  const agent = { id: 'a1', lyfeId: 'lyfe-a1', phone: '+65', email: 'a@x', firstName: 'A', lastName: 'B' };

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
    dispatchEvent: jest.fn().mockResolvedValue(undefined),
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

  it('drains the held queue FIFO: releases each funded lead, charges, fires lead.created', async () => {
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
    expect(deps.dispatchEvent).toHaveBeenCalledTimes(2);
    expect(deps.dispatchEvent).toHaveBeenCalledWith('lead.created', expect.any(Function));
  });

  it('stops when no funded agent is available (via=fallback) — releases nothing', async () => {
    const { deps } = buildMocks();
    deps.Prospect.findOne.mockResolvedValueOnce(held('h1')).mockResolvedValue(null);
    deps.resolveLeadRouting.mockResolvedValue({ agentId: 'system', via: 'fallback' });

    const n = await makeReleaseSweep(deps).sweepCampaign('camp-1');

    expect(n).toBe(0);
    expect(deps.chargeLeadCredit).not.toHaveBeenCalled();
    expect(deps.dispatchEvent).not.toHaveBeenCalled();
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
    expect(deps.dispatchEvent).not.toHaveBeenCalled();
  });

  it('lost the claim race (0 rows) → rolls back, skips, no double delivery', async () => {
    const { deps, mockTx } = buildMocks();
    deps.Prospect.findOne.mockResolvedValueOnce(held('h1')).mockResolvedValue(null);
    deps.sequelize.query.mockResolvedValue([[]]); // claim lost

    const n = await makeReleaseSweep(deps).sweepCampaign('camp-1');

    expect(n).toBe(0);
    expect(mockTx.rollback).toHaveBeenCalled();
    expect(deps.chargeLeadCredit).not.toHaveBeenCalled();
    expect(deps.dispatchEvent).not.toHaveBeenCalled();
  });
});
