import crypto from 'crypto';
import { Op } from 'sequelize';
import { WebhookSubscriber, WebhookDelivery } from '../models/index.js';
import { logger } from '../utils/logger.js';

const AUTO_DISABLE_THRESHOLD = 10;

/**
 * Dispatch an event to all active webhook subscribers.
 * Fire-and-forget — does not throw.
 */
export async function dispatchEvent(eventType, payloadBuilder) {
  if (String(process.env.WEBHOOK_ENABLED || 'false').toLowerCase() !== 'true') {
    return;
  }

  try {
    const subscribers = await WebhookSubscriber.findAll({
      where: { enabled: true }
    });

    // Filter to subscribers interested in this event type
    const matched = subscribers.filter(sub => {
      const events = sub.events || [];
      return events.includes(eventType);
    });

    if (matched.length === 0) {
      logger.debug('[Webhook] No active subscribers for event', { eventType });
      return;
    }

    // Build payload once
    const payload = payloadBuilder();

    for (const subscriber of matched) {
      const deliveryId = crypto.randomUUID();

      const delivery = await WebhookDelivery.create({
        subscriberId: subscriber.id,
        deliveryId,
        eventType,
        payload: { ...payload, deliveryId },
        status: 'pending'
      });

      // Fire-and-forget — do not await
      attemptDelivery(delivery, subscriber).catch(err => {
        logger.error('[Webhook] attemptDelivery error', {
          subscriberName: subscriber.name,
          deliveryId,
          error: err.message
        });
      });
    }
  } catch (err) {
    logger.error('[Webhook] dispatchEvent error', { eventType, error: err.message });
  }
}

/**
 * Attempt to deliver a webhook payload to a subscriber.
 */
export async function attemptDelivery(delivery, subscriber) {
  const rawBody = JSON.stringify(delivery.payload);
  const timestamp = new Date().toISOString();
  const hmac = crypto.createHmac('sha256', subscriber.secret).update(rawBody).digest('hex');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(subscriber.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Event': delivery.eventType,
        'X-Webhook-Delivery-Id': delivery.deliveryId,
        'X-Webhook-Signature': `sha256=${hmac}`,
        'X-Webhook-Timestamp': timestamp
      },
      body: rawBody,
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (response.ok) {
      await delivery.update({
        status: 'success',
        responseCode: response.status,
        lastAttemptAt: new Date(),
        attempts: delivery.attempts + 1
      });
    } else {
      let responseBody = '';
      try {
        responseBody = await response.text();
      } catch (_) { /* best-effort body read */ }

      await handleFailure(delivery, subscriber, {
        responseCode: response.status,
        responseBody: responseBody.slice(0, 1000),
        errorMessage: `HTTP ${response.status}`
      });
    }
  } catch (err) {
    clearTimeout(timeout);

    await handleFailure(delivery, subscriber, {
      responseCode: null,
      responseBody: null,
      errorMessage: err.name === 'AbortError' ? 'Request timed out (10s)' : err.message
    });
  }
}

async function handleFailure(delivery, subscriber, { responseCode, responseBody, errorMessage }) {
  const newAttempts = delivery.attempts + 1;

  const updateData = {
    attempts: newAttempts,
    lastAttemptAt: new Date(),
    responseCode,
    responseBody,
    errorMessage
  };

  if (newAttempts < delivery.maxAttempts) {
    // Exponential backoff: 1s, 4s, 16s
    const delayMs = Math.pow(4, newAttempts - 1) * 1000;
    updateData.nextRetryAt = new Date(Date.now() + delayMs);
    await delivery.update(updateData);

    // Schedule retry
    setTimeout(() => {
      attemptDelivery(delivery, subscriber).catch(err => {
        logger.error('[Webhook] retry error', {
          subscriberName: subscriber.name,
          deliveryId: delivery.deliveryId,
          attempt: newAttempts + 1,
          error: err.message
        });
      });
    }, delayMs);
  } else {
    updateData.status = 'failed';
    await delivery.update(updateData);

    // Auto-disable subscriber after consecutive failures
    await checkAutoDisable(subscriber);
  }

  logger.warn('[Webhook] delivery failed', {
    subscriberName: subscriber.name,
    deliveryId: delivery.deliveryId,
    attempt: newAttempts,
    maxAttempts: delivery.maxAttempts,
    error: errorMessage
  });
}

/**
 * Manually retry a single failed delivery.
 */
