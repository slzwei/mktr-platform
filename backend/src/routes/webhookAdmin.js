import express from 'express';
import { Op } from 'sequelize';
import { WebhookSubscriber, WebhookDelivery } from '../models/index.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { retryDelivery, retryAllFailed } from '../services/webhookService.js';

const router = express.Router();

// All routes require admin auth
router.use(authenticateToken, requireAdmin);

// --- Subscriber CRUD ---

// List all subscribers
router.get('/subscribers', asyncHandler(async (req, res) => {
  const subscribers = await WebhookSubscriber.findAll({
    order: [['createdAt', 'DESC']]
  });
  res.json({ success: true, data: subscribers });
}));

// Create subscriber
router.post('/subscribers', asyncHandler(async (req, res) => {
  const { name, url, secret, events, enabled, description, metadata } = req.body;

  if (!name || !url || !secret) {
    return res.status(400).json({ success: false, message: 'name, url, and secret are required' });
  }

  const subscriber = await WebhookSubscriber.create({
    name, url, secret,
    events: events || [],
    enabled: enabled !== false,
    description: description || null,
    metadata: metadata || {}
  });

  res.status(201).json({ success: true, data: subscriber });
}));

// Update subscriber
router.put('/subscribers/:id', asyncHandler(async (req, res) => {
  const subscriber = await WebhookSubscriber.findByPk(req.params.id);
  if (!subscriber) {
    return res.status(404).json({ success: false, message: 'Subscriber not found' });
  }

  const { name, url, secret, events, enabled, description, metadata } = req.body;
  await subscriber.update({
    ...(name !== undefined && { name }),
    ...(url !== undefined && { url }),
    ...(secret !== undefined && { secret }),
    ...(events !== undefined && { events }),
    ...(enabled !== undefined && { enabled }),
    ...(description !== undefined && { description }),
    ...(metadata !== undefined && { metadata })
  });

  res.json({ success: true, data: subscriber });
}));

// Delete subscriber (hard delete)
router.delete('/subscribers/:id', asyncHandler(async (req, res) => {
  const subscriber = await WebhookSubscriber.findByPk(req.params.id);
  if (!subscriber) {
    return res.status(404).json({ success: false, message: 'Subscriber not found' });
  }

  await subscriber.destroy();
  res.json({ success: true, message: 'Subscriber deleted' });
}));

// --- Delivery management ---

// List deliveries (paginated, filterable)
router.get('/deliveries', asyncHandler(async (req, res) => {
  const { status, subscriberId, eventType, dateFrom, dateTo, page = 1, limit = 20 } = req.query;
  const where = {};

  if (status) where.status = status;
  if (subscriberId) where.subscriberId = subscriberId;
  if (eventType) where.eventType = eventType;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt[Op.gte] = new Date(dateFrom);
    if (dateTo) where.createdAt[Op.lte] = new Date(dateTo);
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const { count, rows: deliveries } = await WebhookDelivery.findAndCountAll({
    where,
    limit: parseInt(limit),
    offset,
    order: [['createdAt', 'DESC']],
    include: [{ association: 'subscriber', attributes: ['id', 'name', 'url'] }]
  });

  res.json({
    success: true,
    data: {
      deliveries,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / parseInt(limit)),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    }
  });
}));

// Single delivery detail
router.get('/deliveries/:id', asyncHandler(async (req, res) => {
  const delivery = await WebhookDelivery.findByPk(req.params.id, {
    include: [{ association: 'subscriber', attributes: ['id', 'name', 'url'] }]
  });
  if (!delivery) {
    return res.status(404).json({ success: false, message: 'Delivery not found' });
  }
  res.json({ success: true, data: delivery });
}));

// Manually retry a single delivery
router.post('/deliveries/:id/retry', asyncHandler(async (req, res) => {
  await retryDelivery(req.params.id);
  res.json({ success: true, message: 'Delivery queued for retry' });
}));

// Retry all failed deliveries for a subscriber
router.post('/deliveries/retry-all', asyncHandler(async (req, res) => {
  const { subscriberId } = req.body;
  if (!subscriberId) {
    return res.status(400).json({ success: false, message: 'subscriberId is required' });
  }
  const count = await retryAllFailed(subscriberId);
  res.json({ success: true, message: `${count} deliveries queued for retry` });
}));

export default router;
