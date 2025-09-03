import express from 'express';
import { Op } from 'sequelize';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { QrTag, Campaign, Car, User } from '../models/index.js';
import { authenticateToken, requireAgentOrAdmin } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

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

// Generate short URL (simple implementation)
const generateShortUrl = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `https://mktr.ly/${result}`;
};

// Get all QR codes
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, type, status, campaignId, carId, search } = req.query;
  const offset = (page - 1) * limit;

  const whereConditions = {};
  
  // Non-admin users can only see their own QR codes
  if (req.user.role !== 'admin') {
    whereConditions.createdBy = req.user.id;
  }
  
  if (type) {
    whereConditions.type = type;
  }
  
  if (status) {
    whereConditions.status = status;
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
        association: 'creator',
        attributes: ['id', 'firstName', 'lastName', 'email']
      },
      {
        association: 'campaign',
        attributes: ['id', 'name', 'status']
      },
      {
        association: 'car',
        attributes: ['id', 'make', 'model', 'licensePlate']
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
router.post('/', authenticateToken, requireAgentOrAdmin, validate(schemas.qrTagCreate), asyncHandler(async (req, res) => {
  const { destinationUrl, name, description, type, campaignId, carId, ...otherData } = req.body;

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

  // Generate unique short URL
  const shortUrl = generateShortUrl();

  // Create tracking URL (this would redirect to destinationUrl and track analytics)
  const trackingUrl = `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/track/${shortUrl}`;

  // Generate QR code image
  const qrCode = await generateQRCodeImage(trackingUrl);

  // Create QR tag
  const qrTag = await QrTag.create({
    name,
    description,
    type,
    qrCode,
    qrData: trackingUrl,
    shortUrl,
    destinationUrl,
    campaignId,
    carId,
    createdBy: req.user.id,
    ...otherData
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
    whereConditions.createdBy = req.user.id;
  }

  const qrTag = await QrTag.findOne({
    where: whereConditions,
    include: [
      {
        association: 'creator',
        attributes: ['id', 'firstName', 'lastName', 'email']
      },
      {
        association: 'campaign',
        attributes: ['id', 'name', 'status', 'type']
      },
      {
        association: 'car',
        attributes: ['id', 'make', 'model', 'licensePlate', 'color']
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
router.put('/:id', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { destinationUrl, regenerateCode, ...updateData } = req.body;

  const whereConditions = { id };
  
  // Non-admin users can only update their own QR codes
  if (req.user.role !== 'admin') {
    whereConditions.createdBy = req.user.id;
  }

  const qrTag = await QrTag.findOne({ where: whereConditions });
  
  if (!qrTag) {
    throw new AppError('QR code not found or access denied', 404);
  }

  // If destination URL changed or regeneration requested, update QR code
  if (destinationUrl && destinationUrl !== qrTag.destinationUrl || regenerateCode) {
    const newDestinationUrl = destinationUrl || qrTag.destinationUrl;
    const trackingUrl = `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/track/${qrTag.shortUrl}`;
    const newQrCode = await generateQRCodeImage(trackingUrl);
    
    updateData.destinationUrl = newDestinationUrl;
    updateData.qrCode = newQrCode;
  }

  await qrTag.update(updateData);

  res.json({
    success: true,
    message: 'QR code updated successfully',
    data: { qrTag }
  });
}));

// Delete QR code
router.delete('/:id', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const whereConditions = { id };
  
  // Non-admin users can only delete their own QR codes
  if (req.user.role !== 'admin') {
    whereConditions.createdBy = req.user.id;
  }

  const qrTag = await QrTag.findOne({ where: whereConditions });
  
  if (!qrTag) {
    throw new AppError('QR code not found or access denied', 404);
  }

  // Archive instead of hard delete
  await qrTag.update({ status: 'archived' });

  res.json({
    success: true,
    message: 'QR code archived successfully'
  });
}));

// Track QR code scan (public endpoint)
router.get('/track/:shortUrl', asyncHandler(async (req, res) => {
  const { shortUrl } = req.params;
  const fullShortUrl = `https://mktr.ly/${shortUrl}`;

  const qrTag = await QrTag.findOne({
    where: { shortUrl: fullShortUrl }
  });

  if (!qrTag || qrTag.status !== 'active') {
    return res.status(404).json({
      success: false,
      message: 'QR code not found or inactive'
    });
  }

  // Check expiration
  if (qrTag.expirationDate && new Date() > qrTag.expirationDate) {
    await qrTag.update({ status: 'expired' });
    return res.status(410).json({
      success: false,
      message: 'QR code has expired'
    });
  }

  // Check max scans
  if (qrTag.maxScans && qrTag.scanCount >= qrTag.maxScans) {
    return res.status(410).json({
      success: false,
      message: 'QR code scan limit reached'
    });
  }

  // Get client info for analytics
  const clientInfo = {
    userAgent: req.headers['user-agent'],
    referer: req.headers.referer,
    ip: req.ip || req.connection.remoteAddress,
    timestamp: new Date()
  };

  // Update analytics
  const currentAnalytics = qrTag.analytics || {};
  const today = new Date().toISOString().split('T')[0];
  
  // Update daily scans
  if (!currentAnalytics.dailyScans) currentAnalytics.dailyScans = {};
  currentAnalytics.dailyScans[today] = (currentAnalytics.dailyScans[today] || 0) + 1;

  // Update device type (simplified)
  if (!currentAnalytics.deviceTypes) currentAnalytics.deviceTypes = {};
  const deviceType = /Mobile|Android|iPhone|iPad/.test(clientInfo.userAgent) ? 'mobile' : 'desktop';
  currentAnalytics.deviceTypes[deviceType] = (currentAnalytics.deviceTypes[deviceType] || 0) + 1;

  // Increment scan count and update analytics
  await qrTag.update({
    scanCount: qrTag.scanCount + 1,
    lastScanned: new Date(),
    analytics: currentAnalytics
  });

  // Return tracking data and redirect URL
  res.json({
    success: true,
    data: {
      redirectUrl: qrTag.destinationUrl,
      qrTagId: qrTag.id,
      campaignId: qrTag.campaignId,
      scanCount: qrTag.scanCount + 1
    }
  });
}));

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
  const { period = '30d' } = req.query;

  const whereConditions = { id };
  
  // Non-admin users can only see analytics for their own QR codes
  if (req.user.role !== 'admin') {
    whereConditions.createdBy = req.user.id;
  }

  const qrTag = await QrTag.findOne({ where: whereConditions });
  
  if (!qrTag) {
    throw new AppError('QR code not found or access denied', 404);
  }

  // Calculate period-specific analytics
  const analytics = qrTag.analytics || {};
  const dailyScans = analytics.dailyScans || {};
  
  // Get scans for the requested period
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const periodScans = [];
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    periodScans.push({
      date: dateStr,
      scans: dailyScans[dateStr] || 0
    });
  }

  const response = {
    qrTag: {
      id: qrTag.id,
      name: qrTag.name,
      type: qrTag.type,
      status: qrTag.status
    },
    summary: {
      totalScans: qrTag.scanCount,
      uniqueScans: qrTag.uniqueScanCount,
      lastScanned: qrTag.lastScanned,
      averageScansPerDay: periodScans.reduce((sum, day) => sum + day.scans, 0) / days
    },
    periodData: periodScans,
    deviceTypes: analytics.deviceTypes || {},
    referrers: analytics.referrers || {},
    locations: analytics.locations || {}
  };

  res.json({
    success: true,
    data: { analytics: response }
  });
}));

// Bulk operations for QR codes
router.post('/bulk', authenticateToken, requireAgentOrAdmin, asyncHandler(async (req, res) => {
  const { operation, qrTagIds, data = {} } = req.body;

  if (!operation || !qrTagIds || !Array.isArray(qrTagIds)) {
    throw new AppError('Operation and qrTagIds array are required', 400);
  }

  const whereConditions = {
    id: { [Op.in]: qrTagIds }
  };
  
  // Non-admin users can only perform bulk operations on their own QR codes
  if (req.user.role !== 'admin') {
    whereConditions.createdBy = req.user.id;
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
