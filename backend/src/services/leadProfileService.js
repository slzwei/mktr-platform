import { Op } from 'sequelize';
import {
  Draw, RewardEntitlement, Activation, RewardOffer, ConsumerSuppression,
  EmailBroadcastRecipient, SessionVisit, sequelize,
} from '../models/index.js';
import { logger } from '../utils/logger.js';
import { presentState } from '../utils/entitlementPresentState.js';
import { makeLuckyDrawService } from './luckyDrawService.js';
import { getConsentState } from './consentService.js';
import { phoneKeyOf, LIVE_PHONE_STATUSES } from './redeemOps/entitlementService.js';
import { phoneVerificationIsCurrent } from './consumerService.js';
import { SCREENING_REASONS } from './screeningConstants.js';

/**
 * Lead Profile enrichment (docs/plans/admin-lead-profile-page.md §4) — the
 * admin-only, `?include=profile`-gated composer behind /admin/leads/:id.
 * READ-ONLY over other domains' tables; every projection here is bounded
 * (LIMITs, DISTINCT ON, allowlists) because it runs on a detail hot path.
 *
 * Boundary contract: prospectService calls this ONLY inside its admin branch
 * and only when the request opted in — nothing here may become load-bearing
 * for agent or public payloads.
 */

const BROADCAST_LIMIT = 20; // recent rows; counts carry the full totals
const SESSION_STEP_LIMIT = 50;
// responseCode → operator-safe reason. Derived from the receive-mktr-lead
// contract (401 bad sig / 400 bad payload / 422 agent-not-found). Raw
// responseBody text is NEVER surfaced — receiver output is not ours to echo.
const LYFE_DELIVERY_REASONS = {
  422: 'agent_not_found',
  401: 'signature_rejected',
  400: 'bad_payload',
};

