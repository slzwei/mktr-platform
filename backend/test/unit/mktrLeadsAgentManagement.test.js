import { jest } from '@jest/globals';
import '../setup.js';
import { makeMktrLeadsAgentManagementService } from '../../src/services/mktrLeadsAgentManagementService.js';

describe('mktrLeadsAgentManagementService', () => {
  let client, sync, User, logger, svc;
  const admin = { id: 'admin-1' };
  const localRow = { id: 'u1', mktrLeadsId: 'mu_12345678', isActive: true };

  beforeEach(() => {
    process.env.MKTR_LEADS_SUPABASE_URL = 'https://proj.supabase.co';
    process.env.MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
    process.env.MKTR_LEADS_INVITE_SECRET = 'invite-secret';
    client = {
      createInvitation: jest.fn(),
      setAgentActive: jest.fn(),
      updateAgentFields: jest.fn(),
    };
    sync = jest.fn().mockResolvedValue({ locked: true });
    User = { findOne: jest.fn().mockResolvedValue(localRow) };
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    svc = makeMktrLeadsAgentManagementService({ client, syncAgentsFromMktrLeads: sync, User, logger });
  });

  afterEach(() => {
    delete process.env.MKTR_LEADS_SUPABASE_URL;
    delete process.env.MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.MKTR_LEADS_INVITE_SECRET;
  });

  describe('configuration gate', () => {
    it('throws 503 when env is unset', async () => {
      delete process.env.MKTR_LEADS_SUPABASE_URL;
      await expect(svc.inviteAgent({ phone: '91234567' }, admin)).rejects.toMatchObject({ statusCode: 503 });
      expect(client.createInvitation).not.toHaveBeenCalled();
    });

    it('invite throws 503 with a setup hint when MKTR_LEADS_INVITE_SECRET is unset', async () => {
      delete process.env.MKTR_LEADS_INVITE_SECRET;
      await expect(svc.inviteAgent({ phone: '91234567' }, admin)).rejects.toMatchObject({
        statusCode: 503,
        message: expect.stringContaining('MKTR_LEADS_INVITE_SECRET'),
      });
      expect(client.createInvitation).not.toHaveBeenCalled();
    });
  });

  describe('inviteAgent — EF status mapping', () => {
    it('200 → returns invitationId + emailSent and audit-logs', async () => {
      client.createInvitation.mockResolvedValue({ status: 200, body: { invitation_id: 'inv1', email_sent: true } });
      const res = await svc.inviteAgent({ phone: '91234567', fullName: 'Ada' }, admin);
      expect(res).toEqual({ invitationId: 'inv1', emailSent: true });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'mktr_leads_agent_invited', adminId: 'admin-1' }),
        expect.any(String)
      );
    });

    it('409 agent_exists ACTIVE → 409 "already an active agent"', async () => {
      client.createInvitation.mockResolvedValue({ status: 409, body: { agent_exists: true, is_active: true } });
      await expect(svc.inviteAgent({ phone: '91234567' }, admin)).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining('active mktr-leads agent'),
      });
    });

    it('409 agent_exists INACTIVE → 409 with the "reactivate instead" hint', async () => {
      client.createInvitation.mockResolvedValue({ status: 409, body: { agent_exists: true, is_active: false } });
      await expect(svc.inviteAgent({ phone: '91234567' }, admin)).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining('reactivate'),
      });
    });

    it('409 pending-invite → 409 passthrough', async () => {
      client.createInvitation.mockResolvedValue({ status: 409, body: { error: 'An invitation for this phone is already pending' } });
      await expect(svc.inviteAgent({ phone: '91234567' }, admin)).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining('already pending'),
      });
    });

    it('400 → 400 (EF rejected the phone)', async () => {
      client.createInvitation.mockResolvedValue({ status: 400, body: { error: 'Valid SG phone required' } });
      await expect(svc.inviteAgent({ phone: '12345678' }, admin)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('401 (old EF without service auth) → 502 with a deploy hint', async () => {
      client.createInvitation.mockResolvedValue({ status: 401, body: { error: 'Invalid session' } });
      await expect(svc.inviteAgent({ phone: '91234567' }, admin)).rejects.toMatchObject({
        statusCode: 502,
        message: expect.stringContaining('create-ext-agent-invite deployed'),
      });
    });
  });

  describe('setAgentActive', () => {
    it('writes to mktr-leads, then refreshes via BLOCKING sync, then returns the local row', async () => {
      client.setAgentActive.mockResolvedValue({ mktr_user_id: 'mu_12345678', is_active: false });

      const res = await svc.setAgentActive('mu_12345678', false, admin);

      expect(client.setAgentActive).toHaveBeenCalledWith('mu_12345678', false);
      expect(sync).toHaveBeenCalledWith({ wait: true });
      expect(User.findOne).toHaveBeenCalledWith({ where: { mktrLeadsId: 'mu_12345678' } });
      expect(res).toBe(localRow);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'mktr_leads_agent_managed', action: 'deactivate', adminId: 'admin-1' }),
        expect.any(String)
      );
    });

    it('404s when the PATCH matched nothing (unknown id / admin row)', async () => {
      client.setAgentActive.mockResolvedValue(null);
      await expect(svc.setAgentActive('mu_ghost', true, admin)).rejects.toMatchObject({ statusCode: 404 });
      expect(sync).not.toHaveBeenCalled();
    });

    it('rejects malformed ids before any network call', async () => {
      await expect(svc.setAgentActive('bad id!', true, admin)).rejects.toMatchObject({ statusCode: 400 });
      expect(client.setAgentActive).not.toHaveBeenCalled();
    });

    it('maps a refresh failure (lock timeout) to 503 WITHOUT failing the upstream write', async () => {
      client.setAgentActive.mockResolvedValue({ mktr_user_id: 'mu_12345678', is_active: false });
      sync.mockRejectedValue(Object.assign(new Error('canceling statement due to lock timeout'), { original: { code: '55P03' } }));

      await expect(svc.setAgentActive('mu_12345678', false, admin)).rejects.toMatchObject({
        statusCode: 503,
        message: expect.stringContaining('Saved in mktr-leads'),
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'mktr_leads_mgmt_refresh_failed' }),
        expect.any(String)
      );
    });
  });

  describe('updateAgentFields', () => {
    it('writes the fields, refreshes, returns the local row, audit-logs the changed keys', async () => {
      client.updateAgentFields.mockResolvedValue({ mktr_user_id: 'mu_12345678' });

      const res = await svc.updateAgentFields('mu_12345678', { full_name: 'New Name', agency: 'Acme' }, admin);

      expect(client.updateAgentFields).toHaveBeenCalledWith('mu_12345678', { full_name: 'New Name', agency: 'Acme' });
      expect(sync).toHaveBeenCalledWith({ wait: true });
      expect(res).toBe(localRow);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'mktr_leads_agent_managed', action: 'update', fields: ['full_name', 'agency'] }),
        expect.any(String)
      );
    });

    it('404s when nothing matched', async () => {
      client.updateAgentFields.mockResolvedValue(null);
      await expect(svc.updateAgentFields('mu_ghost', { full_name: 'X' }, admin)).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
