import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

// ... (existing code for uploadsDir, storage, fileFilter, upload) ...

// Ensure apk uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads', 'apk');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // 1. Clean up old files BEFORE saving the new one
        // This enforces "only 1 latest apk" rule
        if (fs.existsSync(uploadsDir)) {
            const files = fs.readdirSync(uploadsDir);
            for (const existingFile of files) {
                fs.unlinkSync(path.join(uploadsDir, existingFile));
            }
        } else {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        // Keep original name, but maybe sanitize it? 
        // User wants "latest version", so standardizing name might be good, 
        // but preserving version info in filename is also useful for clarity.
        // Let's keep original name for now so they can see "app-release-v1.2.apk"
        cb(null, file.originalname);
    }
});

const fileFilter = (req, file, cb) => {
    // Allow .apk files. Mime type for apk is usually application/vnd.android.package-archive
    // but sometimes generic application/octet-stream if browser doesn't know.
    // We can check extension too.
    if (path.extname(file.originalname).toLowerCase() === '.apk') {
        cb(null, true);
    } else {
        cb(new AppError('Only .apk files are allowed', 400), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 200 * 1024 * 1024, // 200MB limit for APKs
        files: 1 // Only 1 file at a time
    }
});


// POST /upload: Upload a new APK (replaces old one)
router.post('/upload', authenticateToken, requireAdmin, upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new AppError('No APK file uploaded', 400);
    }

    res.json({
        success: true,
        message: 'APK uploaded successfully. Old versions deleted.',
        data: {
            filename: req.file.filename,
            size: req.file.size
        }
    });
}));

// GET /latest: Download the latest APK
// Public endpoint - no auth required to download (usually)
router.get('/latest', asyncHandler(async (req, res) => {
    if (!fs.existsSync(uploadsDir)) {
        throw new AppError('No APK available', 404);
    }

    const files = fs.readdirSync(uploadsDir).filter(f => !f.startsWith('.'));

    if (files.length === 0) {
        throw new AppError('No APK available', 404);
    }

    // Since we delete old ones on upload, there should only be 1. 
    // If manual file manipulation happened, just take the first one or most recent.
    const latestFile = files[0];
    const filePath = path.join(uploadsDir, latestFile);

    res.download(filePath, latestFile);
}));

// GET /list: Get info about current APK
router.get('/list', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
    if (!fs.existsSync(uploadsDir)) {
        return res.json({ success: true, count: 0, apk: null });
    }

    const files = fs.readdirSync(uploadsDir).filter(f => !f.startsWith('.'));

    if (files.length === 0) {
        return res.json({ success: true, count: 0, apk: null });
    }

    const filename = files[0];
    const stats = fs.statSync(path.join(uploadsDir, filename));

    res.json({
        success: true,
        count: files.length,
        apk: {
            filename: filename,
            size: stats.size,
            uploadedAt: stats.birthtime,
            downloadUrl: `${process.env.PUBLIC_BASE_URL || ''}/api/apk/latest`
        }
    });
}));

export default router;
