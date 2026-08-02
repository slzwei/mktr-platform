import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { storageService } from './storage.js';
import { transcodeUploadedVideoToMp4 } from './videoService.js';
import { AppError } from '../middleware/appError.js';

// fs.promises off the same module so the unit suite mocks ONE target.
const fsp = fs.promises;

// Base uploads directory
const uploadsDir = path.join(process.cwd(), 'uploads');

/**
 * Stream an on-disk upload to cloud storage, then remove the temp file.
 * P4-10: the old path fs.readFileSync'd the ENTIRE upload (including
 * transcoded video) into memory on the request path, blocking the event
 * loop. The size is stat'ed at send time — multer's `file.size` goes stale
 * once the transcode step rewrites the file on disk.
 */
async function uploadFileToStorage(key, file) {
  const { size } = await fsp.stat(file.path);
  const url = await storageService.uploadStream(key, fs.createReadStream(file.path), file.mimetype, size);
  await fsp.unlink(file.path).catch(() => {});
  return url;
}

/**
 * Upload a single file to cloud storage (if enabled) or keep local.
 * Returns a fileInfo object.
 */
export async function processSingleUpload(file, type = 'general', userId) {
  // Videos are normalized to a silent, web-optimized MP4 before storage, so any
  // source format (MOV/HEVC, etc.) plays cross-browser as a muted hero loop.
  await transcodeUploadedVideoToMp4(file);

  let fileUrl = `/uploads/${type}/${file.filename}`;

  if (storageService.isEnabled()) {
    fileUrl = await uploadFileToStorage(`${type}/${file.filename}`, file);
  }

  return {
    id: uuidv4(),
    originalName: file.originalname,
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size,
    url: fileUrl,
    type,
    uploadedBy: userId,
    uploadedAt: new Date()
  };
}

/**
 * Upload multiple files. Returns array of fileInfo objects.
 */
export async function processMultipleUpload(files, type = 'general', userId) {
  const results = [];
  for (const file of files) {
    const fileInfo = await processSingleUpload(file, type, userId);
    results.push(fileInfo);
  }
  return results;
}

/**
 * Process an avatar upload.
 * Validates it's an image, uploads to storage, updates the user model.
 * Returns avatar info.
 */
export async function processAvatarUpload(file, user) {
  if (!file.mimetype.startsWith('image/')) {
    throw new AppError('Avatar must be an image file', 400);
  }

  let avatarUrl = `/uploads/avatars/${file.filename}`;
  if (storageService.isEnabled()) {
    avatarUrl = await uploadFileToStorage(`avatars/${file.filename}`, file);
  }

  await user.update({ avatar: avatarUrl });

  return {
    url: avatarUrl,
    filename: file.filename,
    size: file.size
  };
}

/**
 * Process campaign asset uploads.
 * Moves files into campaign-specific directory (local) or cloud storage.
 * Returns array of asset info objects.
 */
export async function processCampaignAssets(files, campaignId, userId) {
  const assets = [];
  for (const file of files) {
    let url = `/uploads/campaigns/${campaignId}/${file.filename}`;
    if (storageService.isEnabled()) {
      url = await uploadFileToStorage(`campaigns/${campaignId}/${file.filename}`, file);
    } else {
      const campaignDir = path.join(uploadsDir, 'campaigns', campaignId);
      await fsp.mkdir(campaignDir, { recursive: true });
      await fsp.rename(file.path, path.join(campaignDir, file.filename));
    }
    assets.push({
      id: uuidv4(),
      originalName: file.originalname,
      filename: file.filename,
      mimetype: file.mimetype,
      size: file.size,
      url,
      type: 'campaign-asset',
      campaignId,
      uploadedBy: userId,
      uploadedAt: new Date()
    });
  }
  return assets;
}

/**
 * Process document uploads for entity verification.
 * Moves files into entity-specific directory.
 * Returns array of document info objects.
 */
const ALLOWED_ENTITY_TYPES = ['prospects', 'campaigns', 'users', 'cars', 'drivers'];

