/**
 * Capture-path screening gate + manual-release override tests (plan §15).
 * Uses the makeProspectService DI seam (no live Postgres, no module mocks).
 * Covers the decision table (screening × dnc × quota), hold bookkeeping, the
 * suppressed lead.created, D8 reward-hook eligibility, the post-commit dial
 * trigger, and the deduct-skip guards on both admin release paths (Codex #2).
 */
import { jest } from '@jest/globals';
import { makeProspectService } from '../../src/services/prospectService.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const CAMPAIGN = {
  id: 'c0000000-0000-4000-8000-000000000001',
  name: 'Screen Camp',
  status: 'active',
  is_active: true,
  enforceLeadQuota: false,
  leadPriceCents: null,
  design_config: { screeningCallAtSubmit: true },
};

function buildDeps(overrides = {}) {
  const createdProspects = [];
  const Prospect = {
    findOne: jest.fn().mockResolvedValue(null),
    findByPk: jest.fn().mockImplementation((id) => Promise.resolve({ id, campaign: null, assignedAgent: null })),
    create: jest.fn().mockImplementation((fields) => {
      const instance = { id: `pros-${createdProspects.length + 1}`, ...fields, update: jest.fn(), reload: jest.fn() };
      createdProspects.push(instance);
      return Promise.resolve(instance);
    }),
  };
  const models = {
    Prospect,
    ProspectActivity: { create: jest.fn().mockResolvedValue({}) },
    Attribution: { findOne: jest.fn().mockResolvedValue(null) },
    Campaign: { findByPk: jest.fn().mockResolvedValue({ ...CAMPAIGN }) },
    QrTag: { findByPk: jest.fn().mockResolvedValue(null) },
    User: { findByPk: jest.fn().mockResolvedValue(null), findOne: jest.fn().mockResolvedValue(null) },
    AgentGroup: { findByPk: jest.fn().mockResolvedValue(null) },
    AgentGroupMember: { findAll: jest.fn().mockResolvedValue([]) },
    Commission: {},
    IdempotencyKey: {},
  };
  const sequelize = {
    transaction: jest.fn().mockImplementation(async (cb) => (typeof cb === 'function' ? cb({}) : { commit: jest.fn(), rollback: jest.fn() })),
    literal: jest.fn().mockImplementation((s) => ({ literal: s })),
    query: jest.fn().mockResolvedValue([[{ id: 'p1' }]]),
  };
  return {
    models,
    sequelize,
    resolveAssignedAgentId: jest.fn().mockResolvedValue(null),
    resolveLeadRouting: jest.fn().mockResolvedValue({ agentId: 'agent-1', via: 'package' }),
    getSystemAgentId: jest.fn().mockResolvedValue(null),
    decideAssignment: jest.fn().mockResolvedValue({ action: 'assign', assignedAgentId: 'agent-1', charged: false, via: 'package' }),
    deductLeadCredit: jest.fn().mockResolvedValue(true),
    chargeLeadCredit: jest.fn().mockResolvedValue(true),
    deductExternalLeadBalance: jest.fn().mockResolvedValue(true),
    hasValidExternalConsent: jest.fn().mockReturnValue(false),
    buildExternalConsentEvidence: jest.fn().mockReturnValue(null),
    buildDncConsentEvidence: jest.fn().mockReturnValue(null),
    dncEnforcement: jest.fn().mockReturnValue('off'),
    formatDncNumber: jest.fn().mockReturnValue(null),
    dncCheckAndRecord: jest.fn().mockResolvedValue({ status: 'clear' }),
    gateHeldDncLead: jest.fn().mockResolvedValue({ outcome: 'released' }),
    screeningConfig: jest.fn().mockResolvedValue({ configured: true }),
    screeningApplies: jest.fn().mockResolvedValue(true),
    startScreeningAttempt: jest.fn().mockResolvedValue({ status: 'dialed' }),
    resolveConsumerForCaptureTx: jest.fn().mockResolvedValue(null),
    recordCaptureConsentEventsTx: jest.fn().mockResolvedValue(),
    canMarketTo: jest.fn().mockResolvedValue(false),
    isPhoneRecentlyVerified: jest.fn().mockReturnValue(true),
    getOrCreateProspectShareLink: jest.fn().mockResolvedValue({ url: '/share/x' }),
    buildProspectWhere: jest.fn().mockResolvedValue({}),
    dispatchEvent: jest.fn().mockResolvedValue(),
    onLeadCaptured: jest.fn().mockResolvedValue(),
    sendLeadEvent: jest.fn().mockResolvedValue({ sent: false }),
    sendCompleteRegistrationEvent: jest.fn().mockResolvedValue({ sent: false }),
    sendTikTokLeadEvent: jest.fn().mockResolvedValue({ sent: false }),
    sendTikTokCompleteRegistrationEvent: jest.fn().mockResolvedValue({ sent: false }),
    AppError: class AppError extends Error { constructor(m, s) { super(m); this.statusCode = s; } },
    logger: silentLogger,
    createdProspects,
    ...overrides,
  };
}

