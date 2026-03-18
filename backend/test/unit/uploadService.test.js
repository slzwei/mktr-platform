import { jest } from '@jest/globals';
import '../setup.js';

// ── Mock dependencies ──

const storageService = {
  isEnabled: jest.fn(),
  uploadBuffer: jest.fn(),
};

const mockFs = {
  readFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  existsSync: jest.fn(),
  statSync: jest.fn(),
  readdirSync: jest.fn(),
  mkdirSync: jest.fn(),
  renameSync: jest.fn(),
};

const AppError = class extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
};

jest.unstable_mockModule('../../src/services/storage.js', () => ({ storageService }));
jest.unstable_mockModule('../../src/middleware/errorHandler.js', () => ({ AppError }));
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
    storageService.uploadBuffer.mockResolvedValue('https://cdn.example.com/photo-123.jpg');
    mockFs.readFileSync.mockReturnValue(Buffer.from('file-content'));
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({
      size: 1024,
      birthtime: new Date('2025-01-01'),
      mtime: new Date('2025-01-02'),
      isDirectory: () => false,
    });
    mockFs.readdirSync.mockReturnValue(['file1.jpg', 'file2.png']);
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

    it('uploads to cloud storage when enabled', async () => {
      storageService.isEnabled.mockReturnValue(true);

      const result = await processSingleUpload(mockFile, 'general', 'user-1');

      expect(storageService.uploadBuffer).toHaveBeenCalledWith(
        'general/photo-123.jpg', expect.any(Buffer), 'image/jpeg'
      );
      expect(result.url).toBe('https://cdn.example.com/photo-123.jpg');
      expect(mockFs.unlinkSync).toHaveBeenCalledWith('/tmp/uploads/photo-123.jpg');
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
    it('deletes file within uploads directory', () => {
      deleteFile('general', 'photo-123.jpg');

      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('throws 404 when file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      expect(() => deleteFile('general', 'nonexistent.jpg')).toThrow('File not found');
    });
  });

  // ── getFileInfo ──

  describe('getFileInfo', () => {
    it('returns file stats for existing file', () => {
      const result = getFileInfo('general', 'photo-123.jpg');

      expect(result.filename).toBe('photo-123.jpg');
      expect(result.type).toBe('general');
      expect(result.size).toBe(1024);
      expect(result.url).toBe('/uploads/general/photo-123.jpg');
    });

    it('throws 404 when file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      expect(() => getFileInfo('general', 'nonexistent.jpg')).toThrow('File not found');
    });
  });

  // ── listFiles ──

  describe('listFiles', () => {
    it('returns paginated file list', () => {
      mockFs.readdirSync.mockReturnValue(['a.jpg', 'b.jpg', 'c.jpg']);

      const result = listFiles('general', 1, 2);

      expect(result.files).toHaveLength(2);
      expect(result.pagination.totalItems).toBe(3);
      expect(result.pagination.totalPages).toBe(2);
    });

    it('returns empty list when directory does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = listFiles('nonexistent');

      expect(result.files).toEqual([]);
      expect(result.pagination.totalItems).toBe(0);
    });
  });

  // ── getStorageUsage ──

  describe('getStorageUsage', () => {
    it('returns storage usage by type', () => {
      mockFs.readdirSync.mockReturnValue(['file1.jpg']);
      mockFs.statSync.mockReturnValue({ size: 1048576, isDirectory: () => false });

      const result = getStorageUsage();

      expect(result.totalUsage.bytes).toBeGreaterThan(0);
      expect(result.byType.general).toBeDefined();
      expect(result.byType.avatars).toBeDefined();
      expect(result.byType.campaigns).toBeDefined();
    });
  });
});
