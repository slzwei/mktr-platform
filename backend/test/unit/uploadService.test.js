import { jest } from '@jest/globals';
import '../setup.js';

// ── Mock dependencies ──
// P4-10: uploadService streams from disk via fs.createReadStream +
// fs.promises (single 'fs' mock target) and calls storageService.uploadStream
// with a stat'ed length — the old readFileSync/uploadBuffer surface is gone.

const storageService = {
  isEnabled: jest.fn(),
  uploadStream: jest.fn(),
};

const mockFsp = {
  stat: jest.fn(),
  unlink: jest.fn(),
  readdir: jest.fn(),
  mkdir: jest.fn(),
  rename: jest.fn(),
};

const mockFs = {
  createReadStream: jest.fn().mockReturnValue('mock-stream'),
  promises: mockFsp,
};

const AppError = class extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
};

jest.unstable_mockModule('../../src/services/storage.js', () => ({ storageService }));
jest.unstable_mockModule('../../src/middleware/appError.js', () => ({ AppError }));
jest.unstable_mockModule('fs', () => ({ default: mockFs, ...mockFs }));
jest.unstable_mockModule('uuid', () => ({ v4: jest.fn().mockReturnValue('mock-uuid') }));

const {
  processSingleUpload, processMultipleUpload, processAvatarUpload,
  deleteFile, getFileInfo, listFiles, getStorageUsage,
} = await import('../../src/services/uploadService.js');

// ── Tests ──

describe('uploadService (unit)', () => {
  let mockFile, mockUser;

  beforeEach(() => {
    jest.clearAllMocks();

    mockFile = {
      originalname: 'photo.jpg',
      filename: 'photo-123.jpg',
      mimetype: 'image/jpeg',
      size: 1024,
      path: '/tmp/uploads/photo-123.jpg',
    };

    mockUser = { id: 'user-1', update: jest.fn().mockResolvedValue(true) };

    storageService.isEnabled.mockReturnValue(false);
    storageService.uploadStream.mockResolvedValue('https://cdn.example.com/photo-123.jpg');
    mockFs.createReadStream.mockReturnValue('mock-stream');
    mockFsp.stat.mockResolvedValue({
      size: 2048, // ≠ multer's file.size — proves the send-time stat is used
      birthtime: new Date('2025-01-01'),
      mtime: new Date('2025-01-02'),
      isDirectory: () => false,
    });
    mockFsp.unlink.mockResolvedValue(undefined);
    mockFsp.readdir.mockResolvedValue(['file1.jpg', 'file2.png']);
    mockFsp.mkdir.mockResolvedValue(undefined);
    mockFsp.rename.mockResolvedValue(undefined);
  });

  // ── processSingleUpload ──

  describe('processSingleUpload', () => {
    it('returns local file URL when storage is not enabled', async () => {
      const result = await processSingleUpload(mockFile, 'general', 'user-1');

      expect(result.url).toBe('/uploads/general/photo-123.jpg');
      expect(result.id).toBe('mock-uuid');
      expect(result.originalName).toBe('photo.jpg');
      expect(result.uploadedBy).toBe('user-1');
    });

    it('STREAMS to cloud storage with the stat-time length (never buffers, never trusts stale file.size)', async () => {
      storageService.isEnabled.mockReturnValue(true);

      const result = await processSingleUpload(mockFile, 'general', 'user-1');

      expect(mockFs.createReadStream).toHaveBeenCalledWith('/tmp/uploads/photo-123.jpg');
      expect(storageService.uploadStream).toHaveBeenCalledWith(
        'general/photo-123.jpg', 'mock-stream', 'image/jpeg', 2048
      );
      expect(result.url).toBe('https://cdn.example.com/photo-123.jpg');
      expect(mockFsp.unlink).toHaveBeenCalledWith('/tmp/uploads/photo-123.jpg');
    });
  });

  // ── processMultipleUpload ──

  describe('processMultipleUpload', () => {
    it('processes each file and returns array of results', async () => {
      const files = [
        { ...mockFile, filename: 'a.jpg' },
        { ...mockFile, filename: 'b.jpg' },
      ];

      const result = await processMultipleUpload(files, 'general', 'user-1');

      expect(result).toHaveLength(2);
      expect(result[0].url).toContain('a.jpg');
      expect(result[1].url).toContain('b.jpg');
    });
  });

  // ── processAvatarUpload ──

  describe('processAvatarUpload', () => {
    it('updates user avatar and returns avatar info', async () => {
      const result = await processAvatarUpload(mockFile, mockUser);

      expect(mockUser.update).toHaveBeenCalledWith({ avatar: '/uploads/avatars/photo-123.jpg' });
      expect(result.url).toBe('/uploads/avatars/photo-123.jpg');
      expect(result.filename).toBe('photo-123.jpg');
    });

    it('throws 400 for non-image file', async () => {
      const pdfFile = { ...mockFile, mimetype: 'application/pdf' };

      await expect(processAvatarUpload(pdfFile, mockUser))
        .rejects.toThrow('Avatar must be an image file');
    });
  });

  // ── deleteFile ──

  describe('deleteFile', () => {
    it('deletes file within uploads directory', async () => {
      await deleteFile('general', 'photo-123.jpg');

      expect(mockFsp.unlink).toHaveBeenCalled();
    });

    it('throws 404 when file does not exist', async () => {
      mockFsp.unlink.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }));

      await expect(deleteFile('general', 'nonexistent.jpg')).rejects.toThrow('File not found');
    });

    it('throws 500 on any other unlink failure', async () => {
      mockFsp.unlink.mockRejectedValue(Object.assign(new Error('disk'), { code: 'EIO' }));

      await expect(deleteFile('general', 'photo-123.jpg')).rejects.toThrow('Failed to delete file');
    });
  });

  // ── getFileInfo ──

  describe('getFileInfo', () => {
    it('returns file stats for existing file', async () => {
      const result = await getFileInfo('general', 'photo-123.jpg');

      expect(result.filename).toBe('photo-123.jpg');
      expect(result.type).toBe('general');
      expect(result.size).toBe(2048);
      expect(result.url).toBe('/uploads/general/photo-123.jpg');
    });

    it('throws 404 when file does not exist', async () => {
      mockFsp.stat.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }));

      await expect(getFileInfo('general', 'nonexistent.jpg')).rejects.toThrow('File not found');
    });
  });

  // ── listFiles ──

  describe('listFiles', () => {
    it('returns paginated file list', async () => {
      mockFsp.readdir.mockResolvedValue(['a.jpg', 'b.jpg', 'c.jpg']);

      const result = await listFiles('general', 1, 2);

      expect(result.files).toHaveLength(2);
      expect(result.pagination.totalItems).toBe(3);
      expect(result.pagination.totalPages).toBe(2);
    });

    it('returns empty list when directory does not exist', async () => {
      mockFsp.readdir.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }));

      const result = await listFiles('nonexistent');

      expect(result.files).toEqual([]);
      expect(result.pagination.totalItems).toBe(0);
    });
  });

  // ── getStorageUsage ──

  describe('getStorageUsage', () => {
    it('returns storage usage by type', async () => {
      mockFsp.readdir.mockResolvedValue(['file1.jpg']);
      mockFsp.stat.mockResolvedValue({ size: 1048576, isDirectory: () => false });

      const result = await getStorageUsage();

      expect(result.totalUsage.bytes).toBeGreaterThan(0);
      expect(result.byType.general).toBeDefined();
      expect(result.byType.avatars).toBeDefined();
      expect(result.byType.campaigns).toBeDefined();
    });
  });
});
