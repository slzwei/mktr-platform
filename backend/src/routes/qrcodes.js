import express from 'express';
import { Op } from 'sequelize';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { QrTag, Campaign, Car, User, QrScan, Attribution, Prospect } from '../models/index.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Save under backend/uploads/image so server static route can serve them
const uploadsDir = path.join(__dirname, '../../uploads/image');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Generate QR code image
const generateQRCodeImage = async (data, options = {}) => {
  try {
    const qrOptions = {
      type: 'svg',
      width: options.size || 300,
      margin: 2,
      color: {
        dark: options.color || '#000000',
        light: '#FFFFFF'
      },
      errorCorrectionLevel: 'M',
      ...options
    };

    const qrCodeSVG = await QRCode.toString(data, qrOptions);
    return qrCodeSVG;
  } catch (error) {
    throw new AppError('Failed to generate QR code', 500);
  }
};

// Generate slug (lowercase, safe)
const generateSlug = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
};

const normalizeSlug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 64);

// Get all QR codes
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, type, status, campaignId, carId, search } = req.query;
  const offset = (page - 1) * limit;

  const whereConditions = {};
  
  // Non-admin users can only see their own QR codes
  if (req.user.role !== 'admin') {
    whereConditions.ownerUserId = req.user.id;
  }
  
  if (type) {
    whereConditions.type = type;
  }
  
  if (status !== undefined) {
    whereConditions.active = status === 'active' || status === true;
  }
  
  if (campaignId) {
    whereConditions.campaignId = campaignId;
  }
  
  if (carId) {
    whereConditions.carId = carId;
  }
  
  if (search) {
    whereConditions[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { description: { [Op.iLike]: `%${search}%` } }
    ];
  }

  const { count, rows: qrTags } = await QrTag.findAndCountAll({
    where: whereConditions,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [['createdAt', 'DESC']],
    include: [
      {
        association: 'owner',
        attributes: ['id', 'firstName', 'lastName', 'email']
      },
      {
        association: 'campaign',
        attributes: ['id', 'name', 'status']
      },
      {
        association: 'car',
        attributes: ['id', 'make', 'model', 'plate_number']
      }
    ]
  });

  res.json({
    success: true,
    data: {
      qrTags,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    }
  });
}));

// Create new QR code
router.post('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { label, tags = [], type, campaignId, carId } = req.body;

  // Validate campaign and car ownership
  if (campaignId) {
    const campaign = await Campaign.findOne({
      where: {
        id: campaignId,
        [Op.or]: [
          { createdBy: req.user.id },
          ...(req.user.role === 'admin' ? [{}] : [])
        ]
      }
    });
    if (!campaign) {
      throw new AppError('Campaign not found or access denied', 404);
    }
  }

  if (carId) {
    const car = await Car.findByPk(carId, {
      include: [{
        association: 'fleetOwner',
        where: { userId: req.user.id }
      }]
    });
    if (!car && req.user.role !== 'admin') {
      throw new AppError('Car not found or access denied', 404);
    }
  }

  // For car QR: enforce single instance per car (idempotent create)
  if (type === 'car' && carId) {
    const existing = await QrTag.findOne({ where: { type: 'car', carId } });
    if (existing) {
      await existing.update({ campaignId: campaignId || existing.campaignId, active: true, label: label || existing.label, tags });
      return res.status(200).json({ success: true, message: 'Car QR updated', data: { qrTag: existing } });
    }
  }

  // Generate unique slug with retries on collision
  let slug = generateSlug();
  let retry = 0;
  while (await QrTag.findOne({ where: { slug } })) {
    slug = generateSlug();
    retry += 1;
    if (retry > 5) break;
  }

  // Short link path is computed at runtime; embed slug in SVG payload
  const publicBase = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
  const linkUrl = `${publicBase}/t/${slug}`;
  const svg = await generateQRCodeImage(linkUrl);
  // Generate PNG and save to uploads
  const pngBuffer = await QRCode.toBuffer(linkUrl, { width: 600, margin: 2 });
  const fileName = `qr-${slug}.png`;
  const filePath = path.join(uploadsDir, fileName);
  fs.writeFileSync(filePath, pngBuffer);
  const publicUrl = `/uploads/image/${fileName}`;

  const qrTag = await QrTag.create({
    slug,
    label: label || null,
    tags: tags,
    type: type || null,
    campaignId: campaignId || null,
    carId: carId || null,
    ownerUserId: req.user.id,
    active: true,
    qrCode: svg,
    qrImageUrl: publicUrl
  });

  res.status(201).json({
    success: true,
    message: 'QR code created successfully',
    data: { qrTag }
  });
}));

