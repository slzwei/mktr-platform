import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { storageService } from './storage.js';
import { transcodeUploadedVideoToMp4 } from './videoService.js';
import { AppError } from '../middleware/errorHandler.js';

// Base uploads directory
const uploadsDir = path.join(process.cwd(), 'uploads');

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
    const key = `${type}/${file.filename}`;
    const buffer = fs.readFileSync(file.path);
    fileUrl = await storageService.uploadBuffer(key, buffer, file.mimetype);
    try { fs.unlinkSync(file.path); } catch (err) { void err; }
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
    const key = `avatars/${file.filename}`;
    const buffer = fs.readFileSync(file.path);
    avatarUrl = await storageService.uploadBuffer(key, buffer, file.mimetype);
    try { fs.unlinkSync(file.path); } catch (err) { void err; }
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
      const key = `campaigns/${campaignId}/${file.filename}`;
      const buffer = fs.readFileSync(file.path);
      url = await storageService.uploadBuffer(key, buffer, file.mimetype);
      try { fs.unlinkSync(file.path); } catch (err) { void err; }
    } else {
      const campaignDir = path.join(uploadsDir, 'campaigns', campaignId);
      if (!fs.existsSync(campaignDir)) fs.mkdirSync(campaignDir, { recursive: true });
      const newPath = path.join(campaignDir, file.filename);
      fs.renameSync(file.path, newPath);
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
  if (!fs.existsSync(entityDir)) {
    fs.mkdirSync(entityDir, { recursive: true });
  }

  const documents = [];
  for (const file of files) {
    const newPath = path.join(entityDir, file.filename);
    fs.renameSync(file.path, newPath);

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
 * Delete a file by type and filename.
 * Validates the path stays within the uploads directory.
 */
export function deleteFile(type, filename) {
  const filePath = path.join(uploadsDir, type, filename);

  // Security check - ensure file is within uploads directory
  const resolvedPath = path.resolve(filePath);
  const uploadsPath = path.resolve(uploadsDir);

  if (!resolvedPath.startsWith(uploadsPath)) {
    throw new AppError('Invalid file path', 400);
  }

  if (!fs.existsSync(filePath)) {
    throw new AppError('File not found', 404);
  }

  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    throw new AppError('Failed to delete file', 500);
  }
}

/**
 * Get file info (stats) by type and filename.
 * Validates the path stays within the uploads directory.
 */
export function getFileInfo(type, filename) {
  const filePath = path.join(uploadsDir, type, filename);

  // Security check
  const resolvedPath = path.resolve(filePath);
  const uploadsPath = path.resolve(uploadsDir);

  if (!resolvedPath.startsWith(uploadsPath)) {
    throw new AppError('Invalid file path', 400);
  }

  if (!fs.existsSync(filePath)) {
    throw new AppError('File not found', 404);
  }

  const stats = fs.statSync(filePath);
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
export function listFiles(type, page = 1, limit = 20) {
  const dirPath = path.join(uploadsDir, type);

  // Path traversal check — ensure resolved path stays within uploads directory
  const resolvedPath = path.resolve(dirPath);
  if (!resolvedPath.startsWith(path.resolve(uploadsDir))) {
    throw new AppError('Invalid path', 400);
  }

  if (!fs.existsSync(dirPath)) {
    return {
      files: [],
      pagination: { currentPage: 1, totalPages: 0, totalItems: 0 }
    };
  }

  const files = fs.readdirSync(dirPath)
    .filter(file => !file.startsWith('.'))
    .map(filename => {
      const filePath = path.join(dirPath, filename);
      const stats = fs.statSync(filePath);
      return {
        filename,
        type,
        size: stats.size,
        url: `/uploads/${type}/${filename}`,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime
      };
    })
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
export function getStorageUsage() {
  const getDirectorySize = (dirPath) => {
    if (!fs.existsSync(dirPath)) return 0;

    let totalSize = 0;
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);

      if (stats.isDirectory()) {
        totalSize += getDirectorySize(filePath);
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
    const size = getDirectorySize(path.join(uploadsDir, type));
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
