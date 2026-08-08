/**
 * Connect-Facebook INTEGRATION tests
 * (docs/plans/facebook-connect-self-serve.md §6) — real Postgres, real
 * models/migrations (116/117), real transactions; only the Graph client is
 * DI-stubbed. The finale wires a provisioned connection into the LIVE lead
 * pipe: a leadgen webhook for the connected page must route to the agent.
 */
import './setup.js';
process.env.WEBHOOK_ENABLED = 'true';
process.env.META_PAGE_TOKEN_ENC_KEY = 'b'.repeat(64);
process.env.META_APP_ID = '1957456775175661';
process.env.META_APP_SECRET = 'integration-app-secret';
process.env.FB_LOGIN_CONFIG_ID = 'cfg-int';
process.env.EXTERNAL_APP_SECRET = 'external-hmac-secret';
process.env.META_OAUTH_ENABLED = 'true';
process.env.META_LEAD_ADS_ENABLED = 'true';

import { jest } from '@jest/globals';
import crypto from 'crypto';
import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js';
import {
  MetaAgentConnection, MetaPage, MetaFormMapping, QrTag, Prospect,
  MetaLeadgenEvent, WebhookSubscriber, WebhookDelivery,
} from '../src/models/index.js';
import { makeMetaConnectService, armMetaOauth } from '../src/services/metaConnectService.js';
import { makeMetaLeadService } from '../src/services/metaLeadService.js';

let app, admin, agent;
let seq = 0;
const uid = () => `${Date.now()}${++seq}`;

const sign = (raw) => `sha256=${crypto.createHmac('sha256', process.env.EXTERNAL_APP_SECRET).update(raw).digest('hex')}`;
function brokerPost(body) {
  const raw = Buffer.from(JSON.stringify(body));
  return request(app)
    .post('/api/external/facebook-connect')
    .set('Content-Type', 'application/json')
    .set('X-Webhook-Signature', sign(raw))
    .send(raw.toString());
}

function stubbedGraph({ pageId, formIdOnCreate = `form-${uid()}` }) {
  return {
    exchangeCodeForLongLivedToken: jest.fn().mockResolvedValue({ token: 'LL-TOKEN', expiresIn: 5184000 }),
    call: jest.fn(async (path, opts = {}) => {
      if (path === 'me') return { id: `fbu-${pageId}` };
      if (String(path).endsWith('/subscribed_apps') && opts.method === 'POST') return { success: true };
      if (String(path).endsWith('/subscribed_apps') && opts.method === 'DELETE') return { success: true };
      if (String(path).endsWith('/subscribed_apps')) return { data: [{ id: process.env.META_APP_ID }] };
      if (String(path) === String(pageId)) return { leadgen_tos_accepted: true };
      if (String(path).endsWith('/leadgen_forms') && opts.method === 'POST') return { id: formIdOnCreate };
      return {};
    }),
    callAllPages: jest.fn(async (path) => {
      if (path === 'me/permissions') {
        return ['leads_retrieval', 'pages_show_list', 'pages_manage_metadata', 'pages_read_engagement', 'pages_manage_ads']
          .map((p) => ({ permission: p, status: 'granted' }));
      }
      if (path === 'me/accounts') return [{ id: pageId, name: `Page ${pageId}`, access_token: `PAGETOK-${pageId}`, tasks: ['MANAGE'] }];
      if (String(path).endsWith('/leadgen_forms')) return [];
      return [];
    }),
  };
}

beforeAll(async () => {
  app = await getApp();
  armMetaOauth(); // bootstrap soft-skips fixtures in test env — arm manually
  ({ user: admin } = await createTestUser({ role: 'admin' }));
  ({ user: agent } = await createTestUser({
    role: 'agent',
    mktrLeadsId: '550e8400-e29b-41d4-a716-446655440777',
    firstName: 'Connie', lastName: 'Agent',
  }));
  const campaign = await createTestCampaign(admin.id, { name: `Meta Agent Ads IT ${Date.now()}`, enforceLeadQuota: false });
  process.env.META_AGENT_ADS_CAMPAIGN_ID = campaign.id;
  await WebhookSubscriber.create({
    name: `it-fbc-mktr-leads-${uid()}`,
    url: 'http://127.0.0.1:9/webhook', secret: 's',
    events: ['lead.created', 'lead.held'], enabled: true,
    metadata: { destination: 'mktr_leads' },
  });
});

afterAll(async () => { await closeDb(); });

