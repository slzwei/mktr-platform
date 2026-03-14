import './setup.js';
import crypto from 'crypto';
import { getApp, closeDb, createTestUser } from './helpers.js';
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

describe('Webhook Dead-Letter & Stats API', () => {
  let subscriberId;

  beforeAll(async () => {
    // Create a subscriber with some failed deliveries
    const res = await request(app)
      .post('/api/admin/webhooks/subscribers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'DL Test Subscriber',
        url: 'https://example.com/dl-test',
        secret: 'dl-secret',
        events: ['lead.created'],
        enabled: true
      });
    subscriberId = res.body.data.id;

    // Create failed deliveries directly
    await WebhookDelivery.bulkCreate([
      { subscriberId, deliveryId: crypto.randomUUID(), eventType: 'lead.created', payload: {}, status: 'failed', attempts: 3, maxAttempts: 3 },
      { subscriberId, deliveryId: crypto.randomUUID(), eventType: 'lead.created', payload: {}, status: 'failed', attempts: 3, maxAttempts: 3 },
      { subscriberId, deliveryId: crypto.randomUUID(), eventType: 'lead.created', payload: {}, status: 'success', attempts: 1, maxAttempts: 3 },
    ]);
  });

  test('GET /api/admin/webhooks/deliveries/dead-letter — lists failed grouped by subscriber', async () => {
    const res = await request(app)
      .get('/api/admin/webhooks/deliveries/dead-letter')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    // At least our subscriber should have failed deliveries
    const group = res.body.data.find(g => g.subscriber.id === subscriberId);
    expect(group).toBeDefined();
    expect(group.deliveries.length).toBe(2);
  });

  test('GET /api/admin/webhooks/stats — returns per-subscriber stats', async () => {
    const res = await request(app)
      .get('/api/admin/webhooks/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const stat = res.body.data.find(s => s.subscriber.id === subscriberId);
    expect(stat).toBeDefined();
    expect(stat.last24h).toHaveProperty('success');
    expect(stat.last24h).toHaveProperty('failed');
    expect(stat.last24h).toHaveProperty('pending');
    expect(stat.last30d.total).toBeGreaterThanOrEqual(3);
  });

  test('POST /api/admin/webhooks/deliveries/dead-letter/purge — purges old failures', async () => {
    const res = await request(app)
      .post('/api/admin/webhooks/deliveries/dead-letter/purge')
      .set('Authorization', `Bearer ${token}`)
      .send({ maxAgeDays: 0 }); // purge all

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBeGreaterThanOrEqual(2);
  });

  afterAll(async () => {
    // Clean up
    await WebhookDelivery.destroy({ where: { subscriberId } });
    await WebhookSubscriber.destroy({ where: { id: subscriberId } });
  });
});

