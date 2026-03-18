import { jest } from '@jest/globals';
import '../setup.js';
import { makeWebhookService } from '../../src/services/webhookService.js';

// ── Helpers ──

function buildMocks() {
  const mockSubscriber = {
    id: 'sub-1',
    name: 'Lyfe App',
    url: 'https://example.com/webhook',
    secret: 'test-secret-123',
    enabled: true,
    events: ['lead.created', 'lead.assigned'],
    update: jest.fn().mockResolvedValue(true),
  };

  const mockDelivery = {
    id: 'dlv-1',
    deliveryId: 'uuid-delivery-1',
    subscriberId: 'sub-1',
    eventType: 'lead.created',
    payload: { event: 'lead.created', data: {} },
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    update: jest.fn().mockResolvedValue(true),
    subscriber: mockSubscriber,
  };

  const WebhookSubscriber = {
    findAll: jest.fn().mockResolvedValue([mockSubscriber]),
    findByPk: jest.fn().mockResolvedValue(mockSubscriber),
    sequelize: {
      query: jest.fn().mockResolvedValue([[]]),
    },
  };

  const WebhookDelivery = {
    create: jest.fn().mockResolvedValue({ ...mockDelivery }),
    findByPk: jest.fn().mockResolvedValue(mockDelivery),
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    destroy: jest.fn().mockResolvedValue(0),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const mockFetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: jest.fn().mockResolvedValue('OK'),
  });

  return {
    mockSubscriber,
    mockDelivery,
    WebhookSubscriber,
    WebhookDelivery,
    logger,
    fetch: mockFetch,
  };
}

function makeService(mocks) {
  return makeWebhookService({
    WebhookSubscriber: mocks.WebhookSubscriber,
    WebhookDelivery: mocks.WebhookDelivery,
    logger: mocks.logger,
    fetch: mocks.fetch,
  });
}

// ── Tests ──

