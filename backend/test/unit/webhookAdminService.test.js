import { jest } from '@jest/globals';
import '../setup.js';
import { Op } from 'sequelize';

// ── Helpers ──

function buildMocks() {
  const mockSubscriber = {
    id: 'sub-1',
    name: 'Test Subscriber',
    url: 'https://example.com/hook',
    secret: 'secret123',
    events: ['lead.created'],
    enabled: true,
    description: 'A test subscriber',
    metadata: {},
    createdAt: new Date().toISOString(),
    update: jest.fn().mockResolvedValue(true),
    destroy: jest.fn().mockResolvedValue(true),
  };

  const mockDelivery = {
    id: 'del-1',
    subscriberId: 'sub-1',
    eventType: 'lead.created',
    payload: { event: 'lead.created', data: {} },
    status: 'delivered',
    createdAt: new Date().toISOString(),
    subscriber: { id: 'sub-1', name: 'Test Subscriber', url: 'https://example.com/hook' },
  };

  const WebhookSubscriber = {
    findAll: jest.fn().mockResolvedValue([mockSubscriber]),
    findByPk: jest.fn().mockResolvedValue(mockSubscriber),
    create: jest.fn().mockResolvedValue(mockSubscriber),
  };

  const WebhookDelivery = {
    findAndCountAll: jest.fn().mockResolvedValue({ count: 0, rows: [] }),
    findByPk: jest.fn().mockResolvedValue(null),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  return {
    mockSubscriber,
    mockDelivery,
    WebhookSubscriber,
    WebhookDelivery,
    logger,
  };
}

async function makeService(mocks) {
  jest.unstable_mockModule('../../src/models/index.js', () => ({
    WebhookSubscriber: mocks.WebhookSubscriber,
    WebhookDelivery: mocks.WebhookDelivery,
  }));

  const mod = await import('../../src/services/webhookAdminService.js');
  return mod;
}

// ── Tests ──

describe('webhookAdminService (unit)', () => {
  let mocks, service;

  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.resetModules();
    mocks = buildMocks();
    service = await makeService(mocks);
  });

  // ────────────────────────────────────────────────
  // listSubscribers
  // ────────────────────────────────────────────────

  describe('listSubscribers', () => {
    it('returns all subscribers ordered by createdAt DESC', async () => {
      const result = await service.listSubscribers();

      expect(mocks.WebhookSubscriber.findAll).toHaveBeenCalledWith({
        order: [['createdAt', 'DESC']],
      });
      expect(result).toEqual([mocks.mockSubscriber]);
    });
  });

  // ────────────────────────────────────────────────
  // createSubscriber
  // ────────────────────────────────────────────────

  describe('createSubscriber', () => {
    it('creates a subscriber with valid fields', async () => {
      const input = {
        name: 'New Sub',
        url: 'https://hook.example.com',
        secret: 'mysecret',
        events: ['lead.created', 'lead.assigned'],
        enabled: true,
        description: 'Desc',
        metadata: { key: 'val' },
      };

      await service.createSubscriber(input);

      expect(mocks.WebhookSubscriber.create).toHaveBeenCalledWith({
        name: 'New Sub',
        url: 'https://hook.example.com',
        secret: 'mysecret',
        events: ['lead.created', 'lead.assigned'],
        enabled: true,
        description: 'Desc',
        metadata: { key: 'val' },
      });
    });

    it('throws 400 when required fields are missing', async () => {
      await expect(service.createSubscriber({ name: 'Only name' }))
        .rejects.toThrow('name, url, and secret are required');

      try {
        await service.createSubscriber({ url: 'https://example.com' });
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('defaults events to [], enabled to true, description to null, metadata to {}', async () => {
      const input = { name: 'Min', url: 'https://min.com', secret: 's' };

      await service.createSubscriber(input);

      expect(mocks.WebhookSubscriber.create).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [],
          enabled: true,
          description: null,
          metadata: {},
        })
      );
    });
  });

  // ────────────────────────────────────────────────
  // updateSubscriber
  // ────────────────────────────────────────────────

  describe('updateSubscriber', () => {
    it('updates subscriber fields and returns the subscriber', async () => {
      const result = await service.updateSubscriber('sub-1', { name: 'Updated' });

      expect(mocks.WebhookSubscriber.findByPk).toHaveBeenCalledWith('sub-1');
      expect(mocks.mockSubscriber.update).toHaveBeenCalledWith({ name: 'Updated' });
      expect(result).toBe(mocks.mockSubscriber);
    });

    it('throws 404 when subscriber not found', async () => {
      mocks.WebhookSubscriber.findByPk.mockResolvedValue(null);

      await expect(service.updateSubscriber('nonexistent', { name: 'X' }))
        .rejects.toThrow('Subscriber not found');

      try {
        await service.updateSubscriber('nonexistent', { name: 'X' });
      } catch (err) {
        expect(err.statusCode).toBe(404);
      }
    });
  });

  // ────────────────────────────────────────────────
  // deleteSubscriber
  // ────────────────────────────────────────────────

  describe('deleteSubscriber', () => {
    it('destroys the subscriber', async () => {
      await service.deleteSubscriber('sub-1');

      expect(mocks.WebhookSubscriber.findByPk).toHaveBeenCalledWith('sub-1');
      expect(mocks.mockSubscriber.destroy).toHaveBeenCalled();
    });

    it('throws 404 when subscriber not found', async () => {
      mocks.WebhookSubscriber.findByPk.mockResolvedValue(null);

      await expect(service.deleteSubscriber('nonexistent'))
        .rejects.toThrow('Subscriber not found');

      try {
        await service.deleteSubscriber('nonexistent');
      } catch (err) {
        expect(err.statusCode).toBe(404);
      }
    });
  });

  // ────────────────────────────────────────────────
  // listDeliveries
  // ────────────────────────────────────────────────

  describe('listDeliveries', () => {
    it('applies pagination correctly', async () => {
      mocks.WebhookDelivery.findAndCountAll.mockResolvedValue({
        count: 50,
        rows: [],
      });

      const result = await service.listDeliveries({ page: 3, limit: 10 });

      const callArg = mocks.WebhookDelivery.findAndCountAll.mock.calls[0][0];
      expect(callArg.offset).toBe(20); // (3-1) * 10
      expect(callArg.limit).toBe(10);
      expect(result.pagination).toEqual({
        currentPage: 3,
        totalPages: 5,
        totalItems: 50,
        itemsPerPage: 10,
      });
    });

    it('applies status, subscriberId, and eventType filters', async () => {
      mocks.WebhookDelivery.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listDeliveries({
        status: 'failed',
        subscriberId: 'sub-1',
        eventType: 'lead.created',
        page: 1,
        limit: 20,
      });

      const callArg = mocks.WebhookDelivery.findAndCountAll.mock.calls[0][0];
      expect(callArg.where.status).toBe('failed');
      expect(callArg.where.subscriberId).toBe('sub-1');
      expect(callArg.where.eventType).toBe('lead.created');
    });

    it('applies date range filters', async () => {
      mocks.WebhookDelivery.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listDeliveries({
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
        page: 1,
        limit: 20,
      });

      const callArg = mocks.WebhookDelivery.findAndCountAll.mock.calls[0][0];
      expect(callArg.where.createdAt[Op.gte]).toEqual(new Date('2025-01-01'));
      expect(callArg.where.createdAt[Op.lte]).toEqual(new Date('2025-12-31'));
    });
  });

  // ────────────────────────────────────────────────
  // getDeliveryById
  // ────────────────────────────────────────────────

  describe('getDeliveryById', () => {
    it('returns the delivery when found', async () => {
      mocks.WebhookDelivery.findByPk.mockResolvedValue(mocks.mockDelivery);

      const result = await service.getDeliveryById('del-1');

      expect(mocks.WebhookDelivery.findByPk).toHaveBeenCalledWith('del-1', {
        include: [{ association: 'subscriber', attributes: ['id', 'name', 'url'] }],
      });
      expect(result).toBe(mocks.mockDelivery);
    });

    it('throws 404 when delivery not found', async () => {
      mocks.WebhookDelivery.findByPk.mockResolvedValue(null);

      await expect(service.getDeliveryById('nonexistent'))
        .rejects.toThrow('Delivery not found');

      try {
        await service.getDeliveryById('nonexistent');
      } catch (err) {
        expect(err.statusCode).toBe(404);
      }
    });
  });
});
