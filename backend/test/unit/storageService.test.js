import { jest } from '@jest/globals';
import '../setup.js';

// ── Mock AWS SDK ──

const mockSend = jest.fn().mockResolvedValue({});

jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn().mockImplementation((params) => params),
  DeleteObjectCommand: jest.fn().mockImplementation((params) => params),
}));

// Must import after mocking
const storageModule = await import('../../src/services/storage.js');
const { storageService } = storageModule;

// ── Tests ──

describe('storageService (unit)', () => {
  const savedEnv = {};

  beforeEach(() => {
    jest.clearAllMocks();
    savedEnv.DO_SPACES_KEY = process.env.DO_SPACES_KEY;
    savedEnv.DO_SPACES_SECRET = process.env.DO_SPACES_SECRET;
    savedEnv.DO_SPACES_REGION = process.env.DO_SPACES_REGION;
    savedEnv.DO_SPACES_ENDPOINT = process.env.DO_SPACES_ENDPOINT;
    savedEnv.DO_SPACES_BUCKET = process.env.DO_SPACES_BUCKET;
    savedEnv.DO_SPACES_CDN_BASE = process.env.DO_SPACES_CDN_BASE;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  // ────────────────────────────────────────────────
  // isEnabled
  // ────────────────────────────────────────────────

  describe('isEnabled', () => {
    it('returns false when env vars are missing', () => {
      delete process.env.DO_SPACES_KEY;
      delete process.env.DO_SPACES_SECRET;

      expect(storageService.isEnabled()).toBe(false);
    });

    it('returns a boolean', () => {
      // isEnabled reads from config captured at module load time
      const result = storageService.isEnabled();
      expect(typeof result).toBe('boolean');
    });
  });

  // ────────────────────────────────────────────────
  // publicUrl
  // ────────────────────────────────────────────────

  describe('publicUrl', () => {
    it('returns a URL containing the key path', () => {
      const url = storageService.publicUrl('image/test.png');

      expect(url).toContain('image/test.png');
    });

    it('strips leading slashes from key', () => {
      // Note: spacesConfig is captured at module load time, so we test
      // based on what was set when the module loaded
      const url = storageService.publicUrl('/image/test.png');

      // Should strip leading slash from key
      expect(url).not.toContain('//image');
    });

    it('handles key without leading slash', () => {
      const url = storageService.publicUrl('image/test.png');

      expect(url).toContain('image/test.png');
    });

    it('publicUrl returns a string', () => {
      const url = storageService.publicUrl('image/test.png');

      expect(typeof url).toBe('string');
      expect(url.length).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────
  // uploadBuffer
  // ────────────────────────────────────────────────

  describe('uploadBuffer', () => {
    it('throws when spaces not configured', async () => {
      delete process.env.DO_SPACES_KEY;

      await expect(storageService.uploadBuffer('test.png', Buffer.from('data'), 'image/png'))
        .rejects.toThrow('Spaces not configured');
    });
  });

  // ────────────────────────────────────────────────
  // deleteObject
  // ────────────────────────────────────────────────

  describe('deleteObject', () => {
    it('throws when spaces not configured', async () => {
      delete process.env.DO_SPACES_KEY;

      await expect(storageService.deleteObject('test.png'))
        .rejects.toThrow('Spaces not configured');
    });
  });

  // ────────────────────────────────────────────────
  // publicUrl edge cases
  // ────────────────────────────────────────────────

  describe('publicUrl (edge cases)', () => {
    it('handles deeply nested key paths', () => {
      const url = storageService.publicUrl('campaigns/camp-1/media/video.mp4');
      expect(url).toContain('campaigns/camp-1/media/video.mp4');
    });

    it('handles key with special characters', () => {
      const url = storageService.publicUrl('image/test file (1).png');
      expect(url).toContain('test file (1).png');
    });

    it('handles empty key', () => {
      const url = storageService.publicUrl('');
      expect(typeof url).toBe('string');
    });

    it('produces consistent URLs for same key', () => {
      const url1 = storageService.publicUrl('image/test.png');
      const url2 = storageService.publicUrl('image/test.png');
      expect(url1).toBe(url2);
    });
  });
});
