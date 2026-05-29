import { jest } from '@jest/globals';
import '../setup.js';
import crypto from 'crypto';

// Set env vars before module import
process.env.IP_HASH_SALT = 'test-salt';
process.env.ATTRIB_SECRET = 'test-attrib-secret';

// ── Mock models ──

const QrTag = { findOne: jest.fn(), findByPk: jest.fn(), increment: jest.fn(), update: jest.fn() };
const QrScan = { findOne: jest.fn(), create: jest.fn() };
const Attribution = { create: jest.fn(), findOne: jest.fn(), findByPk: jest.fn() };
const Campaign = { findByPk: jest.fn() };

jest.unstable_mockModule('../../src/models/index.js', () => ({ QrTag, QrScan, Attribution, Campaign }));

const { resolveQrTag, recordScan, createAttribution, buildRedirectParams, resolveSession, generateSessionId } =
  await import('../../src/services/trackerService.js');

// ── Tests ──

describe('trackerService (unit)', () => {
  let mockQrTag, mockScan, mockAttribution, mockCampaign;

  beforeEach(() => {
    jest.clearAllMocks();

    mockQrTag = { id: 'qr-1', slug: 'test-slug', active: true, campaignId: 'camp-1' };
    mockScan = { id: 'scan-1', qrTagId: 'qr-1', ipHash: 'hash123', ua: 'Mozilla/5.0', ts: new Date() };
    mockAttribution = {
      id: 'attr-1',
      qrTagId: 'qr-1',
      qrScanId: 'scan-1',
      sessionId: null,
      expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      usedOnce: false,
      update: jest.fn().mockResolvedValue(true),
    };
    mockCampaign = { id: 'camp-1', name: 'Test Campaign', design_config: {}, is_active: true };

    QrTag.findOne.mockResolvedValue(mockQrTag);
    QrTag.findByPk.mockResolvedValue(mockQrTag);
    QrScan.findOne.mockResolvedValue(null);
    QrScan.create.mockResolvedValue(mockScan);
    Attribution.create.mockResolvedValue(mockAttribution);
    Attribution.findOne.mockResolvedValue(null);
    Attribution.findByPk.mockResolvedValue(mockAttribution);
    Campaign.findByPk.mockResolvedValue(mockCampaign);
  });

  // ── resolveQrTag ──

  describe('resolveQrTag', () => {
    it('finds active QR tag by slug', async () => {
      const result = await resolveQrTag('test-slug');

      expect(QrTag.findOne).toHaveBeenCalledWith({ where: { slug: 'test-slug', active: true } });
      expect(result).toBe(mockQrTag);
    });

    it('returns null when tag not found', async () => {
      QrTag.findOne.mockResolvedValue(null);

      const result = await resolveQrTag('bad-slug');
      expect(result).toBeNull();
    });
  });

  // ── recordScan ──

  describe('recordScan', () => {
    it('creates scan record with hashed IP and device detection', async () => {
      await recordScan(mockQrTag, {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS)',
        referer: 'https://google.com',
        ip: '1.2.3.4',
      });

      expect(QrScan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          qrTagId: 'qr-1',
          device: 'mobile',
          botFlag: false,
          isDuplicate: false,
        })
      );
    });

    it('detects desktop user agent', async () => {
      await recordScan(mockQrTag, {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        referer: null,
        ip: '1.2.3.4',
      });

      const createArg = QrScan.create.mock.calls[0][0];
      expect(createArg.device).toBe('desktop');
    });

    it('detects bot user agents', async () => {
      await recordScan(mockQrTag, {
        userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)',
        referer: null,
        ip: '1.2.3.4',
      });

      const createArg = QrScan.create.mock.calls[0][0];
      expect(createArg.botFlag).toBe(true);
    });

    it('marks scan as duplicate within 2-minute window', async () => {
      const expectedHash = crypto.createHash('sha256').update('1.2.3.4:test-salt').digest('hex');
      QrScan.findOne.mockResolvedValue({
        ts: new Date(),
        ipHash: expectedHash,
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS)',
      });

      await recordScan(mockQrTag, {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS)',
        referer: null,
        ip: '1.2.3.4',
      });

      const createArg = QrScan.create.mock.calls[0][0];
      expect(createArg.isDuplicate).toBe(true);
    });
  });

  // ── createAttribution ──

  describe('createAttribution', () => {
    it('creates attribution and returns signed token', async () => {
      const result = await createAttribution(mockQrTag, mockScan);

      expect(Attribution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          qrTagId: 'qr-1',
          qrScanId: 'scan-1',
          sessionId: null,
          firstTouch: false,
          usedOnce: false,
        })
      );
      expect(result.token).toBeDefined();
      expect(result.token).toContain('.');
      expect(result.expiresAt).toBeInstanceOf(Date);
    });
  });

  // ── buildRedirectParams ──

  describe('buildRedirectParams', () => {
    it('includes campaign_id and slug when campaignId is set', () => {
      const params = buildRedirectParams({ campaignId: 'camp-1', slug: 'test-slug' });

      expect(params).toContain('campaign_id=camp-1');
      expect(params).toContain('slug=test-slug');
    });

    it('omits campaign_id when campaignId is null', () => {
      const params = buildRedirectParams({ campaignId: null, slug: 'test-slug' });

      expect(params).not.toContain('campaign_id');
      expect(params).toContain('slug=test-slug');
    });
  });

  // ── resolveSession ──

  describe('resolveSession', () => {
    // Build a valid signed atk cookie value for the token-binding branch.
    function makeAtk(id, expOffsetSec = 600) {
      const payload = Buffer.from(
        JSON.stringify({ id, exp: Math.floor(Date.now() / 1000) + expOffsetSec })
      ).toString('base64url');
      const sig = crypto.createHmac('sha256', process.env.ATTRIB_SECRET).update(payload).digest('base64url');
      return `${payload}.${sig}`;
    }

    it('returns null when sid is falsy', async () => {
      const result = await resolveSession(null, null);
      expect(result).toBeNull();
    });

    it('returns null when no attribution found', async () => {
      const result = await resolveSession('sess-1', null);
      expect(result).toBeNull();
    });

    it('returns session context when attribution exists', async () => {
      Attribution.findOne.mockResolvedValue({ ...mockAttribution, sessionId: 'sess-1' });

      const result = await resolveSession('sess-1', null);

      expect(result).toEqual(expect.objectContaining({
        qrTagId: 'qr-1',
        campaignId: 'camp-1',
        slug: 'test-slug',
        active: true,
      }));
    });

    it('resolves the most-recently-touched attribution (lastTouchAt, then createdAt, then id DESC)', async () => {
      // Deterministic last-touch: a later scan of a different campaign must win,
      // and a same-millisecond tie is broken by createdAt then id DESC so the
      // result is stable.
      Attribution.findOne.mockResolvedValue({ ...mockAttribution, sessionId: 'sess-1' });

      await resolveSession('sess-1', null);

      expect(Attribution.findOne).toHaveBeenCalledWith({
        where: { sessionId: 'sess-1' },
        order: [['lastTouchAt', 'DESC'], ['createdAt', 'DESC'], ['id', 'DESC']],
      });
    });

    it('refuses an atk token already consumed by another session (usedOnce)', async () => {
      Attribution.findOne.mockResolvedValue(null); // no session-bound attribution yet
      const used = {
        id: 'attr-used', qrTagId: 'qr-1', sessionId: 'other-sess', usedOnce: true,
        expiresAt: new Date(Date.now() + 20 * 60 * 1000), update: jest.fn(),
      };
      Attribution.findByPk.mockResolvedValue(used);

      const result = await resolveSession('new-sess', makeAtk('attr-used'));

      expect(used.update).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('binds an unused atk token to a new session and marks it usedOnce', async () => {
      Attribution.findOne.mockResolvedValue(null);
      const fresh = {
        id: 'attr-fresh', qrTagId: 'qr-1', sessionId: null, usedOnce: false,
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
        update: jest.fn().mockResolvedValue(true),
      };
      Attribution.findByPk.mockResolvedValue(fresh);

      const result = await resolveSession('new-sess', makeAtk('attr-fresh'));

      expect(fresh.update).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'new-sess', usedOnce: true })
      );
      expect(result).toEqual(expect.objectContaining({ qrTagId: 'qr-1', active: true }));
    });
  });

  // ── generateSessionId ──

  describe('generateSessionId', () => {
    it('returns a 32-char hex string', () => {
      const sid = generateSessionId();
      expect(sid).toMatch(/^[a-f0-9]{32}$/);
    });

    it('returns unique IDs', () => {
      const a = generateSessionId();
      const b = generateSessionId();
      expect(a).not.toBe(b);
    });
  });
});
