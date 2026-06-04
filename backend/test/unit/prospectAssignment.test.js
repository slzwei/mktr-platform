import { jest } from '@jest/globals';
import '../setup.js';
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

function makeService(mocks) {
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

      expect(mocks.dispatchEvent).toHaveBeenCalledWith('lead.assigned', expect.any(Function));
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

      expect(mocks.dispatchEvent).toHaveBeenCalledWith('lead.unassigned', expect.any(Function));
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

      expect(mocks.deductLeadCredit).toHaveBeenCalledWith('agent-1');
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
  });

  // ────────────────────────────────────────────────
  // bulkAssignProspects
  // ────────────────────────────────────────────────

  describe('bulkAssignProspects', () => {
    it('assigns multiple prospects to an agent via bulk update', async () => {
      mocks.models.Prospect.update.mockResolvedValue([3]);

      const result = await service.bulkAssignProspects(['p-1', 'p-2', 'p-3'], 'agent-1', admin);

      expect(result.affectedCount).toBe(3);
      expect(result.agent).toBeDefined();
    });

    it('deducts lead credits for affected count', async () => {
      mocks.models.Prospect.update.mockResolvedValue([2]);

      await service.bulkAssignProspects(['p-1', 'p-2'], 'agent-1', admin);

      expect(mocks.deductLeadCredit).toHaveBeenCalledWith('agent-1', 2);
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

      expect(mocks.deductLeadCredit).toHaveBeenCalledWith(
        'agent-1',
        1,
        mocks.mockTransaction
      );
    });

    it('dispatches lead.created webhook', async () => {
      const body = { firstName: 'Test', campaignId: 'camp-1' };
      await service.createProspect(body, admin, {});

      expect(mocks.dispatchEvent).toHaveBeenCalledWith('lead.created', expect.any(Function));
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
      expect(mocks.dispatchEvent).toHaveBeenCalledWith('lead.created', expect.any(Function));
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
      expect(mocks.deductLeadCredit).toHaveBeenCalledWith('agent-1', 1, mocks.mockTransaction);
      expect(mocks.dispatchEvent).toHaveBeenCalledWith('lead.created', expect.any(Function));
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
