import { jest } from '@jest/globals';
import '../setup.js';
import * as client from '../../src/integrations/adapters/mktr-leads/mktrLeadsClient.js';
import { MktrLeadsAdapter } from '../../src/integrations/adapters/mktr-leads/MktrLeadsAdapter.js';

// mktr-leads `agents` rows as PostgREST would return them.
const ROWS = [
  {
    mktr_user_id: 'mu_1',
    full_name: 'Ada Tan',
    email: 'ada@example.com',
    phone: '6591234567',
    role: 'agent',
    is_active: true,
    created_at: '2026-06-01T00:00:00Z',
  },
  {
    mktr_user_id: 'mu_2',
    full_name: 'Ben Lim',
    email: null,
    phone: '6598765432',
    role: 'agent',
    is_active: true,
    created_at: '2026-06-02T00:00:00Z',
  },
];

describe('mktrLeadsClient', () => {
  const realFetch = global.fetch;
  let fetchMock;

  beforeEach(() => {
    process.env.MKTR_LEADS_SUPABASE_URL = 'https://proj.supabase.co';
    process.env.MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
    client.invalidateCache();
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ROWS,
      text: async () => '',
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.MKTR_LEADS_SUPABASE_URL;
    delete process.env.MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY;
  });

  it('fetchAgents filters role=agent + is_active at the source and normalizes', async () => {
    const agents = await client.fetchAgents();

    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('/rest/v1/agents?');
    expect(url).toContain('role=eq.agent');
    expect(url).toContain('is_active=eq.true');
    expect(url).toContain('select=mktr_user_id,full_name,email,phone,role,is_active,created_at');

    expect(agents).toHaveLength(2);
    expect(agents[0]).toMatchObject({
      externalId: 'mu_1', // the mktr_user_id, NOT an auth id
      fullName: 'Ada Tan',
      email: 'ada@example.com',
      phone: '6591234567',
      externalRole: 'agent',
      isActive: true,
      avatarUrl: null,
      dateOfBirth: null,
      createdAt: '2026-06-01T00:00:00Z',
    });
    expect(agents[1].email).toBeNull(); // do NOT synthesize
  });

  it('caches list results within TTL (no second fetch)', async () => {
    await client.fetchAgents();
    await client.fetchAgents();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetchAgentById queries by mktr_user_id and returns the normalized agent', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => [ROWS[0]], text: async () => '' });
    const agent = await client.fetchAgentById('mu_1');
    expect(fetchMock.mock.calls[0][0]).toContain('mktr_user_id=eq.mu_1');
    expect(agent.externalId).toBe('mu_1');
  });

  it('fetchAgentById throws when the agent is absent', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => [], text: async () => '' });
    await expect(client.fetchAgentById('nope')).rejects.toThrow(/not found in mktr-leads/);
  });

  it('throws a clear error when env is not configured', async () => {
    delete process.env.MKTR_LEADS_SUPABASE_URL;
    client.invalidateCache();
    await expect(client.fetchAgents()).rejects.toThrow(/MKTR_LEADS_SUPABASE_URL/);
  });
});

describe('MktrLeadsAdapter contract', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.MKTR_LEADS_WEBHOOK_URL;
    delete process.env.MKTR_LEADS_WEBHOOK_SECRET;
  });

  it('declares the mktr_leads identity and provenance column', () => {
    expect(MktrLeadsAdapter.id).toBe('mktr_leads');
    expect(MktrLeadsAdapter.localIdField).toBe('mktrLeadsId');
  });

  it('reads outbound webhook url/secret from env each call', () => {
    expect(MktrLeadsAdapter.outboundWebhookUrl()).toBeNull();
    expect(MktrLeadsAdapter.outboundWebhookSecret()).toBeNull();
    process.env.MKTR_LEADS_WEBHOOK_URL = 'https://proj.supabase.co/functions/v1/receive-mktr-lead';
    process.env.MKTR_LEADS_WEBHOOK_SECRET = 'shh';
    expect(MktrLeadsAdapter.outboundWebhookUrl()).toBe('https://proj.supabase.co/functions/v1/receive-mktr-lead');
    expect(MktrLeadsAdapter.outboundWebhookSecret()).toBe('shh');
  });

  it('listAgents delegates to the client', async () => {
    process.env.MKTR_LEADS_SUPABASE_URL = 'https://proj.supabase.co';
    process.env.MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
    client.invalidateCache();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ROWS, text: async () => '' });
    const agents = await MktrLeadsAdapter.listAgents();
    expect(agents.map((a) => a.externalId)).toEqual(['mu_1', 'mu_2']);
    delete process.env.MKTR_LEADS_SUPABASE_URL;
    delete process.env.MKTR_LEADS_SUPABASE_SERVICE_ROLE_KEY;
  });
});
