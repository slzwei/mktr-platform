/**
 * P3-5: the hot-path counters actually move.
 *
 * The gap this closes is that several conditions in this system are only
 * visible as an ABSENCE. "A starving rotation shows up as a persistent zero" —
 * and you cannot grep for a log line that never got written. These signals turn
 * that into a number you can watch.
 *
 * So the tests that matter are the ones proving the numbers move on the real
 * paths: a capture increments capture, a held lead increments held and NOT
 * delivered, a webhook attempt records a latency sample, and an exhausted
 * external call is counted as failed while a 4xx is not.
 */
import request from 'supertest';
import { getApp, closeDb, createTestUser, createTestCampaign } from './helpers.js';
import {
  incCounter, observeDuration, resetMetrics, metricKey,
  getCountersSnapshot, getDurationsSnapshot, getMetricsSnapshot,
} from '../src/services/observability.js';
import { retryingFetch } from '../src/utils/externalFetch.js';
import { randomUUID } from 'crypto';
import { WebhookSubscriber, WebhookDelivery } from '../src/models/index.js';
import { makeWebhookService } from '../src/services/webhookService.js';

let app, admin, campaign, subscriber;
const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

beforeAll(async () => {
  app = await getApp();
  admin = await createTestUser({ role: 'admin' });
  campaign = await createTestCampaign(admin.user.id, { name: 'Metrics Campaign' });
  subscriber = await WebhookSubscriber.create({
    name: 'Metrics Receiver', url: 'https://receiver.test/hook', secret: 'shhh',
    events: ['lead.created'], enabled: true,
  });
});

afterAll(async () => {
  await WebhookDelivery.destroy({ where: { subscriberId: subscriber.id } });
  await subscriber.destroy();
  await closeDb();
});

/** A delivery ready to send, so attemptDelivery does the real thing. */
const pendingDelivery = (over = {}) => WebhookDelivery.create({
  subscriberId: subscriber.id, deliveryId: randomUUID(), eventType: 'lead.created',
  payload: { event: 'lead.created', data: { id: 'lead-1' } },
  status: 'pending', attempts: 0, maxAttempts: 1, ...over,
});

describe('webhook delivery records latency and outcome', () => {
  beforeEach(() => resetMetrics());

  it('counts an attempt and times a successful send', async () => {
    const row = await pendingDelivery();
    const svc = makeWebhookService({
      logger: silent,
      fetch: async () => ({ ok: true, status: 200, text: async () => 'ok' }),
    });

    await svc.attemptDelivery(row, subscriber);

    const c = getCountersSnapshot();
    expect(c['webhook.delivery.attempted{event=lead.created}']).toBe(1);
    expect(c['webhook.delivery.failed{event=lead.created}']).toBeUndefined();
    expect(getDurationsSnapshot()['webhook.delivery.duration{event=lead.created,outcome=ok}'].count).toBe(1);
  });

  it('separates a timeout from an HTTP error in the latency distribution', async () => {
    // A dying receiver times out; a broken one 500s. They need different rows
    // or p95 tells you nothing about which is happening.
    const httpRow = await pendingDelivery();
    await makeWebhookService({
      logger: silent,
      fetch: async () => ({ ok: false, status: 500, text: async () => 'boom' }),
    }).attemptDelivery(httpRow, subscriber);

    const abortRow = await pendingDelivery();
    await makeWebhookService({
      logger: silent,
      fetch: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; },
    }).attemptDelivery(abortRow, subscriber);

    const d = getDurationsSnapshot();
    expect(d['webhook.delivery.duration{event=lead.created,outcome=http_error}'].count).toBe(1);
    expect(d['webhook.delivery.duration{event=lead.created,outcome=timeout}'].count).toBe(1);
    // Both funnel through handleFailure, so the failure count sees both.
    expect(getCountersSnapshot()['webhook.delivery.failed{event=lead.created}']).toBe(2);
  });
});

