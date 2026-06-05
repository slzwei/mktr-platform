import { jest } from '@jest/globals';
import '../setup.js';
import { makeRetellService } from '../../src/services/retellService.js';
import { makeMetaLeadService } from '../../src/services/metaLeadService.js';

// Both inbound paths (Retell voice, Meta Lead Ads) route through the REAL
// decideAssignment (not overridden) with an injected chargeLeadCredit, exactly like
// createProspect. These services NEVER best-effort deducted, so on soft campaigns they
// must stay deduct-free; only the quota path charges (authoritatively) or quarantines.

const AppError = class extends Error { constructor(m, c) { super(m); this.statusCode = c; } };
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function commonMocks(campaign, prospect) {
  const mockTx = { commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn().mockResolvedValue(undefined) };
  return {
    mockTx,
    Prospect: { create: jest.fn().mockResolvedValue(prospect) },
    IdempotencyKey: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    User: {
      findByPk: jest.fn().mockResolvedValue({ id: 'agent-1', lyfeId: 'lyfe-1', phone: '+6590000001', email: 'a@x.com', firstName: 'A', lastName: 'B' }),
      findOne: jest.fn().mockResolvedValue(null),
    },
    Campaign: { findByPk: jest.fn().mockResolvedValue(campaign), findOne: jest.fn().mockResolvedValue(campaign) },
    ProspectActivity: { create: jest.fn().mockResolvedValue({}) },
    sequelize: { transaction: jest.fn().mockResolvedValue(mockTx) },
    resolveAssignedAgentId: jest.fn(),
    resolveLeadRouting: jest.fn().mockResolvedValue({ agentId: 'agent-1', via: 'package' }),
    chargeLeadCredit: jest.fn().mockResolvedValue(true),
    // decideAssignment intentionally NOT overridden → uses the real (pure) impl.
    dispatchEvent: jest.fn().mockResolvedValue(undefined),
    sendLeadAssignmentEmail: jest.fn().mockResolvedValue(undefined),
    AppError,
    logger,
  };
}

const mockProspect = () => ({
  id: 'p-1', firstName: 'John', lastName: 'Doe', phone: '+6591234567', email: null,
  notes: 'n', sourceMetadata: {}, createdAt: '2026-01-01T00:00:00Z', toJSON() { return { ...this }; },
});

// ──────────────────────────────────────────────────────────────
// Retell
// ──────────────────────────────────────────────────────────────
describe('retellService.processRetellCall (lead quota)', () => {
  const payload = {
    call_id: 'call-1', call_status: 'ended',
    call_analysis: { call_successful: true, user_sentiment: 'Positive' },
    agent_id: 'agent_x', agent_name: 'Test Agent',
    to_number: '+6591234567', from_number: '+6590000000',
    retell_llm_dynamic_variables: { name: 'John Doe' },
    duration_ms: 1000, disconnection_reason: 'hangup', transcript: 'hello',
  };

  function svc(campaignOverrides = {}) {
    const campaign = { id: 'camp-1', name: '[Retell] Test Agent', is_active: true, enforceLeadQuota: true, ...campaignOverrides };
    const deps = commonMocks(campaign, mockProspect());
    return { service: makeRetellService(deps), deps };
  }

  it('funded gated route → assigns, charges once, fires lead.created, status=created', async () => {
    const { service, deps } = svc();
    deps.resolveLeadRouting.mockResolvedValue({ agentId: 'agent-1', via: 'package' });
    deps.chargeLeadCredit.mockResolvedValue(true);

    const res = await service.processRetellCall(payload);

    expect(deps.Prospect.create.mock.calls[0][0]).toMatchObject({ assignedAgentId: 'agent-1', quarantinedAt: null });
    expect(deps.chargeLeadCredit).toHaveBeenCalledWith('agent-1', 'camp-1', deps.mockTx);
    expect(deps.dispatchEvent).toHaveBeenCalledWith('lead.created', expect.any(Function));
    expect(res.status).toBe('created');
  });

  it('unfunded → quarantines: no agent, quarantinedAt set, NO lead.created, status=quarantined', async () => {
    const { service, deps } = svc();
    deps.resolveLeadRouting.mockResolvedValue({ agentId: 'agent-1', via: 'package' });
    deps.chargeLeadCredit.mockResolvedValue(false);

    const res = await service.processRetellCall(payload);

    const arg = deps.Prospect.create.mock.calls[0][0];
    expect(arg.assignedAgentId).toBeNull();
    expect(arg.quarantinedAt).toBeInstanceOf(Date);
    expect(arg.quarantineReason).toBe('no_funded_agent');
    expect(deps.dispatchEvent).not.toHaveBeenCalled();
    expect(deps.sendLeadAssignmentEmail).not.toHaveBeenCalled();
    expect(res.status).toBe('quarantined');
  });

  it('soft campaign → assigns WITHOUT charging (retell never deducted), fires lead.created', async () => {
    const { service, deps } = svc({ enforceLeadQuota: false });
    deps.resolveLeadRouting.mockResolvedValue({ agentId: 'agent-1', via: 'package' });

    const res = await service.processRetellCall(payload);

    expect(deps.Prospect.create.mock.calls[0][0].assignedAgentId).toBe('agent-1');
    expect(deps.chargeLeadCredit).not.toHaveBeenCalled();
    expect(deps.dispatchEvent).toHaveBeenCalledWith('lead.created', expect.any(Function));
    expect(res.status).toBe('created');
  });
});