describe('webhookDispatch (unit)', () => {
  let mocks, service;
  const originalEnv = process.env.WEBHOOK_ENABLED;

  beforeEach(() => {
    mocks = buildMocks();
    service = makeService(mocks);
  });

  afterEach(() => {
    process.env.WEBHOOK_ENABLED = originalEnv;
  });

  // ────────────────────────────────────────────────
  // dispatchEvent
  // ────────────────────────────────────────────────

  describe('dispatchEvent', () => {
    it('sends to all enabled subscribers matching event type', async () => {
      process.env.WEBHOOK_ENABLED = 'true';

      const sub2 = { ...mocks.mockSubscriber, id: 'sub-2', events: ['lead.created'] };
      mocks.WebhookSubscriber.findAll.mockResolvedValue([mocks.mockSubscriber, sub2]);

      const payloadBuilder = jest.fn().mockReturnValue({ event: 'lead.created', data: {} });

      await service.dispatchEvent('lead.created', payloadBuilder);

      // Wait for fire-and-forget deliveries
      await new Promise(r => setTimeout(r, 50));

      expect(mocks.WebhookDelivery.create).toHaveBeenCalledTimes(2);
      expect(payloadBuilder).toHaveBeenCalledTimes(1); // called once (lazy)
    });

    it('skips disabled subscribers', async () => {
      process.env.WEBHOOK_ENABLED = 'true';

      const disabledSub = { ...mocks.mockSubscriber, id: 'sub-disabled', enabled: false };
      mocks.WebhookSubscriber.findAll.mockResolvedValue([disabledSub]);

      // The query already filters by enabled: true, so empty result expected
      mocks.WebhookSubscriber.findAll.mockResolvedValue([]);

      const payloadBuilder = jest.fn().mockReturnValue({});
      await service.dispatchEvent('lead.created', payloadBuilder);

      expect(mocks.WebhookDelivery.create).not.toHaveBeenCalled();
    });

    it('filters by event type', async () => {
      process.env.WEBHOOK_ENABLED = 'true';

      const sub = { ...mocks.mockSubscriber, events: ['lead.assigned'] }; // does NOT include lead.created
      mocks.WebhookSubscriber.findAll.mockResolvedValue([sub]);

      const payloadBuilder = jest.fn().mockReturnValue({});
      await service.dispatchEvent('lead.created', payloadBuilder);

      // No match, so no delivery created
      expect(mocks.WebhookDelivery.create).not.toHaveBeenCalled();
    });

    it('does nothing when WEBHOOK_ENABLED is not true', async () => {
      process.env.WEBHOOK_ENABLED = 'false';

      const payloadBuilder = jest.fn().mockReturnValue({});
      await service.dispatchEvent('lead.created', payloadBuilder);

      expect(mocks.WebhookSubscriber.findAll).not.toHaveBeenCalled();
      expect(payloadBuilder).not.toHaveBeenCalled();
    });

    it('creates delivery record for each matched subscriber', async () => {
      process.env.WEBHOOK_ENABLED = 'true';

      const payloadBuilder = jest.fn().mockReturnValue({ event: 'lead.created' });
      await service.dispatchEvent('lead.created', payloadBuilder);

      expect(mocks.WebhookDelivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriberId: 'sub-1',
          eventType: 'lead.created',
          status: 'pending',
        })
      );
    });

    it('does not throw when dispatchEvent encounters an error', async () => {
      process.env.WEBHOOK_ENABLED = 'true';
      mocks.WebhookSubscriber.findAll.mockRejectedValue(new Error('DB down'));

      const payloadBuilder = jest.fn().mockReturnValue({});
      // Should not throw
      await service.dispatchEvent('lead.created', payloadBuilder);

      expect(mocks.logger.error).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // attemptDelivery
  // ────────────────────────────────────────────────

  describe('attemptDelivery', () => {
    it('marks delivery as success on 200 response', async () => {
      const delivery = {
        ...mocks.mockDelivery,
        attempts: 0,
        update: jest.fn().mockResolvedValue(true),
      };

      mocks.fetch.mockResolvedValue({ ok: true, status: 200 });

      await service.attemptDelivery(delivery, mocks.mockSubscriber);

      expect(delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          responseCode: 200,
        })
      );
    });

    it('handles HTTP error response', async () => {
      const delivery = {
        ...mocks.mockDelivery,
        attempts: 0,
        maxAttempts: 3,
        update: jest.fn().mockResolvedValue(true),
      };

      mocks.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Internal Server Error'),
      });

      await service.attemptDelivery(delivery, mocks.mockSubscriber);

      expect(delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: 'HTTP 500',
        })
      );
    });

    it('handles network error (fetch throws)', async () => {
      const delivery = {
        ...mocks.mockDelivery,
        attempts: 0,
        maxAttempts: 3,
        update: jest.fn().mockResolvedValue(true),
      };

      mocks.fetch.mockRejectedValue(new Error('ECONNREFUSED'));

      await service.attemptDelivery(delivery, mocks.mockSubscriber);

      expect(delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: 'ECONNREFUSED',
        })
      );
    });

    it('handles abort/timeout error', async () => {
      const delivery = {
        ...mocks.mockDelivery,
        attempts: 0,
        maxAttempts: 3,
        update: jest.fn().mockResolvedValue(true),
      };

      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mocks.fetch.mockRejectedValue(abortError);

      await service.attemptDelivery(delivery, mocks.mockSubscriber);

      expect(delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: 'Request timed out (10s)',
        })
      );
    });

    it('sends correct HMAC signature header', async () => {
      const delivery = {
        ...mocks.mockDelivery,
        payload: { event: 'test', deliveryId: 'test-id' },
        update: jest.fn().mockResolvedValue(true),
      };

      mocks.fetch.mockResolvedValue({ ok: true, status: 200 });

      await service.attemptDelivery(delivery, mocks.mockSubscriber);

      const fetchCall = mocks.fetch.mock.calls[0];
      expect(fetchCall[0]).toBe('https://example.com/webhook');
      expect(fetchCall[1].headers['X-Webhook-Signature']).toMatch(/^sha256=/);
      expect(fetchCall[1].headers['Content-Type']).toBe('application/json');
    });
  });

  // ────────────────────────────────────────────────
  // retryDelivery
  // ────────────────────────────────────────────────

  describe('retryDelivery', () => {
    it('throws when delivery not found', async () => {
      mocks.WebhookDelivery.findByPk.mockResolvedValue(null);

      await expect(service.retryDelivery('nonexistent'))
        .rejects.toThrow('Delivery not found');
    });

    it('throws when subscriber not found for delivery', async () => {
      mocks.WebhookDelivery.findByPk.mockResolvedValue({
        ...mocks.mockDelivery,
        subscriber: null,
        update: jest.fn().mockResolvedValue(true),
      });

      await expect(service.retryDelivery('dlv-1'))
        .rejects.toThrow('Subscriber not found for delivery');
    });

    it('resets attempts and status on retry', async () => {
      const delivery = {
        ...mocks.mockDelivery,
        update: jest.fn().mockResolvedValue(true),
      };
      mocks.WebhookDelivery.findByPk.mockResolvedValue(delivery);

      await service.retryDelivery('dlv-1');

      expect(delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 0,
          status: 'pending',
          maxAttempts: 3,
        })
      );
    });
  });

  // ────────────────────────────────────────────────
  // purgeDeadLetters
  // ────────────────────────────────────────────────

  describe('purgeDeadLetters', () => {
    it('deletes failed deliveries older than specified days', async () => {
      mocks.WebhookDelivery.destroy.mockResolvedValue(5);

      const result = await service.purgeDeadLetters(30);

      expect(result).toBe(5);
      expect(mocks.WebhookDelivery.destroy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'failed',
          }),
        })
      );
    });

    it('defaults to 30 days when no parameter given', async () => {
      mocks.WebhookDelivery.destroy.mockResolvedValue(0);

      await service.purgeDeadLetters();

      expect(mocks.WebhookDelivery.destroy).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // getDeadLetterQueue
  // ────────────────────────────────────────────────

  describe('getDeadLetterQueue', () => {
    it('returns deliveries grouped by subscriber', async () => {
      mocks.WebhookDelivery.findAll.mockResolvedValue([
        {
          subscriberId: 'sub-1',
          subscriber: { id: 'sub-1', name: 'Lyfe', url: 'https://example.com', enabled: true },
          ...mocks.mockDelivery,
        },
      ]);

      const result = await service.getDeadLetterQueue();

      expect(result).toHaveLength(1);
      expect(result[0].subscriber.id).toBe('sub-1');
      expect(result[0].deliveries).toHaveLength(1);
    });

    it('returns empty array when no failed deliveries', async () => {
      mocks.WebhookDelivery.findAll.mockResolvedValue([]);

      const result = await service.getDeadLetterQueue();

      expect(result).toEqual([]);
    });

    it('groups multiple deliveries under same subscriber', async () => {
      mocks.WebhookDelivery.findAll.mockResolvedValue([
        { subscriberId: 'sub-1', subscriber: { id: 'sub-1', name: 'A', url: 'a', enabled: true }, deliveryId: 'd-1' },
        { subscriberId: 'sub-1', subscriber: { id: 'sub-1', name: 'A', url: 'a', enabled: true }, deliveryId: 'd-2' },
      ]);

      const result = await service.getDeadLetterQueue();

      expect(result).toHaveLength(1);
      expect(result[0].deliveries).toHaveLength(2);
    });
  });

  // ────────────────────────────────────────────────
  // retryAllFailed
  // ────────────────────────────────────────────────

  describe('retryAllFailed', () => {
    it('retries all failed deliveries for a subscriber', async () => {
      const delivery1 = { ...mocks.mockDelivery, id: 'dlv-1', update: jest.fn().mockResolvedValue(true) };
      const delivery2 = { ...mocks.mockDelivery, id: 'dlv-2', update: jest.fn().mockResolvedValue(true) };

      mocks.WebhookDelivery.findAll.mockResolvedValue([delivery1, delivery2]);
      mocks.WebhookDelivery.findByPk
        .mockResolvedValueOnce({ ...delivery1, subscriber: mocks.mockSubscriber, update: jest.fn().mockResolvedValue(true) })
        .mockResolvedValueOnce({ ...delivery2, subscriber: mocks.mockSubscriber, update: jest.fn().mockResolvedValue(true) });

      const count = await service.retryAllFailed('sub-1');

      expect(count).toBe(2);
    });

    it('returns 0 when no failed deliveries exist', async () => {
      mocks.WebhookDelivery.findAll.mockResolvedValue([]);

      const count = await service.retryAllFailed('sub-1');

      expect(count).toBe(0);
    });
  });

  // ────────────────────────────────────────────────
  // dispatchEvent edge cases
  // ────────────────────────────────────────────────

  describe('dispatchEvent (edge cases)', () => {
    it('calls payload builder only once for multiple subscribers', async () => {
      process.env.WEBHOOK_ENABLED = 'true';

      const sub1 = { ...mocks.mockSubscriber, id: 'sub-1' };
      const sub2 = { ...mocks.mockSubscriber, id: 'sub-2' };
      mocks.WebhookSubscriber.findAll.mockResolvedValue([sub1, sub2]);

      const payloadBuilder = jest.fn().mockReturnValue({ event: 'lead.created' });
      await service.dispatchEvent('lead.created', payloadBuilder);

      expect(payloadBuilder).toHaveBeenCalledTimes(1);
    });

    it('handles subscriber with empty events array', async () => {
      process.env.WEBHOOK_ENABLED = 'true';

      const sub = { ...mocks.mockSubscriber, events: [] };
      mocks.WebhookSubscriber.findAll.mockResolvedValue([sub]);

      const payloadBuilder = jest.fn().mockReturnValue({});
      await service.dispatchEvent('lead.created', payloadBuilder);

      expect(mocks.WebhookDelivery.create).not.toHaveBeenCalled();
    });

    it('includes deliveryId in payload', async () => {
      process.env.WEBHOOK_ENABLED = 'true';

      mocks.WebhookDelivery.create.mockImplementation(async (data) => ({
        ...mocks.mockDelivery,
        ...data,
        update: jest.fn().mockResolvedValue(true),
      }));

      const payloadBuilder = jest.fn().mockReturnValue({ event: 'lead.created' });
      await service.dispatchEvent('lead.created', payloadBuilder);

      const createArg = mocks.WebhookDelivery.create.mock.calls[0][0];
      expect(createArg.payload.deliveryId).toBeDefined();
    });
  });
});
