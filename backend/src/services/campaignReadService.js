import { Op } from 'sequelize';
import { Campaign, QrTag, Prospect, sequelize } from '../models/index.js';
import { buildCampaignWhere, buildOwnerWhere } from './campaignScope.js';
import { AppError } from '../middleware/appError.js';
import { escapeLike } from '../utils/escapeLike.js';

/**
 * Campaign READ side (split from campaignService): metrics, listings, detail,
 * summary, analytics — everything that only ever SELECTs. The write side
 * (create/update/launch/archive/duplicate + agent-assignment sync, the H1/H5
 * transactional core) stays in campaignService, which re-exports these so
 * every existing import path keeps working. Extracted verbatim — behaviour is
 * covered by the campaigns/campaignPreviews/dashboard suites with zero test
 * edits.
 */

/**
 * Compute campaign metrics from real data (no JSON blob).
 * Replaces the old read-modify-write `campaign.metrics` pattern that had a race condition.
 */
export async function computeCampaignMetrics(campaignId) {
  const [leads, conversions, scans] = await Promise.all([
    Prospect.count({ where: { campaignId } }),
    Prospect.count({ where: { campaignId, leadStatus: 'won' } }),
    QrTag.sum('scanCount', { where: { campaignId } }).then(v => v || 0),
  ]);

  return {
    leads,
    conversions,
    views: scans,
    clicks: scans,
    referrals: 0,
  };
}

/**
 * List campaigns with pagination, filtering, and role-based scoping.
 */
export async function listCampaigns(user, query, req) {
  const { page = 1, limit = 10, status, type, search, createdBy, period } = query;
  // Clamp pagination so malformed query params (?page=-1&limit=-5, ?page=abc)
  // don't reach Sequelize as a negative/NaN LIMIT/OFFSET, which throws → 500.
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 10), 200);
  const offset = (pageNum - 1) * limitNum;

  // Phase B: validated rolling window for leadsThisPeriod (additive — every
  // existing key keeps its all-time semantics). The start date is computed
  // server-side and interpolated as an ISO literal (never user input).
  const periodDays = { '7d': 7, '30d': 30, '90d': 90 }[period] || 30;
  const periodStartIso = new Date(Date.now() - periodDays * 24 * 3600e3).toISOString();

  const where = buildCampaignWhere(req);

  if (status) where.status = status;
  if (type) where.type = type;
  if (createdBy && user.role === 'admin') where.createdBy = createdBy;

  if (search) {
    const sanitizedSearch = escapeLike(search);
    // Append inside Op.and — the role scope from buildCampaignWhere is an OR
    // group too, and both must hold at once.
    where[Op.and] = [
      ...(where[Op.and] || []),
      {
        [Op.or]: [
          { name: { [Op.iLike]: `%${sanitizedSearch}%` } },
          { description: { [Op.iLike]: `%${sanitizedSearch}%` } }
        ]
      }
    ];
  }

  const { count, rows: campaigns } = await Campaign.findAndCountAll({
    where,
    limit: limitNum,
    offset,
    order: [['createdAt', 'DESC']],
    attributes: {
      include: [
        [sequelize.literal('(SELECT COUNT(*) FROM prospects WHERE prospects."campaignId" = "Campaign".id)'), 'prospectCount'],
        [sequelize.literal('(SELECT COUNT(*) FROM qr_tags WHERE qr_tags."campaignId" = "Campaign".id)'), 'qrTagCount'],
        [sequelize.literal('(SELECT COALESCE(SUM("scanCount"), 0) FROM qr_tags WHERE qr_tags."campaignId" = "Campaign".id)'), 'totalScans'],
        // Phase B aggregates (admin rebuild): period leads + open wallet-commitment
        // demand. All cast ::int so they serialize as JSON numbers (pg returns
        // bigint COUNT/SUM as strings otherwise); int32 bounds are ample here
        // (committedValueCents caps at ~S$21M before overflow — far beyond scale).
        [sequelize.literal('(SELECT COUNT(*) FROM prospects WHERE prospects."campaignId" = "Campaign".id)::int'), 'leadsTotal'],
        [sequelize.literal(`(SELECT COUNT(*) FROM prospects WHERE prospects."campaignId" = "Campaign".id AND prospects."createdAt" >= '${periodStartIso}')::int`), 'leadsThisPeriod'],
        [sequelize.literal('(SELECT COALESCE(SUM(lpa."leadsRemaining"), 0)::int FROM lead_package_assignments lpa JOIN lead_packages lp ON lpa."leadPackageId" = lp.id WHERE lp."campaignId" = "Campaign".id AND lpa."source" = \'wallet\' AND lpa.status = \'active\')'), 'committedRemaining'],
        [sequelize.literal('(SELECT COALESCE(SUM(lpa."leadsRemaining" * lpa."unitPriceCents"), 0)::int FROM lead_package_assignments lpa JOIN lead_packages lp ON lpa."leadPackageId" = lp.id WHERE lp."campaignId" = "Campaign".id AND lpa."source" = \'wallet\' AND lpa.status = \'active\' AND lpa."unitPriceCents" IS NOT NULL)'), 'committedValueCents'],
      ]
    },
    include: [
      { association: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'] },
      { association: 'assignedAgents', attributes: ['id', 'firstName', 'lastName', 'email'] }
    ]
  });

  // Attach backward-compatible virtual fields
  const campaignsJson = campaigns.map(c => {
    const plain = c.toJSON();
    plain.assigned_agents = agentsToIdList(plain.assignedAgents);
    return plain;
  });

  return {
    campaigns: campaignsJson,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(count / limitNum),
      totalItems: count,
      itemsPerPage: limitNum
    }
  };
}

