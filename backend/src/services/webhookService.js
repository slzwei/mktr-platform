import crypto from 'crypto';
import { Op } from 'sequelize';
import { WebhookSubscriber, WebhookDelivery, sequelize } from '../models/index.js';
import { logger } from '../utils/logger.js';

const AUTO_DISABLE_THRESHOLD = 50;

// --- Default dependencies ---
const defaultDeps = {
  WebhookSubscriber,
  WebhookDelivery,
  logger,
  fetch: globalThis.fetch,
};

// --- Factory ---
export function makeWebhookService(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };

  // Concurrency limiter for webhook deliveries to avoid exhausting the connection pool
  const MAX_CONCURRENT_DELIVERIES = 3;
  const MAX_QUEUE_DEPTH = 100;
  let activeDeliveries = 0;
  let droppedDeliveries = 0;
  const deliveryQueue = [];

  function enqueueDelivery(delivery, subscriber) {
    // Backpressure: reject new deliveries when queue is full
    if (deliveryQueue.length >= MAX_QUEUE_DEPTH) {
      droppedDeliveries++;
      d.logger.warn('[Webhook] queue full — dropping delivery', {
        deliveryId: delivery.deliveryId,
        subscriberName: subscriber.name,
        queueDepth: deliveryQueue.length,
        totalDropped: droppedDeliveries,
      });
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const run = async () => {
        activeDeliveries++;
        try {
          await attemptDelivery(delivery, subscriber);
        } catch (err) {
          d.logger.error('[Webhook] delivery error', { deliveryId: delivery.deliveryId, error: err.message });
        } finally {
          activeDeliveries--;
          resolve();
          if (deliveryQueue.length > 0) {
            deliveryQueue.shift()();
          }
        }
      };

      if (activeDeliveries < MAX_CONCURRENT_DELIVERIES) {
        run();
      } else {
        deliveryQueue.push(run);
      }
    });
  }

  function getQueueStats() {
    return { activeDeliveries, queueDepth: deliveryQueue.length, droppedDeliveries };
  }

  /**
   * Dispatch an event to all active webhook subscribers.
   * Fire-and-forget — does not throw.
   */
  async function dispatchEvent(eventType, payloadBuilder) {
    if (String(process.env.WEBHOOK_ENABLED || 'false').toLowerCase() !== 'true') {
      return;
    }

    try {
      const subscribers = await d.WebhookSubscriber.findAll({
        where: { enabled: true }
      });

      // Filter to subscribers interested in this event type
      const matched = subscribers.filter(sub => {
        const events = sub.events || [];
        return events.includes(eventType);
      });

      if (matched.length === 0) {
        d.logger.debug('[Webhook] No active subscribers for event', { eventType });
        return;
      }

      // Build payload once
      const payload = payloadBuilder();

      for (const subscriber of matched) {
        const deliveryId = crypto.randomUUID();

        const delivery = await d.WebhookDelivery.create({
          subscriberId: subscriber.id,
          deliveryId,
          eventType,
          payload: { ...payload, deliveryId },
          status: 'pending'
        });

        // Fire-and-forget with concurrency limit
        enqueueDelivery(delivery, subscriber);
      }
    } catch (err) {
      d.logger.error('[Webhook] dispatchEvent error', { eventType, error: err.message });
    }
  }

  /**
   * Attempt to deliver a webhook payload to a subscriber.
   */
  async function attemptDelivery(delivery, subscriber) {
    const rawBody = JSON.stringify(delivery.payload);
    const timestamp = new Date().toISOString();
    const hmac = crypto.createHmac('sha256', subscriber.secret).update(rawBody).digest('hex');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await d.fetch(subscriber.url, {
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
          d.logger.error('[Webhook] retry error', {
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

    d.logger.warn('[Webhook] delivery failed', {
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
  async function retryDelivery(deliveryId) {
    const delivery = await d.WebhookDelivery.findByPk(deliveryId, {
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
      d.logger.error('[Webhook] manual retry error', {
        deliveryId,
        error: err.message
      });
    });
  }

  /**
   * Retry all failed deliveries for a subscriber.
   */
  async function retryAllFailed(subscriberId) {
    const deliveries = await d.WebhookDelivery.findAll({
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
      const recentFailed = await d.WebhookDelivery.count({
        where: {
          subscriberId: subscriber.id,
          status: 'failed'
        }
      });

      if (recentFailed < AUTO_DISABLE_THRESHOLD) return;

      // Check if there's any success more recent than the 10th-oldest failure
      const tenthFailure = await d.WebhookDelivery.findOne({
        where: { subscriberId: subscriber.id, status: 'failed' },
        order: [['createdAt', 'DESC']],
        offset: AUTO_DISABLE_THRESHOLD - 1
      });

      if (!tenthFailure) return;

      const recentSuccess = await d.WebhookDelivery.count({
        where: {
          subscriberId: subscriber.id,
          status: 'success',
          createdAt: { [Op.gte]: tenthFailure.createdAt }
        }
      });

      if (recentSuccess === 0) {
        await subscriber.update({ enabled: false });
        d.logger.warn('[Webhook] subscriber auto-disabled after consecutive failures', {
          subscriberId: subscriber.id,
          subscriberName: subscriber.name,
          consecutiveFailures: AUTO_DISABLE_THRESHOLD
        });
      }
    } catch (err) {
      d.logger.error('[Webhook] checkAutoDisable error', {
        subscriberId: subscriber.id,
        error: err.message
      });
    }
  }

  /**
   * Get failed deliveries grouped by subscriber (dead-letter queue).
   */
  async function getDeadLetterQueue() {
    const deliveries = await d.WebhookDelivery.findAll({
      where: { status: 'failed' },
      include: [{ association: 'subscriber', attributes: ['id', 'name', 'url', 'enabled'] }],
      order: [['createdAt', 'DESC']],
      limit: 200
    });

    // Group by subscriber
    const grouped = {};
    for (const dlv of deliveries) {
      const subId = dlv.subscriberId;
      if (!grouped[subId]) {
        grouped[subId] = {
          subscriber: dlv.subscriber ? { id: dlv.subscriber.id, name: dlv.subscriber.name, url: dlv.subscriber.url, enabled: dlv.subscriber.enabled } : { id: subId },
          deliveries: []
        };
      }
      grouped[subId].deliveries.push(dlv);
    }

    return Object.values(grouped);
  }

  /**
   * Purge failed deliveries older than maxAgeDays.
   */
  async function purgeDeadLetters(maxAgeDays = 30) {
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const deleted = await d.WebhookDelivery.destroy({
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
  async function getDeliveryStats() {
    const subscribers = await d.WebhookSubscriber.findAll({
      attributes: ['id', 'name', 'url', 'enabled']
    });

    // Single query with FILTER to get all periods x statuses in one pass
    const [rows] = await d.WebhookSubscriber.sequelize.query(`
      SELECT "subscriberId", status,
        COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '1 day')::int AS "last24h",
        COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '7 days')::int AS "last7d",
        COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '30 days')::int AS "last30d"
      FROM webhook_deliveries
      GROUP BY "subscriberId", status
    `);

    // Pivot rows into per-subscriber stats
    const statsMap = {};
    for (const row of rows) {
      if (!statsMap[row.subscriberId]) statsMap[row.subscriberId] = { last24h: {}, last7d: {}, last30d: {} };
      const s = statsMap[row.subscriberId];
      for (const period of ['last24h', 'last7d', 'last30d']) {
        s[period][row.status] = parseInt(row[period]) || 0;
      }
    }

    return subscribers.map(sub => {
      const s = statsMap[sub.id] || { last24h: {}, last7d: {}, last30d: {} };
      const format = (p) => ({
        success: p.success || 0, failed: p.failed || 0, pending: p.pending || 0,
        total: (p.success || 0) + (p.failed || 0) + (p.pending || 0)
      });
      return {
        subscriber: { id: sub.id, name: sub.name, url: sub.url, enabled: sub.enabled },
        last24h: format(s.last24h), last7d: format(s.last7d), last30d: format(s.last30d)
      };
    });
  }

  /**
   * Recover stale pending deliveries that were lost on server restart.
   * Picks up deliveries where nextRetryAt has passed and attempts < maxAttempts.
   */
  async function recoverPendingRetries() {
    const staleDeliveries = await d.WebhookDelivery.findAll({
      where: {
        status: 'pending',
        nextRetryAt: { [Op.lt]: new Date() },
        attempts: { [Op.lt]: sequelize.col('maxAttempts') }
      },
      include: [{ association: 'subscriber', where: { enabled: true } }],
      limit: 50,
      order: [['nextRetryAt', 'ASC']]
    });

    for (const delivery of staleDeliveries) {
      attemptDelivery(delivery, delivery.subscriber).catch(err => {
        d.logger.error('[Webhook] recovery retry error', { deliveryId: delivery.deliveryId, error: err.message });
      });
      // Small delay between retries to avoid hammering
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (staleDeliveries.length > 0) {
      d.logger.info('[Webhook] recovered stale retries', { count: staleDeliveries.length });
    }
  }

  return { dispatchEvent, attemptDelivery, retryDelivery, retryAllFailed,
           getDeadLetterQueue, purgeDeadLetters, getDeliveryStats, getQueueStats, recoverPendingRetries };
}

// --- Backward-compatible named exports ---
const _default = makeWebhookService();
export const dispatchEvent = _default.dispatchEvent;
export const attemptDelivery = _default.attemptDelivery;
export const retryDelivery = _default.retryDelivery;
export const retryAllFailed = _default.retryAllFailed;
export const getDeadLetterQueue = _default.getDeadLetterQueue;
export const purgeDeadLetters = _default.purgeDeadLetters;
export const getDeliveryStats = _default.getDeliveryStats;
export const recoverPendingRetries = _default.recoverPendingRetries;