// Get QR code by ID
router.get('/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const whereConditions = { id };
  
  // Non-admin users can only see their own QR codes
  if (req.user.role !== 'admin') {
    whereConditions.ownerUserId = req.user.id;
  }

  const qrTag = await QrTag.findOne({
    where: whereConditions,
    include: [
      {
        association: 'owner',
        attributes: ['id', 'firstName', 'lastName', 'email']
      },
      {
        association: 'campaign',
        attributes: ['id', 'name', 'status', 'type']
      },
      {
        association: 'car',
        attributes: ['id', 'make', 'model', 'plate_number', 'color']
      },
      {
        association: 'prospects',
        attributes: ['id', 'firstName', 'lastName', 'email', 'leadStatus', 'createdAt']
      }
    ]
  });

  if (!qrTag) {
    throw new AppError('QR code not found', 404);
  }

  res.json({
    success: true,
    data: { qrTag }
  });
}));

// Update QR code
router.put('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { destinationUrl, regenerateCode, ...updateData } = req.body;

  const whereConditions = { id };
  
  // Non-admin users can only update their own QR codes
  if (req.user.role !== 'admin') {
    whereConditions.ownerUserId = req.user.id;
  }

  const qrTag = await QrTag.findOne({ where: whereConditions });
  
  if (!qrTag) {
    throw new AppError('QR code not found or access denied', 404);
  }

  // If regeneration requested, re-render SVG from slug link path
  if (regenerateCode) {
    const publicBase = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
    const linkUrl = `${publicBase}/t/${qrTag.slug}`;
    const newQrCode = await generateQRCodeImage(linkUrl);
    updateData.qrCode = newQrCode;
    // regenerate PNG
    const pngBuffer = await QRCode.toBuffer(linkUrl, { width: 600, margin: 2 });
    const fileName = `qr-${qrTag.slug}.png`;
    const filePath = path.join(uploadsDir, fileName);
    fs.writeFileSync(filePath, pngBuffer);
    updateData.qrImageUrl = `/uploads/image/${fileName}`;
  }

  await qrTag.update(updateData);

  res.json({
    success: true,
    message: 'QR code updated successfully',
    data: { qrTag }
  });
}));

// Delete QR code
router.delete('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const whereConditions = { id };
  
  // Non-admin users can only delete their own QR codes
  if (req.user.role !== 'admin') {
    whereConditions.ownerUserId = req.user.id;
  }

  const qrTag = await QrTag.findOne({ where: whereConditions });
  
  if (!qrTag) {
    throw new AppError('QR code not found or access denied', 404);
  }

  // Attempt to remove PNG from disk if present
  try {
    if (qrTag.qrImageUrl) {
      const fileRel = qrTag.qrImageUrl.replace(/^\/+/, ''); // strip leading slash
      const filePath = path.join(__dirname, '../../', fileRel);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (e) {
    // non-fatal
  }

  // Manually cascade in safe order: null-out FK references before deletion
  await Prospect.update({ qrTagId: null, attributionId: null }, { where: { qrTagId: qrTag.id } });
  await Attribution.destroy({ where: { qrTagId: qrTag.id } });
  await QrScan.destroy({ where: { qrTagId: qrTag.id } });

  await qrTag.destroy();

  res.json({
    success: true,
    message: 'QR code deleted successfully'
  });
}));

// Placeholders removed; tracker moved to /api/qrcodes/track/:slug in a dedicated router to 302

