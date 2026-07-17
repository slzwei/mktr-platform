import { jest } from '@jest/globals';
import '../setup.js';
import { readFileSync } from 'node:fs';
import { makeWebhookService } from '../../src/services/webhookService.js';
import { signWebhookAttempt, signatureVersionForSubscriber } from '../../src/services/webhookSigning.js';

const vector = JSON.parse(readFileSync(new URL('../webhookSigningVector.json', import.meta.url), 'utf8'));
const payload = JSON.parse(vector.rawBody);

function delivery(id, subscriber) {
  return {
    id,
    deliveryId: payload.deliveryId,
    subscriberId: subscriber.id,
    eventType: payload.event,
    payload,
    attempts: 0,
    maxAttempts: 3,
    status: 'pending',
    subscriber,
    update: jest.fn().mockResolvedValue(true),
  };
}

describe('per-subscriber webhook signature versions', () => {
  const lyfe = {
    id: 'lyfe',
    name: 'Lyfe App',
    url: 'https://lyfe.example/webhook',
    secret: vector.secret,
    metadata: { destination: 'lyfe' },
  };
  const mktrLeads = {
    id: 'mktr-leads',
    name: 'MKTR Leads App',
    url: 'https://leads.example/webhook',
    secret: vector.secret,
    metadata: { destination: 'mktr_leads', signatureVersion: 'v2' },
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(vector.timestamp));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('matches the mirrored v1/v2 contract fixture', () => {
    expect(signWebhookAttempt({
      secret: vector.secret,
      rawBody: vector.rawBody,
      timestamp: vector.timestamp,
      signatureVersion: 'v1',
    })).toBe(vector.v1Signature);
    expect(signWebhookAttempt({
      secret: vector.secret,
      rawBody: vector.rawBody,
      timestamp: vector.timestamp,
      signatureVersion: 'v2',
    })).toBe(vector.v2Signature);
  });

  it('defaults absent and unknown metadata to byte-identical v1 behavior', () => {
    expect(signatureVersionForSubscriber(lyfe)).toBe('v1');
    expect(signatureVersionForSubscriber({ metadata: { signatureVersion: 'typo' } })).toBe('v1');
    expect(signatureVersionForSubscriber(mktrLeads)).toBe('v2');
  });

  it('keeps Lyfe on v1 and mktr_leads on v2 for one event and later attempts', async () => {
    const fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const service = makeWebhookService({
      fetch,
      WebhookSubscriber: { findAll: jest.fn() },
      WebhookDelivery: {},
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    });
    const lyfeDelivery = delivery('delivery-lyfe', lyfe);
    const mktrDelivery = delivery('delivery-mktr', mktrLeads);

    await service.attemptDelivery(lyfeDelivery, lyfe);
    await service.attemptDelivery(mktrDelivery, mktrLeads);
    // Exercise the same attempt path used by scheduled, recovered, and manual retries.
    await service.attemptDelivery(lyfeDelivery, lyfe);
    await service.attemptDelivery(mktrDelivery, mktrLeads);

    expect(fetch).toHaveBeenCalledTimes(4);
    for (const index of [0, 2]) {
      const options = fetch.mock.calls[index][1];
      expect(options.headers['X-Webhook-Signature']).toBe(vector.v1Signature);
      expect(options.headers['X-Webhook-Signature-Version']).toBeUndefined();
      expect(options.body).toBe(vector.rawBody);
    }
    for (const index of [1, 3]) {
      const options = fetch.mock.calls[index][1];
      expect(options.headers['X-Webhook-Signature']).toBe(vector.v2Signature);
      expect(options.headers['X-Webhook-Signature-Version']).toBe('v2');
      expect(options.body).toBe(vector.rawBody);
    }
  });

  it.each([
    ['Lyfe', lyfe, undefined],
    ['mktr_leads', mktrLeads, 'v2'],
  ])('preserves the %s subscriber version on an automatic retry', async (_name, subscriber, expectedVersion) => {
    const fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'retry' })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const service = makeWebhookService({
      fetch,
      WebhookSubscriber: { findAll: jest.fn() },
      WebhookDelivery: {},
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    });
    const retrying = delivery(`automatic-${subscriber.id}`, subscriber);
    retrying.maxAttempts = 2;
    retrying.update.mockImplementation(async (updates) => Object.assign(retrying, updates));

    await service.attemptDelivery(retrying, subscriber);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(fetch).toHaveBeenCalledTimes(2);
    for (const call of fetch.mock.calls) {
      expect(call[1].headers['X-Webhook-Signature-Version']).toBe(expectedVersion);
    }
  });

  it.each([
    ['Lyfe', lyfe, undefined],
    ['mktr_leads', mktrLeads, 'v2'],
  ])('preserves the %s subscriber version on a manual retry', async (_name, subscriber, expectedVersion) => {
    const fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const retried = delivery(`manual-${subscriber.id}`, subscriber);
    const service = makeWebhookService({
      fetch,
      WebhookSubscriber: { findAll: jest.fn() },
      WebhookDelivery: { findByPk: jest.fn().mockResolvedValue(retried) },
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    });

    await service.retryDelivery(retried.id);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers['X-Webhook-Signature-Version']).toBe(expectedVersion);
  });
});
