import crypto from 'crypto';
import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from '../helpers.js';
import { Prospect, IdempotencyKey, Campaign, ProspectActivity } from '../../src/models/index.js';

/**
 * Integration tests for the Retell AI webhook pipeline.
 *
 * Covers: POST /api/retell/webhook  (prospect creation, idempotency,
 *         skip guards, audit trail)
 *         GET  /api/retell/recording/:prospectId
 */

const WEBHOOK_SECRET = 'integ-retell-secret';
const RUN = Date.now();

let app, adminUser, adminToken, retellCampaign;

beforeAll(async () => {
  process.env.RETELL_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.WEBHOOK_ENABLED = 'false'; // prevent external dispatch

  app = await getApp();

  // Admin user for authenticated endpoints
  const admin = await createTestUser({ role: 'admin' });
  adminUser = admin.user;
  adminToken = admin.token;

  // Create a [Retell] campaign that the service resolves by naming convention
  retellCampaign = await Campaign.create({
    name: '[Retell] Test Agent',
    createdBy: adminUser.id,
    status: 'active',
    type: 'lead_generation',
    is_active: true,
    min_age: 18,
    max_age: 65
  });
}, 20000);

afterAll(async () => {
  await closeDb();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function signRetellPayload(body, secret) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const hmac = crypto.createHmac('sha256', secret).update(`${timestamp}.${bodyStr}`).digest('hex');
  return `v=${timestamp},d=${hmac}`;
}

let callSeq = 0;
function buildCallPayload(overrides = {}) {
  callSeq++;
  return {
    call_id: `call_integ_${RUN}_${callSeq}`,
    call_type: 'phone_call',
    call_status: 'ended',
    agent_id: 'agent_integ_001',
    agent_name: 'Test Agent',
    from_number: '+6531295909',
    to_number: `+6591${String(RUN).slice(-6)}`,
    duration_ms: 45000,
    disconnection_reason: 'agent_hangup',
    transcript: 'Agent: Hello, how can I help?\nUser: I need info on CareShield.',
    retell_llm_dynamic_variables: { name: 'Jane Tan' },
    call_analysis: {
      call_successful: true,
      call_summary: 'Caller interested in CareShield product.',
      user_sentiment: 'Positive',
      custom_analysis_data: {},
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

describe('POST /api/retell/webhook', () => {
  afterEach(async () => {
    // Clean up prospects and idempotency keys created during each test
    await Prospect.destroy({ where: { leadSource: 'call_bot' }, force: true });
    await IdempotencyKey.destroy({ where: { scope: 'retell:call' } });
  });

  it('creates a prospect from a valid call payload', async () => {
    const payload = buildCallPayload();
    const res = await postWebhook(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('created');
    expect(res.body.prospectId).toBeDefined();

    // Verify persisted prospect
    const prospect = await Prospect.findByPk(res.body.prospectId);
    expect(prospect).not.toBeNull();
    expect(prospect.firstName).toBe('Jane');
    expect(prospect.lastName).toBe('Tan');
    expect(prospect.phone).toBe(payload.to_number);
    expect(prospect.leadSource).toBe('call_bot');
    expect(prospect.leadStatus).toBe('new');
    expect(prospect.priority).toBe('high'); // Positive sentiment
    expect(prospect.retellCallId).toBe(payload.call_id);
    expect(prospect.sourceMetadata.retellCallId).toBe(payload.call_id);
    expect(prospect.sourceMetadata.sentiment).toBe('Positive');
    expect(prospect.campaignId).toBe(retellCampaign.id);
  });

  it('skips a call whose call_status is not "ended"', async () => {
    const payload = buildCallPayload({ call_status: 'in_progress' });
    const res = await postWebhook(payload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('skipped');
    expect(res.body.reason).toBe('call_not_ended');

    // No prospect should be created
    const count = await Prospect.count({ where: { retellCallId: payload.call_id } });
    expect(count).toBe(0);
  });

  it('skips a call where call_successful is false', async () => {
    const payload = buildCallPayload({
      call_analysis: {
        call_successful: false,
        user_sentiment: 'Negative',
        call_summary: 'User was not interested.'
      }
    });
    const res = await postWebhook(payload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('skipped');
    expect(res.body.reason).toBe('call_not_successful');
  });

  it('returns duplicate when the same call_id is sent twice', async () => {
    const payload = buildCallPayload();

    const res1 = await postWebhook(payload);
    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe('created');

    const res2 = await postWebhook(payload);
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('duplicate');
    expect(res2.body.prospectId).toBe(res1.body.prospectId);

    // Only one prospect row exists
    const count = await Prospect.count({ where: { retellCallId: payload.call_id } });
    expect(count).toBe(1);
  });

  it('creates a ProspectActivity audit trail entry', async () => {
    const payload = buildCallPayload();
    const res = await postWebhook(payload);
    expect(res.body.status).toBe('created');

    const activities = await ProspectActivity.findAll({
      where: { prospectId: res.body.prospectId, type: 'created' }
    });

    expect(activities.length).toBeGreaterThanOrEqual(1);
    const activity = activities[0];
    expect(activity.description).toContain('Retell AI');
    expect(activity.metadata.source).toBe('retell_webhook');
    expect(activity.metadata.callId).toBe(payload.call_id);
  });
});

describe('GET /api/retell/recording/:prospectId', () => {
  it('returns recordingUrl from sourceMetadata when present', async () => {
    const payload = buildCallPayload({ recording_url: 'https://storage.retellai.com/recording/abc123.wav' });
    const webhookRes = await postWebhook(payload);
    expect(webhookRes.body.status).toBe('created');

    const res = await request(app)
      .get(`/api/retell/recording/${webhookRes.body.prospectId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.recordingUrl).toBe('https://storage.retellai.com/recording/abc123.wav');

    // Clean up
    await Prospect.destroy({ where: { id: webhookRes.body.prospectId }, force: true });
    await IdempotencyKey.destroy({ where: { scope: 'retell:call' } });
  });

  it('returns 404 for a non-existent prospect', async () => {
    const res = await request(app)
      .get('/api/retell/recording/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for a prospect that is not from Retell', async () => {
    const campaign = await createTestCampaign(adminUser.id);
    const prospect = await createTestProspect(campaign.id, {
      leadSource: 'qr_code',
      sourceMetadata: {} // no retellCallId
    });

    const res = await request(app)
      .get(`/api/retell/recording/${prospect.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});
