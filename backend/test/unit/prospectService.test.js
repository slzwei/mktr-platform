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
    notes: '',
    tags: [],
    campaignId: 'camp-1',
    assignedAgentId: 'agent-1',
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

  const mockCampaign = {
    id: 'camp-1',
    name: 'Test Campaign',
    type: 'lead_gen',
    status: 'active',
    is_active: true,
  };

  const mockQrTag = {
    id: 'qr-1',
    name: 'Test QR',
    campaignId: 'camp-1',
    assignedAgentId: null,
    assignedAgentPhone: null,
    agentAssignmentMode: null,
    analytics: {},
    update: jest.fn().mockResolvedValue(true),
  };

  // --- Models ---

  const Prospect = {
    create: jest.fn().mockResolvedValue(mockProspect),
    findOne: jest.fn().mockResolvedValue(null), // default: no duplicate
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
    findByPk: jest.fn().mockResolvedValue(mockQrTag),
    update: jest.fn().mockResolvedValue([1, [mockQrTag]]),
  };

  const Commission = {
    create: jest.fn().mockResolvedValue({}),
  };

  const Attribution = {
    findOne: jest.fn().mockResolvedValue(null),
  };

  const ProspectActivity = {
    create: jest.fn().mockResolvedValue({}),
  };

  const AgentGroup = {
    findByPk: jest.fn().mockResolvedValue(null),
  };

  const AgentGroupMember = {
    findAll: jest.fn().mockResolvedValue([]),
  };

  // --- Non-model deps ---

  const mockTransaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };

  const sequelize = {
    transaction: jest.fn(async (callback) => {
      // Simulate Sequelize managed transaction
      return callback(mockTransaction);
    }),
    fn: jest.fn((fnName, col) => `${fnName}(${col})`),
    col: jest.fn((name) => name),
    literal: jest.fn((expr) => expr),
  };

  const resolveAssignedAgentId = jest.fn().mockResolvedValue('agent-1');
  const getSystemAgentId = jest.fn().mockResolvedValue('system-agent-id');
  const deductLeadCredit = jest.fn().mockResolvedValue(true);
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
    mockCampaign,
    mockQrTag,
    mockTransaction,
    models: { Prospect, User, Campaign, QrTag, Commission, Attribution, ProspectActivity, AgentGroup, AgentGroupMember },
    sequelize,
    resolveAssignedAgentId,
    getSystemAgentId,
    deductLeadCredit,
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
    getSystemAgentId: mocks.getSystemAgentId,
    deductLeadCredit: mocks.deductLeadCredit,
    buildProspectWhere: mocks.buildProspectWhere,
    dispatchEvent: mocks.dispatchEvent,
    AppError: mocks.AppError,
    logger: mocks.logger,
  });
}

// ── Tests ──

