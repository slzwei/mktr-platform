import { jest } from '@jest/globals';
import '../setup.js';
// leadQuota.js imports nothing from the DB, so we can import it directly.
import { decideAssignment } from '../../src/services/leadQuota.js';

const softCampaign = { enforceLeadQuota: false };
const quotaCampaign = { enforceLeadQuota: true };

describe('decideAssignment (unit)', () => {
  let charge;
  beforeEach(() => { charge = jest.fn(); });

  // ── Soft campaigns: never gated, never charged here ──
  it('soft campaign: assigns the resolved agent without charging (best-effort left to caller)', async () => {
    for (const via of ['self', 'admin', 'qr', 'package', 'fallback']) {
      const d = await decideAssignment({ campaign: softCampaign, routing: { agentId: 'a1', via }, campaignId: 'c1', charge });
      expect(d.action).toBe('assign');
      expect(d.assignedAgentId).toBe('a1');
      expect(d.charged).toBe(false);
    }
    expect(charge).not.toHaveBeenCalled();
  });

  // ── Exempt routes under quota: deliver, no authoritative charge ──
  it('quota campaign, self route: exempt → assign without charging', async () => {
    const d = await decideAssignment({ campaign: quotaCampaign, routing: { agentId: 'agent', via: 'self' }, campaignId: 'c1', charge });
    expect(d).toMatchObject({ action: 'assign', assignedAgentId: 'agent', charged: false, via: 'self' });
    expect(charge).not.toHaveBeenCalled();
  });

  it('quota campaign, admin route: exempt → assign without charging', async () => {
    const d = await decideAssignment({ campaign: quotaCampaign, routing: { agentId: 'agent', via: 'admin' }, campaignId: 'c1', charge });
    expect(d).toMatchObject({ action: 'assign', charged: false, via: 'admin' });
    expect(charge).not.toHaveBeenCalled();
  });

  // ── Gated routes under quota: charge gates delivery ──
  it('quota campaign, package route, charge succeeds → assign with charged=true', async () => {
    charge.mockResolvedValue(true);
    const d = await decideAssignment({ campaign: quotaCampaign, routing: { agentId: 'agent', via: 'package' }, campaignId: 'c1', transaction: 'TX', charge });
    expect(d).toMatchObject({ action: 'assign', assignedAgentId: 'agent', charged: true, via: 'package' });
    expect(charge).toHaveBeenCalledWith('agent', 'c1', 'TX');
  });

  it('quota campaign, package route, charge fails → quarantine (no_funded_agent)', async () => {
    charge.mockResolvedValue(false);
    const d = await decideAssignment({ campaign: quotaCampaign, routing: { agentId: 'agent', via: 'package' }, campaignId: 'c1', charge });
    expect(d).toMatchObject({ action: 'quarantine', quarantineReason: 'no_funded_agent' });
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it('quota campaign, qr route is GATED (decision a), charge fails → quarantine', async () => {
    charge.mockResolvedValue(false);
    const d = await decideAssignment({ campaign: quotaCampaign, routing: { agentId: 'agent', via: 'qr' }, campaignId: 'c1', charge });
    expect(d.action).toBe('quarantine');
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it('quota campaign, fallback route → quarantine WITHOUT charging (no funded agent by definition)', async () => {
    const d = await decideAssignment({ campaign: quotaCampaign, routing: { agentId: 'system-agent', via: 'fallback' }, campaignId: 'c1', charge });
    expect(d).toMatchObject({ action: 'quarantine', quarantineReason: 'no_funded_agent', via: 'fallback' });
    expect(charge).not.toHaveBeenCalled();
  });

  it('quota campaign, gated route but null agent → quarantine without charging', async () => {
    const d = await decideAssignment({ campaign: quotaCampaign, routing: { agentId: null, via: 'package' }, campaignId: 'c1', charge });
    expect(d.action).toBe('quarantine');
    expect(charge).not.toHaveBeenCalled();
  });

  it('defaults a missing routing to a quarantine under quota (defensive)', async () => {
    const d = await decideAssignment({ campaign: quotaCampaign, routing: undefined, campaignId: 'c1', charge });
    expect(d.action).toBe('quarantine');
    expect(d.via).toBe('fallback');
  });
});
