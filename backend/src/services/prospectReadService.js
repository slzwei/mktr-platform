/**
 * Prospect READ projections (P4-3 seam 1 of the prospectService split):
 * detail, stats, list, held list, activities, view tracking. Same DI shape as
 * the parent — makeProspectReads receives the parent factory's (d, m) so
 * every test override keeps working through makeProspectService.
 */
import { Op, fn as sqlFn, col as sqlCol, where as sqlWhere } from 'sequelize';
import { repeatSignupDetail, repeatSignupCounts } from './repeatSignup.js';
import { fetchLeadActivitiesFromSupabase, mergeProspectTimeline } from './webLeadTimelineService.js';
import {
  VALID_LEAD_STATUSES, VALID_ASSIGNMENT_FILTERS, VALID_LEAD_SOURCES,
  parseEnumFilter, parseProspectSort,
} from './prospectShared.js';
import { escapeLike } from '../utils/escapeLike.js';

export function makeProspectReads({ d, m }) {
  /**
   * Get a single prospect by ID, scoped to user access.
   *
   * `include: 'profile'` (Lead Profile page, plan §4) is ADMIN-ONLY and
   * opt-in: non-admins and callers that don't ask get a byte-identical
   * payload to before the option existed — the flag simply never reaches the
   * enrichment branch for them.
   */
  async function getProspect(id, user, { include = '' } = {}) {
    const wantProfile = user?.role === 'admin'
      && String(include).split(',').map((s) => s.trim()).includes('profile');
    const scopeFilter = await d.buildProspectWhere(user);
    const whereConditions = { id, ...scopeFilter };

    const prospect = await m.Prospect.findOne({
      where: whereConditions,
      include: [
        {
          association: 'assignedAgent',
          attributes: ['id', 'firstName', 'lastName', 'email', 'phone'],
        },
        {
          association: 'campaign',
          attributes: ['id', 'name', 'type', 'status', 'description'],
        },
        {
          association: 'qrTag',
          attributes: ['id', 'name', 'type', 'location'],
        },
        // Named external buyer — profile mode only (the association exists but
        // was never loaded; keep the classic payload byte-identical). Name and
        // agency ONLY: never phone/email/balance on an admin lead view.
        ...(wantProfile ? [{
          association: 'externalAgent',
          attributes: ['id', 'fullName', 'agency'],
        }] : []),
        {
          association: 'activities',
          // Newest-first, so the Activity Timeline UI (which renders this array
          // top-to-bottom and pins a "Start of History" marker at the bottom) leads
          // with the most recent event and ends with the genesis 'created' event.
          //
          // `separate: true` is REQUIRED: an `order` inside a normal (JOINed) hasMany
          // include is silently ignored by Sequelize v6 — only the separate (own-query)
          // loader honours include-local ordering. `prospectId` must stay in
          // `attributes` because that loader maps children back to the parent by the
          // FK; omitting it returns an empty activities array. `id DESC` is a
          // deterministic tiebreaker for same-millisecond `createdAt` values.
          separate: true,
          attributes: ['id', 'prospectId', 'type', 'description', 'metadata', 'createdAt'],
          order: [['createdAt', 'DESC'], ['id', 'DESC']],
        },
      ],
    });

    if (!prospect) {
      throw new d.AppError('Prospect not found or access denied', 404);
    }

    // Admin-only: cross-campaign repeat-signup visibility (flag, not block).
    // Omitted entirely for non-admins (this endpoint is shared with the agent
    // detail modal). Resilient — a failed enrichment never breaks the view.
    // Admin-only enrichments. The unified `timeline` merges the agent-engagement half (Supabase
    // lead_activities) with this prospect's ProspectActivity so the web Activity Timeline matches
    // the mktr-leads app. ADMIN-GATED on purpose: the engagement is the external buyer's private
    // notes, which must not surface to a non-admin web user (agents can open the same detail modal).
    // Gated additionally on the export-EF URL (deploy-inert until set). Run in PARALLEL with the
    // repeat-signup lookup so neither blocks the other; both are resilient (a miss never breaks the
    // view, and the timeline degrades to ProspectActivity-only on a Supabase miss).
    if (user?.role === 'admin') {
      const wantTimeline = !!process.env.SUPABASE_LEAD_ACTIVITIES_URL;
      const [repeatSignup, timelineFetch, consumerJourney, session, lyfeDelivery, signupProfile] = await Promise.all([
        repeatSignupDetail(d.sequelize, { phone: prospect.phone, email: prospect.email }).catch(() => null),
        wantTimeline
          ? fetchLeadActivitiesFromSupabase(prospect.id).catch(() => ({ rows: [], ok: false }))
          : Promise.resolve(null),
        // Consumer spine: the person's cross-campaign journey (signups +
        // rewards) for the admin drawer's Person card. Resilient like its
        // siblings — a miss never breaks the detail view. Profile mode
        // (Lead Profile page) enriches the same journey in place: per-signup
        // draw standing + scoped consent + reward diagnostics, entitlement
        // presentation extras, suppressions, broadcast history.
        prospect.consumerId
          ? d.getConsumerJourney(prospect.consumerId, wantProfile ? { includeRaw: true } : undefined)
            .then((j) => (wantProfile && j ? d.enrichJourneyProfile(j) : j))
            .catch(() => null)
          : Promise.resolve(null),
        // Profile-only extras (each resilient, each bounded — plan §4 B6/B7).
        wantProfile
          ? d.getSessionContext(prospect.sessionId).catch(() => null)
          : Promise.resolve(null),
        wantProfile
          ? d.getLyfeDelivery(prospect.id).catch(() => null)
          : Promise.resolve(null),
        // B4: a consumer-less lead (Retell, pre-spine, unverified) still gets
        // its OWN campaign's draw/reward standing.
        wantProfile && !prospect.consumerId
          ? d.getSignupProfile(prospect).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (repeatSignup) prospect.setDataValue('repeatSignup', repeatSignup);
      if (consumerJourney) prospect.setDataValue('consumer', consumerJourney);
      if (timelineFetch) {
        prospect.setDataValue(
          'timeline',
          mergeProspectTimeline(prospect.activities || [], timelineFetch.rows, { ok: timelineFetch.ok }),
        );
      }
      if (session) prospect.setDataValue('session', session);
      if (lyfeDelivery) prospect.setDataValue('lyfeDelivery', lyfeDelivery);
      if (signupProfile) prospect.setDataValue('signupProfile', signupProfile);
    }

    return prospect;
  }
  /**
   * Get prospect statistics for the user's scope.
   */
  async function getProspectStats(user) {
    const whereConditions = await d.buildProspectWhere(user);

    const [totalProspects, prospectsByStatus, prospectsBySource, prospectsByPriority, recentProspects, convertedCount] =
      await Promise.all([
        m.Prospect.count({ where: whereConditions }),
        m.Prospect.findAll({
          where: whereConditions,
          attributes: ['leadStatus', [d.sequelize.fn('COUNT', d.sequelize.col('leadStatus')), 'count']],
          group: ['leadStatus'],
        }),
        m.Prospect.findAll({
          where: whereConditions,
          attributes: ['leadSource', [d.sequelize.fn('COUNT', d.sequelize.col('leadSource')), 'count']],
          group: ['leadSource'],
        }),
        m.Prospect.findAll({
          where: whereConditions,
          attributes: ['priority', [d.sequelize.fn('COUNT', d.sequelize.col('priority')), 'count']],
          group: ['priority'],
        }),
        m.Prospect.findAll({
          where: {
            ...whereConditions,
            createdAt: {
              [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          },
          limit: 10,
          order: [['createdAt', 'DESC']],
          attributes: ['id', 'firstName', 'lastName', 'email', 'leadStatus', 'createdAt'],
          include: [
            {
              association: 'campaign',
              attributes: ['id', 'name'],
            },
          ],
        }),
        m.Prospect.count({
          where: { ...whereConditions, leadStatus: 'won' },
        }),
      ]);
    const conversionRate = totalProspects > 0 ? ((convertedCount / totalProspects) * 100).toFixed(2) : 0;

    return {
      totalProspects,
      conversionRate: parseFloat(conversionRate),
      byStatus: prospectsByStatus.map((item) => ({
        status: item.leadStatus,
        count: parseInt(item.dataValues.count),
      })),
      bySource: prospectsBySource.map((item) => ({
        source: item.leadSource,
        count: parseInt(item.dataValues.count),
      })),
      byPriority: prospectsByPriority.map((item) => ({
        priority: item.priority,
        count: parseInt(item.dataValues.count),
      })),
      recentProspects,
    };
  }
  /**
   * List prospects with pagination, filtering, and auth scoping.
   */
  async function listProspects(user, params) {
    const {
      page = 1,
      limit = 10,
      leadStatus,
      priority,
      leadSource,
      assignedAgentId,
      assignment,
      campaignId,
      search,
      dateFrom,
      dateTo,
      qrTagId,
      sort,
    } = params;

    // Clamp pagination so malformed query params (e.g. ?page=-1&limit=-5) don't
    // reach Sequelize as a negative LIMIT/OFFSET, which throws → 500.
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 10), 200);
    const offset = (pageNum - 1) * limitNum;
    const scopeFilter = await d.buildProspectWhere(user);
    const whereConditions = { ...scopeFilter };

    // leadStatus / leadSource accept comma-lists (Phase B multi-select filters);
    // single values stay backward-compatible. Tokens are whitelisted against
    // the enum so nothing unknown ever reaches a Postgres enum cast (→ 500);
    // an all-invalid value degrades to an empty page — the long-standing
    // single-value behavior.
    const statusFilter = parseEnumFilter(leadStatus, VALID_LEAD_STATUSES);
    const sourceFilter = parseEnumFilter(leadSource, VALID_LEAD_SOURCES);
    if (statusFilter.empty || sourceFilter.empty) {
      return { prospects: [], pagination: { currentPage: pageNum, totalPages: 0, totalItems: 0, itemsPerPage: limitNum } };
    }
    if (assignment && !VALID_ASSIGNMENT_FILTERS.includes(assignment)) {
      return { prospects: [], pagination: { currentPage: pageNum, totalPages: 0, totalItems: 0, itemsPerPage: limitNum } };
    }

    // Assignment-state filter: 'unassigned' means truly in limbo (not held — held rows
    // have their own bucket so the admin's pending pool and the strays stay separable).
    // Prospects carry TWO mutually-exclusive assignee FKs (assignedAgentId for users,
    // externalAgentId for the ExternalAgent buyer pool) — both count as "assigned".
    // The Op.or lives inside Op.and so it can never clobber the search Op.or below.
    if (assignment === 'assigned') {
      whereConditions[Op.and] = [
        ...(whereConditions[Op.and] || []),
        { [Op.or]: [{ assignedAgentId: { [Op.ne]: null } }, { externalAgentId: { [Op.ne]: null } }] },
      ];
    } else if (assignment === 'unassigned') {
      whereConditions.assignedAgentId = null;
      whereConditions.externalAgentId = null;
      whereConditions.quarantinedAt = null;
    } else if (assignment === 'held') whereConditions.quarantinedAt = { [Op.ne]: null };

    if (qrTagId) whereConditions.qrTagId = qrTagId;
    if (statusFilter.values) {
      whereConditions.leadStatus = statusFilter.values.length === 1 ? statusFilter.values[0] : { [Op.in]: statusFilter.values };
    }
    if (priority) whereConditions.priority = priority;
    if (sourceFilter.values) {
      whereConditions.leadSource = sourceFilter.values.length === 1 ? sourceFilter.values[0] : { [Op.in]: sourceFilter.values };
    }
    if (assignedAgentId) whereConditions.assignedAgentId = assignedAgentId;
    if (campaignId) whereConditions.campaignId = campaignId;

    if (search) {
      const sanitizedSearch = escapeLike(search);
      const likeOp = Op.iLike;
      whereConditions[Op.or] = [
        { firstName: { [likeOp]: `%${sanitizedSearch}%` } },
        { lastName: { [likeOp]: `%${sanitizedSearch}%` } },
        { email: { [likeOp]: `%${sanitizedSearch}%` } },
        { company: { [likeOp]: `%${sanitizedSearch}%` } },
        // Phone matches ignore spacing (stored "+65 9231 8804", operators type
        // digits) — strip spaces on both sides of the comparison. Sequelize
        // STATICS (not instance methods) so DI-mocked unit suites stay valid.
        sqlWhere(
          sqlFn('REPLACE', sqlCol('Prospect.phone'), ' ', ''),
          { [likeOp]: `%${sanitizedSearch.replace(/\s+/g, '')}%` }
        ),
      ];
    }

    if (dateFrom || dateTo) {
      whereConditions.createdAt = {};
      if (dateFrom) whereConditions.createdAt[Op.gte] = new Date(dateFrom);
      if (dateTo) whereConditions.createdAt[Op.lte] = new Date(dateTo);
    }

    const { count, rows: prospects } = await m.Prospect.findAndCountAll({
      where: whereConditions,
      // Screening evidence (call transcripts/summaries) is detail-only — never
      // shipped in list projections (plan §4, Codex #16).
      attributes: { exclude: ['screeningMetadata'] },
      limit: limitNum,
      offset,
      order: parseProspectSort(sort),
      include: [
        {
          association: 'assignedAgent',
          attributes: ['id', 'firstName', 'lastName', 'email'],
        },
        {
          association: 'campaign',
          attributes: ['id', 'name', 'type', 'status'],
        },
        {
          association: 'qrTag',
          attributes: ['id', 'name', 'type'],
        },
      ],
    });

    // Admin-only: attach a light cross-campaign repeat-signup count per row for
    // the list badge. Non-admins never receive it (this list endpoint is shared
    // with the agent MyProspects view). Resilient — failure → no badge data.
    if (user?.role === 'admin' && prospects.length > 0) {
      const counts = await repeatSignupCounts(
        d.sequelize,
        prospects.map((p) => ({ id: p.id, phone: p.phone, email: p.email }))
      ).catch(() => new Map());
      for (const p of prospects) p.setDataValue('repeatSignupCount', counts.get(p.id) ?? null);
    }

    // Admin-only, OPT-IN (?include=outcome — the v2 list's STATUS column):
    // per-row campaign outcome, the same contract discipline as
    // ?include=profile. Byte-identical without the flag; agent MyProspects
    // and the palette never pay for it. Resilient — a miss drops the chips,
    // never the page.
    const wantOutcome = user?.role === 'admin'
      && String(params.include || '').split(',').map((s2) => s2.trim()).includes('outcome')
      && prospects.length > 0;
    if (wantOutcome) {
      const outcomes = await d.getProspectOutcomes(prospects).catch(() => new Map());
      for (const p of prospects) {
        const o = outcomes.get(String(p.id));
        if (o) {
          p.setDataValue('draw', o.draw);
          p.setDataValue('reward', o.reward);
        }
      }
    }

    return {
      prospects,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(count / limitNum),
        totalItems: count,
        itemsPerPage: limitNum,
      },
    };
  }
  /**
   * Track a prospect view.
   */
  async function trackProspectView(id, user, { source, userAgent } = {}) {
    const scopeWhere = await d.buildProspectWhere(user);
    const prospect = await m.Prospect.findOne({ where: { id, ...scopeWhere } });

    if (!prospect) {
      throw new d.AppError('Prospect not found or access denied', 404);
    }

    await m.ProspectActivity.create({
      prospectId: prospect.id,
      type: 'viewed',
      actorUserId: user.id,
      description: `Prospect viewed by ${user.firstName || 'agent'} ${user.lastName || ''}`,
      metadata: {
        source: source || 'email_link',
        viewedAt: new Date(),
        userAgent,
      },
    });
  }
  /**
   * List HELD (quarantined) leads, FIFO by quarantinedAt (the release order). Scoped to
   * the caller's access; optionally filtered by campaign. Release is done via the
   * existing assignProspect (PATCH /:id/assign) or the auto-release sweep on top-up.
   */
  async function listHeldProspects(user, params = {}) {
    const { campaignId, quarantineReason } = params;
    const limit = Math.min(parseInt(params.limit, 10) || 100, 500);
    const scopeFilter = await d.buildProspectWhere(user);
    const where = { ...scopeFilter, quarantinedAt: { [Op.ne]: null } };
    if (campaignId) where.campaignId = campaignId;
    // Filter by reason IN the query (before the limit) so assignable holds are never
    // hidden behind a page of external-buyer holds.
    if (quarantineReason) where.quarantineReason = quarantineReason;

    const { count, rows } = await m.Prospect.findAndCountAll({
      where,
      attributes: { exclude: ['screeningMetadata'] },
      include: [{ association: 'campaign', attributes: ['id', 'name'] }],
      order: [['quarantinedAt', 'ASC']], // FIFO — oldest held first (the release order)
      limit,
    });

    const held = rows.map((p) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      phone: p.phone,
      email: p.email,
      leadSource: p.leadSource,
      campaignId: p.campaignId,
      campaignName: p.campaign?.name || null,
      quarantinedAt: p.quarantinedAt,
      quarantineReason: p.quarantineReason,
      createdAt: p.createdAt,
    }));

    return { count, held };
  }
  /**
   * All ProspectActivity rows for a prospect (oldest-first), with actorUserId explicitly
   * selected (the getProspect include omits it). Read-only; powers the external lead-timeline
   * endpoint that feeds the mktr-leads held detail's merged history.
   */
  async function getProspectActivities(prospectId, { limit = 200 } = {}) {
    if (!prospectId) return [];
    const rows = await m.ProspectActivity.findAll({
      where: { prospectId },
      attributes: ['id', 'type', 'description', 'actorUserId', 'metadata', 'createdAt'],
      order: [['createdAt', 'ASC']],
      limit: Math.min(parseInt(limit, 10) || 200, 500),
    });
    return rows.map((a) => ({
      id: a.id,
      type: a.type,
      description: a.description,
      actorUserId: a.actorUserId,
      metadata: a.metadata,
      createdAt: a.createdAt,
    }));
  }

  return { getProspect, getProspectStats, listProspects, trackProspectView, listHeldProspects, getProspectActivities };
}
