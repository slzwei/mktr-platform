import { jest } from '@jest/globals';
import '../setup.js';

// ── Helpers ──

function buildMocks() {
  const mockLink = {
    id: 'link-1',
    slug: 'abc12345',
    targetUrl: 'https://app.mktr.sg/LeadCapture?c=camp-1',
    purpose: 'share',
    campaignId: 'camp-1',
    clickCount: 5,
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    update: jest.fn().mockResolvedValue(true),
    destroy: jest.fn().mockResolvedValue(true),
  };

  const ShortLink = {
    create: jest.fn().mockResolvedValue(mockLink),
    findOne: jest.fn().mockResolvedValue(null), // default: no collision
    findByPk: jest.fn().mockResolvedValue(mockLink),
    findAndCountAll: jest.fn().mockResolvedValue({ count: 0, rows: [] }),
  };

  const ShortLinkClick = {
    create: jest.fn().mockResolvedValue({}),
    findAll: jest.fn().mockResolvedValue([]),
    destroy: jest.fn().mockResolvedValue(1),
  };

  const sequelize = {
    literal: jest.fn((expr) => expr),
  };

  const AppError = class extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
    }
  };

  return { mockLink, ShortLink, ShortLinkClick, sequelize, AppError };
}

let mocks;
let service;

