import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { storageService } from '../services/storage.js';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// --- Upload hardening constants ---

// Global allowlist of MIME types accepted by the platform
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'video/mp4', 'video/webm'
];

// Maximum upload size (default 10 MB, configurable via env)
const MAX_SIZE = (parseInt(process.env.MAX_UPLOAD_SIZE_MB) || 10) * 1024 * 1024;

// Sanitize filenames: strip path traversal and special characters
const sanitizeFilename = (name) => {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '.');
};

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { type = 'general' } = req.query;
    const uploadPath = path.join(uploadsDir, type);

    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = uuidv4();
    const ext = path.extname(file.originalname);
    const name = sanitizeFilename(path.basename(file.originalname, ext));
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

// File filter — enforce global allowlist first, then per-category allowlist
const fileFilter = (req, file, cb) => {
  // Global MIME type gate
  if (!ALLOWED_TYPES.includes(file.mimetype)) {
    logger.warn('Upload rejected: disallowed MIME type', { mimetype: file.mimetype, originalname: file.originalname });
    return cb(new AppError(`File type not allowed. Accepted types: ${ALLOWED_TYPES.join(', ')}`, 400), false);
  }

  // Per-category refinement (backwards-compatible with existing query param)
  const allowedByCategory = {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
    document: ['application/pdf'],
    video: ['video/mp4', 'video/webm'],
    campaign_media: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'video/mp4', 'video/webm']
  };

  const { type = 'image' } = req.query;
  const allowed = allowedByCategory[type] || allowedByCategory.image;

  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    logger.warn('Upload rejected: wrong category for MIME type', { mimetype: file.mimetype, category: type });
    cb(new AppError(`Invalid file type for category "${type}". Allowed: ${allowed.join(', ')}`, 400), false);
  }
};

// Configure upload middleware
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_SIZE,
    files: 5 // Max 5 files at once
  }
});

// Single file upload
router.post('/single', authenticateToken, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }

  const { type = 'general' } = req.query;
  let fileUrl = `/uploads/${type}/${req.file.filename}`;

  // If Spaces configured, upload file contents and return public URL, then remove local file
  if (storageService.isEnabled()) {
    const key = `${type}/${req.file.filename}`;
    const buffer = fs.readFileSync(req.file.path);
    const uploadedUrl = await storageService.uploadBuffer(key, buffer, req.file.mimetype);
    fileUrl = uploadedUrl;
    try { fs.unlinkSync(req.file.path); } catch (err) { void err }
  }

  const fileInfo = {
    id: uuidv4(),
    originalName: req.file.originalname,
    filename: req.file.filename,
    mimetype: req.file.mimetype,
    size: req.file.size,
    url: fileUrl,
    type,
    uploadedBy: req.user.id,
    uploadedAt: new Date()
  };

  res.json({
    success: true,
    message: 'File uploaded successfully',
    data: { file: fileInfo }
  });
}));

// Multiple files upload
router.post('/multiple', authenticateToken, upload.array('files', 5), asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No files uploaded', 400);
  }

  const { type = 'general' } = req.query;
  const files = [];
  for (const file of req.files) {
    let url = `/uploads/${type}/${file.filename}`;
    if (storageService.isEnabled()) {
      const key = `${type}/${file.filename}`;
      const buffer = fs.readFileSync(file.path);
      url = await storageService.uploadBuffer(key, buffer, file.mimetype);
      try { fs.unlinkSync(file.path); } catch (err) { void err }
    }
    files.push({
      id: uuidv4(),
      originalName: file.originalname,
      filename: file.filename,
      mimetype: file.mimetype,
      size: file.size,
      url,
      type,
      uploadedBy: req.user.id,
      uploadedAt: new Date()
    });
  }

  res.json({
    success: true,
    message: `${files.length} files uploaded successfully`,
    data: { files }
  });
}));

// Avatar/profile image upload
router.post('/avatar', authenticateToken, upload.single('avatar'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No avatar file uploaded', 400);
  }

  // Validate it's an image
  if (!req.file.mimetype.startsWith('image/')) {
    throw new AppError('Avatar must be an image file', 400);
  }

  let avatarUrl = `/uploads/avatars/${req.file.filename}`;
  if (storageService.isEnabled()) {
    const key = `avatars/${req.file.filename}`;
    const buffer = fs.readFileSync(req.file.path);
    avatarUrl = await storageService.uploadBuffer(key, buffer, req.file.mimetype);
    try { fs.unlinkSync(req.file.path); } catch (err) { void err }
  }

  // Update user's avatar
  await req.user.update({ avatar: avatarUrl });

  res.json({
    success: true,
    message: 'Avatar uploaded successfully',
    data: {
      avatar: {
        url: avatarUrl,
        filename: req.file.filename,
        size: req.file.size
      }
    }
  });
}));

