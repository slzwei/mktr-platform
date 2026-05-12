import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import * as qrCodeController from '../controllers/qrCodeController.js';

export const meta = {
  mounts: [
    { path: '/api/qrcodes' },
    { path: '/api/leadgen/qrcodes', flag: 'ENABLE_DOMAIN_PREFIXES' },
  ],
};

const router = express.Router();

// List QR codes
router.get('/', authenticateToken, qrCodeController.listQrCodes);

// Create QR code
router.post('/', authenticateToken, requireAdmin, validate(schemas.qrTagCreate), qrCodeController.createQrCode);

// Get QR code by ID
router.get('/:id', authenticateToken, qrCodeController.getQrCode);

// Update QR code
router.put('/:id', authenticateToken, requireAdmin, qrCodeController.updateQrCode);

// Delete QR code
router.delete('/:id', authenticateToken, requireAdmin, qrCodeController.deleteQrCode);

// Record scan
router.post('/:id/scan', authenticateToken, qrCodeController.recordScan);

// Get analytics
router.get('/:id/analytics', authenticateToken, qrCodeController.getAnalytics);

// Download QR image (streaming handled in controller)
router.get('/:id/download', authenticateToken, qrCodeController.downloadQrImage);

// Bulk operations
router.post('/bulk', authenticateToken, requireAdmin, qrCodeController.bulkOperateQrCodes);

export default router;
