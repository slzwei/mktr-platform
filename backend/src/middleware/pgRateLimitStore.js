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
function expandIpv6(addr) {
  const bare = String(addr).split('%')[0];
  let groups;
  if (bare.includes('::')) {
    const [head, tail] = bare.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    groups = [...h, ...Array(Math.max(8 - h.length - t.length, 0)).fill('0'), ...t];
  } else {
    groups = bare.split(':');
  }
  if (groups.length !== 8) return null;
  return groups.map((g) => (g || '0').toLowerCase().padStart(4, '0'));
}

function ipv6Prefix64(addr) {
  const groups = expandIpv6(addr);
  return groups ? groups.slice(0, 4).join(':') : String(addr);
}

/**
 * Cloudflare's published edge ranges — https://www.cloudflare.com/ips/
 *
 * These change rarely (a few times a decade). If Cloudflare adds a range and this
 * list goes stale, the only consequence is that traffic via the new edge falls
 * back to keying on the edge address — the same coarse-but-safe behaviour we had
 * before. It never fails open.
 */
const CF_IPV4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];
const CF_IPV6 = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function inIpv4Cidr(ip, cidr) {
  const [net, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(net);
  if (a === null || b === null) return false;
  if (bits === 0) return true;
  const size = 2 ** (32 - bits);
  return Math.floor(a / size) === Math.floor(b / size);
}

function ipv6ToBigInt(addr) {
  const groups = expandIpv6(addr);
  if (!groups) return null;
  let n = 0n;
  for (const g of groups) {
    const v = Number.parseInt(g, 16);
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) return null;
    n = (n << 16n) + BigInt(v);
  }
  return n;
}

function inIpv6Cidr(ip, cidr) {
  const [net, bitsRaw] = cidr.split('/');
  const bits = BigInt(Number(bitsRaw));
  const a = ipv6ToBigInt(ip);
  const b = ipv6ToBigInt(net);
  if (a === null || b === null) return false;
  const shift = 128n - bits;
  return (a >> shift) === (b >> shift);
}

/** Did this request genuinely arrive from a Cloudflare edge? */
function isCloudflareIp(ip) {
  if (!ip) return false;
  const bare = ip.startsWith('::ffff:') ? ip.slice(7) : String(ip).split('%')[0];
  return bare.includes(':')
    ? CF_IPV6.some((c) => inIpv6Cidr(bare, c))
    : CF_IPV4.some((c) => inIpv4Cidr(bare, c));
}

/** Collapse an address to its rate-limiting identity. */
function normalizeIp(ip) {
  if (!ip) return 'unknown';
  if (ip.startsWith('::ffff:')) return ip.slice(7); // IPv4-mapped IPv6
  if (ip.includes(':')) return ipv6Prefix64(ip);
  return ip;
}

/**
 * Client key for the limiter.
 *
 * api.mktr.sg sits behind Cloudflare, and `trust proxy` is 1, so `req.ip` resolves
 * to the Cloudflare EDGE address, not the visitor. Keying on that bucketed many
 * real users together while letting one attacker spread across edges — confirmed
 * in production, where every limiter row was keyed `162.158.x.x`.
 *
 * So prefer CF-Connecting-IP, but ONLY when the request actually came from a
 * Cloudflare range. The Render origin is publicly reachable, so an unvalidated
 * header read would be strictly worse than the bug it fixes: anyone could send a
 * random CF-Connecting-IP per request and mint unlimited buckets. Validating the
 * edge means a spoofer bypassing Cloudflare is keyed on their real socket address.
 *
 * Note this limiter is defence-in-depth regardless — the control that actually
 * protects the sender ID is the per-number daily cap in services/smsQuota.js.
 */
export function clientKey(req) {
  const edge = req.ip || req.socket?.remoteAddress || '';
  const forwarded = req.headers?.['cf-connecting-ip'];
  const trusted = forwarded && isCloudflareIp(edge)
    ? String(forwarded).split(',')[0].trim()
    : edge;
  return normalizeIp(trusted);
}