describe('the metrics sink', () => {
  beforeEach(() => resetMetrics());

  it('renders labels as a stable, greppable suffix', () => {
    // Sorted, so the same label set is always the same key — otherwise the
    // "same" metric splits into two rows and both look half as busy.
    expect(metricKey('lead.held', { reason: 'dnc_pending' })).toBe('lead.held{reason=dnc_pending}');
    expect(metricKey('x', { b: 2, a: 1 })).toBe('x{a=1,b=2}');
    expect(metricKey('x', null)).toBe('x');
  });

  it('drops empty labels instead of writing the word undefined', () => {
    expect(metricKey('x', { a: 1, b: undefined, c: null, d: '' })).toBe('x{a=1}');
  });

  it('accumulates counters per label set', () => {
    incCounter('lead.held', 1, { reason: 'no_funded_agent' });
    incCounter('lead.held', 1, { reason: 'no_funded_agent' });
    incCounter('lead.held', 1, { reason: 'dnc_pending' });

    expect(getCountersSnapshot()).toMatchObject({
      'lead.held{reason=no_funded_agent}': 2,
      'lead.held{reason=dnc_pending}': 1,
    });
  });

  it('summarises latency rather than keeping every sample forever', () => {
    for (const ms of [10, 20, 30, 40, 100]) observeDuration('webhook.delivery.duration', ms);

    const d = getDurationsSnapshot()['webhook.delivery.duration'];
    expect(d).toMatchObject({ count: 5, minMs: 10, maxMs: 100, totalMs: 200 });
    expect(d.p50Ms).toBe(30);
    expect(d.p95Ms).toBe(100);
  });

  it('ignores a nonsense duration instead of poisoning the metric', () => {
    // Observability must never be able to break the thing it observes.
    observeDuration('x', NaN);
    observeDuration('x', -5);
    observeDuration('x', undefined);
    expect(getDurationsSnapshot().x).toBeUndefined();
  });
});

describe('lead capture increments the capture counters', () => {
  beforeEach(() => resetMetrics());

  it('counts a delivered lead as captured AND delivered, never held', async () => {
    const res = await request(app)
      .post('/api/prospects')
      .send({
        firstName: 'Metric', lastName: 'Lead', phone: '+6591234501',
        email: 'metric1@test.com', campaignId: campaign.id, leadSource: 'website',
        consent_contact: true, consent_terms: true,
      });
    expect(res.status).toBeLessThan(300);

    const c = getCountersSnapshot();
    expect(c['lead.captured{source=website}']).toBe(1);
    // Exactly one of delivered/held fires — they partition every capture, which
    // is what makes "held climbing while delivered is flat" readable.
    const delivered = Object.entries(c).filter(([k]) => k.startsWith('lead.delivered'));
    const held = Object.entries(c).filter(([k]) => k.startsWith('lead.held'));
    expect(delivered.length + held.length).toBe(1);
  });

  it('labels the counter with the lead source', async () => {
    await request(app)
      .post('/api/prospects')
      .send({
        firstName: 'Metric', lastName: 'Two', phone: '+6591234502',
        email: 'metric2@test.com', campaignId: campaign.id, leadSource: 'qr_code',
        consent_contact: true, consent_terms: true,
      });

    expect(getCountersSnapshot()['lead.captured{source=qr_code}']).toBe(1);
  });
});

describe('external calls are measured at the shared transport', () => {
  beforeEach(() => resetMetrics());

  const okRes = { ok: true, status: 200 };

  it('records latency for a successful call, and no failure', async () => {
    await retryingFetch(async () => okRes, 'https://example.test/x', {}, { label: 'message_send', logPrefix: 'wa_graph' });

    const d = getDurationsSnapshot();
    expect(d['external.call.duration{dep=wa_graph,label=message_send,outcome=ok}'].count).toBe(1);
    expect(Object.keys(getCountersSnapshot())).toHaveLength(0);
  });

  it('does NOT count a 4xx as a dependency failure', async () => {
    // A bad template is our bug, not an outage. Counting it as failed would
    // make a deterministic config error look like Meta going down.
    await retryingFetch(async () => ({ ok: false, status: 400 }), 'https://example.test/x', {}, { label: 'message_send', logPrefix: 'wa_graph' });

    const c = getCountersSnapshot();
    expect(Object.keys(c).filter((k) => k.startsWith('external.call.failed'))).toHaveLength(0);
    expect(getDurationsSnapshot()['external.call.duration{dep=wa_graph,label=message_send,outcome=http_error}'].count).toBe(1);
  });

  it('counts an exhausted call as failed, and its retries on the way', async () => {
    const boom = async () => { const e = new Error('ECONNRESET'); throw e; };

    await expect(
      retryingFetch(boom, 'https://example.test/x', {}, {
        label: 'startRun', logPrefix: 'apify', attempts: 3, sleep: async () => {},
      })
    ).rejects.toThrow('ECONNRESET');

    const c = getCountersSnapshot();
    expect(c['external.call.failed{cause=network,dep=apify,label=startRun}']).toBe(1);
    expect(c['external.call.retried{cause=network,dep=apify,label=startRun}']).toBe(2);
  });
});

