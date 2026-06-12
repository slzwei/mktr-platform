/**
 * Route-level integration tests for POST /api/external/lead-outcomes.
 *
 * What the unit suites can't prove: that the route auto-mounts (meta.path),
 * that server_internal.js captures req.rawBody for the /api/external/ prefix
 * (a missing capture surfaces as 500, distinguishing it from 401 auth
 * failures), and that the full apply path writes the Prospect /
 * ProspectActivity / IdempotencyKey rows against a real schema.
 *
 * Needs the local test Postgres (see docker-compose.test.yml / test/setup.js).
 */
import crypto from 'crypto';
import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign, createTestProspect } from './helpers.js';
import { ProspectActivity, IdempotencyKey } from '../src/models/index.js';

const SECRET = 'test-external-outcome-secret';

let app;

beforeAll(async () => {
  process.env.EXTERNAL_OUTCOME_WEBHOOK_SECRET = SECRET;
  app = await getApp();
}, 15000);

afterAll(async () => {
  await closeDb();
});

function sign(rawBody, secret = SECRET) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function outcomeBody(externalId, mktrLeadsStatus, overrides = {}) {
  return JSON.stringify({
    event: 'lead.outcome',
    eventId: `${overrides.leadId || 'lead-1'}:${mktrLeadsStatus}`,
    timestamp: new Date().toISOString(),
    data: { externalId, sourceName: 'mktr', deliveryId: null, mktrLeadsStatus },
    ...overrides.top,
  });
}

function post(rawBody, headers = {}) {
  return request(app)
    .post('/api/external/lead-outcomes')
    .set('Content-Type', 'application/json')
    .set('X-Webhook-Signature', headers.signature ?? sign(rawBody))
    .send(rawBody);
}

describe('POST /api/external/lead-outcomes', () => {
  it('mounts and rejects an unsigned request with 401 (not 404, not 500)', async () => {
    const raw = outcomeBody('11111111-1111-4111-8111-111111111111', 'won');
    const res = await post(raw, { signature: 'sha256=deadbeef' });
    expect(res.status).toBe(401);
  });

  it('verifies the signature over the captured raw body and 422s an unknown prospect', async () => {
    const raw = outcomeBody('11111111-1111-4111-8111-111111111111', 'won');
    const res = await post(raw);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('unknown_prospect');
  });

  it('applies an outcome end-to-end for a mirror-delivered prospect', async () => {
    const { user } = await createTestUser({ role: 'agent', mktrLeadsId: crypto.randomUUID() });
    const campaign = await createTestCampaign(user.id);
    const prospect = await createTestProspect(campaign.id, {
      assignedAgentId: user.id,
      leadStatus: 'contacted',
    });

    const raw = outcomeBody(prospect.id, 'won', { leadId: prospect.id });
    const res = await post(raw);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, appliedLeadStatus: 'won', qualitySignal: false });

    await prospect.reload();
    expect(prospect.leadStatus).toBe('won');
    expect(prospect.conversionDate).not.toBeNull();

    const activity = await ProspectActivity.findOne({
      where: { prospectId: prospect.id, type: 'updated' },
      order: [['createdAt', 'DESC']],
    });
    expect(activity).not.toBeNull();
    expect(activity.metadata).toMatchObject({ source: 'mktr-leads', mktrLeadsStatus: 'won' });

    const key = await IdempotencyKey.findByPk(`external:outcome:${prospect.id}:won`);
    expect(key).not.toBeNull();
    expect(key.scope).toBe('external:outcome');

    // Replay: same eventId returns the stored response without a second activity.
    const replay = await post(outcomeBody(prospect.id, 'won', { leadId: prospect.id }));
    expect(replay.status).toBe(200);
    const activityCount = await ProspectActivity.count({ where: { prospectId: prospect.id, type: 'updated' } });
    expect(activityCount).toBe(1);
  });

  it('422s a prospect that was never delivered to MKTR Leads (internal agent, no mirror id)', async () => {
    const { user } = await createTestUser({ role: 'agent' });
    const campaign = await createTestCampaign(user.id);
    const prospect = await createTestProspect(campaign.id, { assignedAgentId: user.id });

    const res = await post(outcomeBody(prospect.id, 'won', { leadId: prospect.id }));
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('not_a_mktr_leads_prospect');
  });

  it('preserves the prospect status for a disputed signal', async () => {
    const { user } = await createTestUser({ role: 'agent', mktrLeadsId: crypto.randomUUID() });
    const campaign = await createTestCampaign(user.id);
    const prospect = await createTestProspect(campaign.id, {
      assignedAgentId: user.id,
      leadStatus: 'qualified',
    });

    const res = await post(outcomeBody(prospect.id, 'disputed', { leadId: prospect.id }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ appliedLeadStatus: 'qualified', qualitySignal: true });

    await prospect.reload();
    expect(prospect.leadStatus).toBe('qualified');
  });
});
