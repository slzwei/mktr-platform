import { jest } from '@jest/globals';
import '../setup.js';
import crypto from 'crypto';
import { verifyRetellSignature, makeRetellService } from '../../src/services/retellService.js';

// ── Helpers ──

function buildMocks() {
  const mockProspect = {
    id: 'prospect-1',
    firstName: 'John',
    lastName: 'Doe',
    email: null,
    phone: '+6591234567',
    leadSource: 'call_bot',
    leadStatus: 'new',
    priority: 'high',
    notes: 'some notes',
    tags: ['retell', 'phone-call'],
    campaignId: 'camp-1',
    assignedAgentId: 'agent-1',
    sourceMetadata: { retellCallId: 'call123' },
    createdAt: new Date().toISOString(),
    toJSON: jest.fn(function () { return { ...this }; }),
  };

  const mockCampaign = {
    id: 'camp-1',
    name: '[Retell] Test Agent',
    is_active: true,
  };

  const Prospect = {
    create: jest.fn().mockResolvedValue(mockProspect),
    findByPk: jest.fn().mockResolvedValue(mockProspect),
  };

  const IdempotencyKey = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
  };

  const User = {
    findByPk: jest.fn().mockResolvedValue({
      id: 'agent-1',
      lyfeId: 'lyfe-agent-1',
      phone: '+6590001234',
      email: 'agent@test.com',
      firstName: 'Agent',
      lastName: 'Smith',
    }),
    findOne: jest.fn().mockResolvedValue(null),
  };

  const Campaign = {
    findByPk: jest.fn().mockResolvedValue(mockCampaign),
    findOne: jest.fn().mockResolvedValue(mockCampaign),
    findAll: jest.fn().mockResolvedValue([mockCampaign]),
  };

  const ProspectActivity = {
    create: jest.fn().mockResolvedValue({}),
  };

  const mockTransaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };

  const sequelize = {
    transaction: jest.fn().mockResolvedValue(mockTransaction),
  };

  const resolveAssignedAgentId = jest.fn().mockResolvedValue('agent-1');
  const resolveLeadRouting = jest.fn().mockResolvedValue({ agentId: 'agent-1', via: 'package' });
  const chargeLeadCredit = jest.fn().mockResolvedValue(true);
  const dispatchEvent = jest.fn().mockResolvedValue(undefined);
  const sendLeadAssignmentEmail = jest.fn().mockResolvedValue(undefined);
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
    mockCampaign,
    mockTransaction,
    Prospect,
    IdempotencyKey,
    User,
    Campaign,
    ProspectActivity,
    sequelize,
    resolveAssignedAgentId,
    resolveLeadRouting,
    chargeLeadCredit,
    dispatchEvent,
    sendLeadAssignmentEmail,
    AppError,
    logger,
  };
}

function makeSuccessfulCallPayload(overrides = {}) {
  return {
    call_id: 'call123',
    call_status: 'ended',
    call_analysis: {
      call_successful: true,
      user_sentiment: 'Positive',
      call_summary: 'Good call',
      custom_analysis_data: {},
    },
    retell_llm_dynamic_variables: { name: 'John Doe' },
    to_number: '+6591234567',
    from_number: '+6590000000',
    transcript: 'Hello, how are you?',
    duration_ms: 30000,
    disconnection_reason: 'agent_hangup',
    agent_id: 'retell-agent-1',
    agent_name: 'Test Agent',
    recording_url: 'https://recordings.retell.ai/call123.mp3',
    ...overrides,
  };
}

// ── Tests ──

