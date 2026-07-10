import { QueryTypes } from 'sequelize';
import { sequelize, RewardOffer, Activation } from '../../models/index.js';
import { makeCampaignProjection } from './campaignProjection.js';

/**
 * Redeem Ops analytics (brief §29) — plain SQL aggregates over OUR tables.
 * Acquisition numbers are never re-counted here: activation funnels read
 * computeCampaignMetrics via campaignProjection (MKTR stays the source of truth),
 * and nothing is invented where instrumentation doesn't exist.
 */
export function makeAnalyticsService(overrides = {}) {
  const d = { sequelize, RewardOffer, Activation, campaigns: makeCampaignProjection(), ...overrides };

  /** Per-team-member outreach performance. `ownerUserId` limits to one member (exec self-view). */
  async function outreachPerformance({ ownerUserId = null } = {}) {
    const rows = await d.sequelize.query(
      `SELECT u.id AS "userId",
              COALESCE(u."fullName", u.email) AS "name",
              COUNT(p.id) FILTER (WHERE p."ownerUserId" = u.id)::int AS "owned",
              COUNT(p.id) FILTER (WHERE p."ownerUserId" = u.id AND p."firstOutreachAt" IS NOT NULL)::int AS "contacted",
              COUNT(p.id) FILTER (WHERE p."ownerUserId" = u.id AND p."staleFlag")::int AS "stale",
              COUNT(p.id) FILTER (WHERE p."ownerUserId" = u.id AND p."pipelineStage" = 'PARTNERED')::int AS "partnered",
              ROUND(AVG(EXTRACT(EPOCH FROM (p."firstOutreachAt" - p."claimedAt")) / 3600)
                    FILTER (WHERE p."ownerUserId" = u.id AND p."firstOutreachAt" IS NOT NULL AND p."claimedAt" IS NOT NULL))::int
                AS "avgHoursToFirstOutreach"
         FROM users u
         LEFT JOIN partner_organisations p
           ON p."ownerUserId" = u.id AND p."mergedIntoId" IS NULL AND p."archivedAt" IS NULL
        WHERE (u.role = 'redeem_ops' OR u."redeemOpsRole" IS NOT NULL)
          AND (:ownerUserId::uuid IS NULL OR u.id = :ownerUserId::uuid)
        GROUP BY u.id, u."fullName", u.email
        ORDER BY "owned" DESC`,
      { replacements: { ownerUserId }, type: QueryTypes.SELECT }
    );

    const activity = await d.sequelize.query(
      `SELECT a."actorUserId" AS "userId",
              COUNT(*) FILTER (WHERE a.direction = 'outbound' AND a."voidedAt" IS NULL)::int AS "outboundTouches",
              COUNT(*) FILTER (WHERE a.direction = 'inbound' AND a."voidedAt" IS NULL)::int AS "replies",
              COUNT(*) FILTER (WHERE a.type = 'meeting_booked' AND a."voidedAt" IS NULL)::int AS "meetingsBooked",
              COUNT(*) FILTER (WHERE a.type = 'proposal_sent' AND a."voidedAt" IS NULL)::int AS "proposalsSent"
         FROM outreach_activities a
        WHERE a."actorUserId" IS NOT NULL
        GROUP BY a."actorUserId"`,
      { type: QueryTypes.SELECT }
    );
    const byUser = new Map(activity.map((r) => [r.userId, r]));
    return rows.map((r) => ({
      ...r,
      outboundTouches: byUser.get(r.userId)?.outboundTouches || 0,
      replies: byUser.get(r.userId)?.replies || 0,
      meetingsBooked: byUser.get(r.userId)?.meetingsBooked || 0,
      proposalsSent: byUser.get(r.userId)?.proposalsSent || 0,
      partneredRate: r.owned > 0 ? Math.round((r.partnered / r.owned) * 100) : 0,
    }));
  }

  /** Category conversion (brief §29 "Category performance"). */
  async function categoryPerformance() {
    return d.sequelize.query(
      `SELECT COALESCE(p.category, 'Uncategorised') AS category,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE p."firstOutreachAt" IS NOT NULL)::int AS contacted,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM outreach_activities a
                 WHERE a."partnerOrganisationId" = p.id
                   AND a.direction = 'inbound' AND a."voidedAt" IS NULL
              ) OR p."pipelineStage" IN ('MEETING','PROPOSAL','PARTNERED'))::int AS replied,
              COUNT(*) FILTER (WHERE p."pipelineStage" IN ('MEETING','PROPOSAL','PARTNERED'))::int AS meetings,
              COUNT(*) FILTER (WHERE p."pipelineStage" = 'PARTNERED')::int AS partnered
         FROM partner_organisations p
        WHERE p."mergedIntoId" IS NULL AND p."archivedAt" IS NULL
        GROUP BY COALESCE(p.category, 'Uncategorised')
        ORDER BY total DESC
        LIMIT 50`,
      { type: QueryTypes.SELECT }
    );
  }

  /** Reward supply performance — counters are already ledger-audited truth. */
  async function rewardPerformance() {
    const offers = await d.RewardOffer.findAll({
      include: [{ association: 'partner', attributes: ['tradingName', 'legalName'] }],
      order: [['createdAt', 'DESC']],
      limit: 100,
    });
    return offers.map((o) => ({
      id: o.id,
      title: o.title,
      partnerName: o.partner?.tradingName || o.partner?.legalName || null,
      status: o.status,
      committed: o.committedQuantity,
      allocated: o.allocatedQuantity,
      issued: o.issuedQuantity,
      redeemed: o.redeemedQuantity,
      redemptionRate: o.issuedQuantity > 0 ? Math.round((o.redeemedQuantity / o.issuedQuantity) * 100) : 0,
    }));
  }

  /** Activation funnel — MKTR acquisition (never re-counted) + our fulfilment counters. */
  async function activationFunnels() {
    const activations = await d.Activation.findAll({
      include: [
        { association: 'rewardOffer', attributes: ['title'] },
        { association: 'partner', attributes: ['tradingName', 'legalName'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: 50,
    });
    const funnels = [];
    for (const a of activations) {
      let acquisition = null;
      if (a.campaignId) {
        acquisition = await d.campaigns.getCampaignMetrics(a.campaignId).catch(() => null);
      }
      funnels.push({
        id: a.id,
        rewardTitle: a.rewardOffer?.title,
        partnerName: a.partner?.tradingName || a.partner?.legalName || null,
        campaignName: a.campaignNameSnapshot,
        status: a.status,
        renewalOutcome: a.renewalOutcome,
        acquisition, // MKTR's own numbers (computeCampaignMetrics) or null when unlinked
        reward: {
          allocated: a.allocatedQuantity,
          issued: a.issuedCount,
          redeemed: a.redeemedCount,
        },
      });
    }
    return funnels;
  }

  return { outreachPerformance, categoryPerformance, rewardPerformance, activationFunnels };
}

const _default = makeAnalyticsService();
export default _default;