describe('Webhook Service', () => {
  test('dispatchEvent does not throw when no subscribers', async () => {
    const { dispatchEvent } = await import('../src/services/webhookService.js');

    // With WEBHOOK_ENABLED=false (default), should silently return
    await expect(dispatchEvent('lead.created', () => ({ test: true }))).resolves.not.toThrow();
  });

  test('dispatchEvent skips disabled subscribers', async () => {
    // Clean slate: remove all subscribers and deliveries
    await WebhookDelivery.destroy({ where: {} });
    await WebhookSubscriber.destroy({ where: {} });

    // Create a disabled subscriber
    const disabledSub = await WebhookSubscriber.create({
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

    // No deliveries should be created for the disabled subscriber
    const deliveries = await WebhookDelivery.findAll({
      where: { subscriberId: disabledSub.id }
    });
    expect(deliveries.length).toBe(0);

    process.env.WEBHOOK_ENABLED = origEnv;
  });
});

// ──────────────────────────────────────────────────────────────────
// Additional coverage below
// ──────────────────────────────────────────────────────────────────

describe('Webhook Subscriber CRUD — extended', () => {
  let subId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/admin/webhooks/subscribers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Extended CRUD Sub',
        url: 'https://example.com/ext-crud',
        secret: 'ext-secret-123',
        events: ['lead.created', 'qr.scanned'],
        enabled: true,
        description: 'For extended tests'
      });
    subId = res.body.data.id;
  });

  afterAll(async () => {
    await WebhookDelivery.destroy({ where: { subscriberId: subId } }).catch(() => {});
    await WebhookSubscriber.destroy({ where: { id: subId } }).catch(() => {});
  });

  test('GET /api/admin/webhooks/subscribers lists the created subscriber', async () => {
    const res = await request(app)
      .get('/api/admin/webhooks/subscribers')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const match = res.body.data.find(s => s.id === subId);
    expect(match).toBeDefined();
    expect(match.events).toEqual(expect.arrayContaining(['lead.created', 'qr.scanned']));
    expect(match.description).toBe('For extended tests');
  });

  test('PUT updates events list and description', async () => {
    const res = await request(app)
      .put(`/api/admin/webhooks/subscribers/${subId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ events: ['lead.created'], description: 'Updated desc' });

    expect(res.status).toBe(200);
    expect(res.body.data.events).toEqual(['lead.created']);
    expect(res.body.data.description).toBe('Updated desc');
  });

  test('PUT can toggle enabled flag', async () => {
    const res = await request(app)
      .put(`/api/admin/webhooks/subscribers/${subId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(false);

    // Re-enable for subsequent tests
    await request(app)
      .put(`/api/admin/webhooks/subscribers/${subId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true });
  });

  test('PUT to non-existent subscriber returns 404', async () => {
    const res = await request(app)
      .put('/api/admin/webhooks/subscribers/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });

  test('DELETE non-existent subscriber returns 404', async () => {
    const res = await request(app)
      .delete('/api/admin/webhooks/subscribers/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('Webhook Validation', () => {
  test('POST missing url returns 400', async () => {
    const res = await request(app)
      .post('/api/admin/webhooks/subscribers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'No URL', secret: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('POST missing secret returns 400', async () => {
    const res = await request(app)
      .post('/api/admin/webhooks/subscribers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'No Secret', url: 'https://example.com/hook' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('POST missing name returns 400', async () => {
    const res = await request(app)
      .post('/api/admin/webhooks/subscribers')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'https://example.com/hook', secret: 'abc' });

    expect(res.status).toBe(400);
  });

  test('POST empty body returns 400', async () => {
    const res = await request(app)
      .post('/api/admin/webhooks/subscribers')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('Webhook Secret Rotation', () => {
  let subId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/admin/webhooks/subscribers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Secret Rotation Sub',
        url: 'https://example.com/secret-rotate',
        secret: 'original-secret',
        events: ['lead.created']
      });
    subId = res.body.data.id;
  });

  afterAll(async () => {
    await WebhookSubscriber.destroy({ where: { id: subId } }).catch(() => {});
  });

  test('PUT can change the secret (rotation)', async () => {
    const newSecret = `rotated-${crypto.randomUUID().slice(0, 8)}`;
    const res = await request(app)
      .put(`/api/admin/webhooks/subscribers/${subId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ secret: newSecret });

    expect(res.status).toBe(200);
    // Verify secret persisted
    const sub = await WebhookSubscriber.findByPk(subId);
    expect(sub.secret).toBe(newSecret);
  });
});

