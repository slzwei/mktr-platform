import { jest } from '@jest/globals';
import '../setup.js';
import crypto from 'crypto';

// ── Mock models ──

const mockQrTag = {
  id: 'qr-1',
  slug: 'abc123test',
  campaignId: 'camp-1',
  active: true,
  scanCount: 5,
  uniqueScanCount: 3,
  update: jest.fn().mockResolvedValue(true),
};

const mockScan = {
  id: 'scan-1',
  qrTagId: 'qr-1',
  ipHash: 'hash123',
  ua: 'Mozilla/5.0',
  ts: new Date(),
};

const mockAttribution = {
  id: 'attr-1',
  qrTagId: 'qr-1',
  qrScanId: 'scan-1',
  sessionId: null,
  expiresAt: new Date(Date.now() + 20 * 60 * 1000),
  usedOnce: false,
  update: jest.fn().mockResolvedValue(true),
};

const mockCampaign = {
  id: 'camp-1',
  name: 'Test Campaign',
  design_config: {},
  is_active: true,
};

const QrTag = {
  findOne: jest.fn().mockResolvedValue(mockQrTag),
  findByPk: jest.fn().mockResolvedValue(mockQrTag),
  increment: jest.fn().mockResolvedValue([1]),
  update: jest.fn().mockResolvedValue([1]),
};

const QrScan = {
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockResolvedValue(mockScan),
};

const Attribution = {
  findOne: jest.fn().mockResolvedValue(null),
  findByPk: jest.fn().mockResolvedValue(mockAttribution),
  create: jest.fn().mockResolvedValue(mockAttribution),
};

const Campaign = {
  findByPk: jest.fn().mockResolvedValue(mockCampaign),
};

jest.unstable_mockModule('../../src/models/index.js', () => ({
  QrTag,
  QrScan,
  Attribution,
  Campaign,
}));

const {
  resolveQrTag,
  recordScan,
  createAttribution,
  buildRedirectParams,
  resolveSession,
  generateSessionId,
} = await import('../../src/services/trackerService.js');

// ── Tests ──

