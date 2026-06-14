import { jest } from '@jest/globals';
import '../setup.js';
import { Op } from 'sequelize';
import { makeProspectService } from '../../src/services/prospectService.js';

// ── Helpers ──

function buildMocks() {
  const mockProspect = {
    id: 'prospect-1',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@test.com',
    phone: '+6591234567',
    leadSource: 'website',
    leadStatus: 'new',
    priority: 'medium',
    campaignId: 'camp-1',
    assignedAgentId: null,
    qrTagId: null,
    sourceMetadata: {},
    createdAt: new Date().toISOString(),
    toJSON: jest.fn(function () { return { ...this }; }),
    update: jest.fn().mockResolvedValue(true),
    save: jest.fn().mockResolvedValue(true),
    destroy: jest.fn().mockResolvedValue(true),
  };

  const mockAgent = {
    id: 'agent-1',
    lyfeId: 'lyfe-agent-1',
    firstName: 'Agent',
    lastName: 'Smith',
    email: 'agent@test.com',
    phone: '+6590000001',
    role: 'agent',
    isActive: true,
  };

  const mockAgent2 = {
    id: 'agent-2',
    lyfeId: 'lyfe-agent-2',
    firstName: 'Bob',
    lastName: 'Jones',
    email: 'bob@test.com',
    phone: '+6590000002',
    role: 'agent',
    isActive: true,
  };

  const mockCampaign = {
    id: 'camp-1',
    name: 'Test Campaign',
    type: 'lead_gen',
    status: 'active',
    is_active: true,
  };

  const Prospect = {
    create: jest.fn().mockResolvedValue(mockProspect),
    findOne: jest.fn().mockResolvedValue(null),
    findByPk: jest.fn().mockResolvedValue(mockProspect),
    findAll: jest.fn().mockResolvedValue([]),
    findAndCountAll: jest.fn().mockResolvedValue({ count: 0, rows: [] }),
    count: jest.fn().mockResolvedValue(0),
    update: jest.fn().mockResolvedValue([1]),
  };

  const User = {
    findOne: jest.fn().mockResolvedValue(mockAgent),
    findByPk: jest.fn().mockResolvedValue(mockAgent),
    findAll: jest.fn().mockResolvedValue([]),
  };

  const Campaign = {
    findByPk: jest.fn().mockResolvedValue(mockCampaign),
  };

  const QrTag = {
    findByPk: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue([1, []]),
  };

  const Commission = { create: jest.fn().mockResolvedValue({}) };
  const Attribution = { findOne: jest.fn().mockResolvedValue(null) };
  const ProspectActivity = { create: jest.fn().mockResolvedValue({}) };
  const AgentGroup = { findByPk: jest.fn().mockResolvedValue(null) };
  const AgentGroupMember = { findAll: jest.fn().mockResolvedValue([]) };

  const mockTransaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };

  const sequelize = {
    transaction: jest.fn(async (callback) => callback(mockTransaction)),
    query: jest.fn().mockResolvedValue([[{ id: 'prospect-1' }]]),
    fn: jest.fn((fnName, col) => `${fnName}(${col})`),
    col: jest.fn((name) => name),
    literal: jest.fn((expr) => expr),
  };

  const resolveAssignedAgentId = jest.fn().mockResolvedValue('agent-1');
  const resolveLeadRouting = jest.fn().mockResolvedValue({ agentId: 'agent-1', via: 'admin' });
  const getSystemAgentId = jest.fn().mockResolvedValue('system-agent-id');
  const deductLeadCredit = jest.fn().mockResolvedValue(true);
  const chargeLeadCredit = jest.fn().mockResolvedValue(true);
  const buildProspectWhere = jest.fn().mockResolvedValue({});
  const dispatchEvent = jest.fn().mockResolvedValue(undefined);

  const AppError = class extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
    }
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  return {
    mockProspect,
    mockAgent,
    mockAgent2,
    mockCampaign,
    mockTransaction,
    models: { Prospect, User, Campaign, QrTag, Commission, Attribution, ProspectActivity, AgentGroup, AgentGroupMember },
    sequelize,
    resolveAssignedAgentId,
    resolveLeadRouting,
    getSystemAgentId,
    deductLeadCredit,
    chargeLeadCredit,
    buildProspectWhere,
    dispatchEvent,
    AppError,
    logger,
  };
}