// ──────────────────────────────────────────────────────────────
// Meta
// ──────────────────────────────────────────────────────────────
describe('metaLeadService.processMetaLead (lead quota)', () => {
  beforeEach(() => { process.env.META_PAGE_ACCESS_TOKEN = 'test-token'; });

  function svc(campaignOverrides = {}) {
    const campaign = { id: 'camp-1', name: '[Meta] MyForm', is_active: true, enforceLeadQuota: true, ...campaignOverrides };
    const deps = commonMocks(campaign, mockProspect());
    deps.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        field_data: [
          { name: 'full_name', values: ['Jane Doe'] },
          { name: 'email', values: ['jane@x.com'] },
          { name: 'phone_number', values: ['+6591234567'] },
        ],
        form_name: 'MyForm', platform: 'fb',
      }),
    });
    return { service: makeMetaLeadService(deps), deps };
  }

  it('funded gated route → assigns, charges once, fires lead.created, status=created', async () => {
    const { service, deps } = svc();
    deps.resolveLeadRouting.mockResolvedValue({ agentId: 'agent-1', via: 'package' });
    deps.chargeLeadCredit.mockResolvedValue(true);

    const res = await service.processMetaLead('lead-1', 'page-1', 'form-1', 1700000000);

    expect(deps.Prospect.create.mock.calls[0][0]).toMatchObject({ assignedAgentId: 'agent-1', quarantinedAt: null });
    expect(deps.chargeLeadCredit).toHaveBeenCalledWith('agent-1', 'camp-1', deps.mockTx);
    expect(deps.dispatchEvent).toHaveBeenCalledWith('lead.created', expect.any(Function));
    expect(res.status).toBe('created');
  });

  it('unfunded → quarantines: no agent, quarantinedAt set, NO lead.created, status=quarantined', async () => {
    const { service, deps } = svc();
    deps.resolveLeadRouting.mockResolvedValue({ agentId: 'agent-1', via: 'package' });
    deps.chargeLeadCredit.mockResolvedValue(false);

    const res = await service.processMetaLead('lead-1', 'page-1', 'form-1', 1700000000);

    const arg = deps.Prospect.create.mock.calls[0][0];
    expect(arg.assignedAgentId).toBeNull();
    expect(arg.quarantinedAt).toBeInstanceOf(Date);
    expect(arg.quarantineReason).toBe('no_funded_agent');
    expect(deps.dispatchEvent).not.toHaveBeenCalled();
    expect(res.status).toBe('quarantined');
  });

  it('soft campaign → assigns WITHOUT charging (meta never deducted), fires lead.created', async () => {
    const { service, deps } = svc({ enforceLeadQuota: false });
    deps.resolveLeadRouting.mockResolvedValue({ agentId: 'agent-1', via: 'package' });

    const res = await service.processMetaLead('lead-1', 'page-1', 'form-1', 1700000000);

    expect(deps.Prospect.create.mock.calls[0][0].assignedAgentId).toBe('agent-1');
    expect(deps.chargeLeadCredit).not.toHaveBeenCalled();
    expect(deps.dispatchEvent).toHaveBeenCalledWith('lead.created', expect.any(Function));
    expect(res.status).toBe('created');
  });
});
