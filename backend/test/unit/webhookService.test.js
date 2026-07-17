import { jest } from '@jest/globals';
import '../setup.js';
import crypto from 'crypto';
import { makeWebhookService } from '../../src/services/webhookService.js';

// ── Helpers ──

function buildMocks() {
  const mockSubscriber = {
    id: 'sub-1',
    name: 'Test Subscriber',
    url: 'https://example.com/hook',
    secret: 'secret123',
    events: ['lead.created'],
    enabled: true,
    update: jest.fn().mockResolvedValue(true),
  };

  const mockDelivery = {
    id: 'del-1',
    deliveryId: 'uuid-1',
    subscriberId: 'sub-1',
    eventType: 'lead.created',
    payload: { event: 'lead.created', data: {} },
    attempts: 0,
    maxAttempts: 3,
    status: 'pending',
    subscriber: mockSubscriber,
    update: jest.fn().mockResolvedValue(true),
  };

  const WebhookSubscriber = {
    findAll: jest.fn().mockResolvedValue([mockSubscriber]),
    findOne: jest.fn(),
  };

  const WebhookDelivery = {
    create: jest.fn().mockResolvedValue({ ...mockDelivery }),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    destroy: jest.fn().mockResolvedValue(0),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const mockFetch = jest.fn();

  const Sentry = { captureMessage: jest.fn(), captureException: jest.fn() };

  return { mockSubscriber, mockDelivery, WebhookSubscriber, WebhookDelivery, logger, mockFetch, Sentry };
}

// ── Tests ──

describe('webhookService (unit)', () => {
  let mocks, service;
  const originalEnv = process.env.WEBHOOK_ENABLED;

  beforeEach(() => {
    jest.useFakeTimers({ legacyFakeTimers: true });
    mocks = buildMocks();
    service = makeWebhookService({
      WebhookSubscriber: mocks.WebhookSubscriber,
      WebhookDelivery: mocks.WebhookDelivery,
      logger: mocks.logger,
      fetch: mocks.mockFetch,
      Sentry: mocks.Sentry,
    });
  });

  afterEach(() => {
    process.env.WEBHOOK_ENABLED = originalEnv;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // ────────────────────────────────────────────────
  // dispatchEvent
  // ────────────────────────────────────────────────

  describe('dispatchEvent', () => {
    it('skips when WEBHOOK_ENABLED is not "true"', async () => {
      process.env.WEBHOOK_ENABLED = 'false';
      const builder = jest.fn();

      await service.dispatchEvent('lead.created', builder);

      expect(mocks.WebhookSubscriber.findAll).not.toHaveBeenCalled();
      expect(builder).not.toHaveBeenCalled();
    });

    it('skips when WEBHOOK_ENABLED is missing', async () => {
      delete process.env.WEBHOOK_ENABLED;
      const builder = jest.fn();

      await service.dispatchEvent('lead.created', builder);

      expect(mocks.WebhookSubscriber.findAll).not.toHaveBeenCalled();
    });

    it('filters subscribers by event type', async () => {
      process.env.WEBHOOK_ENABLED = 'true';

      // Subscriber only listens to lead.created, not lead.assigned
      await service.dispatchEvent('lead.assigned', jest.fn());

      // findAll is called, but no delivery is created since no subscriber matches
      expect(mocks.WebhookSubscriber.findAll).toHaveBeenCalled();
      expect(mocks.WebhookDelivery.create).not.toHaveBeenCalled();
    });

    it('builds payload lazily — payloadBuilder called once for multiple subscribers', async () => {
      process.env.WEBHOOK_ENABLED = 'true';
      const sub1 = { ...mocks.mockSubscriber, id: 'sub-1', events: ['lead.created'] };
      const sub2 = { ...mocks.mockSubscriber, id: 'sub-2', events: ['lead.created'] };
      mocks.WebhookSubscriber.findAll.mockResolvedValue([sub1, sub2]);

      const builder = jest.fn(() => ({ event: 'lead.created', data: { id: 1 } }));

      await service.dispatchEvent('lead.created', builder);

      // Builder called exactly once, not once per subscriber
      expect(builder).toHaveBeenCalledTimes(1);
      // But two deliveries are created
      expect(mocks.WebhookDelivery.create).toHaveBeenCalledTimes(2);
    });

    it('creates WebhookDelivery record for matched subscribers', async () => {
      process.env.WEBHOOK_ENABLED = 'true';
      const payload = { event: 'lead.created', data: { id: 'p1' } };
      const builder = jest.fn(() => payload);

      await service.dispatchEvent('lead.created', builder);

      expect(mocks.WebhookDelivery.create).toHaveBeenCalledTimes(1);
      const createArg = mocks.WebhookDelivery.create.mock.calls[0][0];
      expect(createArg.subscriberId).toBe('sub-1');
      expect(createArg.eventType).toBe('lead.created');
      expect(createArg.status).toBe('pending');
      expect(createArg.payload).toMatchObject(payload);
      // deliveryId is injected into payload
      expect(createArg.payload.deliveryId).toBeDefined();
    });

    it('does not throw on internal error — fire-and-forget', async () => {
      process.env.WEBHOOK_ENABLED = 'true';
      mocks.WebhookSubscriber.findAll.mockRejectedValue(new Error('DB down'));

      // Should not throw
      await service.dispatchEvent('lead.created', jest.fn());
      expect(mocks.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('dispatchEvent error'),
        expect.objectContaining({ error: 'DB down' })
      );
    });
  });

  // ────────────────────────────────────────────────
  // attemptDelivery
  // ────────────────────────────────────────────────

  describe('attemptDelivery', () => {
    it('sends POST with correct headers (HMAC signature, event type, delivery ID)', async () => {
      const delivery = { ...mocks.mockDelivery, update: jest.fn().mockResolvedValue(true) };
      const subscriber = { ...mocks.mockSubscriber };

      mocks.mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      });

      await service.attemptDelivery(delivery, subscriber);

      expect(mocks.mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mocks.mockFetch.mock.calls[0];
      expect(url).toBe('https://example.com/hook');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(opts.headers['X-Webhook-Event']).toBe('lead.created');
      expect(opts.headers['X-Webhook-Delivery-Id']).toBe('uuid-1');
      expect(opts.headers['X-Webhook-Timestamp']).toBeDefined();

      // Verify HMAC signature
      const expectedHmac = crypto.createHmac('sha256', 'secret123')
        .update(opts.body)
        .digest('hex');
      expect(opts.headers['X-Webhook-Signature']).toBe(`sha256=${expectedHmac}`);
    });

    it('marks delivery as "success" on 2xx response', async () => {
      const delivery = { ...mocks.mockDelivery, update: jest.fn().mockResolvedValue(true) };

      mocks.mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      });

      await service.attemptDelivery(delivery, mocks.mockSubscriber);

      expect(delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          responseCode: 200,
          attempts: 1,
        })
      );
    });

    it('calls handleFailure on non-2xx response', async () => {
      const delivery = {
        ...mocks.mockDelivery,
        maxAttempts: 1,   // So it immediately fails
        update: jest.fn().mockResolvedValue(true),
      };

      mocks.mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        text: jest.fn().mockResolvedValue('Bad Gateway'),
      });

      await service.attemptDelivery(delivery, mocks.mockSubscriber);

      // delivery.update should be called with failure info
      expect(delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 1,
          responseCode: 502,
          errorMessage: 'HTTP 502',
        })
      );
    });

    it('handles timeout (AbortError)', async () => {
      const delivery = {
        ...mocks.mockDelivery,
        maxAttempts: 1,
        update: jest.fn().mockResolvedValue(true),
      };

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mocks.mockFetch.mockRejectedValue(abortError);

      await service.attemptDelivery(delivery, mocks.mockSubscriber);

      expect(delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: 'Request timed out (10s)',
          responseCode: null,
        })
      );
    });

    it('schedules retry with exponential backoff on failure when attempts < maxAttempts', async () => {
      const delivery = {
        ...mocks.mockDelivery,
        attempts: 0,
        maxAttempts: 3,
        update: jest.fn().mockResolvedValue(true),
      };

      mocks.mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Internal Server Error'),
      });

      await service.attemptDelivery(delivery, mocks.mockSubscriber);

      // Status should NOT be 'failed' since we haven't exhausted maxAttempts
      const updateCall = delivery.update.mock.calls[0][0];
      expect(updateCall.status).toBeUndefined(); // status not set to 'failed' when retries remain
      expect(updateCall.attempts).toBe(1);
      expect(updateCall.nextRetryAt).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────
  // retryDelivery
  // ────────────────────────────────────────────────

  describe('retryDelivery', () => {
    it('resets attempts and status to pending', async () => {
      const deliveryRecord = {
        ...mocks.mockDelivery,
        id: 'del-99',
        attempts: 3,
        status: 'failed',
        subscriber: mocks.mockSubscriber,
        update: jest.fn().mockResolvedValue(true),
      };

      mocks.WebhookDelivery.findByPk.mockResolvedValue(deliveryRecord);
      // attemptDelivery will fire-and-forget, stub fetch to succeed
      mocks.mockFetch.mockResolvedValue({ ok: true, status: 200 });

      await service.retryDelivery('del-99');

      expect(mocks.WebhookDelivery.findByPk).toHaveBeenCalledWith('del-99', expect.any(Object));
      expect(deliveryRecord.update).toHaveBeenCalledWith({
        attempts: 0,
        status: 'pending',
        maxAttempts: 3,
      });
    });

    it('throws if delivery not found', async () => {
      mocks.WebhookDelivery.findByPk.mockResolvedValue(null);

      await expect(service.retryDelivery('nonexistent'))
        .rejects.toThrow('Delivery not found');
    });

    it('throws if subscriber not found on delivery', async () => {
      mocks.WebhookDelivery.findByPk.mockResolvedValue({
        ...mocks.mockDelivery,
        subscriber: null,
      });

      await expect(service.retryDelivery('del-1'))
        .rejects.toThrow('Subscriber not found for delivery');
    });
  });

  // ────────────────────────────────────────────────
  // checkAutoDisable (tested indirectly via attemptDelivery)
  // ────────────────────────────────────────────────

  describe('checkAutoDisable (via attemptDelivery)', () => {
    it('disables subscriber after threshold consecutive failures', async () => {
      const subscriberWithUpdate = {
        ...mocks.mockSubscriber,
        update: jest.fn().mockResolvedValue(true),
      };

      const delivery = {
        ...mocks.mockDelivery,
        attempts: 2,
        maxAttempts: 3, // This attempt (3) == maxAttempts, triggers checkAutoDisable
        update: jest.fn().mockResolvedValue(true),
      };

      mocks.mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('error'),
      });

      // The most recent AUTO_DISABLE_THRESHOLD deliveries are ALL failed
      // (genuinely consecutive — what the corrected logic checks).
      mocks.WebhookDelivery.findAll.mockResolvedValueOnce(
        Array.from({ length: 50 }, () => ({ status: 'failed' }))
      );

      await service.attemptDelivery(delivery, subscriberWithUpdate);

      expect(subscriberWithUpdate.update).toHaveBeenCalledWith({ enabled: false });
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('auto-disabled'),
        expect.objectContaining({ subscriberId: 'sub-1' })
      );
      // OBS-01: the kill switch must also raise an error-level Sentry alert.
      expect(mocks.Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('auto-disabled'),
        expect.objectContaining({
          level: 'error',
          tags: expect.objectContaining({ event: 'subscriber_auto_disabled' }),
        })
      );
    });

    it('does NOT disable when a recent success breaks the failure streak', async () => {
      const subscriberWithUpdate = {
        ...mocks.mockSubscriber,
        update: jest.fn().mockResolvedValue(true),
      };

      const delivery = {
        ...mocks.mockDelivery,
        attempts: 2,
        maxAttempts: 3,
        update: jest.fn().mockResolvedValue(true),
      };

      mocks.mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('error'),
      });

      // 50 recent deliveries, but a success is interleaved → not consecutive.
      mocks.WebhookDelivery.findAll.mockResolvedValueOnce([
        { status: 'failed' },
        { status: 'success' },
        ...Array.from({ length: 48 }, () => ({ status: 'failed' })),
      ]);

      await service.attemptDelivery(delivery, subscriberWithUpdate);

      // update(enabled: false) should NOT have been called
      expect(subscriberWithUpdate.update).not.toHaveBeenCalledWith({ enabled: false });
    });
  });

  describe('OBS-01 dropped-delivery alert', () => {
    it('alerts (warning) when a delivery is dropped because the queue is full', () => {
      // fetch never resolves → the 3 concurrent slots stay busy and the queue fills.
      mocks.mockFetch.mockReturnValue(new Promise(() => {}));

      // 3 active + 100 queued (MAX_QUEUE_DEPTH) + 1 that must be dropped.
      const pairs = Array.from({ length: 104 }, (_, i) => ({
        delivery: { ...mocks.mockDelivery, deliveryId: `d-${i}`, update: jest.fn().mockResolvedValue(true) },
        subscriber: mocks.mockSubscriber,
      }));

      service.flushDeliveries(pairs);

      expect(mocks.Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('dropped'),
        expect.objectContaining({
          level: 'warning',
          tags: expect.objectContaining({ event: 'delivery_dropped' }),
        })
      );
    });
  });

  // ────────────────────────────────────────────────
  // getDeadLetterQueue
  // ────────────────────────────────────────────────

  describe('getDeadLetterQueue', () => {
    it('groups failed deliveries by subscriber', async () => {
      const dlv1 = {
        subscriberId: 'sub-1',
        subscriber: { id: 'sub-1', name: 'Sub A', url: 'https://a.com', enabled: true },
      };
      const dlv2 = {
        subscriberId: 'sub-1',
        subscriber: { id: 'sub-1', name: 'Sub A', url: 'https://a.com', enabled: true },
      };
      const dlv3 = {
        subscriberId: 'sub-2',
        subscriber: { id: 'sub-2', name: 'Sub B', url: 'https://b.com', enabled: false },
      };

      mocks.WebhookDelivery.findAll.mockResolvedValue([dlv1, dlv2, dlv3]);

      const result = await service.getDeadLetterQueue();

      expect(result).toHaveLength(2);

      const group1 = result.find(g => g.subscriber.id === 'sub-1');
      const group2 = result.find(g => g.subscriber.id === 'sub-2');

      expect(group1.deliveries).toHaveLength(2);
      expect(group1.subscriber.name).toBe('Sub A');
      expect(group2.deliveries).toHaveLength(1);
      expect(group2.subscriber.enabled).toBe(false);
    });

    it('returns empty array when no failed deliveries exist', async () => {
      mocks.WebhookDelivery.findAll.mockResolvedValue([]);

      const result = await service.getDeadLetterQueue();
      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────
  // purgeDeadLetters
  // ────────────────────────────────────────────────

  describe('purgeDeadLetters', () => {
    it('deletes old failed deliveries and returns count', async () => {
      mocks.WebhookDelivery.destroy.mockResolvedValue(5);

      const deleted = await service.purgeDeadLetters(30);

      expect(deleted).toBe(5);
      expect(mocks.WebhookDelivery.destroy).toHaveBeenCalledTimes(1);

      const arg = mocks.WebhookDelivery.destroy.mock.calls[0][0];
      expect(arg.where.status).toBe('failed');
      // createdAt should be an Op.lt condition
      expect(arg.where.createdAt).toBeDefined();
    });

    it('uses default 30-day cutoff when no arg is provided', async () => {
      mocks.WebhookDelivery.destroy.mockResolvedValue(0);

      await service.purgeDeadLetters();

      const arg = mocks.WebhookDelivery.destroy.mock.calls[0][0];
      expect(arg.where.status).toBe('failed');
      expect(arg.where.createdAt).toBeDefined();
    });
  });
});