function makeService(mocks, overrides = {}) {
  return makeProspectService({
    models: mocks.models,
    sequelize: mocks.sequelize,
    resolveAssignedAgentId: mocks.resolveAssignedAgentId,
    resolveLeadRouting: mocks.resolveLeadRouting,
    getSystemAgentId: mocks.getSystemAgentId,
    deductLeadCredit: mocks.deductLeadCredit,
    chargeLeadCredit: mocks.chargeLeadCredit,
    buildProspectWhere: mocks.buildProspectWhere,
    dispatchEvent: mocks.dispatchEvent,
    AppError: mocks.AppError,
    logger: mocks.logger,
    ...overrides,
  });
}

// ── Tests ──

describe('prospectAssignment (unit)', () => {
  let mocks, service;

  beforeEach(() => {
    mocks = buildMocks();
    service = makeService(mocks);
  });

  const admin = { id: 'admin-1', role: 'admin', firstName: 'Admin' };

  // ────────────────────────────────────────────────
  // assignProspect
  // ────────────────────────────────────────────────

  describe('assignProspect', () => {
    it('assigns prospect to agent and updates lastContactDate', async () => {
      const prospect = {
        ...mocks.mockProspect,
        assignedAgentId: null,
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Prospect.findByPk
        .mockResolvedValueOnce(prospect)
        .mockResolvedValueOnce({ ...prospect, campaign: null });

      await service.assignProspect('prospect-1', 'agent-1', admin);

      expect(prospect.update).toHaveBeenCalledWith({
        assignedAgentId: 'agent-1',
        lastContactDate: expect.any(Date),
      });
    });

    it('fires lead.assigned webhook event', async () => {
      const prospect = {
        ...mocks.mockProspect,
        assignedAgentId: null,
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Prospect.findByPk
        .mockResolvedValueOnce(prospect)
        .mockResolvedValueOnce({ ...prospect, campaign: mocks.mockCampaign });

      await service.assignProspect('prospect-1', 'agent-1', admin);

      expect(mocks.dispatchEvent).toHaveBeenCalledWith('lead.assigned', expect.any(Function), expect.objectContaining({ destination: 'lyfe' }));
    });

    it('fires lead.unassigned to the previous owner on a CROSS-APP reassignment', async () => {
      const prospect = {
        ...mocks.mockProspect,
        assignedAgentId: 'agent-prev',
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Prospect.findByPk
        .mockResolvedValueOnce(prospect)
        .mockResolvedValueOnce({ ...prospect, campaign: mocks.mockCampaign });
      // New owner is a Lyfe agent (default mockAgent via findOne); previous owner is an
      // mktr-leads agent -> different app -> its lingering copy must be released.
      mocks.models.User.findByPk.mockResolvedValue({ id: 'agent-prev', mktrLeadsId: 'ml-prev' });

      await service.assignProspect('prospect-1', 'agent-1', admin);

      expect(mocks.dispatchEvent).toHaveBeenCalledWith('lead.assigned', expect.any(Function), expect.objectContaining({ destination: 'lyfe' }));
      expect(mocks.dispatchEvent).toHaveBeenCalledWith('lead.unassigned', expect.any(Function), expect.objectContaining({ destination: 'mktr_leads' }));
    });

    it('does NOT fire lead.unassigned on a SAME-APP reassignment', async () => {
      const prospect = {
        ...mocks.mockProspect,
        assignedAgentId: 'agent-prev',
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Prospect.findByPk
        .mockResolvedValueOnce(prospect)
        .mockResolvedValueOnce({ ...prospect, campaign: null });
      // Both owners are Lyfe agents -> same app -> the receiver moves the single shared
      // row on lead.assigned, so firing unassigned would wrongly dispute it.
      mocks.models.User.findByPk.mockResolvedValue({ id: 'agent-prev', lyfeId: 'lyfe-prev' });

      await service.assignProspect('prospect-1', 'agent-1', admin);

      expect(mocks.dispatchEvent).toHaveBeenCalledWith('lead.assigned', expect.any(Function), expect.objectContaining({ destination: 'lyfe' }));
      expect(mocks.dispatchEvent).not.toHaveBeenCalledWith('lead.unassigned', expect.any(Function), expect.anything());
    });

    it('fires lead.unassigned when agentId is null', async () => {
      const prospect = {
        ...mocks.mockProspect,
        assignedAgentId: 'agent-1',
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Prospect.findByPk.mockResolvedValue(prospect);
      mocks.models.User.findByPk.mockResolvedValue({ lyfeId: 'lyfe-agent-1' });

      await service.assignProspect('prospect-1', null, admin);

      expect(mocks.dispatchEvent).toHaveBeenCalledWith('lead.unassigned', expect.any(Function), expect.objectContaining({ destination: 'lyfe' }));
    });

    it('deducts lead credit on assignment', async () => {
      const prospect = {
        ...mocks.mockProspect,
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Prospect.findByPk
        .mockResolvedValueOnce(prospect)
        .mockResolvedValueOnce({ ...prospect, campaign: null });

      await service.assignProspect('prospect-1', 'agent-1', admin);

      expect(mocks.deductLeadCredit).toHaveBeenCalledWith({ agentId: 'agent-1', campaignId: 'camp-1' });
    });

    it('does not deduct lead credit on unassignment', async () => {
      const prospect = {
        ...mocks.mockProspect,
        assignedAgentId: 'agent-1',
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Prospect.findByPk.mockResolvedValue(prospect);
      mocks.models.User.findByPk.mockResolvedValue({ lyfeId: 'lyfe-agent-1' });

      await service.assignProspect('prospect-1', null, admin);

      expect(mocks.deductLeadCredit).not.toHaveBeenCalled();
    });

    it('throws for inactive agent', async () => {
      mocks.models.User.findOne.mockResolvedValue(null);

      await expect(service.assignProspect('prospect-1', 'bad-agent', admin))
        .rejects.toThrow('Invalid or inactive agent');
    });

    it('throws when prospect not found', async () => {
      mocks.models.Prospect.findByPk.mockResolvedValue(null);

      await expect(service.assignProspect('nonexistent', 'agent-1', admin))
        .rejects.toThrow('Prospect not found');
    });

    it('creates ProspectActivity record for assignment', async () => {
      const prospect = {
        ...mocks.mockProspect,
        assignedAgentId: null,
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Prospect.findByPk
        .mockResolvedValueOnce(prospect)
        .mockResolvedValueOnce({ ...prospect, campaign: null });

      await service.assignProspect('prospect-1', 'agent-1', admin);

      expect(mocks.models.ProspectActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'assigned',
          prospectId: 'prospect-1',
        })
      );
    });

    it('creates ProspectActivity record for unassignment', async () => {
      const prospect = {
        ...mocks.mockProspect,
        assignedAgentId: 'agent-1',
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Prospect.findByPk.mockResolvedValue(prospect);
      mocks.models.User.findByPk.mockResolvedValue({ lyfeId: 'lyfe-prev' });

      await service.assignProspect('prospect-1', null, admin);

      expect(mocks.models.ProspectActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'assigned',
          description: 'Unassigned from agent',
        })
      );
    });

    it('includes lyfeId in webhook payload', async () => {
      const prospect = {
        ...mocks.mockProspect,
        assignedAgentId: null,
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Prospect.findByPk
        .mockResolvedValueOnce(prospect)
        .mockResolvedValueOnce({ ...prospect, campaign: mocks.mockCampaign });

      await service.assignProspect('prospect-1', 'agent-1', admin);

      const builder = mocks.dispatchEvent.mock.calls[0][1];
      const payload = builder();
      expect(payload.data.routing.agentExternalId).toBe('lyfe-agent-1');
    });

    it('releases a HELD lead: clears quarantine atomically, deducts, fires lead.created (not lead.assigned)', async () => {
      const held = { ...mocks.mockProspect, quarantinedAt: new Date(), reload: jest.fn().mockResolvedValue(true) };
      mocks.models.Prospect.findByPk
        .mockResolvedValueOnce(held)
        .mockResolvedValueOnce({ ...held, campaign: { id: 'camp-1', name: 'C' } });
      mocks.sequelize.query.mockResolvedValue([[{ id: 'prospect-1' }]]); // claim won

      await service.assignProspect('prospect-1', 'agent-1', admin);

      expect(mocks.sequelize.query).toHaveBeenCalled();
      expect(mocks.deductLeadCredit).toHaveBeenCalledWith({ agentId: 'agent-1', campaignId: 'camp-1' });
      expect(mocks.dispatchEvent).toHaveBeenCalledWith('lead.created', expect.any(Function), expect.objectContaining({ destination: 'lyfe' }));
      expect(mocks.dispatchEvent).not.toHaveBeenCalledWith('lead.assigned', expect.any(Function));
    });

    it('refuses to manually release an EXTERNAL hold (no_funded_external_buyer) to an internal agent', async () => {
      const extHeld = {
        ...mocks.mockProspect,
        quarantinedAt: new Date(),
        quarantineReason: 'no_funded_external_buyer',
        reload: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Prospect.findByPk.mockResolvedValue(extHeld);

      await expect(service.assignProspect('prospect-1', 'agent-1', admin)).rejects.toThrow(/MKTR Leads/);

      // No release, no charge, no Lyfe delivery — the external-hold fence holds on the manual path too.
      expect(mocks.sequelize.query).not.toHaveBeenCalled();
      expect(mocks.deductLeadCredit).not.toHaveBeenCalled();
      expect(mocks.dispatchEvent).not.toHaveBeenCalledWith('lead.created', expect.any(Function));
    });

    it('release race lost (claim returns 0 rows) → no deduct, no double delivery', async () => {
      const held = { ...mocks.mockProspect, quarantinedAt: new Date(), reload: jest.fn().mockResolvedValue(true) };
      mocks.models.Prospect.findByPk.mockResolvedValue(held);
      mocks.sequelize.query.mockResolvedValue([[]]); // lost the race

      const res = await service.assignProspect('prospect-1', 'agent-1', admin);

      expect(res.agent).toBeNull(); // don't email an agent for a lead released elsewhere
      expect(mocks.dispatchEvent).not.toHaveBeenCalledWith('lead.created', expect.any(Function));
      expect(mocks.deductLeadCredit).not.toHaveBeenCalled();
    });

    it('does NOT fire lead.unassigned when unassigning a HELD lead (Lyfe never saw a create)', async () => {
      const held = { ...mocks.mockProspect, assignedAgentId: null, quarantinedAt: new Date(), update: jest.fn().mockResolvedValue(true) };
      mocks.models.Prospect.findByPk.mockResolvedValue(held);

      await service.assignProspect('prospect-1', null, admin);

      expect(mocks.dispatchEvent).not.toHaveBeenCalledWith('lead.unassigned', expect.any(Function));
    });
  });

  // ────────────────────────────────────────────────
  // bulkAssignProspects
  // ────────────────────────────────────────────────

  describe('bulkAssignProspects', () => {
    it('assigns multiple prospects to an agent via bulk update', async () => {
      mocks.models.Prospect.update.mockResolvedValue([3, [
        { id: 'p-1', campaignId: 'camp-1' },
        { id: 'p-2', campaignId: 'camp-1' },
        { id: 'p-3', campaignId: 'camp-1' },
      ]]);

      const result = await service.bulkAssignProspects(['p-1', 'p-2', 'p-3'], 'agent-1', admin);

      expect(result.affectedCount).toBe(3);
      expect(result.agent).toBeDefined();
    });

    it('fires lead.assigned for each newly-assigned lead (bulk previously delivered nothing)', async () => {
      mocks.models.Prospect.findAll.mockResolvedValue([
        { id: 'p-1', firstName: 'A', assignedAgentId: null, campaignId: 'camp-1', campaign: mocks.mockCampaign },
        { id: 'p-2', firstName: 'B', assignedAgentId: null, campaignId: 'camp-1', campaign: mocks.mockCampaign },
      ]);
      mocks.models.Prospect.update.mockResolvedValue([2, [
        { id: 'p-1', campaignId: 'camp-1' },
        { id: 'p-2', campaignId: 'camp-1' },
      ]]);

      await service.bulkAssignProspects(['p-1', 'p-2'], 'agent-1', admin);

      const assignedCalls = mocks.dispatchEvent.mock.calls.filter((c) => c[0] === 'lead.assigned');
      expect(assignedCalls).toHaveLength(2);
      expect(mocks.dispatchEvent).toHaveBeenCalledWith('lead.assigned', expect.any(Function), expect.objectContaining({ destination: 'lyfe' }));
    });

    it('deducts lead credits per campaign from the RETURNING rows', async () => {
      mocks.models.Prospect.update.mockResolvedValue([2, [
        { id: 'p-1', campaignId: 'camp-1' },
        { id: 'p-2', campaignId: 'camp-1' },
      ]]);

      await service.bulkAssignProspects(['p-1', 'p-2'], 'agent-1', admin);

      expect(mocks.deductLeadCredit).toHaveBeenCalledWith({ agentId: 'agent-1', campaignId: 'camp-1', amount: 2 });
    });

    it('splits the deduction per campaign when the bulk set spans campaigns (incl. campaignless)', async () => {
      mocks.models.Prospect.update.mockResolvedValue([4, [
        { id: 'p-1', campaignId: 'camp-1' },
        { id: 'p-2', campaignId: 'camp-2' },
        { id: 'p-3', campaignId: 'camp-1' },
        { id: 'p-4', campaignId: null },
      ]]);

      await service.bulkAssignProspects(['p-1', 'p-2', 'p-3', 'p-4'], 'agent-1', admin);

      // Campaign-A leads must never drain campaign-B credits: one scoped
      // deduction per campaign, and the campaignless lead hits only the
      // manual bucket (campaignId: null).
      expect(mocks.deductLeadCredit).toHaveBeenCalledTimes(3);
      expect(mocks.deductLeadCredit).toHaveBeenCalledWith({ agentId: 'agent-1', campaignId: 'camp-1', amount: 2 });
      expect(mocks.deductLeadCredit).toHaveBeenCalledWith({ agentId: 'agent-1', campaignId: 'camp-2', amount: 1 });
      expect(mocks.deductLeadCredit).toHaveBeenCalledWith({ agentId: 'agent-1', campaignId: null, amount: 1 });
    });

    it('excludes rows already assigned to the SAME agent (no re-assign double-charge)', async () => {
      mocks.models.Prospect.update.mockResolvedValue([0, []]);

      await service.bulkAssignProspects(['p-1'], 'agent-1', admin);

      // The same-agent exclusion lives on the locked SELECT (the UPDATE then targets the
      // locked id set). IS DISTINCT FROM semantics: unassigned (NULL) rows still match,
      // rows already held by agent-1 do not.
      const where = mocks.models.Prospect.findAll.mock.calls[0][0].where;
      expect(where[Op.or]).toEqual([
        { assignedAgentId: null },
        { assignedAgentId: { [Op.ne]: 'agent-1' } },
      ]);
      expect(mocks.deductLeadCredit).not.toHaveBeenCalled();
    });

    it('throws when agentId is missing', async () => {
      await expect(service.bulkAssignProspects(['p-1'], null, admin))
        .rejects.toThrow('Prospect IDs array and agent ID are required');
    });

    it('throws when agent is invalid', async () => {
      mocks.models.User.findOne.mockResolvedValue(null);

      await expect(service.bulkAssignProspects(['p-1'], 'bad-agent', admin))
        .rejects.toThrow('Invalid or inactive agent');
    });

    it('does not deduct credits when no prospects affected', async () => {
      mocks.models.Prospect.update.mockResolvedValue([0]);

      await service.bulkAssignProspects(['p-1'], 'agent-1', admin);

      expect(mocks.deductLeadCredit).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // createProspect (assignment during creation)
  // ────────────────────────────────────────────────

  describe('createProspect (assignment integration)', () => {
    it('assigns agent during creation when resolved', async () => {
      mocks.resolveLeadRouting.mockResolvedValue({ agentId: 'agent-1', via: 'admin' });

      const body = { firstName: 'Test', campaignId: 'camp-1' };
      await service.createProspect(body, admin, {});

      const createArg = mocks.models.Prospect.create.mock.calls[0][0];
      expect(createArg.assignedAgentId).toBe('agent-1');
    });

    it('creates prospect without agent when none resolved', async () => {
      mocks.resolveLeadRouting.mockResolvedValue({ agentId: null, via: 'fallback' });

      const body = { firstName: 'Test', campaignId: 'camp-1' };
      await service.createProspect(body, admin, {});

      expect(mocks.deductLeadCredit).not.toHaveBeenCalled();
    });

    it('deducts lead credit during creation when agent assigned', async () => {
      mocks.resolveLeadRouting.mockResolvedValue({ agentId: 'agent-1', via: 'admin' });

      const body = { firstName: 'Test', campaignId: 'camp-1' };
      await service.createProspect(body, admin, {});

      expect(mocks.deductLeadCredit).toHaveBeenCalledWith({
        agentId: 'agent-1',
        campaignId: 'camp-1',
        transaction: mocks.mockTransaction,
      });
    });

    it('dispatches lead.created webhook', async () => {
      const body = { firstName: 'Test', campaignId: 'camp-1' };
      await service.createProspect(body, admin, {});

      expect(mocks.dispatchEvent).toHaveBeenCalledWith('lead.created', expect.any(Function), expect.objectContaining({ destination: 'lyfe' }));
    });

    it('creates activity records for created + assigned', async () => {
      mocks.resolveLeadRouting.mockResolvedValue({ agentId: 'agent-1', via: 'admin' });

      const body = { firstName: 'Test', campaignId: 'camp-1' };
      await service.createProspect(body, admin, {});

      const calls = mocks.models.ProspectActivity.create.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(calls[0][0].type).toBe('created');
      expect(calls[1][0].type).toBe('assigned');
    });

    it('creates assigned activity even when agent is null (records assignment state)', async () => {
      mocks.resolveLeadRouting.mockResolvedValue({ agentId: null, via: 'fallback' });

      const body = { firstName: 'Test', campaignId: 'camp-1' };
      await service.createProspect(body, admin, {});

      const calls = mocks.models.ProspectActivity.create.mock.calls;
      // Service creates both 'created' and 'assigned' activities regardless
      expect(calls).toHaveLength(2);
      expect(calls[0][0].type).toBe('created');
      expect(calls[1][0].type).toBe('assigned');
    });
  });

  // ────────────────────────────────────────────────
  // createProspect — lead quota (enforceLeadQuota)
  // ────────────────────────────────────────────────

  describe('createProspect (lead quota)', () => {
    const quotaCampaign = { id: 'camp-1', name: 'Quota Campaign', is_active: true, enforceLeadQuota: true };
    const admin = { id: 'admin-1', role: 'admin', firstName: 'Admin' };

    beforeEach(() => {
      mocks.models.Campaign.findByPk.mockResolvedValue(quotaCampaign);
    });

    it('gated route + charge succeeds → assigns, charges once, no best-effort deduct, fires lead.created', async () => {
      mocks.resolveLeadRouting.mockResolvedValue({ agentId: 'agent-1', via: 'package' });
      mocks.chargeLeadCredit.mockResolvedValue(true);

      await service.createProspect({ firstName: 'Q', campaignId: 'camp-1' }, admin, {});

      const createArg = mocks.models.Prospect.create.mock.calls[0][0];
      expect(createArg.assignedAgentId).toBe('agent-1');
      expect(createArg.quarantinedAt).toBeNull();
      expect(mocks.chargeLeadCredit).toHaveBeenCalledWith('agent-1', 'camp-1', mocks.mockTransaction);
      expect(mocks.deductLeadCredit).not.toHaveBeenCalled(); // no double-charge
      expect(mocks.dispatchEvent).toHaveBeenCalledWith('lead.created', expect.any(Function), expect.objectContaining({ destination: 'lyfe' }));
    });

    it('gated route + charge fails → quarantines: no agent, quarantinedAt set, no webhook, no deduct', async () => {
      mocks.resolveLeadRouting.mockResolvedValue({ agentId: 'agent-1', via: 'package' });
      mocks.chargeLeadCredit.mockResolvedValue(false);

      const res = await service.createProspect({ firstName: 'Q', campaignId: 'camp-1' }, admin, {});

      const createArg = mocks.models.Prospect.create.mock.calls[0][0];
      expect(createArg.assignedAgentId).toBeNull();
      expect(createArg.quarantinedAt).toBeInstanceOf(Date);
      expect(createArg.quarantineReason).toBe('no_funded_agent');
      expect(res.quarantined).toBe(true);
      expect(mocks.deductLeadCredit).not.toHaveBeenCalled();
      expect(mocks.dispatchEvent).not.toHaveBeenCalledWith('lead.created', expect.any(Function));
    });

    it('fallback route → quarantines WITHOUT charging', async () => {
      mocks.resolveLeadRouting.mockResolvedValue({ agentId: 'system-agent', via: 'fallback' });

      const res = await service.createProspect({ firstName: 'Q', campaignId: 'camp-1' }, admin, {});

      expect(res.quarantined).toBe(true);
      expect(mocks.chargeLeadCredit).not.toHaveBeenCalled();
      expect(mocks.dispatchEvent).not.toHaveBeenCalledWith('lead.created', expect.any(Function));
    });

    it('exempt admin route on a quota campaign → assigns + best-effort deduct, no authoritative charge', async () => {
      mocks.resolveLeadRouting.mockResolvedValue({ agentId: 'agent-1', via: 'admin' });

      await service.createProspect({ firstName: 'Q', campaignId: 'camp-1' }, admin, {});

      const createArg = mocks.models.Prospect.create.mock.calls[0][0];
      expect(createArg.assignedAgentId).toBe('agent-1');
      expect(mocks.chargeLeadCredit).not.toHaveBeenCalled();
      expect(mocks.deductLeadCredit).toHaveBeenCalledWith({
        agentId: 'agent-1',
        campaignId: 'camp-1',
        transaction: mocks.mockTransaction,
      });
      expect(mocks.dispatchEvent).toHaveBeenCalledWith('lead.created', expect.any(Function), expect.objectContaining({ destination: 'lyfe' }));
    });

    it('logs a held activity (type updated) when quarantined', async () => {
      mocks.resolveLeadRouting.mockResolvedValue({ agentId: 'agent-1', via: 'package' });
      mocks.chargeLeadCredit.mockResolvedValue(false);

      await service.createProspect({ firstName: 'Q', campaignId: 'camp-1' }, admin, {});

      const calls = mocks.models.ProspectActivity.create.mock.calls;
      expect(calls[0][0].type).toBe('created');
      expect(calls[1][0].type).toBe('updated');
      expect(calls[1][0].metadata.quarantined).toBe(true);
    });
  });
});

describe('createProspect — single-pass external routing (W1)', () => {
  const admin = { id: 'admin-1', role: 'admin', firstName: 'Admin' };

  it('external-eligible + consented lead routes via resolveLeadAssignment ONLY (no resolveLeadRouting double-pass), writes externalAgentId, and suppresses the Lyfe webhook', async () => {
    const mocks = buildMocks();
    mocks.mockCampaign.externalEligible = true; // Campaign.findByPk returns this row
    const resolveLeadAssignment = jest
      .fn()
      .mockResolvedValue({ kind: 'external', externalAgentId: 'ext-1', via: 'external' });
    const deductExternalLeadBalance = jest.fn().mockResolvedValue(true);
    const service = makeService(mocks, {
      hasValidExternalConsent: () => true,
      resolveLeadAssignment,
      deductExternalLeadBalance,
    });

    await service.createProspect(
      {
        firstName: 'Ext',
        campaignId: 'camp-1',
        consentMetadata: { external: { version: 'v1', consentedAt: '2026-01-01T00:00:00Z', channels: ['phone'] } },
      },
      admin,
      {}
    );

    // Exactly one routing pass: the unified resolver, never the internal-only one.
    expect(resolveLeadAssignment).toHaveBeenCalledTimes(1);
    expect(mocks.resolveLeadRouting).not.toHaveBeenCalled();
    // Written as an external lead (mutually exclusive with assignedAgentId).
    expect(mocks.models.Prospect.create).toHaveBeenCalledWith(
      expect.objectContaining({ externalAgentId: 'ext-1', assignedAgentId: null }),
      expect.anything()
    );
    // Paid external buyer charged authoritatively; the internal quota gate is skipped.
    expect(deductExternalLeadBalance).toHaveBeenCalledWith('ext-1', 1, expect.anything());
    expect(mocks.chargeLeadCredit).not.toHaveBeenCalled();
    // External leads must NOT fire the Lyfe lead.created webhook.
    expect(mocks.dispatchEvent).not.toHaveBeenCalled();
  });

  it('non-external-eligible lead still routes via resolveLeadRouting only (live path unchanged)', async () => {
    const mocks = buildMocks();
    mocks.mockCampaign.externalEligible = false;
    const resolveLeadAssignment = jest.fn();
    const service = makeService(mocks, { hasValidExternalConsent: () => true, resolveLeadAssignment });
    mocks.resolveLeadRouting.mockResolvedValue({ agentId: 'agent-1', via: 'admin' });

    await service.createProspect({ firstName: 'Int', campaignId: 'camp-1' }, admin, {});

    expect(mocks.resolveLeadRouting).toHaveBeenCalledTimes(1);
    expect(resolveLeadAssignment).not.toHaveBeenCalled();
  });

  it('external-eligible + consented but NO funded buyer → HELD (quarantined), not assigned, not charged, webhook suppressed', async () => {
    const mocks = buildMocks();
    mocks.mockCampaign.externalEligible = true;
    const resolveLeadAssignment = jest
      .fn()
      .mockResolvedValue({ kind: 'hold', via: 'fallback', holdReason: 'no_funded_external_buyer' });
    const deductExternalLeadBalance = jest.fn();
    const service = makeService(mocks, {
      hasValidExternalConsent: () => true,
      resolveLeadAssignment,
      deductExternalLeadBalance,
    });

    await service.createProspect(
      {
        firstName: 'Held',
        campaignId: 'camp-1',
        consentMetadata: { external: { version: 'v1', consentedAt: '2026-01-01T00:00:00Z', channels: ['phone'] } },
      },
      admin,
      {}
    );

    // Held: quarantined, neither assignee set, distinct external reason.
    expect(mocks.models.Prospect.create).toHaveBeenCalledWith(
      expect.objectContaining({
        assignedAgentId: null,
        externalAgentId: null,
        quarantineReason: 'no_funded_external_buyer',
      }),
      expect.anything()
    );
    expect(mocks.models.Prospect.create.mock.calls[0][0].quarantinedAt).toBeInstanceOf(Date);
    // Never charged (no buyer), internal quota gate skipped, Lyfe webhook suppressed.
    expect(deductExternalLeadBalance).not.toHaveBeenCalled();
    expect(mocks.chargeLeadCredit).not.toHaveBeenCalled();
    expect(mocks.dispatchEvent).not.toHaveBeenCalled();
  });
});