beforeEach(async () => {
  mocks = buildMocks();

  jest.unstable_mockModule('../../src/models/index.js', () => ({
    ShortLink: mocks.ShortLink,
    ShortLinkClick: mocks.ShortLinkClick,
    sequelize: mocks.sequelize,
  }));

  jest.unstable_mockModule('../../src/middleware/errorHandler.js', () => ({
    AppError: mocks.AppError,
  }));

  service = await import('../../src/services/shortlinkService.js');
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

// ── Tests ──

describe('shortlinkService (unit)', () => {

  // ── createShareLink ──

  describe('createShareLink', () => {
    it('creates a share link for a LeadCapture URL', async () => {
      const result = await service.createShareLink({
        targetUrl: 'https://app.mktr.sg/LeadCapture?c=camp-1',
        campaignId: 'camp-1',
      });

      expect(mocks.ShortLink.create).toHaveBeenCalledWith(
        expect.objectContaining({
          targetUrl: 'https://app.mktr.sg/LeadCapture?c=camp-1',
          purpose: 'share',
          createdBy: null,
        })
      );
      expect(result).toHaveProperty('slug');
      expect(result).toHaveProperty('url');
    });

    it('throws 400 when targetUrl is missing', async () => {
      await expect(service.createShareLink({}))
        .rejects.toThrow('targetUrl is required');
    });

    it('throws 400 when targetUrl is not a lead capture URL', async () => {
      await expect(service.createShareLink({ targetUrl: 'https://evil.com' }))
        .rejects.toThrow('Only lead capture URLs can be shortened');
    });

    it('rejects a lead-capture URL on a non-owned host (open-redirect guard)', async () => {
      await expect(service.createShareLink({ targetUrl: 'https://evil.com/LeadCapture?c=1' }))
        .rejects.toThrow(/host is not allowed/i);
      expect(mocks.ShortLink.create).not.toHaveBeenCalled();
    });

    it('accepts lead-capture (kebab-case) URLs', async () => {
      const result = await service.createShareLink({
        targetUrl: 'https://app.mktr.sg/lead-capture?c=camp-1',
      });

      expect(result).toHaveProperty('slug');
    });

    it('sets expiry to 90 days from now', async () => {
      await service.createShareLink({
        targetUrl: 'https://app.mktr.sg/LeadCapture?c=1',
      });

      const createArg = mocks.ShortLink.create.mock.calls[0][0];
      const expiresAt = new Date(createArg.expiresAt);
      const now = new Date();
      const diffDays = (expiresAt - now) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(89);
      expect(diffDays).toBeLessThanOrEqual(91);
    });
  });

  // ── createAdminLink ──

  describe('createAdminLink', () => {
    it('creates a link with userId as createdBy', async () => {
      const result = await service.createAdminLink({
        targetUrl: 'https://any.url/path',
        purpose: 'admin',
        ttlDays: 30,
      }, 'admin-1');

      expect(mocks.ShortLink.create).toHaveBeenCalledWith(
        expect.objectContaining({
          createdBy: 'admin-1',
          purpose: 'admin',
        })
      );
      expect(result).toHaveProperty('slug');
      expect(result).toHaveProperty('link');
    });

    it('throws 400 when targetUrl is missing', async () => {
      await expect(service.createAdminLink({}, 'admin-1'))
        .rejects.toThrow('targetUrl is required');
    });
  });

  // ── resolveSlug ──

  describe('resolveSlug', () => {
    it('returns ok with link for valid slug', async () => {
      mocks.ShortLink.findOne.mockResolvedValue(mocks.mockLink);

      const result = await service.resolveSlug('abc12345');

      expect(result.status).toBe('ok');
      expect(result.link).toBe(mocks.mockLink);
    });

    it('returns not_found when slug does not exist', async () => {
      mocks.ShortLink.findOne.mockResolvedValue(null);

      const result = await service.resolveSlug('nonexistent');

      expect(result.status).toBe('not_found');
      expect(result.link).toBeNull();
    });

    it('returns expired when link is past expiry', async () => {
      const expiredLink = {
        ...mocks.mockLink,
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
      };
      mocks.ShortLink.findOne.mockResolvedValue(expiredLink);

      const result = await service.resolveSlug('expired');

      expect(result.status).toBe('expired');
      expect(result.link).toBeNull();
    });
  });

  // ── recordClick ──

  describe('recordClick', () => {
    it('creates a click record and increments counter', async () => {
      await service.recordClick(mocks.mockLink, {
        userAgent: 'Mozilla/5.0',
        referer: 'https://google.com',
        ip: '1.2.3.4',
      });

      expect(mocks.ShortLinkClick.create).toHaveBeenCalledWith(
        expect.objectContaining({
          shortLinkId: 'link-1',
          device: 'desktop',
        })
      );
      expect(mocks.mockLink.update).toHaveBeenCalled();
    });

    it('detects mobile user agent', async () => {
      await service.recordClick(mocks.mockLink, {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS)',
        referer: '',
        ip: '1.2.3.4',
      });

      const createArg = mocks.ShortLinkClick.create.mock.calls[0][0];
      expect(createArg.device).toBe('mobile');
    });

    it('does not throw when create fails (swallows errors)', async () => {
      mocks.ShortLinkClick.create.mockRejectedValue(new Error('DB error'));

      await expect(
        service.recordClick(mocks.mockLink, { userAgent: '', referer: '', ip: '1.1.1.1' })
      ).resolves.toBeUndefined();
    });
  });

  // ── listLinks ──

  describe('listLinks', () => {
    it('returns items and total count', async () => {
      mocks.ShortLink.findAndCountAll.mockResolvedValue({ count: 2, rows: [mocks.mockLink] });

      const result = await service.listLinks({ page: 1, limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(2);
    });

    it('applies pagination offset correctly', async () => {
      mocks.ShortLink.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listLinks({ page: 3, limit: 10 });

      const callArg = mocks.ShortLink.findAndCountAll.mock.calls[0][0];
      expect(callArg.offset).toBe(20); // (3-1) * 10
      expect(callArg.limit).toBe(10);
    });

    it('applies search filter on slug', async () => {
      mocks.ShortLink.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await service.listLinks({ search: 'abc' });

      const callArg = mocks.ShortLink.findAndCountAll.mock.calls[0][0];
      expect(callArg.where.slug).toBeDefined();
    });
  });

  // ── updateLink ──

  describe('updateLink', () => {
    it('updates expiresAt for existing link', async () => {
      const newDate = '2027-01-01T00:00:00.000Z';
      await service.updateLink('link-1', { expiresAt: newDate });

      expect(mocks.mockLink.update).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt: expect.any(Date) })
      );
    });

    it('throws 404 when link not found', async () => {
      mocks.ShortLink.findByPk.mockResolvedValue(null);

      await expect(service.updateLink('bad-id', { expiresAt: '2027-01-01' }))
        .rejects.toThrow('Not found');
    });
  });

  // ── getClicks ──

  describe('getClicks', () => {
    it('returns click records for a short link', async () => {
      const clicks = [{ id: 'click-1', device: 'desktop' }];
      mocks.ShortLinkClick.findAll.mockResolvedValue(clicks);

      const result = await service.getClicks('link-1');

      expect(mocks.ShortLinkClick.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { shortLinkId: 'link-1' } })
      );
      expect(result).toEqual(clicks);
    });
  });

  // ── deleteLink ──

  describe('deleteLink', () => {
    it('deletes link and associated clicks', async () => {
      await service.deleteLink('link-1');

      expect(mocks.ShortLinkClick.destroy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { shortLinkId: 'link-1' } })
      );
      expect(mocks.mockLink.destroy).toHaveBeenCalled();
    });

    it('throws 404 when link not found', async () => {
      mocks.ShortLink.findByPk.mockResolvedValue(null);

      await expect(service.deleteLink('bad-id'))
        .rejects.toThrow('Not found');
    });
  });
});