export async function processDocumentUpload(files, entityType, entityId, userId) {
  if (!ALLOWED_ENTITY_TYPES.includes(entityType)) {
    throw new AppError('Invalid entity type', 400);
  }

  const entityDir = path.join(uploadsDir, 'documents', entityType, entityId);
  await fsp.mkdir(entityDir, { recursive: true });

  const documents = [];
  for (const file of files) {
    await fsp.rename(file.path, path.join(entityDir, file.filename));

    documents.push({
      id: uuidv4(),
      originalName: file.originalname,
      filename: file.filename,
      mimetype: file.mimetype,
      size: file.size,
      url: `/uploads/documents/${entityType}/${entityId}/${file.filename}`,
      type: 'document',
      entityType,
      entityId,
      uploadedBy: userId,
      uploadedAt: new Date()
    });
  }
  return documents;
}

/**
 * Resolve + traversal-check a path under uploads/.
 *
 * The check is relative-path based, not prefix based (P1-5): a bare
 * startsWith() accepts any SIBLING directory that merely shares the prefix —
 * path.resolve('/app/uploads-x').startsWith('/app/uploads') is true — so
 * type='../uploads-x' escaped the sandbox while passing the guard.
 */
function safeUploadsPath(...segments) {
  const root = path.resolve(uploadsDir);
  const filePath = path.resolve(path.join(uploadsDir, ...segments));
  const relative = path.relative(root, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError('Invalid file path', 400);
  }
  return filePath;
}

/**
 * Delete a file by type and filename.
 * Validates the path stays within the uploads directory.
 */
export async function deleteFile(type, filename) {
  const filePath = safeUploadsPath(type, filename);
  try {
    await fsp.unlink(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new AppError('File not found', 404);
    throw new AppError('Failed to delete file', 500);
  }
}

/**
 * Get file info (stats) by type and filename.
 * Validates the path stays within the uploads directory.
 */
export async function getFileInfo(type, filename) {
  const filePath = safeUploadsPath(type, filename);
  let stats;
  try {
    stats = await fsp.stat(filePath);
  } catch {
    throw new AppError('File not found', 404);
  }
  return {
    filename,
    type,
    size: stats.size,
    url: `/uploads/${type}/${filename}`,
    createdAt: stats.birthtime,
    modifiedAt: stats.mtime
  };
}

/**
 * List files in a type directory with pagination.
 * Returns { files, pagination }.
 */
export async function listFiles(type, page = 1, limit = 20) {
  const dirPath = safeUploadsPath(type);

  let names;
  try {
    names = await fsp.readdir(dirPath);
  } catch {
    return {
      files: [],
      pagination: { currentPage: 1, totalPages: 0, totalItems: 0 }
    };
  }

  const files = (await Promise.all(
    names
      .filter((file) => !file.startsWith('.'))
      .map(async (filename) => {
        try {
          const stats = await fsp.stat(path.join(dirPath, filename));
          return {
            filename,
            type,
            size: stats.size,
            url: `/uploads/${type}/${filename}`,
            createdAt: stats.birthtime,
            modifiedAt: stats.mtime
          };
        } catch {
          return null; // deleted between readdir and stat
        }
      })
  ))
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;
  const paginatedFiles = files.slice(offset, offset + limitNum);

  return {
    files: paginatedFiles,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(files.length / limitNum),
      totalItems: files.length,
      itemsPerPage: limitNum
    }
  };
}

/**
 * Calculate storage usage statistics across all upload types.
 * Returns { totalUsage, byType }.
 */
export async function getStorageUsage() {
  const getDirectorySize = async (dirPath) => {
    let names;
    try {
      names = await fsp.readdir(dirPath);
    } catch {
      return 0;
    }
    let totalSize = 0;
    for (const file of names) {
      const filePath = path.join(dirPath, file);
      let stats;
      try {
        stats = await fsp.stat(filePath);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        totalSize += await getDirectorySize(filePath);
      } else {
        totalSize += stats.size;
      }
    }
    return totalSize;
  };

  const types = ['general', 'avatars', 'campaigns', 'documents', 'images'];
  const usage = {};
  let totalUsage = 0;

  for (const type of types) {
    const size = await getDirectorySize(path.join(uploadsDir, type));
    usage[type] = {
      size,
      sizeFormatted: (size / (1024 * 1024)).toFixed(2) + ' MB'
    };
    totalUsage += size;
  }

  return {
    totalUsage: {
      bytes: totalUsage,
      formatted: (totalUsage / (1024 * 1024)).toFixed(2) + ' MB'
    },
    byType: usage
  };
}
