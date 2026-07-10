import { Op, QueryTypes } from 'sequelize';
import {
  OutreachTask, OutreachActivity, PartnerOrganisation, PartnerContact, User, sequelize,
} from '../../models/index.js';
import { sgtDayWindow } from './taskService.js';

const PARTNER_LITE = ['id', 'tradingName', 'legalName', 'brandName', 'pipelineStage', 'category', 'lastActivityAt', 'claimedAt'];
const BUCKET_LIMIT = 10;

/**
 * "My Outreach Queue" — the start-of-day worklist (brief §20). One aggregated
 * read; each bucket capped at 10 with a total count so the page renders fast.
 */
export function makeQueueService(overrides = {}) {
  const d = { OutreachTask, OutreachActivity, PartnerOrganisation, PartnerContact, User, sequelize, ...overrides };

  async function getMyQueue(user) {
    const { start, end } = sgtDayWindow();
    const taskInclude = [
      { model: d.PartnerOrganisation, as: 'partner', attributes: PARTNER_LITE },
      { model: d.PartnerContact, as: 'contact', attributes: ['id', 'name'] },
    ];
    const openTasks = { assigneeUserId: user.id, status: { [Op.in]: ['open', 'in_progress'] } };
    const myLivePartners = { ownerUserId: user.id, mergedIntoId: null, archivedAt: null };

    const [
      overdueTasks, overdueCount,
      dueTodayTasks, dueTodayCount,
      upcomingTasks,
      awaitingFirstOutreach, awaitingCount,
      stalePartners, staleCount,
      recentReplies,
    ] = await Promise.all([
      d.OutreachTask.findAll({ where: { ...openTasks, dueAt: { [Op.lt]: start } }, include: taskInclude, order: [['dueAt', 'ASC']], limit: BUCKET_LIMIT }),
      d.OutreachTask.count({ where: { ...openTasks, dueAt: { [Op.lt]: start } } }),
      d.OutreachTask.findAll({ where: { ...openTasks, dueAt: { [Op.gte]: start, [Op.lt]: end } }, include: taskInclude, order: [['dueAt', 'ASC']], limit: BUCKET_LIMIT }),
      d.OutreachTask.count({ where: { ...openTasks, dueAt: { [Op.gte]: start, [Op.lt]: end } } }),
      d.OutreachTask.findAll({
        where: { ...openTasks, dueAt: { [Op.gte]: end, [Op.lt]: new Date(end.getTime() + 3 * 24 * 3600 * 1000) } },
        include: taskInclude, order: [['dueAt', 'ASC']], limit: BUCKET_LIMIT,
      }),
      d.PartnerOrganisation.findAll({
        where: { ...myLivePartners, firstOutreachAt: null, availability: 'owned' },
        attributes: [...PARTNER_LITE, 'atRiskFlag'],
        order: [['claimedAt', 'ASC']], limit: BUCKET_LIMIT,
      }),
      d.PartnerOrganisation.count({ where: { ...myLivePartners, firstOutreachAt: null, availability: 'owned' } }),
      d.PartnerOrganisation.findAll({
        where: { ...myLivePartners, staleFlag: true },
        attributes: [...PARTNER_LITE, 'staleFlag'],
        order: [['lastActivityAt', 'ASC']], limit: BUCKET_LIMIT,
      }),
      d.PartnerOrganisation.count({ where: { ...myLivePartners, staleFlag: true } }),
      // Inbound replies on my partners in the last 7 days
      d.sequelize.query(
        `SELECT a.id, a.type, a.summary, a."occurredAt",
                p.id AS "partnerId", COALESCE(p."tradingName", p."brandName", p."legalName") AS "partnerName"
           FROM outreach_activities a
           JOIN partner_organisations p ON p.id = a."partnerOrganisationId"
          WHERE p."ownerUserId" = :userId
            AND a.direction = 'inbound'
            AND a."voidedAt" IS NULL
            AND a."occurredAt" > NOW() - INTERVAL '7 days'
          ORDER BY a."occurredAt" DESC
          LIMIT ${BUCKET_LIMIT}`,
        { replacements: { userId: user.id }, type: QueryTypes.SELECT }
      ),
    ]);

    return {
      overdueTasks: { items: overdueTasks, total: overdueCount },
      dueTodayTasks: { items: dueTodayTasks, total: dueTodayCount },
      upcomingTasks: { items: upcomingTasks },
      awaitingFirstOutreach: { items: awaitingFirstOutreach, total: awaitingCount },
      stalePartners: { items: stalePartners, total: staleCount },
      recentReplies: { items: recentReplies },
    };
  }

  /** Manager board: stage × owner counts + per-stage partner lists. */
  async function getTeamPipeline() {
    const rows = await d.sequelize.query(
      `SELECT p."pipelineStage" AS stage,
              p."ownerUserId" AS "ownerUserId",
              COALESCE(u."fullName", 'Unowned') AS "ownerName",
              COUNT(*)::int AS count
         FROM partner_organisations p
         LEFT JOIN users u ON u.id = p."ownerUserId"
        WHERE p."mergedIntoId" IS NULL AND p."archivedAt" IS NULL
        GROUP BY p."pipelineStage", p."ownerUserId", u."fullName"
        ORDER BY count DESC`,
      { type: QueryTypes.SELECT }
    );
    const partners = await d.PartnerOrganisation.findAll({
      where: { mergedIntoId: null, archivedAt: null },
      attributes: [...PARTNER_LITE, 'ownerUserId', 'atRiskFlag', 'staleFlag', 'createdAt', 'availability', 'snoozedUntil', 'lostReason'],
      include: [{ model: d.User, as: 'owner', attributes: ['id', 'fullName'] }],
      order: [['lastActivityAt', 'DESC']],
      limit: 500,
    });
    // When each business entered its current stage — latest stage event per
    // partner (falls back to createdAt for rows that never moved). Powers the
    // board's "time in stage" chip.
    const stageTimes = await d.sequelize.query(
      `SELECT "partnerOrganisationId" AS pid, MAX("createdAt") AS at
         FROM partner_stage_events GROUP BY "partnerOrganisationId"`,
      { type: QueryTypes.SELECT }
    );
    const stageSinceByPartner = Object.fromEntries(stageTimes.map((r) => [r.pid, r.at]));
    const withStageSince = partners.map((partner) => ({
      ...partner.toJSON(),
      stageSince: stageSinceByPartner[partner.id] || partner.createdAt,
    }));
    return { counts: rows, partners: withStageSince };
  }

  return { getMyQueue, getTeamPipeline };
}

const _default = makeQueueService();
export default _default;
