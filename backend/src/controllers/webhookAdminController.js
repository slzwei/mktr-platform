import { asyncHandler } from '../middleware/errorHandler.js';
import * as webhookAdminService from '../services/webhookAdminService.js';
import { retryDelivery, retryAllFailed, getDeadLetterQueue, purgeDeadLetters, getDeliveryStats } from '../services/webhookService.js';

// --- Subscriber CRUD ---

export const listSubscribers = asyncHandler(async (req, res) => {
  const subscribers = await webhookAdminService.listSubscribers();
  res.json({ success: true, data: subscribers });
});

export const createSubscriber = asyncHandler(async (req, res) => {
  const subscriber = await webhookAdminService.createSubscriber(req.body);
  res.status(201).json({ success: true, data: subscriber });
});

export const updateSubscriber = asyncHandler(async (req, res) => {
  const subscriber = await webhookAdminService.updateSubscriber(req.params.id, req.body);
  res.json({ success: true, data: subscriber });
});

export const deleteSubscriber = asyncHandler(async (req, res) => {
  await webhookAdminService.deleteSubscriber(req.params.id);
  res.json({ success: true, message: 'Subscriber deleted' });
});

// --- Delivery management ---

export const listDeliveries = asyncHandler(async (req, res) => {
  const data = await webhookAdminService.listDeliveries(req.query);
  res.json({ success: true, data });
});

export const getDelivery = asyncHandler(async (req, res) => {
  const delivery = await webhookAdminService.getDeliveryById(req.params.id);
  res.json({ success: true, data: delivery });
});

// --- Dead-letter queue ---

export const listDeadLetters = asyncHandler(async (req, res) => {
  const data = await getDeadLetterQueue();
  res.json({ success: true, data });
});

export const purgeDeadLetterQueue = asyncHandler(async (req, res) => {
  const maxAgeDays = req.body.maxAgeDays !== undefined ? parseInt(req.body.maxAgeDays) : 30;
  const deleted = await purgeDeadLetters(maxAgeDays);
  res.json({ success: true, message: `${deleted} dead-letter deliveries purged`, deleted });
});

export const retryAllFailedDeliveries = asyncHandler(async (req, res) => {
  const { subscriberId } = req.body;
  if (!subscriberId) {
    return res.status(400).json({ success: false, message: 'subscriberId is required' });
  }
  const count = await retryAllFailed(subscriberId);
  res.json({ success: true, message: `${count} deliveries queued for retry` });
});

// --- Stats ---

export const getStats = asyncHandler(async (req, res) => {
  const data = await getDeliveryStats();
  res.json({ success: true, data });
});

// --- Single delivery retry ---

export const retrySingleDelivery = asyncHandler(async (req, res) => {
  await retryDelivery(req.params.id);
  res.json({ success: true, message: 'Delivery queued for retry' });
});