export async function retryDelivery(deliveryId) {
  const delivery = await WebhookDelivery.findByPk(deliveryId, {
    include: [{ association: 'subscriber' }]
  });

  if (!delivery) {
    throw new Error('Delivery not found');
  }

  if (!delivery.subscriber) {
    throw new Error('Subscriber not found for delivery');
  }

  await delivery.update({
    attempts: 0,
    status: 'pending',
    maxAttempts: 3
  });

  // Fire-and-forget
  attemptDelivery(delivery, delivery.subscriber).catch(err => {
    logger.error('[Webhook] manual retry error', {
      deliveryId,
      error: err.message
    });
  });
}

/**
 * Retry all failed deliveries for a subscriber.
 */
export async function retryAllFailed(subscriberId) {
  const deliveries = await WebhookDelivery.findAll({
    where: {
      subscriberId,
      status: 'failed'
    }
  });

  for (const delivery of deliveries) {
    await retryDelivery(delivery.id);
  }

  return deliveries.length;
}

/**
 * Auto-disable a subscriber if it has 10+ consecutive failed deliveries
 * (no successful delivery more recent than the oldest of the last 10 failures).
 */
async function checkAutoDisable(subscriber) {
  try {
    const recentFailed = await WebhookDelivery.count({
      where: {
        subscriberId: subscriber.id,
        status: 'failed'
      }
    });

    if (recentFailed < AUTO_DISABLE_THRESHOLD) return;

    // Check if there's any success more recent than the 10th-oldest failure
    const tenthFailure = await WebhookDelivery.findOne({
      where: { subscriberId: subscriber.id, status: 'failed' },
      order: [['createdAt', 'DESC']],
      offset: AUTO_DISABLE_THRESHOLD - 1
    });

    if (!tenthFailure) return;

    const recentSuccess = await WebhookDelivery.count({
      where: {
        subscriberId: subscriber.id,
        status: 'success',
        createdAt: { [Op.gte]: tenthFailure.createdAt }
      }
    });

    if (recentSuccess === 0) {
      await subscriber.update({ enabled: false });
      logger.warn('[Webhook] subscriber auto-disabled after consecutive failures', {
        subscriberId: subscriber.id,
        subscriberName: subscriber.name,
        consecutiveFailures: AUTO_DISABLE_THRESHOLD
      });
    }
  } catch (err) {
    logger.error('[Webhook] checkAutoDisable error', {
      subscriberId: subscriber.id,
      error: err.message
    });
  }
}

/**
 * Get failed deliveries grouped by subscriber (dead-letter queue).
 */
export async function getDeadLetterQueue() {
  const deliveries = await WebhookDelivery.findAll({
    where: { status: 'failed' },
    include: [{ association: 'subscriber', attributes: ['id', 'name', 'url', 'enabled'] }],
    order: [['createdAt', 'DESC']]
  });

  // Group by subscriber
  const grouped = {};
  for (const d of deliveries) {
    const subId = d.subscriberId;
    if (!grouped[subId]) {
      grouped[subId] = {
        subscriber: d.subscriber ? { id: d.subscriber.id, name: d.subscriber.name, url: d.subscriber.url, enabled: d.subscriber.enabled } : { id: subId },
        deliveries: []
      };
    }
    grouped[subId].deliveries.push(d);
  }

  return Object.values(grouped);
}

/**
 * Purge failed deliveries older than maxAgeDays.
 */
export async function purgeDeadLetters(maxAgeDays = 30) {
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
  const deleted = await WebhookDelivery.destroy({
    where: {
      status: 'failed',
      createdAt: { [Op.lt]: cutoff }
    }
  });
  return deleted;
}

/**
 * Get delivery statistics per subscriber for given time periods.
 */
export async function getDeliveryStats() {
  const now = new Date();
  const day1 = new Date(now - 24 * 60 * 60 * 1000);
  const day7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const day30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const subscribers = await WebhookSubscriber.findAll({
    attributes: ['id', 'name', 'url', 'enabled']
  });

  const stats = [];
  for (const sub of subscribers) {
    const countForPeriod = async (since) => {
      const where = { subscriberId: sub.id, createdAt: { [Op.gte]: since } };
      const [success, failed, pending] = await Promise.all([
        WebhookDelivery.count({ where: { ...where, status: 'success' } }),
        WebhookDelivery.count({ where: { ...where, status: 'failed' } }),
        WebhookDelivery.count({ where: { ...where, status: 'pending' } })
      ]);
      return { success, failed, pending, total: success + failed + pending };
    };

    const [last24h, last7d, last30d] = await Promise.all([
      countForPeriod(day1),
      countForPeriod(day7),
      countForPeriod(day30)
    ]);

    stats.push({
      subscriber: { id: sub.id, name: sub.name, url: sub.url, enabled: sub.enabled },
      last24h,
      last7d,
      last30d
    });
  }

  return stats;
}
