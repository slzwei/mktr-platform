import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { sniffFileType, canonicalExtensionForMime } from '../utils/fileSignature.js';
import * as uploadController from '../controllers/uploadController.js';

export const meta = { path: '/api/uploads' };

const router = express.Router();

// --- Upload hardening constants ---

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  // Source video formats — non-MP4 (e.g. MOV) are transcoded to web MP4 on upload.
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/x-msvideo', 'video/3gpp'
];

const MAX_SIZE = (parseInt(process.env.MAX_UPLOAD_SIZE_MB) || 10) * 1024 * 1024;

const ALLOWED_UPLOAD_TYPES = ['general', 'avatars', 'campaigns', 'documents', 'images', 'campaign_media'];

const ALLOWED_BY_CATEGORY = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  document: ['application/pdf'],
  video: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/x-msvideo', 'video/3gpp'],
  campaign_media: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/x-msvideo', 'video/3gpp']
};

const allowedMimesFor = (category) => ALLOWED_BY_CATEGORY[category] || ALLOWED_BY_CATEGORY.image;

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
    // The bytes are not on disk yet, so this extension comes from the declared
    // MIME via a fixed table — NEVER from file.originalname, which would let a
    // part named evil.html land as an executable .html (P0-1). The sniff pass
    // below corrects it to whatever the content actually is.
    const ext = canonicalExtensionForMime(file.mimetype);
    const name = sanitizeFilename(path.basename(file.originalname, path.extname(file.originalname)));
    cb(null, `${name}-${uniqueSuffix}.${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_TYPES.includes(file.mimetype)) {
    logger.warn('Upload rejected: disallowed MIME type', { mimetype: file.mimetype, originalname: file.originalname });
    return cb(new AppError(`File type not allowed. Accepted types: ${ALLOWED_TYPES.join(', ')}`, 400), false);
  }

  const { type = 'image' } = req.query;
  const allowed = allowedMimesFor(type);

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

// --- Content verification (runs after multer has written the file) ---

const MAGIC_BYTES = 64;

async function readLeadingBytes(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(MAGIC_BYTES);
    const { bytesRead } = await handle.read(buf, 0, MAGIC_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Rename the stored file so its extension matches the sniffed type, and make file.mimetype truthful. */
async function retypeStoredFile(file, sniffed) {
  file.mimetype = sniffed.mime;
  if (path.extname(file.filename).toLowerCase() === `.${sniffed.ext}`) return;

  const filename = `${path.basename(file.filename, path.extname(file.filename))}.${sniffed.ext}`;
  const target = path.join(path.dirname(file.path), filename);
  await fs.promises.rename(file.path, target);
  file.filename = filename;
  file.path = target;
}

const filesOnRequest = (req) => {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  if (req.files) return Object.values(req.files).flat();
  return [];
};

/**
 * Multer only ever saw the client's declared Content-Type. Now that the bytes
 * are on disk, sniff them: reject anything whose REAL type isn't allowed for
 * this category, and re-extension the rest from the content (P0-1).
 */
const verifyUploadedContent = async (req, res, next) => {
  const files = filesOnRequest(req);
  if (files.length === 0) return next();

  const category = req.query.type || 'image';
  const allowed = allowedMimesFor(category);

  try {
    for (const file of files) {
      const sniffed = sniffFileType(await readLeadingBytes(file.path));
      if (!sniffed || !allowed.includes(sniffed.mime)) {
        logger.warn('Upload rejected: file content does not match an allowed type', {
          declared: file.mimetype,
          sniffed: sniffed?.mime || 'unknown',
          category,
          originalname: file.originalname
        });
        throw new AppError(`File content is not a valid ${category} upload. Allowed: ${allowed.join(', ')}`, 400);
      }
      await retypeStoredFile(file, sniffed);
    }
    next();
  } catch (error) {
    await Promise.all(files.map((file) => fs.promises.unlink(file.path).catch(() => {})));
    next(error);
  }
};

// --- Routes ---

router.post('/single',          authenticateToken, upload.single('file'),        verifyUploadedContent, uploadController.uploadSingle);
router.post('/multiple',        authenticateToken, upload.array('files', 5),     verifyUploadedContent, uploadController.uploadMultiple);
router.post('/avatar',          authenticateToken, upload.single('avatar'),      verifyUploadedContent, uploadController.uploadAvatar);
router.post('/campaign-assets', authenticateToken, upload.array('assets', 10),   verifyUploadedContent, uploadController.uploadCampaignAssets);
router.post('/documents',       authenticateToken, upload.array('documents', 5), verifyUploadedContent, uploadController.uploadDocuments);
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
