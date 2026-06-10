import { jest } from '@jest/globals';
import '../setup.js';
import * as client from '../../src/integrations/adapters/mktr-leads/mktrLeadsClient.js';

describe('mktrLeadsClient write-backs', () => {
  const realFetch = global.fetch;
  let fetchMock;

  beforeEach(() => {
    process.env.MKTR_LEADS_SUPABASE_URL = 'https://proj.supabase.co';
    process.env.MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
    client.invalidateCache();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.MKTR_LEADS_SUPABASE_URL;
    delete process.env.MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY;
  });

  describe('createInvitation', () => {
    it('POSTs to the create-ext-agent-invite EF with the service bearer and snake_case body', async () => {
      fetchMock.mockResolvedValue({ status: 200, json: async () => ({ success: true, invitation_id: 'inv1', email_sent: true }) });

      const res = await client.createInvitation({ phone: '91234567', fullName: 'Ada Tan', email: 'ada@x.com', agency: 'Acme' });

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://proj.supabase.co/functions/v1/create-ext-agent-invite');
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe('Bearer svc-key');
      expect(JSON.parse(opts.body)).toEqual({ phone: '91234567', full_name: 'Ada Tan', email: 'ada@x.com', agency: 'Acme' });
      expect(res).toEqual({ status: 200, body: { success: true, invitation_id: 'inv1', email_sent: true } });
    });

    it('returns non-2xx statuses with their body instead of throwing (409/400 carry meaning)', async () => {
      fetchMock.mockResolvedValue({ status: 409, json: async () => ({ error: 'Phone already belongs to an agent', agent_exists: true, is_active: false }) });
      const res = await client.createInvitation({ phone: '91234567' });
      expect(res.status).toBe(409);
      expect(res.body.agent_exists).toBe(true);
      expect(res.body.is_active).toBe(false);
    });

    it('nulls out omitted optional fields', async () => {
      fetchMock.mockResolvedValue({ status: 200, json: async () => ({}) });
      await client.createInvitation({ phone: '91234567' });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ phone: '91234567', full_name: null, email: null, agency: null });
    });
  });

  describe('setAgentActive / updateAgentFields (PATCH agents)', () => {
    const okRow = { mktr_user_id: 'mu_1', is_active: false };

    it('PATCHes with the role=eq.agent hard guard and an ENCODED id, returns the row', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => [okRow], text: async () => '' });

      const row = await client.setAgentActive('mu/1 weird', false);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain('/rest/v1/agents?');
      expect(url).toContain(`mktr_user_id=eq.${encodeURIComponent('mu/1 weird')}`);
      expect(url).toContain('role=eq.agent'); // admins untouchable by construction
      expect(opts.method).toBe('PATCH');
      expect(opts.headers.Prefer).toBe('return=representation');
      expect(JSON.parse(opts.body)).toEqual({ is_active: false });
      expect(row).toEqual(okRow);
    });

    it('returns null when nothing matched (unknown id or admin row)', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => [], text: async () => '' });
      const row = await client.setAgentActive('mu_admin', true);
      expect(row).toBeNull();
    });

    it('throws on a non-ok PATCH response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' });
      await expect(client.setAgentActive('mu_1', true)).rejects.toThrow(/PATCH failed: 500/);
    });

    it('updateAgentFields sends ONLY the provided keys (empty-string → null)', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => [okRow], text: async () => '' });

      await client.updateAgentFields('mu_1', { full_name: 'New Name', agency: '' });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({ full_name: 'New Name', agency: null });
      expect('email' in body).toBe(false);
    });
  });
});