describe('GET /health/metrics', () => {
  it('serves the snapshot with uptime, counters and durations', async () => {
    resetMetrics();
    incCounter('lead.captured', 3, { source: 'website' });
    observeDuration('webhook.delivery.duration', 42, { event: 'lead.created' });

    const res = await request(app).get('/health/metrics');

    expect(res.status).toBe(200);
    expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(res.body.counters['lead.captured{source=website}']).toBe(3);
    expect(res.body.durations['webhook.delivery.duration{event=lead.created}']).toMatchObject({ count: 1, maxMs: 42 });
  });

  it('exposes names and numbers only — no payloads, no PII', async () => {
    const snap = getMetricsSnapshot();
    for (const v of Object.values(snap.counters)) expect(typeof v).toBe('number');
    for (const v of Object.values(snap.durations)) {
      expect(Object.values(v).every((n) => typeof n === 'number')).toBe(true);
    }
  });
});

/**
 * Round-3 regression: a label carrying an id is a memory leak.
 *
 * P3-5 shipped with the Apify client passing `apify GET /actor-runs/${runId}`,
 * so every Discovery run minted a permanent counter AND a permanent histogram
 * holding up to 512 samples. The "keep cardinality low" rule was documented and
 * still broken within hours, so it is enforced in the sink now, not just
 * written down.
 */
describe('metric key cardinality is bounded', () => {
  beforeEach(() => resetMetrics());

  it('templates ids out of the Apify label instead of interpolating them', async () => {
    const { makeApifyClient } = await import('../src/services/redeemOps/discovery/apifyClient.js');
    const client = makeApifyClient({
      token: 't', baseUrl: 'https://api.test',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: { id: 'r1' } }) }),
      logger: silent, sleep: async () => {},
    });

    await client.getRun('run-abcdef123456');
    await client.getRun('run-zzzzzz999999');

    // Two different runs, ONE metric key.
    const keys = Object.keys(getDurationsSnapshot()).filter((k) => k.includes('apify'));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain('/actor-runs/:id');
    expect(keys[0]).not.toContain('abcdef');
  });

  it('stops minting new keys past the cap but keeps updating existing ones', () => {
    for (let i = 0; i < 600; i += 1) incCounter('leaky', 1, { id: `id-${i}` });

    const snap = getCountersSnapshot();
    // Bounded, not unbounded.
    expect(Object.keys(snap).length).toBeLessThanOrEqual(501);
    // The drop is COUNTED, not silent — telemetry going blind unnoticed is its
    // own outage.
    expect(snap['observability.keys_dropped']).toBeGreaterThan(0);

    // An already-tracked key must keep working, or the signals that matter go
    // dead the moment some unrelated caller floods the map.
    const before = snap['leaky{id=id-0}'];
    incCounter('leaky', 5, { id: 'id-0' });
    expect(getCountersSnapshot()['leaky{id=id-0}']).toBe(before + 5);
  });

  it('caps durations the same way', () => {
    for (let i = 0; i < 600; i += 1) observeDuration('leaky.duration', 10, { id: `id-${i}` });
    expect(Object.keys(getDurationsSnapshot()).length).toBeLessThanOrEqual(500);
  });
});
