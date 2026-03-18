import { jest } from '@jest/globals';
import '../setup.js';

// ── Mock models ──

const SessionVisit = { findOne: jest.fn(), create: jest.fn() };
const Campaign = { findByPk: jest.fn() };

jest.unstable_mockModule('../../src/models/index.js', () => ({ SessionVisit, Campaign }));

const { trackEvent, trackReferral } = await import('../../src/services/analyticsService.js');

// ── Tests ──

describe('analyticsService (unit)', () => {
  let mockVisit;

  beforeEach(() => {
    jest.clearAllMocks();

    mockVisit = {
      sessionId: 'sess-1',
      eventsJson: [],
      update: jest.fn().mockResolvedValue(true),
    };

    SessionVisit.findOne.mockResolvedValue(null);
    SessionVisit.create.mockResolvedValue(mockVisit);
    Campaign.findByPk.mockResolvedValue({ id: 'camp-1', name: 'Test Campaign' });
  });

  // ── trackEvent ──

  describe('trackEvent', () => {
    it('creates new session visit when none exists', async () => {
      await trackEvent('sess-1', 'page_view', { path: '/home' });

      expect(SessionVisit.create).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'sess-1', landingPath: '/home', eventsJson: [] })
      );
      expect(mockVisit.update).toHaveBeenCalledWith({
        eventsJson: [expect.objectContaining({ type: 'page_view' })],
      });
    });

    it('appends event to existing session visit', async () => {
      const existingVisit = {
        sessionId: 'sess-1',
        eventsJson: [{ type: 'old_event', ts: '2025-01-01T00:00:00Z', meta: {} }],
        update: jest.fn().mockResolvedValue(true),
      };
      SessionVisit.findOne.mockResolvedValue(existingVisit);

      await trackEvent('sess-1', 'form_submit', {});

      expect(SessionVisit.create).not.toHaveBeenCalled();
      const updateArg = existingVisit.update.mock.calls[0][0];
      expect(updateArg.eventsJson).toHaveLength(2);
      expect(updateArg.eventsJson[1].type).toBe('form_submit');
    });

    it('uses /lead-capture as default landing path', async () => {
      await trackEvent('sess-1', 'page_view');

      const createArg = SessionVisit.create.mock.calls[0][0];
      expect(createArg.landingPath).toBe('/lead-capture');
    });

    it('stores UTM parameters from meta', async () => {
      await trackEvent('sess-1', 'page_view', {
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'brand',
      });

      const createArg = SessionVisit.create.mock.calls[0][0];
      expect(createArg.utmSource).toBe('google');
      expect(createArg.utmMedium).toBe('cpc');
      expect(createArg.utmCampaign).toBe('brand');
    });
  });

  // ── trackReferral ──

  describe('trackReferral', () => {
    it('creates referral_visit event in session', async () => {
      await trackReferral('sess-1', 'camp-1');

      expect(SessionVisit.create).toHaveBeenCalled();
      expect(mockVisit.update).toHaveBeenCalledWith({
        eventsJson: [expect.objectContaining({
          type: 'referral_visit',
          meta: { campaignId: 'camp-1' },
        })],
      });
    });

    it('throws 400 when campaignId is missing', async () => {
      await expect(trackReferral('sess-1', null)).rejects.toThrow('campaignId required');
      try { await trackReferral('sess-1', null); } catch (e) { expect(e.statusCode).toBe(400); }
    });

    it('throws 404 when campaign not found', async () => {
      Campaign.findByPk.mockResolvedValue(null);

      await expect(trackReferral('sess-1', 'bad-camp')).rejects.toThrow('Campaign not found');
    });

    it('appends to existing session visit events', async () => {
      const existingVisit = {
        eventsJson: [{ type: 'page_view', ts: '2025-01-01T00:00:00Z', meta: {} }],
        update: jest.fn().mockResolvedValue(true),
      };
      SessionVisit.findOne.mockResolvedValue(existingVisit);

      await trackReferral('sess-1', 'camp-1');

      expect(SessionVisit.create).not.toHaveBeenCalled();
      const updateArg = existingVisit.update.mock.calls[0][0];
      expect(updateArg.eventsJson).toHaveLength(2);
      expect(updateArg.eventsJson[1].type).toBe('referral_visit');
    });
  });
});
