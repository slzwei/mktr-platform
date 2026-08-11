import { Op, QueryTypes } from 'sequelize';
import {
  OutreachTask, OutreachActivity, PartnerOrganisation, PartnerContact, User, sequelize,
  OutreachCadenceStep, OutreachCadence, OutreachEmail, OutreachPersona,
} from '../../models/index.js';
import { sgtDayWindow } from '../../utils/sgtTime.js';

const PARTNER_LITE = ['id', 'tradingName', 'legalName', 'brandName', 'pipelineStage', 'category', 'lastActivityAt', 'claimedAt'];
const BUCKET_LIMIT = 10;

/**
 * "My Outreach Queue" — the start-of-day worklist (brief §20). One aggregated
 * read; each bucket capped at 10 with a total count so the page renders fast.
 */
export function makeQueueService(overrides = {}) {
  const d = {
    OutreachTask, OutreachActivity, PartnerOrganisation, PartnerContact, User, sequelize,
    OutreachCadenceStep, OutreachCadence, OutreachEmail, OutreachPersona, ...overrides,
  };

  async function getMyQueue(user) {
    const { start, end } = sgtDayWindow();
    const taskInclude = [
      { model: d.PartnerOrganisation, as: 'partner', attributes: PARTNER_LITE },
      { model: d.PartnerContact, as: 'contact', attributes: ['id', 'name'] },
      {
        model: d.OutreachCadenceStep, as: 'cadenceStep', required: false,
        attributes: ['id', 'stepOrder', 'channel', 'title', 'mode'],
        include: [{ model: d.OutreachCadence, as: 'cadence', attributes: ['id', 'key', 'name', 'version'] }],
      },
      {
        model: d.OutreachEmail, as: 'outboxEmails', required: false,
        attributes: ['id', 'status', 'holdReason', 'nextAttemptAt', 'toAddress', 'lastError'],
        where: {
          [Op.or]: [
            { status: { [Op.in]: ['queued', 'needs_approval', 'sending', 'failed'] } },
            {
              status: 'cancelled',
              lastError: {
                [Op.in]: ['no_sending_persona', 'recipient_changed', 'no_email', 'reassigned_review', 'autosend_disabled', 'reply_in_thread'],
              },
            },
          ],
        },
      },
    ];
    const openTasks = { assigneeUserId: user.id, status: { [Op.in]: ['open', 'in_progress'] } };
    const myLivePartners = { ownerUserId: user.id, mergedIntoId: null, archivedAt: null };
    // A partner whose cadence already scheduled the first touch is being worked —
    // counting it under "awaiting first outreach" would double-count the same
    // to-do (docs/plans/redeem-ops-cadences.md §8.3). Overdue cadence tasks stay
    // counted: those DO need attention.
    const noScheduledCadenceTouch = {
      id: {
        [Op.notIn]: d.sequelize.literal(`(
          SELECT ot."partnerOrganisationId" FROM outreach_tasks ot
           WHERE ot."cadenceEnrollmentId" IS NOT NULL
             AND ot.status IN ('open', 'in_progress')
             AND ot."dueAt" >= '${start.toISOString()}')`),
      },
    };

    // Cadences parked on a step they can't prepare (no email/phone/handle/
    // outlet on record, DNC, bad template — §15). A mid-cadence park has no
    // open task and a set firstOutreachAt, so WITHOUT this bucket it matches
    // nothing above and silently vanishes from the docket for up to 14 days
    // (until the stale sweep). Snoozed partners stay out — that deferral is
    // deliberate and the unsnooze wake re-surfaces them.
    const waitingOnInfoWhere = `
         FROM outreach_cadence_enrollments e
         JOIN partner_organisations p ON p.id = e."partnerOrganisationId"
        WHERE p."ownerUserId" = :userId
          AND p."archivedAt" IS NULL AND p."mergedIntoId" IS NULL
          AND p.availability = 'owned'
          AND e.state = 'paused' AND e."pausedReason" = 'missing_info'`;

    const [
      overdueTasks, overdueCount,
      dueTodayTasks, dueTodayCount,
      upcomingTasks,
      awaitingFirstOutreach, awaitingCount,
      stalePartners, staleCount,
      recentReplies,
      waitingOnInfo, waitingOnInfoCountRows,
      scheduledSends, scheduledSendsCount,
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
        where: { ...myLivePartners, firstOutreachAt: null, availability: 'owned', ...noScheduledCadenceTouch },
        attributes: [...PARTNER_LITE, 'atRiskFlag'],
        order: [['claimedAt', 'ASC']], limit: BUCKET_LIMIT,
      }),
      d.PartnerOrganisation.count({ where: { ...myLivePartners, firstOutreachAt: null, availability: 'owned', ...noScheduledCadenceTouch } }),
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
      d.sequelize.query(
        `SELECT p.id, COALESCE(p."tradingName", p."brandName", p."legalName") AS "partnerName",
                e."blockedReason", e."pausedAt", s.title AS "stepTitle", s."stepOrder"
           FROM outreach_cadence_enrollments e
           JOIN partner_organisations p ON p.id = e."partnerOrganisationId"
           LEFT JOIN outreach_cadence_steps s ON s.id = e."currentStepId"
          WHERE p."ownerUserId" = :userId
            AND p."archivedAt" IS NULL AND p."mergedIntoId" IS NULL
            AND p.availability = 'owned'
            AND e.state = 'paused' AND e."pausedReason" = 'missing_info'
          ORDER BY e."pausedAt" ASC
          LIMIT ${BUCKET_LIMIT}`,
        { replacements: { userId: user.id }, type: QueryTypes.SELECT }
      ),
      d.sequelize.query(
        `SELECT COUNT(*)::int AS n ${waitingOnInfoWhere}`,
        { replacements: { userId: user.id }, type: QueryTypes.SELECT }
      ),
      // Every machine-send the rep owns (plan P11: the 3-day/10-row upcoming
      // bucket hides them; this group is dedicated and carries a total).
      d.OutreachEmail.findAll({
        where: { status: { [Op.in]: ['queued', 'needs_approval'] } },
        include: [
          {
            model: d.OutreachTask, as: 'task', required: true,
            attributes: ['id', 'title', 'dueAt'],
            where: { assigneeUserId: user.id, status: { [Op.in]: ['open', 'in_progress'] } },
            include: [{ model: d.PartnerOrganisation, as: 'partner', attributes: PARTNER_LITE }],
          },
          { model: d.OutreachPersona, as: 'persona', attributes: ['address', 'displayName'] },
        ],
        order: [['nextAttemptAt', 'ASC']],
        limit: 25,
      }),
      d.OutreachEmail.count({
        where: { status: { [Op.in]: ['queued', 'needs_approval'] } },
        include: [{
          model: d.OutreachTask, as: 'task', required: true, attributes: [],
          where: { assigneeUserId: user.id, status: { [Op.in]: ['open', 'in_progress'] } },
        }],
      }),
    ]);

    return {
      overdueTasks: { items: overdueTasks, total: overdueCount },
      dueTodayTasks: { items: dueTodayTasks, total: dueTodayCount },
      upcomingTasks: { items: upcomingTasks },
      awaitingFirstOutreach: { items: awaitingFirstOutreach, total: awaitingCount },
      stalePartners: { items: stalePartners, total: staleCount },
      recentReplies: { items: recentReplies },
      waitingOnInfo: { items: waitingOnInfo, total: waitingOnInfoCountRows[0]?.n || 0 },
      scheduledSends: { items: scheduledSends, total: scheduledSendsCount },
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