const baseBody = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '+6591234567',
  leadSource: 'qr_code',
  campaignId: CAMPAIGN.id,
};

describe('createProspect — screening gate decision table', () => {
  it('gate on + assignable route → born held screening_pending with bookkeeping; delivery suppressed; dial triggered; reward hook fires (D8)', async () => {
    const deps = buildDeps();
    const svc = makeProspectService(deps);
    const res = await svc.createProspect({ ...baseBody }, null, {});

    const row = deps.createdProspects[0];
    expect(row.quarantineReason).toBe('screening_pending');
    expect(row.quarantinedAt).toBeInstanceOf(Date);
    expect(row.assignedAgentId).toBeNull();
    expect(row.screeningMetadata).toEqual({ intendedAgentId: 'agent-1', alreadyCharged: false, attempts: {} });
    expect(res.quarantined).toBe(true);

    const dispatched = deps.dispatchEvent.mock.calls.map((c) => c[0]);
    expect(dispatched).not.toContain('lead.created');
    expect(deps.startScreeningAttempt).toHaveBeenCalledTimes(1);
    expect(deps.onLeadCaptured).toHaveBeenCalledTimes(1); // screening holds stay reward-eligible
  });

  it('capture-charged gated route stashes alreadyCharged for the release/refund bookkeeping', async () => {
    const deps = buildDeps({
      decideAssignment: jest.fn().mockResolvedValue({ action: 'assign', assignedAgentId: 'agent-1', charged: true, via: 'package' }),
    });
    const svc = makeProspectService(deps);
    await svc.createProspect({ ...baseBody }, null, {});
    expect(deps.createdProspects[0].screeningMetadata.alreadyCharged).toBe(true);
  });

  it('quota quarantine wins: screening never overrides no_funded_agent, no dial, no reward hook', async () => {
    const deps = buildDeps({
      decideAssignment: jest.fn().mockResolvedValue({ action: 'quarantine', quarantineReason: 'no_funded_agent', charged: false, via: 'package' }),
    });
    const svc = makeProspectService(deps);
    await svc.createProspect({ ...baseBody }, null, {});
    const row = deps.createdProspects[0];
    expect(row.quarantineReason).toBe('no_funded_agent');
    expect(row.screeningMetadata).toBeUndefined();
    expect(deps.startScreeningAttempt).not.toHaveBeenCalled();
    expect(deps.onLeadCaptured).not.toHaveBeenCalled();
  });

  it('DNC block-mode wins the capture hold: born dnc_pending, handoff dials later (never here)', async () => {
    const deps = buildDeps({
      dncEnforcement: jest.fn().mockReturnValue('block'),
      formatDncNumber: jest.fn().mockReturnValue('91234567'),
    });
    deps.models.Campaign.findByPk.mockResolvedValue({
      ...CAMPAIGN,
      design_config: { screeningCallAtSubmit: true, dncCheckAtSubmit: true },
    });
    const svc = makeProspectService(deps);
    await svc.createProspect({ ...baseBody }, null, {});
    const row = deps.createdProspects[0];
    expect(row.quarantineReason).toBe('dnc_pending');
    expect(row.dncMetadata).toEqual({ intendedAgentId: 'agent-1', alreadyCharged: false });
    expect(row.screeningMetadata).toBeUndefined();
    expect(deps.gateHeldDncLead).toHaveBeenCalled();
    expect(deps.startScreeningAttempt).not.toHaveBeenCalled();
  });

  it('gate not applicable → assigned + delivered exactly as today', async () => {
    const deps = buildDeps({ screeningApplies: jest.fn().mockResolvedValue(false) });
    const svc = makeProspectService(deps);
    const res = await svc.createProspect({ ...baseBody }, null, {});
    expect(deps.createdProspects[0].quarantineReason == null).toBe(true);
    expect(res.assignedAgentId).toBe('agent-1');
    expect(deps.dispatchEvent.mock.calls.map((c) => c[0])).toContain('lead.created');
    expect(deps.startScreeningAttempt).not.toHaveBeenCalled();
    expect(deps.onLeadCaptured).toHaveBeenCalled();
  });
});

