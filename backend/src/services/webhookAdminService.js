import { Op } from 'sequelize';
import { WebhookSubscriber, WebhookDelivery } from '../models/index.js';

/**
 * Subscriber CRUD and delivery listing for the webhook admin panel.
 * Retry / dead-letter / stats remain in webhookService.js.
 */

export async function listSubscribers() {
  return WebhookSubscriber.findAll({
    order: [['createdAt', 'DESC']]
  });
}

export async function createSubscriber({ name, url, secret, events, enabled, description, metadata }) {
  if (!name || !url || !secret) {
    const err = new Error('name, url, and secret are required');
    err.statusCode = 400;
    throw err;
  }

  return WebhookSubscriber.create({
    name,
    url,
    secret,
    events: events || [],
    enabled: enabled !== false,
    description: description || null,
    metadata: metadata || {}
  });
}

export async function updateSubscriber(id, fields) {
  const subscriber = await WebhookSubscriber.findByPk(id);
  if (!subscriber) {
    const err = new Error('Subscriber not found');
    err.statusCode = 404;
    throw err;
  }

  const { name, url, secret, events, enabled, description, metadata } = fields;
  await subscriber.update({
    ...(name !== undefined && { name }),
    ...(url !== undefined && { url }),
    ...(secret !== undefined && { secret }),
    ...(events !== undefined && { events }),
    ...(enabled !== undefined && { enabled }),
    ...(description !== undefined && { description }),
    ...(metadata !== undefined && { metadata })
  });

  return subscriber;
}

export async function deleteSubscriber(id) {
  const subscriber = await WebhookSubscriber.findByPk(id);
  if (!subscriber) {
    const err = new Error('Subscriber not found');
    err.statusCode = 404;
    throw err;
  }

  await subscriber.destroy();
}

export async function listDeliveries({ status, subscriberId, eventType, dateFrom, dateTo, page = 1, limit = 20 }) {
  const where = {};

  if (status) where.status = status;
  if (subscriberId) where.subscriberId = subscriberId;
  if (eventType) where.eventType = eventType;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt[Op.gte] = new Date(dateFrom);
    if (dateTo) where.createdAt[Op.lte] = new Date(dateTo);
  }

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  const { count, rows: deliveries } = await WebhookDelivery.findAndCountAll({
    where,
    limit: limitNum,
    offset,
    order: [['createdAt', 'DESC']],
    include: [{ association: 'subscriber', attributes: ['id', 'name', 'url'] }]
  });

  return {
    deliveries,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(count / limitNum),
      totalItems: count,
      itemsPerPage: limitNum
    }
  };
}

export async function getDeliveryById(id) {
  const delivery = await WebhookDelivery.findByPk(id, {
    include: [{ association: 'subscriber', attributes: ['id', 'name', 'url'] }]
  });
  if (!delivery) {
    const err = new Error('Delivery not found');
    err.statusCode = 404;
    throw err;
  }
  return delivery;
}