describe('qrScanFlow (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    QrTag.findOne.mockResolvedValue(mockQrTag);
    QrTag.findByPk.mockResolvedValue(mockQrTag);
    QrScan.findOne.mockResolvedValue(null);
    QrScan.create.mockResolvedValue(mockScan);
    Attribution.findOne.mockResolvedValue(null);
    Attribution.create.mockResolvedValue(mockAttribution);
  });

  // ────────────────────────────────────────────────
  // resolveQrTag
  // ────────────────────────────────────────────────

  describe('resolveQrTag', () => {
    it('resolves active QR tag by slug', async () => {
      const result = await resolveQrTag('abc123test');

      expect(QrTag.findOne).toHaveBeenCalledWith({ where: { slug: 'abc123test', active: true } });
      expect(result).toEqual(mockQrTag);
    });

    it('returns null for inactive/missing QR tag', async () => {
      QrTag.findOne.mockResolvedValue(null);

      const result = await resolveQrTag('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────────
  // recordScan
  // ────────────────────────────────────────────────

  describe('recordScan', () => {
    it('creates a scan record with hashed IP', async () => {
      await recordScan(mockQrTag, {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0)',
        referer: 'https://google.com',
        ip: '192.168.1.1',
      });

      expect(QrScan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          qrTagId: 'qr-1',
          device: 'mobile',
          botFlag: false,
        })
      );
    });

    it('detects mobile device from user agent', async () => {
      await recordScan(mockQrTag, {
        userAgent: 'Mozilla/5.0 (Android)',
        referer: '',
        ip: '1.2.3.4',
      });

      const createArg = QrScan.create.mock.calls[0][0];
      expect(createArg.device).toBe('mobile');
    });

    it('detects desktop device from user agent', async () => {
      await recordScan(mockQrTag, {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        referer: '',
        ip: '1.2.3.4',
      });

      const createArg = QrScan.create.mock.calls[0][0];
      expect(createArg.device).toBe('desktop');
    });

    it('detects bot from user agent', async () => {
      await recordScan(mockQrTag, {
        userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)',
        referer: '',
        ip: '1.2.3.4',
      });

      const createArg = QrScan.create.mock.calls[0][0];
      expect(createArg.botFlag).toBe(true);
    });

    it('marks duplicate scan within 2 minutes', async () => {
      const recentScan = {
        ts: new Date(), // just now
        ipHash: crypto.createHash('sha256').update('1.2.3.4:dev-salt').digest('hex'),
        ua: 'Mozilla/5.0',
      };
      QrScan.findOne.mockResolvedValue(recentScan);

      await recordScan(mockQrTag, {
        userAgent: 'Mozilla/5.0',
        referer: '',
        ip: '1.2.3.4',
      });

      const createArg = QrScan.create.mock.calls[0][0];
      expect(createArg.isDuplicate).toBe(true);
    });

    it('does not mark as duplicate when IP differs', async () => {
      const recentScan = {
        ts: new Date(),
        ipHash: 'different-hash',
        ua: 'Mozilla/5.0',
      };
      QrScan.findOne.mockResolvedValue(recentScan);

      await recordScan(mockQrTag, {
        userAgent: 'Mozilla/5.0',
        referer: '',
        ip: '1.2.3.4',
      });

      const createArg = QrScan.create.mock.calls[0][0];
      expect(createArg.isDuplicate).toBe(false);
    });
  });

  // ────────────────────────────────────────────────
  // createAttribution
  // ────────────────────────────────────────────────

  describe('createAttribution', () => {
    it('creates attribution record with expiry', async () => {
      const result = await createAttribution(mockQrTag, mockScan);

      expect(Attribution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          qrTagId: 'qr-1',
          qrScanId: 'scan-1',
          usedOnce: false,
        })
      );
      expect(result.token).toBeDefined();
      expect(result.expiresAt).toBeDefined();
    });

    it('returns a signed token with base64url encoding', async () => {
      const result = await createAttribution(mockQrTag, mockScan);

      expect(result.token).toContain('.'); // payload.signature format
      const parts = result.token.split('.');
      expect(parts).toHaveLength(2);
    });
  });

  // ────────────────────────────────────────────────
  // buildRedirectParams
  // ────────────────────────────────────────────────

  describe('buildRedirectParams', () => {
    it('builds params with campaign_id and slug', () => {
      const params = buildRedirectParams({ campaignId: 'camp-1', slug: 'abc123' });

      expect(params).toContain('campaign_id=camp-1');
      expect(params).toContain('slug=abc123');
    });

    it('omits campaign_id when not present', () => {
      const params = buildRedirectParams({ slug: 'abc123' });

      expect(params).not.toContain('campaign_id');
      expect(params).toContain('slug=abc123');
    });
  });

  // ────────────────────────────────────────────────
  // resolveSession
  // ────────────────────────────────────────────────

  describe('resolveSession', () => {
    it('returns null when sid is missing', async () => {
      const result = await resolveSession(null, null);

      expect(result).toBeNull();
    });

    it('returns null when no attribution found', async () => {
      Attribution.findOne.mockResolvedValue(null);

      const result = await resolveSession('sess-123', null);

      expect(result).toBeNull();
    });

    it('resolves session from existing attribution', async () => {
      Attribution.findOne.mockResolvedValue({
        ...mockAttribution,
        sessionId: 'sess-123',
        qrTagId: 'qr-1',
      });
      QrTag.findByPk.mockResolvedValue({ ...mockQrTag, campaignId: 'camp-1' });
      Campaign.findByPk.mockResolvedValue(mockCampaign);

      const result = await resolveSession('sess-123', null);

      expect(result).toBeDefined();
      expect(result.qrTagId).toBe('qr-1');
      expect(result.campaignId).toBe('camp-1');
    });

    it('returns null when QR tag is inactive', async () => {
      Attribution.findOne.mockResolvedValue(mockAttribution);
      QrTag.findByPk.mockResolvedValue({ ...mockQrTag, active: false });

      const result = await resolveSession('sess-123', null);

      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────────
  // resolveSession edge cases
  // ────────────────────────────────────────────────

  describe('resolveSession (edge cases)', () => {
    it('returns null when QR tag not found', async () => {
      Attribution.findOne.mockResolvedValue(mockAttribution);
      QrTag.findByPk.mockResolvedValue(null);

      const result = await resolveSession('sess-123', null);

      expect(result).toBeNull();
    });

    it('returns null for expired attribution token', async () => {
      Attribution.findOne.mockResolvedValue(null);
      // atk cookie with expired signature won't bind
      const result = await resolveSession('sess-123', 'invalid.token');

      expect(result).toBeNull();
    });

    it('returns campaign info when QR tag has campaignId', async () => {
      Attribution.findOne.mockResolvedValue({
        ...mockAttribution,
        sessionId: 'sess-123',
      });
      QrTag.findByPk.mockResolvedValue({ ...mockQrTag, campaignId: 'camp-1' });
      Campaign.findByPk.mockResolvedValue(mockCampaign);

      const result = await resolveSession('sess-123', null);

      expect(result.campaign).toBeDefined();
      expect(result.campaign.name).toBe('Test Campaign');
    });

    it('returns null campaign when QR tag has no campaignId', async () => {
      Attribution.findOne.mockResolvedValue(mockAttribution);
      QrTag.findByPk.mockResolvedValue({ ...mockQrTag, campaignId: null, active: true });

      const result = await resolveSession('sess-123', null);

      expect(result).toBeDefined();
      expect(result.campaign).toBeNull();
    });
  });

  // ────────────────────────────────────────────────
  // recordScan edge cases
  // ────────────────────────────────────────────────

  describe('recordScan (edge cases)', () => {
    it('does not mark as duplicate when scan is older than 2 minutes', async () => {
      const oldScan = {
        ts: new Date(Date.now() - 3 * 60 * 1000), // 3 minutes ago
        ipHash: crypto.createHash('sha256').update('1.2.3.4:dev-salt').digest('hex'),
        ua: 'Mozilla/5.0',
      };
      QrScan.findOne.mockResolvedValue(oldScan);

      await recordScan(mockQrTag, {
        userAgent: 'Mozilla/5.0',
        referer: '',
        ip: '1.2.3.4',
      });

      const createArg = QrScan.create.mock.calls[0][0];
      expect(createArg.isDuplicate).toBe(false);
    });

    it('detects iPad as mobile', async () => {
      await recordScan(mockQrTag, {
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 15_0)',
        referer: '',
        ip: '1.2.3.4',
      });

      const createArg = QrScan.create.mock.calls[0][0];
      expect(createArg.device).toBe('mobile');
    });

    it('detects spider as bot', async () => {
      await recordScan(mockQrTag, {
        userAgent: 'Mozilla/5.0 (compatible; Baiduspider/2.0)',
        referer: '',
        ip: '1.2.3.4',
      });

      const createArg = QrScan.create.mock.calls[0][0];
      expect(createArg.botFlag).toBe(true);
    });

    it('stores referer in scan record', async () => {
      await recordScan(mockQrTag, {
        userAgent: 'Mozilla/5.0',
        referer: 'https://facebook.com/some-post',
        ip: '1.2.3.4',
      });

      const createArg = QrScan.create.mock.calls[0][0];
      expect(createArg.referer).toBe('https://facebook.com/some-post');
    });
  });

  // ────────────────────────────────────────────────
  // createAttribution edge cases
  // ────────────────────────────────────────────────

  describe('createAttribution (edge cases)', () => {
    it('sets 20-minute expiry on attribution', async () => {
      const before = Date.now();
      const result = await createAttribution(mockQrTag, mockScan);
      const after = Date.now();

      const expiryMs = result.expiresAt.getTime();
      const twentyMin = 20 * 60 * 1000;
      expect(expiryMs).toBeGreaterThanOrEqual(before + twentyMin - 100);
      expect(expiryMs).toBeLessThanOrEqual(after + twentyMin + 100);
    });

    it('creates attribution with correct qrTagId and scanId', async () => {
      await createAttribution(mockQrTag, mockScan);

      expect(Attribution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          qrTagId: 'qr-1',
          qrScanId: 'scan-1',
          sessionId: null,
          firstTouch: false,
        })
      );
    });
  });

  // ────────────────────────────────────────────────
  // generateSessionId
  // ────────────────────────────────────────────────

  describe('generateSessionId', () => {
    it('generates a hex string of 32 characters', () => {
      const sid = generateSessionId();

      expect(sid).toMatch(/^[0-9a-f]{32}$/);
    });

    it('generates unique IDs', () => {
      const sid1 = generateSessionId();
      const sid2 = generateSessionId();

      expect(sid1).not.toBe(sid2);
    });

    it('generates IDs of consistent length', () => {
      const ids = Array.from({ length: 10 }, () => generateSessionId());
      for (const id of ids) {
        expect(id).toHaveLength(32);
      }
    });
  });
});
