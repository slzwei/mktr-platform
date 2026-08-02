/**
 * P1-3 regression: a DNC-held VOICE lead must bake a hold target it can
 * actually be delivered to.
 *
 * The web capture path nulls a fallback-routed target that carries no
 * lyfeId/mktrLeadsId, so releaseDncClearedLead re-resolves on clear and the
 * lead self-heals once a funded package appears. The Retell path set
 * `dncIntendedAgentId = assignedAgentId` with no such nulling, so a [Retell]
 * campaign with dncCheckAtSubmit=block and no funded agent baked the
 * System-Agent id. On release that id is truthy, re-resolution is skipped,
 * delivery to the destination-less System Agent fails — and the lead loops held
 * forever. Same shape as the 07-24 prod incident, on the path that never got
 * the fix.
 */
import { jest } from '@jest/globals';
import '../setup.js';
import { makeRetellService } from '../../src/services/retellService.js';

const SYSTEM_AGENT = { id: 'system-agent-id', lyfeId: null, mktrLeadsId: null, phone: null, email: 'system@mktr.local', firstName: 'System', lastName: 'Agent' };
const REAL_AGENT = { id: 'real-agent-id', lyfeId: 'lyfe-77', mktrLeadsId: null, phone: '+6590001234', email: 'agent@test.com', firstName: 'Real', lastName: 'Agent' };

function buildDeps({ routing, agentRow }) {
  const created = [];
  const campaign = {
    id: 'camp-retell',
    name: '[Retell] Voice Bot',
    is_active: true,
    design_config: { dncCheckAtSubmit: true },
  };

  return {
    created,
    deps: {
      Prospect: {
        create: jest.fn(async (payload) => {
          created.push(payload);
          return { id: 'prospect-held', ...payload, toJSON() { return { ...payload }; } };
        }),
        findByPk: jest.fn().mockResolvedValue(null),
      },
      IdempotencyKey: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      User: { findByPk: jest.fn(async (id) => (id === agentRow.id ? agentRow : null)), findOne: jest.fn().mockResolvedValue(null) },
      Campaign: {
        findByPk: jest.fn().mockResolvedValue(campaign),
        findOne: jest.fn().mockResolvedValue(campaign),
        findAll: jest.fn().mockResolvedValue([campaign]),
      },
      ProspectActivity: { create: jest.fn().mockResolvedValue({}) },
      sequelize: {
        transaction: jest.fn().mockResolvedValue({
          commit: jest.fn().mockResolvedValue(undefined),
          rollback: jest.fn().mockResolvedValue(undefined),
        }),
      },
      resolveLeadRouting: jest.fn().mockResolvedValue(routing),
      getSystemAgentId: jest.fn().mockResolvedValue(SYSTEM_AGENT.id),
      chargeLeadCredit: jest.fn().mockResolvedValue(true),
      // No funded package: the route stands as resolved, nothing charged.
      decideAssignment: jest.fn(async ({ routing: r }) => ({
        action: 'assign', assignedAgentId: r.agentId, charged: false, via: r.via,
      })),
      // Campaign opts into the DNC check and the registry is in block mode.
      dncEnforcement: jest.fn(() => 'block'),
      formatDncNumber: jest.fn(() => '91234567'),
      dncCheckAndRecord: jest.fn().mockResolvedValue({ status: 'clear' }),
      gateHeldDncLead: jest.fn().mockResolvedValue({ outcome: 'held' }),
      dispatchEvent: jest.fn().mockResolvedValue(undefined),
      sendLeadAssignmentEmail: jest.fn().mockResolvedValue(undefined),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    },
  };
}

const payload = (callId) => ({
  call_id: callId,
  call_status: 'ended',
  call_analysis: { call_successful: true, user_sentiment: 'Positive', call_summary: 'Good call', custom_analysis_data: {} },
  retell_llm_dynamic_variables: { name: 'Jane Tan' },
  to_number: '+6591234567',
  from_number: '+6590000000',
  transcript: 'hello',
  duration_ms: 30000,
  disconnection_reason: 'agent_hangup',
  agent_id: 'retell-agent-1',
  agent_name: 'Voice Bot',
});

describe('Retell DNC hold — intended-agent bake', () => {
  it('bakes NULL when the only route is the destination-less System Agent', async () => {
    const { created, deps } = buildDeps({
      routing: { agentId: SYSTEM_AGENT.id, via: 'fallback' },
      agentRow: SYSTEM_AGENT,
    });

    const res = await makeRetellService(deps).processRetellCall(payload('call-sys'));

    expect(res.status).toBe('quarantined'); // born held pending the DNC check
    expect(created).toHaveLength(1);
    const row = created[0];
    expect(row.quarantineReason).toBe('dnc_pending');
    // The whole point: null ⇒ release-time re-resolution ⇒ the hold self-heals.
    expect(row.dncMetadata).toEqual({ intendedAgentId: null, alreadyCharged: false });
    expect(deps.gateHeldDncLead).toHaveBeenCalled();
  });

  it('keeps a fallback bake that CAN be delivered (provenance-carrying default agent)', async () => {
    const { created, deps } = buildDeps({
      routing: { agentId: REAL_AGENT.id, via: 'fallback' },
      agentRow: REAL_AGENT,
    });

    await makeRetellService(deps).processRetellCall(payload('call-default'));

    expect(created[0].dncMetadata.intendedAgentId).toBe(REAL_AGENT.id);
  });

  it('leaves a non-fallback route untouched', async () => {
    const { created, deps } = buildDeps({
      routing: { agentId: REAL_AGENT.id, via: 'package' },
      agentRow: REAL_AGENT,
    });

    await makeRetellService(deps).processRetellCall(payload('call-package'));

    expect(created[0].dncMetadata.intendedAgentId).toBe(REAL_AGENT.id);
    // A non-fallback route never needs the deliverability lookup.
    expect(deps.User.findByPk).not.toHaveBeenCalledWith(REAL_AGENT.id, expect.objectContaining({
      attributes: ['id', 'lyfeId', 'mktrLeadsId'],
    }));
  });
});
