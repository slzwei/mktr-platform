import { Op } from 'sequelize';
import {
  User, Campaign, Prospect, QrTag,
  WebhookDelivery, WebhookSubscriber, LeadPackageAssignment, sequelize
} from '../models/index.js';
import { logger } from '../utils/logger.js';

// ── Period plumbing (admin rebuild Phase B) ───────────────────────────────────
// Everything admin-dashboard is SGT-anchored: "today" = since 00:00 SGT.
const VALID_PERIODS = ['7d', '30d', '90d'];
const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 };
const SGT_OFFSET_MS = 8 * 3600e3;
const DAY_MS = 24 * 3600e3;
// Wallets below S$50 are "low" on the attention rail (design constant).
const LOW_WALLET_CENTS = 5000;

export function normalizePeriod(period) {
  return VALID_PERIODS.includes(period) ? period : '30d';
}

/** UTC instant of the most recent SGT midnight. */
function sgtMidnightUtc(now = new Date()) {
  const shifted = new Date(now.getTime() + SGT_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - SGT_OFFSET_MS);
}

/** Rolling period window anchored to SGT midnight: [start of (days-1) ago, now]. */
function periodStartUtc(period, now = new Date()) {
  return new Date(sgtMidnightUtc(now).getTime() - (PERIOD_DAYS[normalizePeriod(period)] - 1) * DAY_MS);
}