// Campaign assets upload
router.post('/campaign-assets', authenticateToken, upload.array('assets', 10), asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No campaign assets uploaded', 400);
  }

  const { campaignId } = req.body;
  if (!campaignId) {
    throw new AppError('Campaign ID is required', 400);
  }

  // Create campaign-specific directory
  const assets = [];
  for (const file of req.files) {
    let url = `/uploads/campaigns/${campaignId}/${file.filename}`;
    if (storageService.isEnabled()) {
      const key = `campaigns/${campaignId}/${file.filename}`;
      const buffer = fs.readFileSync(file.path);
      url = await storageService.uploadBuffer(key, buffer, file.mimetype);
      try { fs.unlinkSync(file.path); } catch (err) { void err }
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
      uploadedBy: req.user.id,
      uploadedAt: new Date()
    });
  }

  res.json({
    success: true,
    message: `${assets.length} campaign assets uploaded successfully`,
    data: { assets }
  });
}));

// Document upload for fleet/driver verification
router.post('/documents', authenticateToken, upload.array('documents', 5), asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No documents uploaded', 400);
  }

  const { entityType, entityId } = req.body; // 'fleet_owner', 'driver', etc.

  if (!entityType || !entityId) {
    throw new AppError('Entity type and ID are required', 400);
  }

  // Create entity-specific directory
  const entityDir = path.join(uploadsDir, 'documents', entityType, entityId);
  if (!fs.existsSync(entityDir)) {
    fs.mkdirSync(entityDir, { recursive: true });
  }

  // Move files to entity directory
  const documents = [];
  for (const file of req.files) {
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
      uploadedBy: req.user.id,
      uploadedAt: new Date()
    });
  }

  res.json({
    success: true,
    message: `${documents.length} documents uploaded successfully`,
    data: { documents }
  });
}));

// Delete file
router.delete('/:type/:filename', authenticateToken, asyncHandler(async (req, res) => {
  const { type, filename } = req.params;
  const filePath = path.join(uploadsDir, type, filename);

  // Security check - ensure file is within uploads directory
  const resolvedPath = path.resolve(filePath);
  const uploadsPath = path.resolve(uploadsDir);

  if (!resolvedPath.startsWith(uploadsPath)) {
    throw new AppError('Invalid file path', 400);
  }

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    throw new AppError('File not found', 404);
  }

  // Delete file
  try {
    fs.unlinkSync(filePath);
    res.json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    throw new AppError('Failed to delete file', 500);
  }
}));

// Get file info
router.get('/info/:type/:filename', authenticateToken, asyncHandler(async (req, res) => {
  const { type, filename } = req.params;
  const filePath = path.join(uploadsDir, type, filename);

  // Security check
  const resolvedPath = path.resolve(filePath);
  const uploadsPath = path.resolve(uploadsDir);

  if (!resolvedPath.startsWith(uploadsPath)) {
    throw new AppError('Invalid file path', 400);
  }

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    throw new AppError('File not found', 404);
  }

  // Get file stats
  const stats = fs.statSync(filePath);
  const fileInfo = {
    filename,
    type,
    size: stats.size,
    url: `/uploads/${type}/${filename}`,
    createdAt: stats.birthtime,
    modifiedAt: stats.mtime
  };

  res.json({
    success: true,
    data: { file: fileInfo }
  });
}));

// List files in directory
router.get('/list/:type', authenticateToken, asyncHandler(async (req, res) => {
  const { type } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const dirPath = path.join(uploadsDir, type);

  if (!fs.existsSync(dirPath)) {
    return res.json({
      success: true,
      data: { files: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0 } }
    });
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

  // Pagination
  const offset = (page - 1) * limit;
  const paginatedFiles = files.slice(offset, offset + parseInt(limit));

  res.json({
    success: true,
    data: {
      files: paginatedFiles,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(files.length / limit),
        totalItems: files.length,
        itemsPerPage: parseInt(limit)
      }
    }
  });
}));

// Get storage usage statistics
router.get('/stats/usage', authenticateToken, asyncHandler(async (req, res) => {
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

  res.json({
    success: true,
    data: {
      totalUsage: {
        bytes: totalUsage,
        formatted: (totalUsage / (1024 * 1024)).toFixed(2) + ' MB'
      },
      byType: usage
    }
  });
}));

// Error handling for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large',
        details: `Maximum file size is ${MAX_SIZE / (1024 * 1024)}MB`
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files',
        details: 'Maximum 5 files allowed per upload'
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected file field',
        details: 'Check the file input field name'
      });
    }
  }
  next(error);
});

export default router;
