import './setup.js';
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js';
import request from 'supertest';
import { WebhookSubscriber, WebhookDelivery } from '../src/models/index.js';

let app, admin, token;

beforeAll(async () => {
  app = await getApp();
  const result = await createTestUser({ role: 'admin' });
  admin = result.user;
  token = result.token;
});

afterAll(async () => {
  await closeDb();
});

describe('Webhook Admin API', () => {
  let subscriberId;

  test('POST /api/admin/webhooks/subscribers — create subscriber', async () => {
    const res = await request(app)
      .post('/api/admin/webhooks/subscribers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Subscriber',
        url: 'https://example.com/webhook',
        secret: 'test-secret-123',
        events: ['lead.created'],
        enabled: true
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Test Subscriber');
    subscriberId = res.body.data.id;
  });

  test('GET /api/admin/webhooks/subscribers — list subscribers', async () => {
    const res = await request(app)
      .get('/api/admin/webhooks/subscribers')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('PUT /api/admin/webhooks/subscribers/:id — update subscriber', async () => {
    const res = await request(app)
      .put(`/api/admin/webhooks/subscribers/${subscriberId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Subscriber' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Subscriber');
  });

  test('POST /api/admin/webhooks/subscribers — requires name, url, secret', async () => {
    const res = await request(app)
      .post('/api/admin/webhooks/subscribers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Missing Fields' });

    expect(res.status).toBe(400);
  });

  test('DELETE /api/admin/webhooks/subscribers/:id — delete subscriber', async () => {
    const res = await request(app)
      .delete(`/api/admin/webhooks/subscribers/${subscriberId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  test('GET /api/admin/webhooks/deliveries — list deliveries', async () => {
    const res = await request(app)
      .get('/api/admin/webhooks/deliveries')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('deliveries');
    expect(res.body.data).toHaveProperty('pagination');
  });

  test('Requires admin auth', async () => {
    const { token: agentToken } = await createTestUser({ role: 'agent' });

    const res = await request(app)
      .get('/api/admin/webhooks/subscribers')
      .set('Authorization', `Bearer ${agentToken}`);

    expect(res.status).toBe(403);
  });
});

describe('Webhook Service', () => {
  test('dispatchEvent does not throw when no subscribers', async () => {
    const { dispatchEvent } = await import('../src/services/webhookService.js');

    // With WEBHOOK_ENABLED=false (default), should silently return
    await expect(dispatchEvent('lead.created', () => ({ test: true }))).resolves.not.toThrow();
  });

  test('dispatchEvent skips disabled subscribers', async () => {
    // Create a disabled subscriber
    await WebhookSubscriber.create({
      name: 'Disabled Sub',
      url: 'https://example.com/disabled',
      secret: 'secret',
      events: ['lead.created'],
      enabled: false
    });

    // Even with WEBHOOK_ENABLED=true, disabled subs are skipped
    const origEnv = process.env.WEBHOOK_ENABLED;
    process.env.WEBHOOK_ENABLED = 'true';

    const { dispatchEvent } = await import('../src/services/webhookService.js');
    await dispatchEvent('lead.created', () => ({ test: true }));

    // No deliveries should be created for disabled subscriber
    const deliveries = await WebhookDelivery.findAll();
    const hasDisabled = deliveries.some(d => d.payload?.test === true);
    // The disabled subscriber should not have received a delivery
    expect(hasDisabled).toBe(false);

    process.env.WEBHOOK_ENABLED = origEnv;
  });
});
