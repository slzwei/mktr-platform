import { jest } from '@jest/globals';
import '../setup.js';
import { makeWebhookService } from '../../src/services/webhookService.js';
import { destinationForAgent, externalIdForDestination } from '../../src/services/prospectHelpers.js';

// ── Pure helpers ──
describe('destinationForAgent / externalIdForDestination', () => {
  it('maps lyfeId -> lyfe and returns the lyfeId', () => {
    expect(destinationForAgent({ lyfeId: 'L1' })).toBe('lyfe');
    expect(externalIdForDestination({ lyfeId: 'L1', id: 'U1' }, 'lyfe')).toBe('L1');
  });

  it('maps mktrLeadsId -> mktr_leads and returns the mktrLeadsId', () => {
    expect(destinationForAgent({ mktrLeadsId: 'M1' })).toBe('mktr_leads');
    expect(externalIdForDestination({ mktrLeadsId: 'M1', id: 'U1' }, 'mktr_leads')).toBe('M1');
  });

  it('returns null for a sourceless agent and NEVER falls back to the internal id', () => {
    expect(destinationForAgent({ id: 'U1' })).toBeNull();
    expect(destinationForAgent(null)).toBeNull();
    expect(externalIdForDestination({ id: 'U1' }, null)).toBeNull();
    expect(externalIdForDestination({ id: 'U1', lyfeId: null }, 'lyfe')).toBeNull();
    expect(externalIdForDestination({ id: 'U1', mktrLeadsId: null }, 'mktr_leads')).toBeNull();
  });
});

// ── dispatchEvent destination routing ──
describe('dispatchEvent destination routing', () => {
  const originalEnv = process.env.WEBHOOK_ENABLED;
  let WebhookSubscriber, WebhookDelivery, logger, service;

  const lyfeSub = { id: 'lyfe', name: 'Lyfe App', url: 'https://lyfe', secret: 's1', events: ['lead.created', 'lead.assigned', 'lead.unassigned'], enabled: true, metadata: { destination: 'lyfe' } };
  const mktrSub = { id: 'mktr', name: 'MKTR Leads App', url: 'https://mktr', secret: 's2', events: ['lead.created', 'lead.assigned', 'lead.unassigned'], enabled: true, metadata: { destination: 'mktr_leads' } };

  const builder = () => ({ event: 'lead.created', data: {} });

  beforeEach(() => {
    jest.useFakeTimers({ legacyFakeTimers: true });
    process.env.WEBHOOK_ENABLED = 'true';
    WebhookSubscriber = { findAll: jest.fn().mockResolvedValue([lyfeSub, mktrSub]) };
    WebhookDelivery = { create: jest.fn().mockImplementation(async (data) => ({ ...data, update: jest.fn().mockResolvedValue(true) })) };
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'ok', json: async () => ({}) });
    service = makeWebhookService({ WebhookSubscriber, WebhookDelivery, logger, fetch: fetchMock });
  });

  afterEach(() => {
    process.env.WEBHOOK_ENABLED = originalEnv;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('delivers a lyfe-destined lead ONLY to the lyfe subscriber', async () => {
    await service.dispatchEvent('lead.created', builder, { destination: 'lyfe' });
    expect(WebhookDelivery.create).toHaveBeenCalledTimes(1);
    expect(WebhookDelivery.create.mock.calls[0][0].subscriberId).toBe('lyfe');
  });

  it('delivers an mktr_leads-destined lead ONLY to the mktr-leads subscriber', async () => {
    await service.dispatchEvent('lead.created', builder, { destination: 'mktr_leads' });
    expect(WebhookDelivery.create).toHaveBeenCalledTimes(1);
    expect(WebhookDelivery.create.mock.calls[0][0].subscriberId).toBe('mktr');
  });

  it('default-denies (no delivery + logs) when destination is null', async () => {
    await service.dispatchEvent('lead.created', builder, { destination: null });
    expect(WebhookDelivery.create).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[Webhook] lead_webhook_default_denied',
      expect.objectContaining({ event: 'lead_webhook_default_denied', eventType: 'lead.created' })
    );
  });

  it('omitting destination preserves legacy broadcast to all event-type matches', async () => {
    await service.dispatchEvent('lead.created', builder); // no options object at all
    expect(WebhookDelivery.create).toHaveBeenCalledTimes(2);
  });

  it('does not deliver to a subscriber tagged for a different destination', async () => {
    WebhookSubscriber.findAll.mockResolvedValue([lyfeSub]); // only Lyfe present
    await service.dispatchEvent('lead.created', builder, { destination: 'mktr_leads' });
    expect(WebhookDelivery.create).not.toHaveBeenCalled();
  });
});