// Increment scan count (for manual tracking)
router.post('/:id/scan', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { metadata = {} } = req.body;

  const qrTag = await QrTag.findByPk(id);
  
  if (!qrTag) {
    throw new AppError('QR code not found', 404);
  }

  if (qrTag.status !== 'active') {
    throw new AppError('QR code is not active', 400);
  }

  // Update scan count and analytics
  const currentAnalytics = qrTag.analytics || {};
  const today = new Date().toISOString().split('T')[0];
  
  if (!currentAnalytics.dailyScans) currentAnalytics.dailyScans = {};
  currentAnalytics.dailyScans[today] = (currentAnalytics.dailyScans[today] || 0) + 1;

  await qrTag.update({
    scanCount: qrTag.scanCount + 1,
    lastScanned: new Date(),
    analytics: { ...currentAnalytics, ...metadata }
  });

  res.json({
    success: true,
    message: 'Scan recorded successfully',
    data: {
      scanCount: qrTag.scanCount + 1,
      destinationUrl: qrTag.destinationUrl
    }
  });
}));

// Get QR code analytics
router.get('/:id/analytics', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const whereConditions = { id };
  if (req.user.role !== 'admin') whereConditions.ownerUserId = req.user.id;
  const qrTag = await QrTag.findOne({ where: whereConditions });
  if (!qrTag) throw new AppError('QR code not found or access denied', 404);

  const { QrScan, Attribution, SessionVisit, Prospect } = await import('../models/index.js');
  // Scans
  const totalScans = await QrScan.count({ where: { qrTagId: qrTag.id, botFlag: false, isDuplicate: false } });

  // Landings: find sessionIds from attributions, then check visits with a 'landing' event
  const attributions = await Attribution.findAll({ where: { qrTagId: qrTag.id }, attributes: ['sessionId'], order: [['lastTouchAt', 'DESC']] });
  const sessionIds = [...new Set(attributions.map(a => a.sessionId).filter(Boolean))];
  let landings = 0;
  if (sessionIds.length > 0) {
    const visits = await SessionVisit.findAll({ where: { sessionId: sessionIds } });
    for (const v of visits) {
      const events = Array.isArray(v.eventsJson) ? v.eventsJson : [];
      if (events.some(ev => ev?.type === 'landing')) landings++;
    }
  }

  // Leads
  const leads = await Prospect.count({ where: { qrTagId: qrTag.id } });

  res.json({ success: true, data: { analytics: { summary: { totalScans, landings, leads } } } });
}));

// Bulk operations for QR codes
router.post('/bulk', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { operation, qrTagIds, data = {} } = req.body;

  if (!operation || !qrTagIds || !Array.isArray(qrTagIds)) {
    throw new AppError('Operation and qrTagIds array are required', 400);
  }

  const whereConditions = {
    id: { [Op.in]: qrTagIds }
  };
  
  // Non-admin users can only perform bulk operations on their own QR codes
  if (req.user.role !== 'admin') {
    whereConditions.ownerUserId = req.user.id;
  }

  const qrTags = await QrTag.findAll({ where: whereConditions });

  if (qrTags.length !== qrTagIds.length) {
    throw new AppError('Some QR codes not found or access denied', 404);
  }

  let result = {};

  switch (operation) {
    case 'activate':
      await QrTag.update({ status: 'active' }, { where: whereConditions });
      result.message = `${qrTags.length} QR codes activated`;
      break;
    
    case 'deactivate':
      await QrTag.update({ status: 'inactive' }, { where: whereConditions });
      result.message = `${qrTags.length} QR codes deactivated`;
      break;
    
    case 'archive':
      await QrTag.update({ status: 'archived' }, { where: whereConditions });
      result.message = `${qrTags.length} QR codes archived`;
      break;
    
    case 'update':
      await QrTag.update(data, { where: whereConditions });
      result.message = `${qrTags.length} QR codes updated`;
      break;
    
    default:
      throw new AppError('Invalid operation', 400);
  }

  res.json({
    success: true,
    message: result.message,
    data: { affectedCount: qrTags.length }
  });
}));

export default router;