/**
 * Get a single campaign by ID with full associations.
 */
export async function getCampaign(id, req) {
  const where = buildCampaignWhere(req, { id });

  const campaign = await Campaign.findOne({
    where,
    include: [
      { association: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'] },
      {
        association: 'qrTags',
        attributes: ['id', 'label', 'name', 'type', 'campaignId'],
      },
      {
        association: 'prospects',
        attributes: ['id', 'firstName', 'lastName', 'email', 'leadStatus', 'assignedAgentId'],
        include: [{ association: 'assignedAgent', attributes: ['id', 'firstName', 'lastName', 'email'] }]
      },
      { association: 'leadPackages', attributes: ['id', 'name', 'type', 'price', 'leadCount'] },
      { association: 'assignedAgents', attributes: ['id', 'firstName', 'lastName', 'email'] }
    ]
  });

  if (!campaign) throw new AppError('Campaign not found', 404);

  // Attach backward-compatible virtual fields
  const plain = campaign.toJSON();
  plain.assigned_agents = agentsToIdList(plain.assignedAgents);
  return plain;
}

/**
 * Admin campaign-detail composite (Phase B): one round-trip for the rebuild's
 * detail screen — campaign row + 30d SGT lead series + open wallet commitments
 * + latest leads + QR tags. Read-only aggregation over existing data.
 */
export async function getCampaignSummary(id, req) {
  const where = buildOwnerWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);

  const { getLeadSeries } = await import('./dashboardService.js');
  const { LeadPackageAssignment, Prospect: ProspectModel, QrTag: QrTagModel } = await import('../models/index.js');

  const [series, commitmentRows, recent, qrTags] = await Promise.all([
    getLeadSeries('30d', { campaignId: id }),
    LeadPackageAssignment.findAll({
      where: { source: 'wallet', status: 'active', leadsRemaining: { [Op.gt]: 0 } },
      include: [
        { association: 'package', attributes: [], where: { campaignId: id }, required: true },
        { association: 'agent', attributes: ['id', 'firstName', 'lastName', 'fullName', 'email'] },
      ],
      order: [['purchaseDate', 'ASC']],
    }),
    ProspectModel.findAll({
      where: { campaignId: id },
      attributes: ['id', 'firstName', 'lastName', 'leadStatus', 'leadSource', 'quarantinedAt', 'quarantineReason', 'assignedAgentId', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit: 6,
    }),
    QrTagModel.findAll({
      where: { campaignId: id },
      attributes: ['id', 'name', 'scanCount', 'uniqueScanCount', 'lastScanned', 'active'],
      order: [['scanCount', 'DESC']],
    }),
  ]);

  const commitments = commitmentRows.map((r) => ({
    assignmentId: r.id,
    agentId: r.agent?.id ?? r.agentId,
    agent: r.agent ? (r.agent.fullName || `${r.agent.firstName || ''} ${r.agent.lastName || ''}`.trim() || r.agent.email) : null,
    remaining: r.leadsRemaining,
    unitPriceCents: r.unitPriceCents,
    valueCents: Number.isInteger(r.unitPriceCents) ? r.leadsRemaining * r.unitPriceCents : null,
  }));

  return {
    campaign: campaign.toJSON(),
    series,
    commitments,
    committedRemaining: commitments.reduce((s, c) => s + c.remaining, 0),
    committedValueCents: commitments.reduce((s, c) => s + (c.valueCents || 0), 0),
    recent,
    qrTags,
  };
}

/**
 * Get campaign analytics (QR + prospect funnel).
 */
export async function getCampaignAnalytics(id, req) {
  const where = buildCampaignWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);

  const qrTags = await QrTag.findAll({
    where: { campaignId: id },
    attributes: ['id', 'name', 'scanCount', 'uniqueScanCount', 'lastScanned', 'analytics']
  });

  const prospectStats = await Prospect.findAll({
    where: { campaignId: id },
    attributes: [
      'leadStatus',
      [sequelize.fn('COUNT', sequelize.col('leadStatus')), 'count']
    ],
    group: ['leadStatus']
  });

  const totalProspects = await Prospect.count({ where: { campaignId: id } });
  const qualifiedProspects = await Prospect.count({
    where: { campaignId: id, leadStatus: ['qualified', 'proposal_sent', 'negotiating', 'won'] }
  });
  const convertedProspects = await Prospect.count({
    where: { campaignId: id, leadStatus: 'won' }
  });

  const metrics = await computeCampaignMetrics(id);

  return {
    campaign: {
      metrics,
      totalQrTags: qrTags.length,
      totalScans: qrTags.reduce((sum, tag) => sum + tag.scanCount, 0),
      totalUniqueScans: qrTags.reduce((sum, tag) => sum + tag.uniqueScanCount, 0)
    },
    prospects: {
      total: totalProspects,
      qualified: qualifiedProspects,
      converted: convertedProspects,
      conversionRate: totalProspects > 0 ? (convertedProspects / totalProspects * 100).toFixed(2) : 0,
      byStatus: prospectStats.map(stat => ({
        status: stat.leadStatus,
        count: parseInt(stat.dataValues.count)
      }))
    },
    qrTags: qrTags.map(tag => ({
      id: tag.id,
      name: tag.name,
      scanCount: tag.scanCount,
      uniqueScanCount: tag.uniqueScanCount,
      lastScanned: tag.lastScanned,
      conversionRate: tag.scanCount > 0
        ? ((tag.analytics?.conversions || 0) / tag.scanCount * 100).toFixed(2) : 0
    }))
  };
}

/**
 * Get computed campaign metrics (read-only).
 * Replaces the old read-modify-write updateCampaignMetrics that had a race condition.
 * The PATCH endpoint is kept for backward compatibility but is now a no-op write —
 * it returns the computed metrics from real data.
 */
export async function updateCampaignMetrics(id, _metrics, req) {
  const where = buildOwnerWhere(req, { id });
  const campaign = await Campaign.findOne({ where });
  if (!campaign) throw new AppError('Campaign not found or access denied', 404);

  // Attach computed metrics so the response format stays the same
  const computed = await computeCampaignMetrics(id);
  const plain = campaign.toJSON();
  plain.metrics = computed;
  return plain;
}

// ---- Internal helpers ----

/**
 * Convert assignedAgents association (User objects from join) to a flat array of UUIDs
 * for backward-compatible API responses.
 */
export function agentsToIdList(assignedAgents) {
  if (!assignedAgents || !Array.isArray(assignedAgents)) return [];
  return assignedAgents.map(a => a.id);
}