/** design_config.luckyDraw closesAt/boostClosesAt are YYYY-MM-DD with SGT end-of-day semantics. */
function sgtDayEndMs(yyyyMmDd) {
  if (typeof yyyyMmDd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return null;
  const t = Date.parse(`${yyyyMmDd}T23:59:59+08:00`);
  return Number.isNaN(t) ? null : t;
}

// Defensive helpers for optional columns / missing tables. Degrading to 0 is
// deliberate (one broken column must not blank the whole dashboard), but the
// failure has to be visible — a DB outage otherwise renders as healthy zeros.
const safeSum = async (model, column, options = {}) => {
  try {
    const val = await model.sum(column, options);
    return Number(val) || 0;
  } catch (err) {
    logger.warn('[Dashboard] sum failed — rendering 0', { model: model?.name, column, error: err?.message });
    return 0;
  }
};
const safeCount = async (model, options = {}) => {
  try { return await model.count(options); }
  catch (err) {
    logger.warn('[Dashboard] count failed — rendering 0', { model: model?.name, error: err?.message });
    return 0;
  }
};
// Same contract for the attention rail's list queries: degrade to empty, loudly.
const warnEmpty = (query, empty) => (err) => {
  logger.warn('[Dashboard] attention query failed — rendering empty', { query, error: err?.message });
  return empty;
};

/**
 * Get dashboard overview statistics based on user role.
 */
export async function getOverview(userId, userRole, period = '30d') {
  const now = new Date();
  const safePeriod = normalizePeriod(period);
  const days = PERIOD_DAYS[safePeriod];
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  switch (userRole) {
    case 'admin': return getAdminStats(startDate, now, safePeriod);
    case 'agent': return getAgentStats(userId, startDate, now);
    default: return getCustomerStats(userId);
  }
}

// ---- Admin Stats (simple TTL cache, KEYED BY PERIOD) ----
// The old single global cache served 90d numbers to a 7d request made within
// the TTL — period switches on the dashboard silently lied. One entry per
// period fixes it without losing the burst protection.

const adminStatsCache = new Map(); // period → { result, time }
const ADMIN_CACHE_TTL_MS = 30000; // 30 seconds

/** Reset admin stats cache (useful for tests that change period between calls). */
export function resetAdminStatsCache() {
  adminStatsCache.clear();
}

async function getAdminStats(startDate, endDate, period = '30d') {
  const now = Date.now();
  const cached = adminStatsCache.get(period);
  if (cached && (now - cached.time) < ADMIN_CACHE_TTL_MS) {
    return cached.result;
  }

  // Prospects can be assigned through EITHER assignee FK (internal users OR
  // the ExternalAgent buyer pool) — "assigned" must count both.
  const anyAssignee = { [Op.or]: [{ assignedAgentId: { [Op.ne]: null } }, { externalAgentId: { [Op.ne]: null } }] };

  const [
    totalUsers, activeUsers, totalCampaigns, activeCampaigns,
    totalProspects, newProspects,
    totalQrTags, totalScans,
    periodTotal, periodAssigned, periodConverted
  ] = await Promise.all([
    safeCount(User),
    safeCount(User, { where: { isActive: true } }),
    safeCount(Campaign, { where: { status: { [Op.ne]: 'archived' } } }),
    safeCount(Campaign, { where: { [Op.or]: [{ status: 'active' }, { is_active: true }] } }),
    safeCount(Prospect),
    safeCount(Prospect, { where: { createdAt: { [Op.gte]: startDate } } }),
    safeCount(QrTag),
    safeSum(QrTag, 'scanCount'),
    // Phase B additions — period-scoped; existing `total` (all-time) and `new`
    // keep their semantics for the legacy dashboard during coexistence.
    safeCount(Prospect, { where: { createdAt: { [Op.gte]: startDate } } }),
    safeCount(Prospect, { where: { createdAt: { [Op.gte]: startDate }, ...anyAssignee } }),
    safeCount(Prospect, { where: { leadStatus: 'won', conversionDate: { [Op.gte]: startDate } } })
  ]);

  const userGrowth = await getUserGrowthTrend(startDate, endDate);
  const recentActivities = await getRecentActivities(10);

  const result = {
    users: { total: totalUsers, active: activeUsers, growth: userGrowth },
    campaigns: { total: totalCampaigns, active: activeCampaigns },
    prospects: {
      total: totalProspects,
      new: newProspects,
      periodTotal,
      assigned: periodAssigned,
      converted: periodConverted,
      conversionRate: periodTotal > 0 ? Number(((periodConverted / periodTotal) * 100).toFixed(1)) : 0
    },
    qrCodes: { total: totalQrTags, totalScans },
    recentActivities
  };

  adminStatsCache.set(period, { result, time: Date.now() });
  return result;
}

// ---- Admin attention / series / funnel (Phase B — the Switchboard rebuild's data) ----

const KNOWN_HOLD_REASONS = [
  'no_funded_agent', 'no_funded_external_buyer', 'dnc_pending', 'dnc_registered', 'returned_by_admin',
  'screening_pending', 'screening_failed', 'screening_unreachable',
];

/**
 * Structured aggregates behind the dashboard's needs-attention rail. The UI
 * composes the queue rows/copy; this returns facts only. Definitions locked to
 * docs/plans/mktr-admin-rebuild-implementation.md B2.
 */
export async function getAttention() {
  const now = new Date();
  const cutoff24h = new Date(now.getTime() - DAY_MS);
  const horizon7d = now.getTime() + 7 * DAY_MS;

  const [
    webhookPending, webhookFailed24h, disabledSubscribers,
    heldRows, unassigned,
    externalAgents, committedRows, activeCampaigns,
    screeningAgg
  ] = await Promise.all([
    safeCount(WebhookDelivery, { where: { status: 'pending' } }),
    safeCount(WebhookDelivery, { where: { status: 'failed', updatedAt: { [Op.gte]: cutoff24h } } }),
    safeCount(WebhookSubscriber, { where: { enabled: false } }),
    Prospect.findAll({
      where: { quarantinedAt: { [Op.ne]: null } },
      attributes: ['quarantineReason', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
      group: ['quarantineReason'],
      raw: true
    }).catch(warnEmpty('heldByReason', [])),
    safeCount(Prospect, { where: { assignedAgentId: null, externalAgentId: null, quarantinedAt: null } }),
    // FULL external cohort, including inactive agents — the agent-sync can
    // deactivate a user who still holds a balance, and money must never
    // vanish from the float. Rows carry isActive so the UI can badge them.
    User.findAll({
      where: { mktrLeadsId: { [Op.ne]: null }, role: 'agent' },
      attributes: ['id', 'firstName', 'lastName', 'fullName', 'email', 'walletBalanceCents', 'isActive'],
      raw: true
    }).catch(warnEmpty('externalAgentWallets', [])),
    LeadPackageAssignment.findAll({
      where: { source: 'wallet', status: 'active', leadsRemaining: { [Op.gt]: 0 } },
      attributes: ['leadsRemaining', 'unitPriceCents'],
      include: [{ association: 'package', attributes: ['campaignId'], required: true }],
    }).catch(warnEmpty('committedDemand', [])),
    Campaign.findAll({
      where: { status: 'active', is_active: true },
      attributes: ['id', 'name', 'end_date', 'leadPriceCents', 'design_config'],
    }).catch(warnEmpty('activeCampaigns', [])),
    // Screening economics. One row: total spend across every screening attempt
    // (jsonb_each over the token-keyed attempts, summing costCents) and the
    // qualified count. LEFT JOIN LATERAL keeps a qualified lead whose attempts
    // predate cost-capture in the count while contributing 0 to spend. Screening
    // is opt-in + dial-capped, so this scans a small slice; still guarded so a
    // failure degrades to zeros rather than breaking the whole dashboard.
    sequelize.query(
      `SELECT
         COALESCE(SUM((att.value->>'costCents')::numeric), 0)::float AS spend_cents,
         COUNT(DISTINCT p.id) FILTER (WHERE p."screeningVerdict" = 'qualified')::int AS qualified
       FROM prospects p
       LEFT JOIN LATERAL jsonb_each(COALESCE(p."screeningMetadata"->'attempts', '{}'::jsonb)) att ON true
       WHERE p."screeningMetadata" IS NOT NULL`,
      { type: sequelize.QueryTypes.SELECT }
    ).then((r) => r?.[0] || { spend_cents: 0, qualified: 0 }).catch(warnEmpty('screeningEconomics', { spend_cents: 0, qualified: 0 }))
  ]);

  // Held, grouped over the real reason set; anything unknown/null reconciles into `other`.
  const byReason = Object.fromEntries(KNOWN_HOLD_REASONS.map((r) => [r, 0]));
  byReason.other = 0;
  let heldTotal = 0;
  for (const row of heldRows) {
    const n = Number(row.n) || 0;
    heldTotal += n;
    if (KNOWN_HOLD_REASONS.includes(row.quarantineReason)) byReason[row.quarantineReason] += n;
    else byReason.other += n;
  }

  // Wallets — EXTERNAL agents only (v1 cohort), inactive included.
  // raw:true skips the fullName VIRTUAL and synced external agents can lack an
  // email — this must never emit null (it crashed the v2 dashboard).
  const name = (a) => a.fullName || `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.email || 'Agent';
  const zero = externalAgents
    .filter((a) => a.walletBalanceCents === 0)
    .map((a) => ({ id: a.id, name: name(a), isActive: a.isActive }));
  const low = externalAgents
    .filter((a) => a.walletBalanceCents > 0 && a.walletBalanceCents < LOW_WALLET_CENTS)
    .map((a) => ({ id: a.id, name: name(a), balanceCents: a.walletBalanceCents, isActive: a.isActive }));
  const floatCents = externalAgents.reduce((s, a) => s + (a.walletBalanceCents || 0), 0);

  // Committed demand — open wallet commitments across all campaigns.
  const fundedCampaignIds = new Set();
  let committedLeads = 0;
  let committedValueCents = 0;
  for (const r of committedRows) {
    committedLeads += r.leadsRemaining;
    if (Number.isInteger(r.unitPriceCents)) committedValueCents += r.leadsRemaining * r.unitPriceCents;
    if (r.package?.campaignId) fundedCampaignIds.add(r.package.campaignId);
  }

  // Zero-commitment incidents: ACTIVE + PRICED campaigns with no open funded
  // assignment at all (wallet OR package — a package-funded campaign is still
  // covered during drain-down). Unpriced campaigns are never incidents.
  const pricedActive = activeCampaigns.filter((c) => Number.isInteger(c.leadPriceCents) && c.leadPriceCents > 0);
  let coveredIds = new Set();
  if (pricedActive.length > 0) {
    const covered = await LeadPackageAssignment.findAll({
      where: { status: 'active', leadsRemaining: { [Op.gt]: 0 } },
      attributes: [],
      include: [{
        association: 'package',
        attributes: ['campaignId'],
        required: true,
        where: { campaignId: pricedActive.map((c) => c.id) },
      }],
      raw: true,
      // A failure here is worse than zeros: every priced campaign would render
      // as a zero-commitment INCIDENT (false alarms), so it must be loud.
    }).catch(warnEmpty('campaignCoverage', []));
    coveredIds = new Set(covered.map((r) => r['package.campaignId']));
  }
  const zeroCommitCampaigns = pricedActive
    .filter((c) => !coveredIds.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, endsAt: c.end_date ?? null }));

  // Draw deadlines (≤7d) and plain campaign endings (≤7d, draws excluded so a
  // campaign never appears in both lists).
  const drawsClosing = [];
  const endingCampaigns = [];
  for (const c of activeCampaigns) {
    const draw = c.design_config?.luckyDraw;
    if (draw?.enabled === true) {
      const closesMs = sgtDayEndMs(draw.closesAt);
      if (closesMs !== null && closesMs > now.getTime() && closesMs <= horizon7d) {
        drawsClosing.push({
          id: c.id, name: c.name,
          closesAt: draw.closesAt,
          boostClosesAt: draw.boostClosesAt ?? null,
          multiplier: draw.multiplier ?? null,
          winners: draw.winners ?? null,
        });
      }
      continue;
    }
    const endsMs = c.end_date ? new Date(c.end_date).getTime() : null;
    if (endsMs !== null && endsMs > now.getTime() && endsMs <= horizon7d) {
      endingCampaigns.push({ id: c.id, name: c.name, endsAt: c.end_date });
    }
  }

  // Screening cost-per-qualified. Spend counts EVERY dial (qualified, failed,
  // unreachable) — the true acquisition cost — divided by qualified leads.
  const scrSpendCents = Math.round(Number(screeningAgg?.spend_cents) || 0);
  const scrQualified = Number(screeningAgg?.qualified) || 0;
  const screening = {
    spendCents: scrSpendCents,
    qualified: scrQualified,
    costPerQualifiedCents: scrQualified > 0 ? Math.round(scrSpendCents / scrQualified) : null,
  };

  return {
    webhooks: { pending: webhookPending, failedLast24h: webhookFailed24h, subscriberDisabled: disabledSubscribers > 0 },
    held: { total: heldTotal, byReason },
    unassigned,
    zeroCommitCampaigns,
    wallets: { total: externalAgents.length, zero, low, floatCents },
    committed: { leads: committedLeads, valueCents: committedValueCents, campaigns: fundedCampaignIds.size },
    screening,
    drawsClosing,
    endingCampaigns,
  };
}

/**
 * Daily lead counts, SGT-midnight buckets. `today` = the current (partial) SGT
 * day; avgPerDay excludes it so the delta baseline is honest.
 */
export async function getLeadSeries(period = '30d', { campaignId = null } = {}) {
  const safePeriod = normalizePeriod(period);
  const days = PERIOD_DAYS[safePeriod];
  const now = new Date();
  const start = periodStartUtc(safePeriod, now);

  const campaignFilter = campaignId ? 'AND "campaignId" = :campaignId' : '';
  const [rows] = await sequelize.query(`
    SELECT (("createdAt" AT TIME ZONE 'Asia/Singapore')::date)::text AS day, COUNT(*)::int AS count
    FROM prospects
    WHERE "createdAt" >= :start ${campaignFilter}
    GROUP BY day
    ORDER BY day
  `, { replacements: { start, campaignId } });

  const byDay = new Map(rows.map((r) => [r.day, r.count]));
  const daysOut = [];
  for (let i = 0; i < days; i++) {
    const dayStartUtc = new Date(start.getTime() + i * DAY_MS);
    const key = new Date(dayStartUtc.getTime() + SGT_OFFSET_MS).toISOString().slice(0, 10);
    daysOut.push({ date: key, count: byDay.get(key) || 0, isToday: i === days - 1 });
  }
  const today = daysOut[daysOut.length - 1].count;
  const prior = daysOut.slice(0, -1);
  const avgPerDay = prior.length ? Number((prior.reduce((s, d) => s + d.count, 0) / prior.length).toFixed(1)) : 0;
  return { days: daysOut, today, avgPerDay, total: daysOut.reduce((s, d) => s + d.count, 0) };
}

/**
 * Funnel: scans → submits → assigned → won. QR scanCounts are LIFETIME, so the
 * top of the funnel is prorated to the period and flagged `estimated` — the
 * honest fix is a per-period scan series (wishlist). Floored at submits so the
 * funnel never inverts.
 */
const SCAN_PRORATION_LIFETIME_DAYS = 90; // assumed average tag lifetime for the estimate

export async function getFunnel(period = '30d') {
  const safePeriod = normalizePeriod(period);
  const days = PERIOD_DAYS[safePeriod];
  const start = periodStartUtc(safePeriod, new Date());
  const anyAssignee = { [Op.or]: [{ assignedAgentId: { [Op.ne]: null } }, { externalAgentId: { [Op.ne]: null } }] };

  const [lifetimeScans, submits, assigned, won] = await Promise.all([
    safeSum(QrTag, 'scanCount'),
    safeCount(Prospect, { where: { createdAt: { [Op.gte]: start } } }),
    safeCount(Prospect, { where: { createdAt: { [Op.gte]: start }, ...anyAssignee } }),
    safeCount(Prospect, { where: { leadStatus: 'won', conversionDate: { [Op.gte]: start } } }),
  ]);

  const prorated = Math.round(lifetimeScans * (days / SCAN_PRORATION_LIFETIME_DAYS));
  return { scans: Math.max(prorated, submits), submits, assigned, won, estimated: true };
}

// ---- Agent Stats ----

async function getAgentStats(userId, startDate, endDate) {
  const [
    assignedProspects, newProspects, convertedProspects,
    myCampaigns, activeCampaigns
  ] = await Promise.all([
    Prospect.count({ where: { assignedAgentId: userId } }),
    Prospect.count({ where: { assignedAgentId: userId, createdAt: { [Op.gte]: startDate } } }),
    Prospect.count({ where: { assignedAgentId: userId, leadStatus: 'won' } }),
    Campaign.count({ where: { createdBy: userId } }),
    Campaign.count({ where: { createdBy: userId, status: 'active' } })
  ]);

  const conversionRate = assignedProspects > 0
    ? (convertedProspects / assignedProspects * 100).toFixed(2) : 0;

  const recentProspects = await Prospect.findAll({
    where: { assignedAgentId: userId },
    limit: 5,
    order: [['createdAt', 'DESC']],
    attributes: ['id', 'firstName', 'lastName', 'email', 'leadStatus', 'createdAt'],
    include: [{ association: 'campaign', attributes: ['id', 'name'] }]
  });

  return {
    prospects: { assigned: assignedProspects, new: newProspects, converted: convertedProspects, conversionRate: parseFloat(conversionRate) },
    campaigns: { total: myCampaigns, active: activeCampaigns },
    recentProspects
  };
}

// ---- Customer Stats ----

async function getCustomerStats(userId) {
  return { interactions: { total: 0, recent: 0 } };
}

// ---- Analytics ----

export async function getAnalytics(userId, userRole, type, period = '30d', filters = {}) {
  const now = new Date();
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  switch (type) {
    case 'prospects': return getProspectAnalytics(userId, userRole, startDate, now, filters);
    case 'campaigns': return getCampaignAnalytics(userId, userRole, startDate, now, filters);
    case 'qr_codes': return getQRAnalytics(userId, userRole, startDate, now);
    default: return {};
  }
}

// ---- Helpers ----

async function getUserGrowthTrend(startDate, endDate) {
  const [results] = await sequelize.query(`
    SELECT DATE("createdAt") AS day, COUNT(*)::int AS count
    FROM users
    WHERE "createdAt" BETWEEN :start AND :end
    GROUP BY DATE("createdAt")
    ORDER BY day
  `, { replacements: { start: startDate, end: endDate } });

  // Fill in zero-count days
  const dayMap = new Map(results.map(r => [r.day, r.count]));
  const trend = [];
  const d = new Date(startDate);
  while (d <= endDate) {
    const key = d.toISOString().slice(0, 10);
    trend.push({ date: key, count: dayMap.get(key) || 0 });
    d.setDate(d.getDate() + 1);
  }
  return trend;
}

async function getRecentActivities(limit) {
  const chunk = Math.max(1, Math.floor(limit / 3));
  const [recentProspects, recentCampaigns, recentScans] = await Promise.all([
    Prospect.findAll({
      limit: chunk, order: [['createdAt', 'DESC']],
      attributes: ['id', 'firstName', 'lastName', 'createdAt'],
      include: [{ association: 'campaign', attributes: ['name'] }]
    }),
    Campaign.findAll({
      limit: chunk, order: [['createdAt', 'DESC']],
      attributes: ['id', 'name', 'createdAt', 'status'],
      include: [{ association: 'creator', attributes: ['firstName', 'lastName'] }]
    }),
    QrTag.findAll({
      where: { lastScanned: { [Op.not]: null } },
      limit: chunk, order: [['lastScanned', 'DESC']],
      attributes: ['id', 'name', 'lastScanned', 'scanCount']
    })
  ]);

  const activities = [
    ...recentProspects.map(p => ({
      type: 'prospect', id: p.id,
      description: `New prospect: ${p.firstName} ${p.lastName}`,
      timestamp: p.createdAt,
      metadata: { campaign: p.campaign?.name }
    })),
    ...recentCampaigns.map(c => ({
      type: 'campaign', id: c.id,
      description: `Campaign ${c.status}: ${c.name}`,
      timestamp: c.createdAt,
      metadata: { creator: c.creator ? `${c.creator.firstName} ${c.creator.lastName}` : 'Unknown' }
    })),
    ...recentScans.map(q => ({
      type: 'qr_scan', id: q.id,
      description: `QR code scanned: ${q.name}`,
      timestamp: q.lastScanned,
      metadata: { scanCount: q.scanCount }
    }))
  ];

  return activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);
}

async function getProspectAnalytics(userId, userRole, startDate, endDate, filters) {
  const where = { createdAt: { [Op.gte]: startDate, [Op.lte]: endDate } };
  if (userRole === 'agent') where.assignedAgentId = userId;
  else if (userRole !== 'admin') {
    const userCampaigns = await Campaign.findAll({ where: { createdBy: userId }, attributes: ['id'] });
    where.campaignId = { [Op.in]: userCampaigns.map(c => c.id) };
  }
  if (filters.agentId && userRole === 'admin') where.assignedAgentId = filters.agentId;
  if (filters.campaignId) where.campaignId = filters.campaignId;

  const prospectsByStatus = await Prospect.findAll({
    where,
    attributes: [
      'leadStatus',
      [sequelize.fn('DATE', sequelize.col('createdAt')), 'date'],
      [sequelize.fn('COUNT', sequelize.col('id')), 'count']
    ],
    group: ['leadStatus', sequelize.fn('DATE', sequelize.col('createdAt'))],
    order: [[sequelize.fn('DATE', sequelize.col('createdAt')), 'ASC']]
  });
  return { prospectsByStatus };
}

async function getCampaignAnalytics(userId, userRole, startDate, endDate, filters) {
  const where = { createdAt: { [Op.gte]: startDate, [Op.lte]: endDate } };
  if (userRole !== 'admin') where.createdBy = userId;
  if (filters.campaignId) where.id = filters.campaignId;

  const campaigns = await Campaign.findAll({
    where,
    attributes: ['id', 'name', 'status', 'type'],
    include: [{ association: 'prospects', attributes: ['leadStatus'], separate: true }]
  });

  const campaignIds = campaigns.map(c => c.id);

  if (campaignIds.length === 0) {
    return { campaignPerformance: [] };
  }

  // Bulk queries grouped by campaignId instead of N calls to computeCampaignMetrics
  const [leadCounts, conversionCounts, scanSums] = await Promise.all([
    Prospect.findAll({
      where: { campaignId: { [Op.in]: campaignIds } },
      attributes: ['campaignId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['campaignId'], raw: true
    }),
    Prospect.findAll({
      where: { campaignId: { [Op.in]: campaignIds }, leadStatus: 'won' },
      attributes: ['campaignId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['campaignId'], raw: true
    }),
    QrTag.findAll({
      where: { campaignId: { [Op.in]: campaignIds } },
      attributes: ['campaignId', [sequelize.fn('SUM', sequelize.col('scanCount')), 'total']],
      group: ['campaignId'], raw: true
    }),
  ]);

  const leadsMap = new Map(leadCounts.map(r => [r.campaignId, parseInt(r.count)]));
  const convsMap = new Map(conversionCounts.map(r => [r.campaignId, parseInt(r.count)]));
  const scansMap = new Map(scanSums.map(r => [r.campaignId, parseInt(r.total) || 0]));

  const campaignPerformance = campaigns.map(c => {
    const plain = c.toJSON();
    const scans = scansMap.get(c.id) || 0;
    plain.metrics = {
      leads: leadsMap.get(c.id) || 0,
      conversions: convsMap.get(c.id) || 0,
      views: scans,
      clicks: scans,
      referrals: 0,
    };
    return plain;
  });

  return { campaignPerformance };
}

async function getQRAnalytics(userId, userRole, startDate, endDate) {
  const where = {};
  if (userRole !== 'admin') where.createdBy = userId;

  const qrScanTrend = await QrTag.findAll({
    where,
    attributes: ['id', 'name', 'scanCount', 'analytics', 'lastScanned']
  });
  return { qrScanTrend };
}
