/**
 * Featured drops — the public list behind GET /api/campaigns/featured-drops,
 * consumed by the redeem.sg homepage. Design: docs/plans/redeem-home-featured-drops.md.
 *
 * Only campaigns that are is_active AND status='active' AND explicitly flagged
 * (design_config.featuredDrop.enabled, admin-gated on write) are listed.
 * DTO is a strict whitelist; claim links are ALWAYS the redeem.sg host (the
 * homepage's trust copy promises "redeem.sg only"); raw signup counts are never
 * exposed without an operator-set display cap.
 */

import { Op } from 'sequelize';
import { Campaign, Prospect } from '../models/index.js';
import { normalizeFeaturedDrop } from '../utils/featuredDrop.js';
import { getStoredFeaturedDrop } from '../utils/designConfigV2Clamp.js';
import { customerHostOrigin } from '../utils/customerHost.js';
import { sgtDayEndExclusiveMs } from '../utils/sgtTime.js';
import { logger } from '../utils/logger.js';

const TTL_MS = 60_000;
const GONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // gone cards auto-hide 7d after endsAt
const MAX_DROPS = 6;

let cache = { data: null, ts: 0 };
let inflight = null;

// endsAt is inclusive through the whole SGT day: an instant is within the day
// iff now < sgtDayEndExclusiveMs(endsAt) (shared util — the old private helper
// stopped at 23:59:59.000 and dropped the day's final 999ms).

async function fetchDrops(now) {
  const campaigns = await Campaign.findAll({
    // Both flags: is_active for the on/off switch, status for lifecycle —
    // archived/draft campaigns must never publish even if still flagged.
    where: { is_active: true, status: 'active' },
    attributes: ['id', 'name', 'design_config'],
  });

  const flagged = [];
  for (const c of campaigns) {
    // Re-normalize on read: defense in depth against rows written outside
    // campaignService (seeds, manual SQL, old code paths). Version-aware:
    // v2 docs keep the drop at distribution.featuredDrop.
    const fd = normalizeFeaturedDrop(getStoredFeaturedDrop(c.design_config));
    if (!fd || fd.enabled !== true) continue;
    const endMs = fd.endsAt ? sgtDayEndExclusiveMs(fd.endsAt) : null;
    if (endMs !== null && now >= endMs + GONE_RETENTION_MS) continue;
    flagged.push({ c, fd, endMs });
  }
  if (flagged.length === 0) return [];

  const ids = flagged.map((f) => f.c.id);
  // One grouped count; pg can return counts as strings — parse defensively.
  const rows = await Prospect.count({
    where: { campaignId: { [Op.in]: ids } },
    group: ['campaignId'],
  });
  const counts = new Map(
    (rows || []).map((r) => [String(r.campaignId), Number(r.count) || 0])
  );

  const origin = customerHostOrigin('redeem');
  const drops = flagged.map(({ c, fd, endMs }) => {
    const claimed = counts.get(String(c.id)) || 0;
    const capReached = typeof fd.cap === 'number' && claimed >= fd.cap;
    const ended = endMs !== null && now >= endMs;
    const drop = {
      id: c.id,
      title: fd.title || c.name,
      valueLabel: fd.valueLabel || null,
      emoji: fd.emoji || null,
      status: capReached || ended ? 'gone' : 'live',
      claimUrl: `${origin}/LeadCapture?campaign_id=${c.id}`,
    };
    if (typeof fd.cap === 'number') {
      drop.claimedPct = Math.max(0, Math.min(100, Math.round((claimed / fd.cap) * 100)));
      drop.left = Math.max(0, fd.cap - claimed);
    }
    if (fd.endsAt) drop.endsAt = fd.endsAt;
    return drop;
  });

  // Deterministic: live first, then soonest-ending (nulls last), then id.
  drops.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'live' ? -1 : 1;
    const ae = a.endsAt ? sgtDayEndExclusiveMs(a.endsAt) : Infinity;
    const be = b.endsAt ? sgtDayEndExclusiveMs(b.endsAt) : Infinity;
    if (ae !== be) return ae - be;
    return String(a.id).localeCompare(String(b.id));
  });
  return drops.slice(0, MAX_DROPS);
}

/**
 * 60s TTL cache with in-flight coalescing (concurrent misses share one query)
 * and stale-on-error (a failed refresh serves the last good list).
 */
export async function getFeaturedDrops({ now = Date.now() } = {}) {
  if (cache.data && now - cache.ts < TTL_MS) return cache.data;
  if (inflight) return inflight;
  inflight = fetchDrops(now)
    .then((data) => {
      cache = { data, ts: now };
      return data;
    })
    .catch((err) => {
      logger.error({ err: err?.message }, 'featured_drops.refresh_failed');
      if (cache.data) return cache.data; // stale-on-error
      throw err;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Test hook — module cache is process state; reset between cases. */
export function __resetFeaturedDropsCache() {
  cache = { data: null, ts: 0 };
  inflight = null;
}