describe('prospectService (unit)', () => {
  let mocks, service;

  beforeEach(() => {
    mocks = buildMocks();
    service = makeService(mocks);
  });

  // ────────────────────────────────────────────────
  // createProspect
  // ────────────────────────────────────────────────

  describe('createProspect', () => {
    const user = { id: 'admin-1', role: 'admin', firstName: 'Admin' };

    it('normalizes Singapore phone: 8 digits starting with valid prefix -> +65XXXXXXXX', async () => {
      const body = { firstName: 'Test', phone: '91234567', campaignId: 'camp-1' };

      await service.createProspect(body, user, {});

      const createArg = mocks.models.Prospect.create.mock.calls[0][0];
      expect(createArg.phone).toBe('+6591234567');
    });

    it('normalizes phone with country code prefix: 65XXXXXXXX -> +65XXXXXXXX', async () => {
      const body = { firstName: 'Test', phone: '6591234567', campaignId: 'camp-1' };

      await service.createProspect(body, user, {});

      const createArg = mocks.models.Prospect.create.mock.calls[0][0];
      expect(createArg.phone).toBe('+6591234567');
    });

    it('preserves phone that already starts with +', async () => {
      const body = { firstName: 'Test', phone: '+6591234567', campaignId: 'camp-1' };

      await service.createProspect(body, user, {});

      const createArg = mocks.models.Prospect.create.mock.calls[0][0];
      expect(createArg.phone).toBe('+6591234567');
    });

    it('strips whitespace from phone before normalizing', async () => {
      const body = { firstName: 'Test', phone: '9123 4567', campaignId: 'camp-1' };

      await service.createProspect(body, user, {});

      const createArg = mocks.models.Prospect.create.mock.calls[0][0];
      expect(createArg.phone).toBe('+6591234567');
    });

    it('rejects duplicate phone per campaign (409)', async () => {
      mocks.models.Prospect.findOne.mockResolvedValue({ id: 'existing-prospect' });

      const body = { firstName: 'Test', phone: '91234567', campaignId: 'camp-1' };

      await expect(service.createProspect(body, user, {}))
        .rejects.toThrow('This phone number has already signed up for this campaign.');

      try {
        await service.createProspect(body, user, {});
      } catch (err) {
        expect(err.statusCode).toBe(409);
      }
    });

    it('resolves attribution from session ID (cookie sid)', async () => {
      const mockAttribution = {
        id: 'attr-1',
        sessionId: 'sess-abc',
        qrTagId: 'qr-attr',
      };
      mocks.models.Attribution.findOne.mockResolvedValue(mockAttribution);

      const body = { firstName: 'Test', campaignId: 'camp-1' };
      const cookies = { sid: 'sess-abc' };

      await service.createProspect(body, user, { cookies });

      expect(mocks.models.Attribution.findOne).toHaveBeenCalledWith({
        where: { sessionId: 'sess-abc' },
        order: [['lastTouchAt', 'DESC'], ['id', 'DESC']],
      });

      const createArg = mocks.models.Prospect.create.mock.calls[0][0];
      expect(createArg.attributionId).toBe('attr-1');
      expect(createArg.sessionId).toBe('sess-abc');
    });

    it('resolves attribution from x-session-id header when no cookie', async () => {
      const mockAttribution = { id: 'attr-2', sessionId: 'sess-xyz', qrTagId: null };
      mocks.models.Attribution.findOne.mockResolvedValue(mockAttribution);

      const body = { firstName: 'Test', campaignId: 'camp-1' };
      const headers = { 'x-session-id': 'sess-xyz' };

      await service.createProspect(body, user, { headers });

      expect(mocks.models.Attribution.findOne).toHaveBeenCalledWith({
        where: { sessionId: 'sess-xyz' },
        order: [['lastTouchAt', 'DESC'], ['id', 'DESC']],
      });
    });

    // ── Attribution last-touch regression (QR campaign mis-attribution) ──
    // Bug: scan attribution was sticky to the FIRST campaign a session ever
    // scanned, so scanning campaign A then campaign B and signing up bound the
    // lead to A. Fix: each scan rebinds the session with lastTouchAt=now, and
    // createProspect resolves the most-recently-touched attribution
    // (order: lastTouchAt DESC, id DESC). The mock below honors the `order`
    // clause, so these tests fail if it is dropped, reversed, or loses the
    // id tiebreaker.
    describe('attribution last-touch (regression)', () => {
      // A findOne stand-in that actually applies the `order` clause to an
      // in-memory row set. A fixed-return mock would pass even with no order.
      function orderedFindOne(rows) {
        return jest.fn(async ({ where = {}, order = [] } = {}) => {
          const matching = rows.filter((r) =>
            Object.entries(where).every(([k, v]) => r[k] === v)
          );
          const sorted = [...matching].sort((a, b) => {
            for (const [field, dir] of order) {
              const av = a[field] instanceof Date ? a[field].getTime() : a[field];
              const bv = b[field] instanceof Date ? b[field].getTime() : b[field];
              let cmp = 0;
              if (av < bv) cmp = -1;
              else if (av > bv) cmp = 1;
              if (cmp !== 0) return dir === 'DESC' ? -cmp : cmp;
            }
            return 0;
          });
          return sorted[0] || null;
        });
      }

      // Two QR tags on two different campaigns, keyed for QrTag.findByPk.
      // agentAssignmentMode null keeps routing on the simple 'direct' path.
      function wireTwoCampaignQrTags() {
        const base = { ...mocks.mockQrTag, agentAssignmentMode: null, assignedAgentId: null, assignedAgentPhone: null };
        const byId = {
          'qr-A': { ...base, id: 'qr-A', campaignId: 'camp-A' },
          'qr-B': { ...base, id: 'qr-B', campaignId: 'camp-B' },
        };
        mocks.models.QrTag.findByPk.mockImplementation(async (id) => byId[id] || null);
      }

      it('binds a signup to the most recently scanned campaign (A then B -> B)', async () => {
        wireTwoCampaignQrTags();
        // A scanned first (older lastTouchAt), B scanned second (newer).
        const attrA = { id: 'attr-A', sessionId: 'sess-1', qrTagId: 'qr-A', lastTouchAt: new Date('2026-05-29T10:00:00Z') };
        const attrB = { id: 'attr-B', sessionId: 'sess-1', qrTagId: 'qr-B', lastTouchAt: new Date('2026-05-29T10:05:00Z') };
        mocks.models.Attribution.findOne = orderedFindOne([attrA, attrB]);

        // No campaignId in body — it must be derived from the bound attribution's QR tag.
        const body = { firstName: 'Test', phone: '91234567' };
        await service.createProspect(body, user, { cookies: { sid: 'sess-1' } });

        const createArg = mocks.models.Prospect.create.mock.calls[0][0];
        expect(createArg.attributionId).toBe('attr-B');
        expect(createArg.qrTagId).toBe('qr-B');
        expect(createArg.campaignId).toBe('camp-B');
        // The original bug bound it to camp-A (first campaign scanned).
        expect(createArg.campaignId).not.toBe('camp-A');
      });

      it('breaks a same-lastTouchAt tie deterministically via id DESC', async () => {
        wireTwoCampaignQrTags();
        // Identical lastTouchAt; the id DESC secondary key must decide.
        const sameTs = new Date('2026-05-29T10:00:00Z');
        const attrLow = { id: 'attr-aaa', sessionId: 'sess-1', qrTagId: 'qr-A', lastTouchAt: sameTs };
        const attrHigh = { id: 'attr-bbb', sessionId: 'sess-1', qrTagId: 'qr-B', lastTouchAt: sameTs };
        // Low id inserted first: without the id tiebreaker a stable sort would pick A.
        mocks.models.Attribution.findOne = orderedFindOne([attrLow, attrHigh]);

        const body = { firstName: 'Test', phone: '91234568' };
        await service.createProspect(body, user, { cookies: { sid: 'sess-1' } });

        const createArg = mocks.models.Prospect.create.mock.calls[0][0];
        expect(createArg.attributionId).toBe('attr-bbb');
        expect(createArg.qrTagId).toBe('qr-B');
      });
    });

    it('derives campaignId from qrTagId when campaignId is missing', async () => {
      mocks.models.QrTag.findByPk
        .mockResolvedValueOnce({ ...mocks.mockQrTag, campaignId: 'camp-from-qr' }) // first call: derive
        .mockResolvedValue(mocks.mockQrTag); // subsequent calls

      mocks.models.Campaign.findByPk.mockResolvedValue({
        ...mocks.mockCampaign,
        id: 'camp-from-qr',
      });

      const body = { firstName: 'Test', qrTagId: 'qr-1' }; // no campaignId

      await service.createProspect(body, user, {});

      const createArg = mocks.models.Prospect.create.mock.calls[0][0];
      expect(createArg.campaignId).toBe('camp-from-qr');
    });

    it('deducts lead credit for assigned agent', async () => {
      mocks.resolveAssignedAgentId.mockResolvedValue('agent-1');

      const body = { firstName: 'Test', campaignId: 'camp-1' };

      await service.createProspect(body, user, {});

      expect(mocks.deductLeadCredit).toHaveBeenCalledWith(
        'agent-1',
        1,
        mocks.mockTransaction
      );
    });

    it('does not deduct lead credit when no agent is assigned', async () => {
      mocks.resolveAssignedAgentId.mockResolvedValue(null);

      const body = { firstName: 'Test', campaignId: 'camp-1' };

      await service.createProspect(body, user, {});

      expect(mocks.deductLeadCredit).not.toHaveBeenCalled();
    });

    it('dispatches lead.created webhook', async () => {
      const body = { firstName: 'Test', campaignId: 'camp-1' };

      await service.createProspect(body, user, {});

      expect(mocks.dispatchEvent).toHaveBeenCalledWith(
        'lead.created',
        expect.any(Function)
      );

      // Verify webhook payload structure
      const payloadBuilder = mocks.dispatchEvent.mock.calls[0][1];
      const payload = payloadBuilder();
      expect(payload.event).toBe('lead.created');
      expect(payload.data.lead.externalId).toBe('prospect-1');
      expect(payload.data.campaign).toBeDefined();
      expect(payload.data.routing).toBeDefined();
    });

    it('creates ProspectActivity records for created and assigned', async () => {
      const body = { firstName: 'Test', campaignId: 'camp-1' };

      await service.createProspect(body, user, {});

      // Two activity records: created and assigned
      expect(mocks.models.ProspectActivity.create).toHaveBeenCalledTimes(2);

      const createdActivity = mocks.models.ProspectActivity.create.mock.calls[0][0];
      expect(createdActivity.type).toBe('created');

      const assignedActivity = mocks.models.ProspectActivity.create.mock.calls[1][0];
      expect(assignedActivity.type).toBe('assigned');
    });
  });

  // ────────────────────────────────────────────────
  // assignProspect
  // ────────────────────────────────────────────────

  describe('assignProspect', () => {
    const user = { id: 'admin-1', role: 'admin', firstName: 'Admin' };

    it('throws for inactive agent', async () => {
      mocks.models.User.findOne.mockResolvedValue(null); // no active agent found

      await expect(service.assignProspect('prospect-1', 'bad-agent', user))
        .rejects.toThrow('Invalid or inactive agent');
    });

    it('throws when prospect not found', async () => {
      mocks.models.Prospect.findByPk.mockResolvedValue(null);

      await expect(service.assignProspect('nonexistent', 'agent-1', user))
        .rejects.toThrow('Prospect not found');
    });

    it('fires lead.assigned webhook with lyfeId', async () => {
      const prospect = {
        ...mocks.mockProspect,
        assignedAgentId: null,
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Prospect.findByPk
        .mockResolvedValueOnce(prospect)       // first: find prospect
        .mockResolvedValueOnce({               // second: findByPk with campaign include
          ...prospect,
          campaign: { id: 'camp-1', name: 'Test Campaign' },
        });

      mocks.models.User.findOne.mockResolvedValue(mocks.mockAgent);

      await service.assignProspect('prospect-1', 'agent-1', user);

      expect(mocks.dispatchEvent).toHaveBeenCalledWith(
        'lead.assigned',
        expect.any(Function)
      );

      // Verify the payload uses lyfeId
      const builder = mocks.dispatchEvent.mock.calls[0][1];
      const payload = builder();
      expect(payload.event).toBe('lead.assigned');
      expect(payload.data.routing.agentExternalId).toBe('lyfe-agent-1'); // lyfeId used
      expect(payload.data.routing.agentName).toBe('Agent Smith');
      expect(payload.data.routing.agentEmail).toBe('agent@test.com');
    });

    it('fires lead.unassigned when agentId is null', async () => {
      const prospect = {
        ...mocks.mockProspect,
        assignedAgentId: 'prev-agent',
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Prospect.findByPk.mockResolvedValue(prospect);

      // Previous agent lookup for lyfeId resolution
      mocks.models.User.findByPk.mockResolvedValue({
        lyfeId: 'lyfe-prev-agent',
      });

      await service.assignProspect('prospect-1', null, user);

      expect(mocks.dispatchEvent).toHaveBeenCalledWith(
        'lead.unassigned',
        expect.any(Function)
      );

      const builder = mocks.dispatchEvent.mock.calls[0][1];
      const payload = builder();
      expect(payload.event).toBe('lead.unassigned');
      expect(payload.data.previousAgentId).toBe('lyfe-prev-agent');
    });

    it('updates prospect with new agentId and lastContactDate', async () => {
      const prospect = {
        ...mocks.mockProspect,
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Prospect.findByPk
        .mockResolvedValueOnce(prospect)
        .mockResolvedValueOnce({ ...prospect, campaign: null });
      mocks.models.User.findOne.mockResolvedValue(mocks.mockAgent);

      await service.assignProspect('prospect-1', 'agent-1', user);

      expect(prospect.update).toHaveBeenCalledWith({
        assignedAgentId: 'agent-1',
        lastContactDate: expect.any(Date),
      });
    });

    it('deducts lead credit on assignment', async () => {
      const prospect = {
        ...mocks.mockProspect,
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Prospect.findByPk
        .mockResolvedValueOnce(prospect)
        .mockResolvedValueOnce({ ...prospect, campaign: null });
      mocks.models.User.findOne.mockResolvedValue(mocks.mockAgent);

      await service.assignProspect('prospect-1', 'agent-1', user);

      expect(mocks.deductLeadCredit).toHaveBeenCalledWith('agent-1');
    });

    it('creates ProspectActivity record for unassignment', async () => {
      const prospect = {
        ...mocks.mockProspect,
        assignedAgentId: 'prev-agent',
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Prospect.findByPk.mockResolvedValue(prospect);
      mocks.models.User.findByPk.mockResolvedValue({ lyfeId: 'lyfe-prev' });

      await service.assignProspect('prospect-1', null, user);

      expect(mocks.models.ProspectActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'assigned',
          description: 'Unassigned from agent',
          metadata: expect.objectContaining({ previousAgentId: 'prev-agent' }),
        })
      );
    });
  });

  // ────────────────────────────────────────────────
  // updateProspect
  // ────────────────────────────────────────────────

  describe('updateProspect', () => {
    const user = { id: 'admin-1', role: 'admin', firstName: 'Admin' };

    it('blocks won status for system agent', async () => {
      mocks.getSystemAgentId.mockResolvedValue('system-agent-id');

      const prospect = {
        ...mocks.mockProspect,
        leadStatus: 'contacted',
        assignedAgentId: 'system-agent-id',
        update: jest.fn().mockResolvedValue(true),
        save: jest.fn().mockResolvedValue(true),
        assignedAgent: { firstName: 'System', lastName: 'Agent', email: 'system@mktr.sg' },
      };
      mocks.models.Prospect.findOne.mockResolvedValue(prospect);

      await expect(
        service.updateProspect('prospect-1', { leadStatus: 'won' }, user)
      ).rejects.toThrow('Lead must be assigned to a real agent before marking as won');
    });

    it('creates commission on status change to won', async () => {
      const prospect = {
        ...mocks.mockProspect,
        leadStatus: 'contacted',
        assignedAgentId: 'agent-1',
        update: jest.fn().mockResolvedValue(true),
        save: jest.fn().mockResolvedValue(true),
        assignedAgent: { firstName: 'Agent', lastName: 'Smith', email: 'agent@test.com' },
      };
      mocks.models.Prospect.findOne.mockResolvedValue(prospect);
      mocks.getSystemAgentId.mockResolvedValue('system-agent-id'); // different from agent-1

      await service.updateProspect('prospect-1', { leadStatus: 'won' }, user);

      expect(mocks.models.Commission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'conversion',
          status: 'pending',
          agentId: 'agent-1',
          prospectId: 'prospect-1',
          campaignId: 'camp-1',
        }),
        { transaction: mocks.mockTransaction }
      );
    });

    it('does not create commission when status does not change to won', async () => {
      const prospect = {
        ...mocks.mockProspect,
        leadStatus: 'new',
        assignedAgentId: 'agent-1',
        update: jest.fn().mockResolvedValue(true),
        assignedAgent: null,
      };
      mocks.models.Prospect.findOne.mockResolvedValue(prospect);

      await service.updateProspect('prospect-1', { leadStatus: 'contacted' }, user);

      expect(mocks.models.Commission.create).not.toHaveBeenCalled();
    });

    it('does not create commission when status is already won', async () => {
      const prospect = {
        ...mocks.mockProspect,
        leadStatus: 'won', // already won
        assignedAgentId: 'agent-1',
        update: jest.fn().mockResolvedValue(true),
        assignedAgent: null,
      };
      mocks.models.Prospect.findOne.mockResolvedValue(prospect);

      await service.updateProspect('prospect-1', { leadStatus: 'won' }, user);

      expect(mocks.models.Commission.create).not.toHaveBeenCalled();
    });

    it('throws 404 when prospect not found', async () => {
      mocks.models.Prospect.findOne.mockResolvedValue(null);

      await expect(service.updateProspect('nonexistent', { leadStatus: 'contacted' }, user))
        .rejects.toThrow('Prospect not found or access denied');
    });

    it('only updates fields in the allowlist', async () => {
      const prospect = {
        ...mocks.mockProspect,
        leadStatus: 'new',
        update: jest.fn().mockResolvedValue(true),
        assignedAgent: null,
      };
      mocks.models.Prospect.findOne.mockResolvedValue(prospect);

      await service.updateProspect('prospect-1', {
        firstName: 'Updated',
        leadStatus: 'contacted',
        dangerousField: 'should be filtered',
      }, user);

      const updateArg = prospect.update.mock.calls[0][0];
      expect(updateArg.firstName).toBe('Updated');
      expect(updateArg.leadStatus).toBe('contacted');
      expect(updateArg.dangerousField).toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────
  // listProspects
  // ────────────────────────────────────────────────

  describe('listProspects', () => {
    const user = { id: 'admin-1', role: 'admin' };

    it('uses iLike for search', async () => {
      mocks.models.Prospect.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listProspects(user, { search: 'john', page: 1, limit: 10 });

      const whereArg = mocks.models.Prospect.findAndCountAll.mock.calls[0][0].where;

      // Op.or should contain iLike conditions
      const orConditions = whereArg[Op.or];
      expect(orConditions).toBeDefined();
      expect(orConditions).toHaveLength(4); // firstName, lastName, email, company

      // Verify at least one uses iLike pattern
      const firstCondition = orConditions[0];
      const firstKey = Object.keys(firstCondition)[0]; // 'firstName'
      const firstValue = firstCondition[firstKey];
      expect(firstValue[Op.iLike]).toBe('%john%');
    });

    it('applies pagination correctly', async () => {
      mocks.models.Prospect.findAndCountAll.mockResolvedValue({ count: 25, rows: [] });

      const result = await service.listProspects(user, { page: 3, limit: 5 });

      const callArg = mocks.models.Prospect.findAndCountAll.mock.calls[0][0];
      expect(callArg.offset).toBe(10); // (3-1) * 5
      expect(callArg.limit).toBe(5);

      expect(result.pagination.currentPage).toBe(3);
      expect(result.pagination.totalPages).toBe(5);
      expect(result.pagination.totalItems).toBe(25);
    });

    it('applies filters for leadStatus, priority, campaignId', async () => {
      mocks.models.Prospect.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listProspects(user, {
        leadStatus: 'contacted',
        priority: 'high',
        campaignId: 'camp-1',
        page: 1,
        limit: 10,
      });

      const whereArg = mocks.models.Prospect.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.leadStatus).toBe('contacted');
      expect(whereArg.priority).toBe('high');
      expect(whereArg.campaignId).toBe('camp-1');
    });

    it('applies date range filters', async () => {
      mocks.models.Prospect.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listProspects(user, {
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
        page: 1,
        limit: 10,
      });

      const whereArg = mocks.models.Prospect.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.createdAt).toBeDefined();
      expect(whereArg.createdAt[Op.gte]).toEqual(new Date('2025-01-01'));
      expect(whereArg.createdAt[Op.lte]).toEqual(new Date('2025-12-31'));
    });

    it('uses buildProspectWhere for access scoping', async () => {
      mocks.buildProspectWhere.mockResolvedValue({ assignedAgentId: 'agent-1' });
      mocks.models.Prospect.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listProspects(user, { page: 1, limit: 10 });

      expect(mocks.buildProspectWhere).toHaveBeenCalledWith(user);
      const whereArg = mocks.models.Prospect.findAndCountAll.mock.calls[0][0].where;
      expect(whereArg.assignedAgentId).toBe('agent-1');
    });
  });

  // ────────────────────────────────────────────────
  // getProspectStats
  // ────────────────────────────────────────────────

  describe('getProspectStats', () => {
    const user = { id: 'admin-1', role: 'admin' };

    it('returns correct structure with all stat categories', async () => {
      mocks.models.Prospect.count
        .mockResolvedValueOnce(100)  // totalProspects
        .mockResolvedValueOnce(10);  // convertedCount (won)

      mocks.models.Prospect.findAll
        .mockResolvedValueOnce([     // byStatus
          { leadStatus: 'new', dataValues: { count: 50 } },
          { leadStatus: 'won', dataValues: { count: 10 } },
        ])
        .mockResolvedValueOnce([     // bySource
          { leadSource: 'website', dataValues: { count: 60 } },
          { leadSource: 'call_bot', dataValues: { count: 40 } },
        ])
        .mockResolvedValueOnce([     // byPriority
          { priority: 'high', dataValues: { count: 20 } },
          { priority: 'medium', dataValues: { count: 80 } },
        ])
        .mockResolvedValueOnce([]);  // recentProspects

      const result = await service.getProspectStats(user);

      expect(result.totalProspects).toBe(100);
      expect(result.conversionRate).toBe(10.00);

      expect(result.byStatus).toEqual([
        { status: 'new', count: 50 },
        { status: 'won', count: 10 },
      ]);

      expect(result.bySource).toEqual([
        { source: 'website', count: 60 },
        { source: 'call_bot', count: 40 },
      ]);

      expect(result.byPriority).toEqual([
        { priority: 'high', count: 20 },
        { priority: 'medium', count: 80 },
      ]);

      expect(result.recentProspects).toEqual([]);
    });

    it('returns 0 conversion rate when no prospects exist', async () => {
      mocks.models.Prospect.count.mockResolvedValue(0);
      mocks.models.Prospect.findAll.mockResolvedValue([]);

      const result = await service.getProspectStats(user);

      expect(result.totalProspects).toBe(0);
      expect(result.conversionRate).toBe(0);
    });
  });

  // ────────────────────────────────────────────────
  // deleteProspect
  // ────────────────────────────────────────────────

  describe('deleteProspect', () => {
    const user = { id: 'admin-1', role: 'admin' };

    it('throws 404 when prospect not found', async () => {
      mocks.models.Prospect.findOne.mockResolvedValue(null);

      await expect(service.deleteProspect('nonexistent', user))
        .rejects.toThrow('Prospect not found or access denied');
    });

    it('calls destroy on the prospect', async () => {
      const prospect = {
        ...mocks.mockProspect,
        destroy: jest.fn().mockResolvedValue(true),
      };
      mocks.models.Prospect.findOne.mockResolvedValue(prospect);

      await service.deleteProspect('prospect-1', user);

      expect(prospect.destroy).toHaveBeenCalled();
    });
  });
});
