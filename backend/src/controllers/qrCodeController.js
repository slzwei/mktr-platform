import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as qrCodeService from '../services/qrCodeService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const listQrCodes = asyncHandler(async (req, res) => {
  const data = await qrCodeService.listQrCodes(req.user, req.query);
  res.json({ success: true, data });
});

export const createQrCode = asyncHandler(async (req, res) => {
  const { qrTag, updated } = await qrCodeService.createQrCode(req.body, req.user);
  if (updated) {
    return res.status(200).json({ success: true, message: 'Car QR updated', data: { qrTag } });
  }
  res.status(201).json({ success: true, message: 'QR code created successfully', data: { qrTag } });
});

export const getQrCode = asyncHandler(async (req, res) => {
  const qrTag = await qrCodeService.getQrCode(req.params.id, req.user);
  res.json({ success: true, data: { qrTag } });
});

export const updateQrCode = asyncHandler(async (req, res) => {
  const qrTag = await qrCodeService.updateQrCode(req.params.id, req.body, req.user);
  res.json({ success: true, message: 'QR code updated successfully', data: { qrTag } });
});

export const deleteQrCode = asyncHandler(async (req, res) => {
  await qrCodeService.deleteQrCode(req.params.id, req.user);
  res.json({ success: true, message: 'QR code deleted successfully' });
});

export const recordScan = asyncHandler(async (req, res) => {
  const data = await qrCodeService.recordScan(req.params.id, req.body.metadata);
  res.json({ success: true, message: 'Scan recorded successfully', data });
});

export const getAnalytics = asyncHandler(async (req, res) => {
  const analytics = await qrCodeService.getAnalytics(req.params.id, req.user);
  res.json({ success: true, data: { analytics } });
});

/**
 * Download QR image — streaming I/O stays in the controller layer.
 * The service provides the URL/path; the controller handles response streaming.
 */
export const downloadQrImage = asyncHandler(async (req, res) => {
  const { imageUrl, fileName } = await qrCodeService.getQrImageForDownload(req.params.id, req.user);

  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  if (/^https?:\/\//i.test(imageUrl)) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      return res.status(502).json({ success: false, message: 'Failed to fetch QR image' });
    }
    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/png');
    if (response.body && typeof response.body.pipe === 'function') {
      response.body.pipe(res);
    } else {
      const arrayBuffer = await response.arrayBuffer();
      res.end(Buffer.from(arrayBuffer));
    }
    return;
  }

  const fileRel = imageUrl.replace(/^\/+/, '');
  const filePath = path.join(__dirname, '../../', fileRel);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'File not found' });
  }
  res.setHeader('Content-Type', 'image/png');
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => res.status(500).end());
  stream.pipe(res);
});

export const bulkOperateQrCodes = asyncHandler(async (req, res) => {
  const { operation, qrTagIds, data = {} } = req.body;
  const result = await qrCodeService.bulkOperateQrCodes(operation, qrTagIds, data, req.user);
  res.json({ success: true, message: result.message, data: { affectedCount: result.affectedCount } });
});