describe('retellService (unit)', () => {
  // ────────────────────────────────────────────────
  // verifyRetellSignature (exported directly, not via factory)
  // ────────────────────────────────────────────────

  describe('verifyRetellSignature', () => {
    const originalEnv = process.env.RETELL_WEBHOOK_SECRET;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.RETELL_WEBHOOK_SECRET;
      } else {
        process.env.RETELL_WEBHOOK_SECRET = originalEnv;
      }
    });

    it('returns false with no secret', () => {
      delete process.env.RETELL_WEBHOOK_SECRET;
      const result = verifyRetellSignature(Buffer.from('body'), 'v=123,d=abc');
      expect(result).toBe(false);
    });

    it('returns false with no signatureHeader', () => {
      process.env.RETELL_WEBHOOK_SECRET = 'test-secret';
      const result = verifyRetellSignature(Buffer.from('body'), '');
      expect(result).toBe(false);
    });

    it('returns true with valid v=timestamp,d=hmac format', () => {
      const secret = 'test-secret';
      process.env.RETELL_WEBHOOK_SECRET = secret;
      const body = Buffer.from('{"event":"call_ended"}');
      const timestamp = '1700000000';

      // Canonical format: HMAC-SHA256 over "${timestamp}.${bodyStr}"
      const hmac = crypto.createHmac('sha256', secret)
        .update(`${timestamp}.${body.toString()}`)
        .digest('hex');

      const sig = `v=${timestamp},d=${hmac}`;
      const result = verifyRetellSignature(body, sig);
      expect(result).toBe(true);
    });

    it('returns false with invalid signature', () => {
      process.env.RETELL_WEBHOOK_SECRET = 'test-secret';
      const body = Buffer.from('{"event":"call_ended"}');

      const result = verifyRetellSignature(body, 'v=123,d=deadbeef0000deadbeef0000deadbeef0000deadbeef0000deadbeef00001234');
      expect(result).toBe(false);
    });

    it('returns false for plain hex (no v/d format)', () => {
      const secret = 'test-secret';
      process.env.RETELL_WEBHOOK_SECRET = secret;
      const body = Buffer.from('test-body');

      // Plain hex without v=timestamp,d=hmac format should be rejected
      const plainHex = crypto.createHmac('sha256', secret).update(body).digest('hex');
      const result = verifyRetellSignature(body, plainHex);
      expect(result).toBe(false);
    });
  });

  // ────────────────────────────────────────────────
  // processRetellCall
  // ────────────────────────────────────────────────

  describe('processRetellCall', () => {
    let mocks, service;

    beforeEach(() => {
      mocks = buildMocks();
      service = makeRetellService({
        Prospect: mocks.Prospect,
        IdempotencyKey: mocks.IdempotencyKey,
        User: mocks.User,
        Campaign: mocks.Campaign,
        ProspectActivity: mocks.ProspectActivity,
        sequelize: mocks.sequelize,
        resolveAssignedAgentId: mocks.resolveAssignedAgentId,
        resolveLeadRouting: mocks.resolveLeadRouting,
        chargeLeadCredit: mocks.chargeLeadCredit,
        dispatchEvent: mocks.dispatchEvent,
        sendLeadAssignmentEmail: mocks.sendLeadAssignmentEmail,
        AppError: mocks.AppError,
        logger: mocks.logger,
      });
    });

    it('skips non-ended calls', async () => {
      const payload = makeSuccessfulCallPayload({ call_status: 'in_progress' });

      const result = await service.processRetellCall(payload);

      expect(result).toEqual({ status: 'skipped', reason: 'call_not_ended' });
      expect(mocks.Prospect.create).not.toHaveBeenCalled();
    });

    it('skips unsuccessful calls (boolean false)', async () => {
      const payload = makeSuccessfulCallPayload({
        call_analysis: { call_successful: false },
      });

      const result = await service.processRetellCall(payload);

      expect(result).toEqual({ status: 'skipped', reason: 'call_not_successful' });
    });

    it('skips unsuccessful calls (string "false")', async () => {
      const payload = makeSuccessfulCallPayload({
        call_analysis: { call_successful: 'false' },
      });

      const result = await service.processRetellCall(payload);

      expect(result).toEqual({ status: 'skipped', reason: 'call_not_successful' });
    });

    it('treats missing call_analysis as successful', async () => {
      const payload = makeSuccessfulCallPayload({
        call_analysis: undefined,
      });

      const result = await service.processRetellCall(payload);

      expect(result.status).toBe('created');
    });

    it('returns duplicate for existing idempotency key', async () => {
      mocks.IdempotencyKey.findOne.mockResolvedValue({
        key: 'call123',
        scope: 'retell:call',
        responseBody: { prospectId: 'prospect-existing' },
      });

      const result = await service.processRetellCall(makeSuccessfulCallPayload());

      expect(result).toEqual({
        status: 'duplicate',
        prospectId: 'prospect-existing',
      });
      expect(mocks.Prospect.create).not.toHaveBeenCalled();
    });

    it('creates prospect with correct fields for successful call', async () => {
      const payload = makeSuccessfulCallPayload();

      const result = await service.processRetellCall(payload);

      expect(result.status).toBe('created');
      expect(result.prospectId).toBe('prospect-1');

      const createCall = mocks.Prospect.create.mock.calls[0];
      const prospectData = createCall[0];

      expect(prospectData.firstName).toBe('John');
      expect(prospectData.lastName).toBe('Doe');
      expect(prospectData.email).toBeNull();
      expect(prospectData.phone).toBe('+6591234567');
      expect(prospectData.leadSource).toBe('call_bot');
      expect(prospectData.leadStatus).toBe('new');
      expect(prospectData.tags).toEqual(['retell', 'phone-call']);
      expect(prospectData.retellCallId).toBe('call123');
      expect(prospectData.sourceMetadata.retellCallId).toBe('call123');
      expect(prospectData.sourceMetadata.recordingUrl).toBe('https://recordings.retell.ai/call123.mp3');

      // Created within a transaction
      expect(createCall[1]).toEqual({ transaction: mocks.mockTransaction });
    });

    it('maps sentiment to priority: Positive -> high', async () => {
      const payload = makeSuccessfulCallPayload({
        call_analysis: { call_successful: true, user_sentiment: 'Positive' },
      });

      await service.processRetellCall(payload);

      const prospectData = mocks.Prospect.create.mock.calls[0][0];
      expect(prospectData.priority).toBe('high');
    });

    it('maps sentiment to priority: Neutral -> medium', async () => {
      const payload = makeSuccessfulCallPayload({
        call_analysis: { call_successful: true, user_sentiment: 'Neutral' },
      });

      await service.processRetellCall(payload);

      const prospectData = mocks.Prospect.create.mock.calls[0][0];
      expect(prospectData.priority).toBe('medium');
    });

    it('maps sentiment to priority: Negative -> low', async () => {
      const payload = makeSuccessfulCallPayload({
        call_analysis: { call_successful: true, user_sentiment: 'Negative' },
      });

      await service.processRetellCall(payload);

      const prospectData = mocks.Prospect.create.mock.calls[0][0];
      expect(prospectData.priority).toBe('low');
    });

    it('defaults priority to medium when sentiment is unknown', async () => {
      const payload = makeSuccessfulCallPayload({
        call_analysis: { call_successful: true, user_sentiment: undefined },
      });

      await service.processRetellCall(payload);

      const prospectData = mocks.Prospect.create.mock.calls[0][0];
      expect(prospectData.priority).toBe('medium');
    });

    it('resolves campaign by agent name convention: [Retell] {agent_name}', async () => {
      const payload = makeSuccessfulCallPayload({
        agent_id: 'retell-agent-1',
        agent_name: 'Test Agent',
      });

      await service.processRetellCall(payload);

      expect(mocks.Campaign.findOne).toHaveBeenCalledWith({
        where: { name: '[Retell] Test Agent', is_active: true },
      });
    });

    it('creates idempotency key in same transaction', async () => {
      await service.processRetellCall(makeSuccessfulCallPayload());

      expect(mocks.IdempotencyKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'call123',
          scope: 'retell:call',
          responseBody: { prospectId: 'prospect-1' },
          responseCode: 200,
        }),
        { transaction: mocks.mockTransaction }
      );
    });

    it('commits transaction on success', async () => {
      await service.processRetellCall(makeSuccessfulCallPayload());

      expect(mocks.mockTransaction.commit).toHaveBeenCalled();
      expect(mocks.mockTransaction.rollback).not.toHaveBeenCalled();
    });

    it('handles unique constraint as duplicate (not error)', async () => {
      const err = new Error('Unique constraint violated');
      err.name = 'SequelizeUniqueConstraintError';
      err.fields = { retellCallId: 'call123' };
      mocks.Prospect.create.mockRejectedValue(err);

      const result = await service.processRetellCall(makeSuccessfulCallPayload());

      expect(result).toEqual({ status: 'duplicate', reason: 'db_constraint' });
      expect(mocks.mockTransaction.rollback).toHaveBeenCalled();
    });

    it('rolls back and re-throws non-unique-constraint errors', async () => {
      const err = new Error('Connection lost');
      mocks.Prospect.create.mockRejectedValue(err);

      await expect(service.processRetellCall(makeSuccessfulCallPayload()))
        .rejects.toThrow('Connection lost');
      expect(mocks.mockTransaction.rollback).toHaveBeenCalled();
    });

    it('fires webhook dispatch after commit', async () => {
      await service.processRetellCall(makeSuccessfulCallPayload());

      expect(mocks.dispatchEvent).toHaveBeenCalledWith(
        'lead.created',
        expect.any(Function)
      );

      // Invoke the payload builder to verify its structure
      const payloadBuilder = mocks.dispatchEvent.mock.calls[0][1];
      const webhookPayload = payloadBuilder();
      expect(webhookPayload.event).toBe('lead.created');
      expect(webhookPayload.data.lead.externalId).toBe('prospect-1');
      expect(webhookPayload.data.lead.leadSource).toBe('call_bot');
      expect(webhookPayload.data.lead.recordingUrl).toBe('https://recordings.retell.ai/call123.mp3');

      // Verify routing block is present (B1 fix)
      expect(webhookPayload.data.routing).toBeDefined();
      expect(webhookPayload.data.routing.agentPhone).toBe('+6590001234');
      expect(webhookPayload.data.routing.agentName).toBe('Agent Smith');
      expect(webhookPayload.data.routing.agentExternalId).toBe('lyfe-agent-1');
      expect(webhookPayload.data.routing.mode).toBe('retell_round_robin');
    });

    it('parses first/last name from dynamic variables', async () => {
      const payload = makeSuccessfulCallPayload({
        retell_llm_dynamic_variables: { name: 'Alice Wong Mei Lin' },
      });

      await service.processRetellCall(payload);

      const prospectData = mocks.Prospect.create.mock.calls[0][0];
      expect(prospectData.firstName).toBe('Alice');
      expect(prospectData.lastName).toBe('Wong Mei Lin');
    });

    it('defaults firstName to "Retell Lead" when name is missing', async () => {
      const payload = makeSuccessfulCallPayload({
        retell_llm_dynamic_variables: {},
      });

      await service.processRetellCall(payload);

      const prospectData = mocks.Prospect.create.mock.calls[0][0];
      expect(prospectData.firstName).toBe('Retell Lead');
      // Empty string is falsy, so `lastName || null` evaluates to null
      expect(prospectData.lastName).toBeNull();
    });

    it('accepts call_status omitted (some Retell versions)', async () => {
      const payload = makeSuccessfulCallPayload({ call_status: undefined });

      const result = await service.processRetellCall(payload);
      expect(result.status).toBe('created');
    });
  });

  // ────────────────────────────────────────────────
  // getRecordingUrl
  // ────────────────────────────────────────────────

  describe('getRecordingUrl', () => {
    let mocks, service;

    beforeEach(() => {
      mocks = buildMocks();
      service = makeRetellService({
        Prospect: mocks.Prospect,
        IdempotencyKey: mocks.IdempotencyKey,
        User: mocks.User,
        Campaign: mocks.Campaign,
        ProspectActivity: mocks.ProspectActivity,
        sequelize: mocks.sequelize,
        resolveAssignedAgentId: mocks.resolveAssignedAgentId,
        resolveLeadRouting: mocks.resolveLeadRouting,
        chargeLeadCredit: mocks.chargeLeadCredit,
        dispatchEvent: mocks.dispatchEvent,
        sendLeadAssignmentEmail: mocks.sendLeadAssignmentEmail,
        AppError: mocks.AppError,
        logger: mocks.logger,
      });
    });

    it('throws 404 when prospect not found', async () => {
      mocks.Prospect.findByPk.mockResolvedValue(null);

      await expect(service.getRecordingUrl('nonexistent'))
        .rejects.toThrow('Prospect not found');
    });

    it('throws 404 when prospect has no retellCallId', async () => {
      mocks.Prospect.findByPk.mockResolvedValue({
        sourceMetadata: {},
      });

      await expect(service.getRecordingUrl('prospect-1'))
        .rejects.toThrow('Not a Retell prospect');
    });

    it('returns cached recordingUrl from sourceMetadata', async () => {
      mocks.Prospect.findByPk.mockResolvedValue({
        sourceMetadata: {
          retellCallId: 'call123',
          recordingUrl: 'https://cached.url/recording.mp3',
        },
      });

      const result = await service.getRecordingUrl('prospect-1');
      expect(result).toEqual({ recordingUrl: 'https://cached.url/recording.mp3' });
    });
  });
});