describe('assignProspect — screening release override (deduct-skip, Codex #2)', () => {
  function heldProspect(screeningMetadata) {
    return {
      id: 'p1',
      assignedAgentId: null,
      campaignId: CAMPAIGN.id,
      quarantinedAt: new Date(),
      quarantineReason: 'screening_failed',
      screeningMetadata,
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+6591234567',
      email: 'j@x.co',
      sourceMetadata: {},
      notes: '',
      tags: [],
      reload: jest.fn().mockResolvedValue(),
      update: jest.fn().mockResolvedValue(),
    };
  }
  const agent = { id: 'agent-1', role: 'agent', isActive: true, firstName: 'A', lastName: 'G', phone: null, email: 'a@x.co', lyfeId: null, mktrLeadsId: null };

  async function runAssign(screeningMetadata) {
    const p = heldProspect(screeningMetadata);
    const deps = buildDeps();
    deps.models.Prospect.findByPk = jest.fn()
      .mockResolvedValueOnce(p) // target load
      .mockResolvedValue({ ...p, campaign: { id: CAMPAIGN.id, name: CAMPAIGN.name }, qrTag: null }); // withCampaign
    deps.models.User.findOne = jest.fn().mockResolvedValue(agent);
    deps.models.User.findByPk = jest.fn().mockResolvedValue(agent);
    const svc = makeProspectService(deps);
    const out = await svc.assignProspect('p1', 'agent-1', { id: 'admin-1', role: 'admin' });
    return { deps, out };
  }

  it('capture-charged, un-refunded screening lead releases WITHOUT a second deduct', async () => {
    const { deps } = await runAssign({ intendedAgentId: 'agent-1', alreadyCharged: true });
    expect(deps.deductLeadCredit).not.toHaveBeenCalled();
    const activity = deps.models.ProspectActivity.create.mock.calls[0][0];
    expect(activity.metadata.screeningOverride).toBe(true);
    expect(deps.dispatchEvent.mock.calls.map((c) => c[0])).toContain('lead.assigned');
  });

  it('refunded screening_failed override deducts normally (single-charge invariant)', async () => {
    const { deps } = await runAssign({ intendedAgentId: 'agent-1', alreadyCharged: true, chargeRefunded: true });
    expect(deps.deductLeadCredit).toHaveBeenCalledTimes(1);
  });

  it('never-charged screening lead deducts normally on release', async () => {
    const { deps } = await runAssign({ intendedAgentId: 'agent-1', alreadyCharged: false });
    expect(deps.deductLeadCredit).toHaveBeenCalledTimes(1);
  });
});