describe('Connect Facebook (integration)', () => {
  test('full journey: start → callback → provision → connected, then a leadgen webhook routes to the agent', async () => {
    const pageId = `77${uid()}`.slice(0, 15);
    const svc = makeMetaConnectService({ graph: stubbedGraph({ pageId }) });

    // start
    const { startUrl } = await svc.startConnect({ agentMktrUserId: agent.mktrLeadsId });
    const nonce = new URL(startUrl).searchParams.get('state');
    expect(nonce).toHaveLength(48);

    // callback (public GET semantics, service-level)
    const cb = await svc.handleOAuthCallback({ code: `code-${uid()}`, state: nonce });
    expect(cb.redirect).toBe('pending');

    // worker
    await svc.drainMetaConnections();
    const row = await MetaAgentConnection.findOne({ where: { userId: agent.id } });
    expect(row.status).toBe('connected');
    expect(row.oauthCodeEnc).toBeNull();
    expect(row.pageId).toBe(pageId);

    const pageRow = await MetaPage.findByPk(row.metaPageRowId);
    expect(pageRow).toMatchObject({ pageId, isActive: true, connectedVia: 'oauth' });
    expect(pageRow.accessTokenEnc).not.toContain('PAGETOK');

    const qr = await QrTag.findByPk(row.qrTagId);
    expect(qr).toMatchObject({ assignedAgentId: agent.id, type: 'meta_agent', active: true });

    const mapping = await MetaFormMapping.findByPk(row.mappingId);
    expect(mapping).toMatchObject({ formId: row.formId, qrTagId: qr.id, isActive: true });

    // ── the money shot: a lead on the connected page reaches THIS agent ──
    const leadSvc = makeMetaLeadService({
      fetch: jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          field_data: [
            { name: 'full_name', values: ['Self Serve Lead'] },
            { name: 'phone_number', values: [`+65916${String(++seq).padStart(5, '0')}`] },
            { name: 'email', values: [`fbc-${uid()}@test.com`] },
          ],
          form_id: row.formId, platform: 'fb', is_organic: false,
          custom_disclaimer_responses: [{ checkbox_key: 'mktr_pdpa_consent', is_checked: true }],
        }),
      }),
      flushDeliveries: jest.fn(),
      sendLeadAssignmentEmail: jest.fn().mockResolvedValue({}),
    });
    const leadgenId = `88${uid()}`.slice(0, 15);
    await leadSvc.enqueueLeadgenChanges([{ leadgen_id: leadgenId, page_id: pageId, form_id: row.formId, created_time: 1754500000 }]);
    await leadSvc.drainMetaInbox({ batchSize: 5, maxBatches: 2 });

    const inboxRow = await MetaLeadgenEvent.findOne({ where: { leadgenId } });
    expect(inboxRow.status).toBe('completed');
    const prospect = await Prospect.findByPk(inboxRow.prospectId);
    expect(prospect.assignedAgentId).toBe(agent.id);
    expect(prospect.quarantinedAt).toBeNull();
    expect(prospect.sourceMetadata.utm.utm_source).toBe('fb');
    const delivery = await WebhookDelivery.findOne({ where: { eventType: 'lead.created' }, order: [['createdAt', 'DESC']] });
    expect(delivery.payload.data.routing.agentExternalId).toBe(agent.mktrLeadsId);
  });

  test('broker endpoint: HMAC gate + status + select_page validation + disconnect tombstone', async () => {
    // Unsigned → 401 before anything else.
    const raw = JSON.stringify({ action: 'status', agentMktrUserId: agent.mktrLeadsId, timestamp: new Date().toISOString() });
    await request(app).post('/api/external/facebook-connect').set('Content-Type', 'application/json').send(raw).expect(401);

    // Signed status → connected DTO from the previous journey.
    const res = await brokerPost({ action: 'status', agentMktrUserId: agent.mktrLeadsId, timestamp: new Date().toISOString() }).expect(200);
    expect(res.body.connection.status).toBe('connected');
    expect(res.body.connection.pageName).toMatch(/^Page /);
    expect(res.body.connection.formName).toContain('Connie');

    // select_page with nothing pending → 409 taxonomy.
    const sel = await brokerPost({ action: 'select_page', agentMktrUserId: agent.mktrLeadsId, pageId: '1', timestamp: new Date().toISOString() });
    expect(sel.status).toBe(409);
    expect(sel.body.error).toBe('no_selection_pending');

    // Stale timestamp → 401 (freshness window).
    const staleBody = { action: 'status', agentMktrUserId: agent.mktrLeadsId, timestamp: new Date(Date.now() - 10 * 60000).toISOString() };
    await brokerPost(staleBody).expect(401);

    // disconnect → tombstone semantics.
    await brokerPost({ action: 'disconnect', agentMktrUserId: agent.mktrLeadsId, timestamp: new Date().toISOString() }).expect(200);
    const row = await MetaAgentConnection.findOne({ where: { userId: agent.id } });
    expect(row.status).toBe('disconnected');
    const pageRow = await MetaPage.findByPk(row.metaPageRowId);
    expect(pageRow.isActive).toBe(false);
    expect(pageRow.accessTokenEnc).toBeNull();
    const mapping = await MetaFormMapping.findByPk(row.mappingId);
    expect(mapping.isActive).toBe(false);
  });

  test('two granted pages stop at needs_page_selection; select resumes to connected', async () => {
    const { user: agent2 } = await createTestUser({
      role: 'agent', mktrLeadsId: '550e8400-e29b-41d4-a716-446655440888',
      firstName: 'Multi', lastName: 'Pager',
    });
    const pageA = `71${uid()}`.slice(0, 15);
    const pageB = `72${uid()}`.slice(0, 15);
    const graph = stubbedGraph({ pageId: pageA });
    graph.callAllPages = jest.fn(async (path) => {
      if (path === 'me/permissions') {
        return ['leads_retrieval', 'pages_show_list', 'pages_manage_metadata', 'pages_read_engagement', 'pages_manage_ads']
          .map((p) => ({ permission: p, status: 'granted' }));
      }
      if (path === 'me/accounts') {
        return [
          { id: pageA, name: 'Page A', access_token: `PT-${pageA}` },
          { id: pageB, name: 'Page B', access_token: `PT-${pageB}` },
        ];
      }
      if (String(path).endsWith('/leadgen_forms')) return [];
      return [];
    });
    graph.call = jest.fn(async (path, opts = {}) => {
      if (path === 'me') return { id: `fbu-${pageB}` };
      if (String(path).endsWith('/subscribed_apps') && opts.method === 'POST') return { success: true };
      if (String(path).endsWith('/subscribed_apps')) return { data: [{ id: process.env.META_APP_ID }] };
      if (String(path) === pageB || String(path) === pageA) return { leadgen_tos_accepted: true };
      if (String(path).endsWith('/leadgen_forms') && opts.method === 'POST') return { id: `form-${uid()}` };
      return {};
    });
    const svc = makeMetaConnectService({ graph });

    const { startUrl } = await svc.startConnect({ agentMktrUserId: agent2.mktrLeadsId });
    await svc.handleOAuthCallback({ code: `code-${uid()}`, state: new URL(startUrl).searchParams.get('state') });
    await svc.drainMetaConnections();

    let row = await MetaAgentConnection.findOne({ where: { userId: agent2.id } });
    expect(row.status).toBe('needs_page_selection');
    expect(row.candidatePages).toHaveLength(2);
    expect(JSON.stringify(row.candidatePages)).not.toContain('PT-');

    await svc.selectPage({ agentMktrUserId: agent2.mktrLeadsId, pageId: pageB });
    await svc.drainMetaConnections();
    row = await MetaAgentConnection.findOne({ where: { userId: agent2.id } });
    expect(row.status).toBe('connected');
    expect(row.pageId).toBe(pageB);

    // ── page_in_use (review F3): a third agent granting the SAME page must
    // terminal-fail against the live-page reservation, never wire anything.
    const { user: agent3 } = await createTestUser({
      role: 'agent', mktrLeadsId: '550e8400-e29b-41d4-a716-446655440999',
      firstName: 'Late', lastName: 'Claimer',
    });
    const svc3 = makeMetaConnectService({ graph: stubbedGraph({ pageId: pageB }) });
    const s3 = await svc3.startConnect({ agentMktrUserId: agent3.mktrLeadsId });
    await svc3.handleOAuthCallback({ code: `code-${uid()}`, state: new URL(s3.startUrl).searchParams.get('state') });
    await svc3.drainMetaConnections();
    const row3 = await MetaAgentConnection.findOne({ where: { userId: agent3.id } });
    expect(row3.status).toBe('failed');
    expect(row3.statusDetail).toBe('page_in_use');
    // The winner keeps the page.
    const winner = await MetaAgentConnection.findOne({ where: { userId: agent2.id } });
    expect(winner.status).toBe('connected');
  });
});