describe('Webhook Delivery Filtering & Detail', () => {
  let subId;
  let deliveryIds = [];

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/admin/webhooks/subscribers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Delivery Filter Sub',
        url: 'https://example.com/delivery-filter',
        secret: 'filter-secret',
        events: ['lead.created', 'qr.scanned']
      });
    subId = res.body.data.id;

    // Create deliveries with different statuses and event types
    const created = await WebhookDelivery.bulkCreate([
      { subscriberId: subId, deliveryId: crypto.randomUUID(), eventType: 'lead.created', payload: { a: 1 }, status: 'success', attempts: 1, maxAttempts: 3 },
      { subscriberId: subId, deliveryId: crypto.randomUUID(), eventType: 'lead.created', payload: { a: 2 }, status: 'failed', attempts: 3, maxAttempts: 3, errorMessage: 'HTTP 500' },
      { subscriberId: subId, deliveryId: crypto.randomUUID(), eventType: 'qr.scanned', payload: { a: 3 }, status: 'pending', attempts: 0, maxAttempts: 3 },
    ]);
    deliveryIds = created.map(d => d.id);
  });

  afterAll(async () => {
    await WebhookDelivery.destroy({ where: { subscriberId: subId } });
    await WebhookSubscriber.destroy({ where: { id: subId } });
  });

  test('GET deliveries with status filter', async () => {
    const res = await request(app)
      .get('/api/admin/webhooks/deliveries?status=failed')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const allFailed = res.body.data.deliveries.every(d => d.status === 'failed');
    expect(allFailed).toBe(true);
  });

  test('GET deliveries filtered by subscriberId', async () => {
    const res = await request(app)
      .get(`/api/admin/webhooks/deliveries?subscriberId=${subId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deliveries.length).toBe(3);
    const allBelongToSub = res.body.data.deliveries.every(d => d.subscriberId === subId);
    expect(allBelongToSub).toBe(true);
  });

  test('GET deliveries filtered by eventType', async () => {
    const res = await request(app)
      .get(`/api/admin/webhooks/deliveries?eventType=qr.scanned&subscriberId=${subId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deliveries.length).toBe(1);
    expect(res.body.data.deliveries[0].eventType).toBe('qr.scanned');
  });

  test('GET deliveries pagination returns correct metadata', async () => {
    const res = await request(app)
      .get(`/api/admin/webhooks/deliveries?subscriberId=${subId}&limit=2&page=1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deliveries.length).toBe(2);
    expect(res.body.data.pagination.totalItems).toBe(3);
    expect(res.body.data.pagination.totalPages).toBe(2);
    expect(res.body.data.pagination.currentPage).toBe(1);
  });

  test('GET single delivery by ID', async () => {
    const res = await request(app)
      .get(`/api/admin/webhooks/deliveries/${deliveryIds[0]}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(deliveryIds[0]);
    expect(res.body.data.subscriber).toBeDefined();
    expect(res.body.data.subscriber.name).toBe('Delivery Filter Sub');
  });

  test('GET non-existent delivery returns 404', async () => {
    const res = await request(app)
      .get('/api/admin/webhooks/deliveries/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('Webhook Retry Endpoints', () => {
  let subId;
  let failedDeliveryId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/admin/webhooks/subscribers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Retry Test Sub',
        url: 'https://example.com/retry-test',
        secret: 'retry-secret',
        events: ['lead.created']
      });
    subId = res.body.data.id;

    const delivery = await WebhookDelivery.create({
      subscriberId: subId,
      deliveryId: crypto.randomUUID(),
      eventType: 'lead.created',
      payload: { test: 'retry' },
      status: 'failed',
      attempts: 3,
      maxAttempts: 3,
      errorMessage: 'HTTP 500'
    });
    failedDeliveryId = delivery.id;
  });

  afterAll(async () => {
    await WebhookDelivery.destroy({ where: { subscriberId: subId } });
    await WebhookSubscriber.destroy({ where: { id: subId } });
  });

  test('POST retry-all without subscriberId returns 400', async () => {
    const res = await request(app)
      .post('/api/admin/webhooks/deliveries/retry-all')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('POST retry-all with subscriberId succeeds', async () => {
    const res = await request(app)
      .post('/api/admin/webhooks/deliveries/retry-all')
      .set('Authorization', `Bearer ${token}`)
      .send({ subscriberId: subId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Webhook Auth — role enforcement', () => {
  let agentToken;
  let driverToken;

  beforeAll(async () => {
    const agent = await createTestUser({ role: 'agent' });
    agentToken = agent.token;
    const driver = await createTestUser({ role: 'driver_partner' });
    driverToken = driver.token;
  });

  test('agent cannot list subscribers', async () => {
    const res = await request(app)
      .get('/api/admin/webhooks/subscribers')
      .set('Authorization', `Bearer ${agentToken}`);
    expect(res.status).toBe(403);
  });

  test('agent cannot create subscriber', async () => {
    const res = await request(app)
      .post('/api/admin/webhooks/subscribers')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ name: 'Rogue', url: 'https://evil.com', secret: 'x', events: [] });
    expect(res.status).toBe(403);
  });

  test('driver_partner cannot access deliveries', async () => {
    const res = await request(app)
      .get('/api/admin/webhooks/deliveries')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });

  test('driver_partner cannot access stats', async () => {
    const res = await request(app)
      .get('/api/admin/webhooks/stats')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });

  test('driver_partner cannot access dead-letter queue', async () => {
    const res = await request(app)
      .get('/api/admin/webhooks/deliveries/dead-letter')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });

  test('unauthenticated request is rejected', async () => {
    const res = await request(app)
      .get('/api/admin/webhooks/subscribers');
    expect(res.status).toBe(401);
  });
});

describe('Webhook Service — dispatchEvent with matching subscribers', () => {
  let subId;
  const origEnv = process.env.WEBHOOK_ENABLED;

  beforeAll(async () => {
    await WebhookDelivery.destroy({ where: {} });
    await WebhookSubscriber.destroy({ where: {} });

    const sub = await WebhookSubscriber.create({
      name: 'Dispatch Test Sub',
      url: 'https://httpbin.org/status/200', // unreachable in test, but delivery row is created
      secret: 'dispatch-secret',
      events: ['lead.created', 'qr.scanned'],
      enabled: true
    });
    subId = sub.id;

    process.env.WEBHOOK_ENABLED = 'true';
  });

  afterAll(async () => {
    process.env.WEBHOOK_ENABLED = origEnv;
    await WebhookDelivery.destroy({ where: { subscriberId: subId } });
    await WebhookSubscriber.destroy({ where: { id: subId } });
  });

  test('dispatchEvent creates a delivery for matched event', async () => {
    const { dispatchEvent } = await import('../src/services/webhookService.js');
    await dispatchEvent('lead.created', () => ({ leadId: 42 }));

    // Small delay to let fire-and-forget delivery row creation settle
    await new Promise(r => setTimeout(r, 200));

    const deliveries = await WebhookDelivery.findAll({ where: { subscriberId: subId, eventType: 'lead.created' } });
    expect(deliveries.length).toBeGreaterThanOrEqual(1);
    expect(deliveries[0].payload).toHaveProperty('leadId', 42);
    expect(deliveries[0].payload).toHaveProperty('deliveryId');
  });

  test('dispatchEvent does NOT create delivery for non-matching event', async () => {
    const before = await WebhookDelivery.count({ where: { subscriberId: subId, eventType: 'user.signup' } });

    const { dispatchEvent } = await import('../src/services/webhookService.js');
    await dispatchEvent('user.signup', () => ({ userId: 99 }));

    await new Promise(r => setTimeout(r, 200));

    const after = await WebhookDelivery.count({ where: { subscriberId: subId, eventType: 'user.signup' } });
    expect(after).toBe(before); // No new deliveries
  });

  test('dispatchEvent is silent when WEBHOOK_ENABLED is false', async () => {
    process.env.WEBHOOK_ENABLED = 'false';
    const countBefore = await WebhookDelivery.count({ where: { subscriberId: subId } });

    const { dispatchEvent } = await import('../src/services/webhookService.js');
    await dispatchEvent('lead.created', () => ({ x: 1 }));

    await new Promise(r => setTimeout(r, 200));

    const countAfter = await WebhookDelivery.count({ where: { subscriberId: subId } });
    expect(countAfter).toBe(countBefore);

    process.env.WEBHOOK_ENABLED = 'true'; // restore for other tests
  });
});
