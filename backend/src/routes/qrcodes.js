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

// (M3) The authenticated POST /:id/scan endpoint is RETIRED. It duplicated
// the public tracker path (/t/:slug) with no owner scoping — any logged-in
// user holding another owner's QR UUID could inflate that tag's scanCount and
// dailyScans analytics. The tracker flow is the one real scan recorder; no
// frontend surface ever called this route (dead client method removed with it).

// Get analytics
router.get('/:id/analytics', authenticateToken, qrCodeController.getAnalytics);

// Download QR image (streaming handled in controller)
router.get('/:id/download', authenticateToken, qrCodeController.downloadQrImage);

// Bulk operations
router.post('/bulk', authenticateToken, requireAdmin, qrCodeController.bulkOperateQrCodes);

export default router;
