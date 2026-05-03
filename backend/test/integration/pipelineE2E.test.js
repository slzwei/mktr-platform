import crypto from 'crypto';
import http from 'http';
import request from 'supertest';
import {
  getApp, closeDb, createTestUser,
  createTestLeadPackage, createTestLeadPackageAssignment
} from '../helpers.js';
import {
  Prospect, IdempotencyKey, ProspectActivity,
  WebhookSubscriber, WebhookDelivery, Campaign
} from '../../src/models/index.js';

/**
 * End-to-end pipeline test:
 *   Retell webhook → Prospect creation → Webhook dispatch → Payload shape
 *
 * Spins up a local HTTP server to capture the dispatched webhook and validates
 * that the payload matches what receive-mktr-lead edge function expects.
 */

const WEBHOOK_SECRET = 'e2e-retell-secret';
const SUBSCRIBER_SECRET = 'e2e-subscriber-secret';
const RUN = Date.now();

let app, adminUser, adminToken, agentUser, retellCampaign;
let mockServer, mockServerUrl;
let capturedPayloads;

// ── Mock webhook receiver ────────────────────────────────────────────────────

function startMockServer() {
  return new Promise((resolve) => {
    capturedPayloads = [];
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        capturedPayloads.push({
          headers: { ...req.headers },
          body: JSON.parse(body),
          rawBody: body
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    mockServer.listen(0, '127.0.0.1', () => {
      const { port } = mockServer.address();
      mockServerUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

function stopMockServer() {
  return new Promise((resolve) => {
    if (mockServer) mockServer.close(resolve);
    else resolve();
  });
}

/** Wait until capturedPayloads has at least `count` entries, or timeout. */
function waitForPayloads(count = 1, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (capturedPayloads.length >= count) return resolve(capturedPayloads);
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timed out waiting for ${count} payload(s), got ${capturedPayloads.length}`));
      }
      setTimeout(check, 50);
    };
    check();
  });
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env.RETELL_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.WEBHOOK_ENABLED = 'true';

  await startMockServer();
  app = await getApp();

  // Admin user
  const admin = await createTestUser({ role: 'admin' });
  adminUser = admin.user;
  adminToken = admin.token;

  // Agent with phone (needed for edge function agent matching)
  const agent = await createTestUser({
    role: 'agent',
    phone: '+6590001234',
    lyfeId: 'lyfe-uuid-agent-001'
  });
  agentUser = agent.user;

  // Retell campaign matching naming convention
  retellCampaign = await Campaign.create({
    name: '[Retell] E2E Agent',
    createdBy: adminUser.id,
    status: 'active',
    type: 'lead_generation',
    is_active: true,
    min_age: 18,
    max_age: 65
  });

  // Lead package + assignment so round-robin resolves to our agent
  const pkg = await createTestLeadPackage(retellCampaign.id, adminUser.id);
  await createTestLeadPackageAssignment(agentUser.id, pkg.id, {
    leadsRemaining: 10
  });

  // Webhook subscriber pointing to mock server
  await WebhookSubscriber.create({
    name: 'E2E Test Receiver',
    url: mockServerUrl,
    secret: SUBSCRIBER_SECRET,
    events: ['lead.created', 'lead.assigned', 'lead.unassigned'],
    enabled: true
  });
}, 30000);

afterAll(async () => {
  process.env.WEBHOOK_ENABLED = 'false';
  await stopMockServer();
  await closeDb();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function signRetellPayload(body, secret) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const hmac = crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${bodyStr}`)
    .digest('hex');
  return `v=${timestamp},d=${hmac}`;
}

let callSeq = 0;
function buildCallPayload(overrides = {}) {
  callSeq++;
  return {
    call_id: `call_e2e_${RUN}_${callSeq}`,
    call_type: 'phone_call',
    call_status: 'ended',
    agent_id: 'agent_e2e_001',
    agent_name: 'E2E Agent',
    from_number: '+6531295909',
    to_number: `+6592${String(RUN).slice(-6)}`,
    duration_ms: 60000,
    disconnection_reason: 'agent_hangup',
    transcript: 'Agent: Hello.\nUser: I want CareShield info.',
    recording_url: 'https://storage.retellai.com/recording/e2e-test.wav',
    retell_llm_dynamic_variables: { name: 'Alice Lim' },
    call_analysis: {
      call_successful: true,
      call_summary: 'Caller interested in CareShield Life product.',
      user_sentiment: 'Positive',
      custom_analysis_data: { interested_product: 'CareShield Life' },
      in_voicemail: false
    },
    ...overrides
  };
}

function postWebhook(payload) {
  const bodyStr = JSON.stringify(payload);
  const sig = signRetellPayload(bodyStr, WEBHOOK_SECRET);
  return request(app)
    .post('/api/retell/webhook')
    .set('Content-Type', 'application/json')
    .set('x-retell-signature', sig)
    .send(bodyStr);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Pipeline E2E: Retell webhook → Prospect → Webhook dispatch', () => {
  afterEach(async () => {
    await Prospect.destroy({ where: { leadSource: 'call_bot' }, force: true });
    await IdempotencyKey.destroy({ where: { scope: 'retell:call' } });
    await WebhookDelivery.destroy({ where: {}, truncate: true });
    capturedPayloads = [];
  });

  it('delivers a well-formed lead.created payload to the webhook subscriber', async () => {
    const payload = buildCallPayload();
    const res = await postWebhook(payload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('created');
    expect(res.body.prospectId).toBeDefined();

    // Wait for async webhook delivery
    const payloads = await waitForPayloads(1);
    expect(payloads).toHaveLength(1);

    const received = payloads[0];
    const body = received.body;

    // -- Event shape --
    expect(body.event).toBe('lead.created');
    expect(body.timestamp).toBeDefined();
    expect(body.deliveryId).toBeDefined();

    // -- data.lead fields required by receive-mktr-lead --
    expect(body.data.lead).toBeDefined();
    expect(body.data.lead.externalId).toBe(res.body.prospectId);
    expect(body.data.lead.firstName).toBe('Alice');
    expect(body.data.lead.lastName).toBe('Lim');
    expect(body.data.lead.phone).toBe(payload.to_number);
    expect(body.data.lead.leadSource).toBe('call_bot');
    expect(body.data.lead.sourceMetadata).toBeDefined();
    expect(body.data.lead.sourceMetadata.retellCallId).toBe(payload.call_id);
    expect(body.data.lead.recordingUrl).toBe(payload.recording_url);
    expect(body.data.lead.transcript).toBeDefined();
    expect(body.data.lead.createdAt).toBeDefined();

    // -- data.routing fields required by receive-mktr-lead --
    expect(body.data.routing).toBeDefined();
    // At least one of agentPhone or agentExternalId must be present
    const hasAgentIdentifier = body.data.routing.agentPhone || body.data.routing.agentExternalId;
    expect(hasAgentIdentifier).toBeTruthy();

    // -- Webhook security headers --
    expect(received.headers['x-webhook-event']).toBe('lead.created');
    expect(received.headers['x-webhook-delivery-id']).toBeDefined();
    expect(received.headers['x-webhook-signature']).toMatch(/^sha256=/);
    expect(received.headers['x-webhook-timestamp']).toBeDefined();
  });

  it('HMAC signature on the dispatched webhook is verifiable', async () => {
    const payload = buildCallPayload();
    await postWebhook(payload);

    const payloads = await waitForPayloads(1);
    const received = payloads[0];

    // Verify HMAC using subscriber secret
    const expectedHmac = crypto
      .createHmac('sha256', SUBSCRIBER_SECRET)
      .update(received.rawBody)
      .digest('hex');

    expect(received.headers['x-webhook-signature']).toBe(`sha256=${expectedHmac}`);
  });

  it('creates Prospect + ProspectActivity + IdempotencyKey in one transaction', async () => {
    const payload = buildCallPayload();
    const res = await postWebhook(payload);
    const prospectId = res.body.prospectId;

    // Prospect
    const prospect = await Prospect.findByPk(prospectId);
    expect(prospect).not.toBeNull();
    expect(prospect.firstName).toBe('Alice');
    expect(prospect.lastName).toBe('Lim');
    expect(prospect.leadSource).toBe('call_bot');
    expect(prospect.retellCallId).toBe(payload.call_id);
    expect(prospect.campaignId).toBe(retellCampaign.id);

    // ProspectActivity
    const activities = await ProspectActivity.findAll({
      where: { prospectId, type: 'created' }
    });
    expect(activities.length).toBeGreaterThanOrEqual(1);
    expect(activities[0].metadata.source).toBe('retell_webhook');

    // IdempotencyKey
    const key = await IdempotencyKey.findOne({
      where: { key: payload.call_id, scope: 'retell:call' }
    });
    expect(key).not.toBeNull();
    expect(key.responseBody.prospectId).toBe(prospectId);
  });

  it('webhook payload maps correctly to edge function lead INSERT fields', async () => {
    const payload = buildCallPayload();
    await postWebhook(payload);

    const payloads = await waitForPayloads(1);
    const lead = payloads[0].body.data.lead;

    // Edge function builds full_name from firstName + lastName
    expect(lead.firstName).toBeTruthy();
    // externalId is used as dedup key (external_id + source_name='mktr')
    expect(typeof lead.externalId).toBe('string');
    expect(lead.externalId.length).toBeGreaterThan(0);
    // phone must be present for the edge function to store it
    expect(lead.phone).toMatch(/^\+65/);
    // sourceMetadata.retellCallId must be present (used for recording/transcript)
    expect(lead.sourceMetadata.retellCallId).toBeDefined();
  });

  it('dispatches webhook delivery record to DB with success status', async () => {
    const payload = buildCallPayload();
    await postWebhook(payload);
    await waitForPayloads(1);

    // Small delay for DB write to propagate
    await new Promise(r => setTimeout(r, 200));

    const deliveries = await WebhookDelivery.findAll({
      where: { eventType: 'lead.created', status: 'success' }
    });
    expect(deliveries.length).toBeGreaterThanOrEqual(1);

    const delivery = deliveries[0];
    expect(delivery.responseCode).toBe(200);
    expect(delivery.attempts).toBe(1);
    expect(delivery.payload.event).toBe('lead.created');
    expect(delivery.payload.data.lead.externalId).toBeDefined();
  });

  it('duplicate Retell call does not trigger a second webhook dispatch', async () => {
    const payload = buildCallPayload();

    const res1 = await postWebhook(payload);
    expect(res1.body.status).toBe('created');
    await waitForPayloads(1);

    // Reset captured payloads before sending duplicate
    capturedPayloads = [];

    const res2 = await postWebhook(payload);
    expect(res2.body.status).toBe('duplicate');

    // Wait briefly — no new payload should arrive
    await new Promise(r => setTimeout(r, 500));
    expect(capturedPayloads).toHaveLength(0);
  });
});
