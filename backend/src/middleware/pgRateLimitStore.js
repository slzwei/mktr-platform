import { bump, unbump, reset } from '../services/rateCounter.js';
import { logger } from '../utils/logger.js';

/**
 * A durable express-rate-limit store backed by Postgres (migration 083).
 *
 * Replaces the default MemoryStore, which counted per-process and reset on every
 * redeploy — so the advertised "10 per 15 min" was really "10 per instance, until
 * the next deploy". On Render that is a much softer limit than it looks.
 *
 * Fixed-window, bucketed on `windowMs`. Fixed windows allow a 2x burst across a
 * boundary; that is fine here because this limiter is defence-in-depth for
 * transport abuse. The control that actually protects the SSIR Sender ID is the
 * per-phone/global quota in services/smsQuota.js, which is daily and fails closed.
 *
 * Deliberately FAILS OPEN on a database error: a Postgres blip must not 503 the
 * whole verification surface. The quota layer still fails closed, so a DB outage
 * degrades the transport limiter without exposing the SMS budget.
 */
export class PostgresRateLimitStore {
  constructor({ prefix = 'rl' } = {}) {
    this.prefix = prefix;
    this.windowMs = 60_000;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  #bucket(key, now = Date.now()) {
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    return {
      counterKey: `${this.prefix}:${key}:${windowStart}`,
      resetTime: new Date(windowStart + this.windowMs),
    };
  }

  async increment(key) {
    const { counterKey, resetTime } = this.#bucket(key);
    try {
      const { count } = await bump(counterKey, resetTime);
      return { totalHits: count, resetTime };
    } catch (err) {
      logger.warn({ err: err.message }, 'rate_limit.store_unavailable_failing_open');
      return { totalHits: 0, resetTime };
    }
  }

  async decrement(key) {
    const { counterKey } = this.#bucket(key);
    try {
      await unbump(counterKey);
    } catch (err) {
      logger.warn({ err: err.message }, 'rate_limit.decrement_failed');
    }
  }

  async resetKey(key) {
    const { counterKey } = this.#bucket(key);
    try {
      await reset(counterKey);
    } catch (err) {
      logger.warn({ err: err.message }, 'rate_limit.reset_failed');
    }
  }
}

/**
 * Expand an IPv6 address and keep its /64 routing prefix.
 *
 * A single IPv6 allocation hands out 2^64 addresses, so keying on the full
 * address would let one client mint unlimited windows. Handles `::` compression
 * and zone ids, which a naive split(':') gets wrong.
 */
function ipv6Prefix64(addr) {
  const bare = addr.split('%')[0];
  let groups;
  if (bare.includes('::')) {
    const [head, tail] = bare.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    groups = [...h, ...Array(Math.max(8 - h.length - t.length, 0)).fill('0'), ...t];
  } else {
    groups = bare.split(':');
  }
  return groups.slice(0, 4).map((g) => (g || '0').toLowerCase().padStart(4, '0')).join(':');
}

/**
 * Client key for the limiter. express-rate-limit's default keyGenerator uses the
 * raw req.ip, which treats every address in an IPv6 /64 as a separate client.
 */
export function clientKey(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (ip.startsWith('::ffff:')) return ip.slice(7); // IPv4-mapped IPv6
  if (ip.includes(':')) return ipv6Prefix64(ip);
  return ip;
}
