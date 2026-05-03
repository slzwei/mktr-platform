import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import * as uploadController from '../controllers/uploadController.js';

export const meta = { path: '/api/uploads' };

const router = express.Router();

// --- Upload hardening constants ---

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'video/mp4', 'video/webm'
];

const MAX_SIZE = (parseInt(process.env.MAX_UPLOAD_SIZE_MB) || 10) * 1024 * 1024;

const ALLOWED_UPLOAD_TYPES = ['general', 'avatars', 'campaigns', 'documents', 'images', 'campaign_media'];

const sanitizeFilename = (name) => {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '.');
};

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// --- Multer configuration ---

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = ALLOWED_UPLOAD_TYPES.includes(req.query.type) ? req.query.type : 'general';
    const uploadPath = path.join(uploadsDir, type);
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

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_TYPES.includes(file.mimetype)) {
    logger.warn('Upload rejected: disallowed MIME type', { mimetype: file.mimetype, originalname: file.originalname });
    return cb(new AppError(`File type not allowed. Accepted types: ${ALLOWED_TYPES.join(', ')}`, 400), false);
  }

  const allowedByCategory = {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    document: ['application/pdf'],
    video: ['video/mp4', 'video/webm'],
    campaign_media: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm']
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

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_SIZE,
    files: 5
  }
});

// --- Routes ---

router.post('/single',          authenticateToken, upload.single('file'),        uploadController.uploadSingle);
router.post('/multiple',        authenticateToken, upload.array('files', 5),     uploadController.uploadMultiple);
router.post('/avatar',          authenticateToken, upload.single('avatar'),      uploadController.uploadAvatar);
router.post('/campaign-assets', authenticateToken, upload.array('assets', 10),   uploadController.uploadCampaignAssets);
router.post('/documents',       authenticateToken, upload.array('documents', 5), uploadController.uploadDocuments);
router.delete('/:type/:filename',      authenticateToken, uploadController.deleteFile);
router.get('/info/:type/:filename',    authenticateToken, uploadController.getFileInfo);
router.get('/list/:type',              authenticateToken, uploadController.listFiles);
router.get('/stats/usage',             authenticateToken, uploadController.getStorageUsage);

// --- Multer error handling middleware ---

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