export function makeLeadProfileService(overrides = {}) {
  const d = {
    Draw, RewardEntitlement, Activation, RewardOffer, ConsumerSuppression,
    EmailBroadcastRecipient, SessionVisit, sequelize, logger,
    getProspectDrawStatus: null, // defaults to a lucky-draw service built below
    getConsentState,
    presentState,
    phoneKeyOf,
    phoneVerificationIsCurrent,
    now: () => new Date(),
    ...overrides,
  };
  if (!d.getProspectDrawStatus) {
    d.getProspectDrawStatus = makeLuckyDrawService().getProspectDrawStatus;
  }

  /**
   * Read-time "why does this signup have no reward?" — re-runs the same
   * checks issueForProspect applies, in the same order, against LIVE state.
   * Deliberately NOT the ActivationIssuanceSkip ledger: skip rows carry no
   * prospect/consumer anchor (by design) and purge after 30 days, so
   * attributing a campaign's latest skip to this person can be flat wrong.
   * 'not_issued_yet' = every gate passes and the sweep just hasn't landed.
   */
  async function deriveRewardDiagnostic(prospect) {
    if (!prospect?.campaignId) return null;
    if (prospect.quarantinedAt && !SCREENING_REASONS.includes(prospect.quarantineReason)) {
      return 'quarantined';
    }
    if (!d.phoneVerificationIsCurrent(prospect)) return 'phone_not_verified';
    const activation = await d.Activation.findOne({
      where: { campaignId: prospect.campaignId, status: 'active' },
      include: [{ model: d.RewardOffer, as: 'rewardOffer' }],
    });
    if (!activation) return 'no_active_activation';
    const phoneKey = d.phoneKeyOf(prospect.phone);
    if (!phoneKey) return 'no_phone';
    const liveOnPhone = await d.RewardEntitlement.findOne({
      where: {
        activationId: activation.id,
        phoneKey,
        status: { [Op.in]: LIVE_PHONE_STATUSES },
      },
    });
    if (liveOnPhone) return 'duplicate_phone';
    const offer = activation.rewardOffer;
    if (!offer || offer.status !== 'active') return 'offer_not_active';
    if (activation.endDate && new Date(activation.endDate) <= d.now()) return 'activation_ended';
    if (activation.issuedCount >= activation.allocatedQuantity) return 'allocation_exhausted';
    return 'not_issued_yet';
  }

  /**
   * Latest delivery receipt per (entitlement, channel) in ONE bounded query —
   * DISTINCT ON, not the redeemOps in-memory reduce (that one loads every
   * historical receipt and was written for a paginated list). Legacy receipts
   * without metadata.channel group under email, matching the ops console.
   */
  async function deliveryReceipts(entitlementIds) {
    const map = new Map();
    if (!entitlementIds.length) return map;
    // COALESCE inside DISTINCT ON so legacy channel-less rows group WITH email
    // (not as a separate NULL group that JS then collapses over email), and
    // id DESC as a deterministic tie-break for same-timestamp receipts. The
    // LEFT JOIN pulls post-acceptance truth (Meta status inbox, keyed by the
    // receipt's wamid) — null delivery means "accepted, nothing further heard",
    // which is exactly what legacy rows and emails show today.
    const [rows] = await d.sequelize.query(
      `SELECT DISTINCT ON (re."entitlementId", COALESCE(re.metadata->>'channel', 'email'))
              re."entitlementId", re.type, re."createdAt",
              COALESCE(re.metadata->>'channel', 'email') AS channel,
              re.metadata->>'kind' AS kind,
              re.metadata->>'error' AS error,
              s.status AS delivery_status, s."occurredAt" AS delivery_at,
              s."errorCode" AS delivery_error_code, s."errorTitle" AS delivery_error_title
         FROM redemption_events re
         LEFT JOIN wa_message_statuses s ON s.wamid = re.metadata->>'messageId'
        WHERE re."entitlementId" IN (:ids) AND re.type IN ('notified', 'notify_failed')
        ORDER BY re."entitlementId", COALESCE(re.metadata->>'channel', 'email'),
                 re."createdAt" DESC, re.id DESC`,
      { replacements: { ids: entitlementIds } }
    );
    for (const r of rows) {
      const key = String(r.entitlementId);
      if (!map.has(key)) map.set(key, { email: null, whatsapp: null });
      const channel = r.channel === 'whatsapp' ? 'whatsapp' : 'email';
      map.get(key)[channel] = {
        kind: r.kind || null,
        at: r.createdAt,
        ok: r.type === 'notified',
        ...(r.error ? { error: r.error } : {}),
        delivery: r.delivery_status
          ? {
              status: r.delivery_status,
              at: r.delivery_at,
              errorCode: r.delivery_error_code,
              errorTitle: r.delivery_error_title,
            }
          : null,
      };
    }
    return map;
  }

  /** Draw rails across a campaign set — entitlements on one speak the draw voice. */
  async function drawRailActivationIds(campaignIds) {
    const railIds = new Set();
    if (!campaignIds.length) return railIds;
    const rows = await d.Draw.findAll({
      where: { campaignId: { [Op.in]: campaignIds } },
      attributes: ['activationId'],
    });
    for (const r of rows) if (r.activationId) railIds.add(String(r.activationId));
    return railIds;
  }

  /**
   * List-page outcome facts (docs/plans/admin-prospects-outcome-column.md):
   * per-row draw standing (trimmed of drawHistory) plus the newest
   * non-draw-linked entitlement's presentation state — the STATUS column's
   * raw material. Batched for a 25-row page: the draw side is bounded per
   * DISTINCT draw (getProspectDrawStatus), the reward side is one entitlement
   * query (idx_re_prospect) plus the rail lookup.
   * Returns Map<prospectId(string), { draw, reward }>.
   */
  async function getProspectOutcomes(prospects) {
    const rows = (prospects || []).filter((p) => p && p.id);
    const out = new Map();
    if (rows.length === 0) return out;
    const campaignIds = [...new Set(rows.map((p) => String(p.campaignId)).filter(Boolean))];

    const [drawMap, railIds, entitlements] = await Promise.all([
      d.getProspectDrawStatus(rows),
      drawRailActivationIds(campaignIds),
      d.RewardEntitlement.findAll({
        where: { prospectId: { [Op.in]: rows.map((p) => p.id) } },
        attributes: ['id', 'prospectId', 'status', 'expiresAt', 'activationId', 'createdAt'],
        include: [{ association: 'rewardOffer', attributes: ['id', 'title', 'publicTitle'] }],
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
      }),
    ]);

    // Newest non-draw-linked entitlement per prospect (DESC order → first
    // eligible wins; draw passes are the boost rail, never the voucher voice).
    const rewardByProspect = new Map();
    for (const e of entitlements) {
      const key = String(e.prospectId);
      if (rewardByProspect.has(key)) continue;
      if (e.activationId && railIds.has(String(e.activationId))) continue;
      rewardByProspect.set(key, {
        state: d.presentState(e, d.now()),
        rewardTitle: e.rewardOffer ? (e.rewardOffer.publicTitle || e.rewardOffer.title) : null,
      });
    }

    for (const p of rows) {
      const block = drawMap.get(String(p.id)) ?? null;
      let draw = block;
      if (block && 'drawHistory' in block) {
        const { drawHistory: _history, ...rest } = block;
        draw = rest;
      }
      out.set(String(p.id), { draw, reward: rewardByProspect.get(String(p.id)) || null });
    }
    return out;
  }

  /** Bounded person-level broadcast history: recent page + full status tallies. */
  async function broadcastHistory(consumerId) {
    try {
      const [rows, tallies] = await Promise.all([
        d.EmailBroadcastRecipient.findAll({
          where: { consumerId },
          include: [{ association: 'broadcast', attributes: ['id', 'subject'] }],
          order: [['createdAt', 'DESC'], ['id', 'DESC']],
          limit: BROADCAST_LIMIT,
        }),
        d.EmailBroadcastRecipient.findAll({
          where: { consumerId },
          attributes: ['status', [d.sequelize.fn('COUNT', d.sequelize.col('id')), 'n']],
          group: ['status'],
          raw: true,
        }),
      ]);
      const counts = {};
      for (const t of tallies) counts[t.status] = Number(t.n);
      return {
        counts,
        recent: rows.map((r) => ({
          broadcastId: r.broadcastId,
          subject: r.broadcast?.subject || null,
          status: r.status,
          reason: r.reason || null,
          sentAt: r.sentAt || null,
          at: r.createdAt,
        })),
      };
    } catch (err) {
      d.logger.warn('[leadProfile] broadcast history failed (omitted)', { error: err?.message });
      return { counts: {}, recent: [] };
    }
  }

  /**
   * Enrich a `getConsumerJourney(..., { includeRaw: true })` payload in place:
   * per-signup draw standing + campaign-scoped consent + reward diagnostic,
   * entitlement presentation extras + delivery receipts, person suppressions,
   * bounded broadcast history. Consumes and strips `_rawSignups`.
   */
  async function enrichJourneyProfile(journey) {
    if (!journey) return journey;
    const raw = Array.isArray(journey._rawSignups) ? journey._rawSignups : [];
    delete journey._rawSignups;
    const erased = Boolean(journey.consumer?.erasedAt);
    const campaignIds = [...new Set(raw.map((p) => String(p.campaignId)).filter(Boolean))];

    const [drawMap, railIds] = await Promise.all([
      d.getProspectDrawStatus(raw, { erased }),
      drawRailActivationIds(campaignIds),
    ]);

    // Presentation extras the lean journey projection doesn't carry — one
    // bounded re-read by id (the journey stays byte-identical without profile).
    const entIds = journey.entitlements.map((e) => e.id);
    const extraById = new Map();
    if (entIds.length) {
      const rows = await d.RewardEntitlement.findAll({
        where: { id: { [Op.in]: entIds } },
        attributes: ['id', 'status', 'expiresAt', 'unlockedVia', 'tokenHint', 'activationId'],
      });
      for (const r of rows) extraById.set(String(r.id), r);
    }
    const receipts = await deliveryReceipts(entIds);
    journey.entitlements = journey.entitlements.map((e) => {
      const extra = extraById.get(String(e.id));
      return {
        ...e,
        state: extra ? d.presentState(extra, d.now()) : null,
        unlockedVia: extra?.unlockedVia || null,
        tokenHint: extra?.tokenHint || null,
        drawLinked: Boolean(extra?.activationId && railIds.has(String(extra.activationId))),
        delivery: receipts.get(String(e.id)) || { email: null, whatsapp: null },
      };
    });

    // Consent is SCOPED — resolve per signup campaign (campaign + global
    // latest-wins), never one person-wide last-per-kind map.
    const consentByCampaign = new Map();
    await Promise.all(campaignIds.map(async (cid) => {
      const state = await d.getConsentState(journey.consumer.id, { campaignId: cid })
        .catch(() => null);
      consentByCampaign.set(cid, state);
    }));

    const entitledCampaigns = new Set(
      journey.entitlements.map((e) => String(e.campaignId)).filter(Boolean)
    );
    const rawById = new Map(raw.map((p) => [String(p.id), p]));
    journey.signups = await Promise.all(journey.signups.map(async (s) => {
      const cid = s.campaign ? String(s.campaign.id) : null;
      const consent = cid ? consentByCampaign.get(cid) : null;
      const { suppressions: _drop, ...consentKinds } = consent || {};
      const wantDiagnostic = cid && !entitledCampaigns.has(cid) && !erased;
      return {
        ...s,
        draw: drawMap.get(String(s.prospectId)) ?? null,
        consent: consent ? consentKinds : null,
        rewardDiagnostic: wantDiagnostic
          ? await deriveRewardDiagnostic(rawById.get(String(s.prospectId))).catch(() => null)
          : null,
      };
    }));

    journey.suppressions = await d.ConsumerSuppression.findAll({ where: { consumerId: journey.consumer.id } })
      .then((rows) => rows.map((r) => ({ channel: r.channel, reason: r.reason })))
      .catch(() => []);
    journey.broadcasts = await broadcastHistory(journey.consumer.id);
    return journey;
  }

  /**
   * B4 fallback — the same draw/reward standing for a prospect with NO
   * consumer link (Retell voice leads, pre-spine rows, unverified phones), so
   * their page still tells their own campaign's story.
   */
  async function getSignupProfile(prospect) {
    const plain = {
      id: prospect.id,
      campaignId: prospect.campaignId,
      phone: prospect.phone,
      createdAt: prospect.createdAt,
      quarantinedAt: prospect.quarantinedAt,
      quarantineReason: prospect.quarantineReason,
      sourceMetadata: prospect.sourceMetadata,
      consentMetadata: prospect.consentMetadata,
    };
    const [drawMap, railIds, entitlements] = await Promise.all([
      d.getProspectDrawStatus([plain], { erased: plain.sourceMetadata?.erased === true }),
      drawRailActivationIds(plain.campaignId ? [String(plain.campaignId)] : []),
      d.RewardEntitlement.findAll({
        where: { prospectId: prospect.id },
        attributes: ['id', 'status', 'createdAt', 'unlockedAt', 'expiresAt', 'unlockedVia', 'tokenHint', 'activationId'],
        include: [
          { association: 'rewardOffer', attributes: ['id', 'title', 'publicTitle'] },
          { association: 'activation', attributes: ['id', 'campaignId', 'campaignNameSnapshot'] },
          { association: 'redemption', attributes: ['id', 'redeemedAt', 'status'] },
        ],
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
      }),
    ]);
    const receipts = await deliveryReceipts(entitlements.map((e) => e.id));
    return {
      draw: drawMap.get(String(prospect.id)) ?? null,
      entitlements: entitlements.map((e) => ({
        id: e.id,
        status: e.status,
        state: d.presentState(e, d.now()),
        createdAt: e.createdAt,
        unlockedAt: e.unlockedAt,
        expiresAt: e.expiresAt,
        rewardTitle: e.rewardOffer ? (e.rewardOffer.publicTitle || e.rewardOffer.title) : null,
        campaignName: e.activation?.campaignNameSnapshot || null,
        campaignId: e.activation?.campaignId || null,
        redeemedAt: e.redemption?.redeemedAt || null,
        unlockedVia: e.unlockedVia || null,
        tokenHint: e.tokenHint || null,
        drawLinked: Boolean(e.activationId && railIds.has(String(e.activationId))),
        delivery: receipts.get(String(e.id)) || { email: null, whatsapp: null },
      })),
      rewardDiagnostic: entitlements.length
        ? null
        : await deriveRewardDiagnostic(plain).catch(() => null),
    };
  }

  /**
   * How this lead arrived: merged view over ALL session_visits rows for the
   * sessionId (the write path is findOne-then-append and the index is
   * non-unique — duplicates exist; never findOne). Funnel steps are an
   * ALLOWLISTED projection — eventsJson is arbitrary public beacon input and
   * must not be reflected raw into the admin UI.
   */
  async function getSessionContext(sessionId) {
    if (!sessionId) return null;
    const visits = await d.SessionVisit.findAll({
      where: { sessionId },
      order: [['startedAt', 'ASC'], ['id', 'ASC']],
    });
    if (!visits.length) return null;
    const first = visits[0];
    const steps = [];
    for (const v of visits) {
      const events = Array.isArray(v.eventsJson) ? v.eventsJson : [];
      for (const ev of events) {
        if (typeof ev?.type !== 'string') continue;
        steps.push({
          type: ev.type.slice(0, 64),
          at: typeof ev.ts === 'string' ? ev.ts : null,
          path: typeof ev.meta?.path === 'string' ? ev.meta.path.slice(0, 200) : null,
        });
      }
    }
    return {
      startedAt: first.startedAt,
      landingPath: first.landingPath || null,
      utm: {
        source: first.utmSource || null,
        medium: first.utmMedium || null,
        campaign: first.utmCampaign || null,
        term: first.utmTerm || null,
        content: first.utmContent || null,
      },
      steps: steps.slice(0, SESSION_STEP_LIMIT),
      stepsTruncated: steps.length > SESSION_STEP_LIMIT,
      visitCount: visits.length,
    };
  }

  /**
   * Did this lead reach the Lyfe app? Latest delivery per event type, filtered
   * to the Lyfe-destination subscriber (deliveries are per-subscriber; an
   * MKTR-Leads row is NOT Lyfe delivery). Returns null when nothing was ever
   * queued — a System-Agent lead's null destination is default-denied and
   * writes no row at all, so "no rows" is itself the signal the UI voices.
   * Served by the partial expression index idx_wd_lead_external_created (089).
   */
  async function getLyfeDelivery(prospectId) {
    const [rows] = await d.sequelize.query(
      `SELECT DISTINCT ON (wd."eventType")
              wd."eventType", wd.status, wd.attempts, wd."lastAttemptAt",
              wd."responseCode", wd."createdAt"
         FROM webhook_deliveries wd
         JOIN webhook_subscribers ws ON ws.id = wd."subscriberId"
        WHERE wd."eventType" IN ('lead.created', 'lead.assigned')
          AND (wd.payload::jsonb #>> '{data,lead,externalId}') = :pid
          AND ws.metadata->>'destination' = 'lyfe'
        ORDER BY wd."eventType", wd."createdAt" DESC`,
      { replacements: { pid: String(prospectId) } }
    );
    if (!rows.length) return null;
    return rows.map((r) => ({
      eventType: r.eventType,
      status: r.status,
      attempts: r.attempts,
      lastAttemptAt: r.lastAttemptAt,
      responseCode: r.responseCode ?? null,
      reason: LYFE_DELIVERY_REASONS[r.responseCode] || null,
      at: r.createdAt,
    }));
  }

  return {
    enrichJourneyProfile,
    getSignupProfile,
    getSessionContext,
    getLyfeDelivery,
    getProspectOutcomes,
    deriveRewardDiagnostic,
  };
}

const _default = makeLeadProfileService();
export const enrichJourneyProfile = _default.enrichJourneyProfile;
export const getSignupProfile = _default.getSignupProfile;
export const getSessionContext = _default.getSessionContext;
export const getLyfeDelivery = _default.getLyfeDelivery;
export const getProspectOutcomes = _default.getProspectOutcomes;
