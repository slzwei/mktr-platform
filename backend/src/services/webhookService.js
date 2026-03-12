import crypto from 'crypto';
import { WebhookSubscriber, WebhookDelivery } from '../models/index.js';
import { logger } from '../utils/logger.js';

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
      } catch (_) {}

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
