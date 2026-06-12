/**
 * @file externalLeadOutcomeService — applies a lead-outcome event from the
 * MKTR Leads buyer app to the originating Prospect.
 *
 * The return half of the external (paid-buyer) lead loop: MKTR delivers a lead
 * to the mktr-leads app; when the buyer later moves the lead's status, a
 * Postgres trigger in the mktr-leads Supabase project fires its
 * report-lead-outcome edge function, which POSTs here. We mirror the buyer's
 * status onto Prospect.leadStatus and write a ProspectActivity so admins can
 * see what buyers did with the leads they paid for (billing / refund / dispute
 * reconciliation).
 *
 * Deliberately separate from leadOutcomeService (Lyfe → Meta CAPI conversions):
 * different sender, different secret, different purpose — this one mirrors
 * status and does NOT fire CAPI events.
 *
 * ── Status mapping (MKTR_LEADS_PLAN.md §2, against the real enum) ───────
 *
 * Prospect.leadStatus enum: new, contacted, qualified, proposal_sent,
 * negotiating, won, lost, nurturing. `invalid`/`disputed` have no counterpart
 * BY DESIGN: they are quality/dispute signals, so the prospect's status is
 * preserved and the activity is flagged (`metadata.qualitySignal`) instead.
 *
 * ── Side-effects on `won` ────────────────────────────────────────────────
 *
 * Internal wins (prospectService.updateProspect) create a Commission for the
 * assigned agent and stamp conversionDate. An external win stamps
 * conversionDate (it IS a conversion for reporting) but creates NO commission:
 * the "assigned agent" on a buyer-delivered prospect is the buyer's mirror
 * users row (users.mktrLeadsId) — buyers pay for leads, they don't earn
 * internal commissions.
 *
 * ── Idempotency ──────────────────────────────────────────────────────────
 *
 * The sender's eventId is `${leadId}:${status}` — stable across re-fires of
 * the same status change (pg_net has no retry; a DB sweep re-invokes unreported
 * outcomes). The key is claimed in the SAME transaction as the prospect update
 * + activity insert, so a failed apply leaves the event re-processable and a
 * processed event replays its stored response. Expired keys (purge is hourly)
 * are taken over so a genuine re-occurrence after the TTL is processed anew.
 */

import { sequelize, Prospect, ProspectActivity, IdempotencyKey, User } from '../models/index.js';
import { logger } from '../utils/logger.js';

export const IDEMPOTENCY_SCOPE = 'external:outcome';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Statuses the mktr-leads app can send (its leads.status CHECK constraint). */
export const MKTR_LEADS_STATUSES = Object.freeze([
  'new',
  'contacted',
  'qualified',
  'proposed',
  'won',
  'lost',
  'invalid',
  'disputed',
]);

// MKTR Leads status → Prospect.leadStatus. null = preserve status, record a
// flagged activity (quality/dispute signal).
const STATUS_MAP = Object.freeze({
  new: 'new',
  contacted: 'contacted',
  qualified: 'qualified',
  proposed: 'proposal_sent',
  won: 'won',
  lost: 'lost',
  invalid: null,
  disputed: null,
});

const defaultDeps = {
  sequelize,
  models: { Prospect, ProspectActivity, IdempotencyKey, User },
  logger,
};

export function makeExternalLeadOutcomeService(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };
  const m = { ...defaultDeps.models, ...(overrides.models || {}) };

  /**
   * Apply one lead-outcome event. The controller has already authenticated the
   * request and validated the payload shape + status membership.
   *
   * @param {object} payload { event, eventId, timestamp, data: { externalId,
   *   sourceName, deliveryId, mktrLeadsStatus } }
   * @returns {Promise<{statusCode: number, body: object}>} — the sender stamps
   *   outcome_reported_at only on 2xx, so non-2xx keeps the outcome visible as
   *   unreported (and the mktr-leads sweep will re-fire it).
   */
  async function processExternalLeadOutcome(payload) {
    const { eventId, data } = payload;
    const { externalId, deliveryId, mktrLeadsStatus } = data;
    const key = `${IDEMPOTENCY_SCOPE}:${eventId}`;

    // Replay fast-path. Expired rows linger until the hourly purge — take them
    // over so a re-occurrence after the TTL (status flapped back) is processed.
    const existing = await m.IdempotencyKey.findOne({ where: { key } });
    if (existing) {
      if (new Date(existing.expiresAt).getTime() > Date.now()) {
        return {
          statusCode: existing.responseCode ?? 200,
          body: existing.responseBody ?? { success: true, replay: true },
        };
      }
      await existing.destroy();
    }

    const prospect = await m.Prospect.findByPk(externalId, {
      include: [{ model: m.User, as: 'assignedAgent', attributes: ['id', 'mktrLeadsId'] }],
    });
    if (!prospect) {
      return { statusCode: 422, body: { success: false, error: 'unknown_prospect' } };
    }

    // Ownership gate: only prospects actually delivered to the MKTR Leads app
    // may be mutated by it — either the external_agents path (future) or the
    // mirror-user path (current: assignedAgent carries users.mktrLeadsId).
    const isMktrLeadsProspect =
      prospect.externalAgentId != null || prospect.assignedAgent?.mktrLeadsId != null;
    if (!isMktrLeadsProspect) {
      d.logger.warn(
        { event: 'external_outcome_rejected', prospect_id: prospect.id, eventId },
        '[external-outcome] prospect is not MKTR Leads-delivered'
      );
      return { statusCode: 422, body: { success: false, error: 'not_a_mktr_leads_prospect' } };
    }

    const mapped = STATUS_MAP[mktrLeadsStatus] ?? null;
    const previousLeadStatus = prospect.leadStatus;

    try {
      const body = await d.sequelize.transaction(async (t) => {
        if (mapped && mapped !== previousLeadStatus) {
          prospect.leadStatus = mapped;
          if (mapped === 'won' && !prospect.conversionDate) {
            prospect.conversionDate = new Date();
          }
          await prospect.save({ transaction: t });
        }

        const description = mapped
          ? `MKTR Leads buyer marked lead as ${mktrLeadsStatus}` +
            (mapped !== mktrLeadsStatus ? ` (leadStatus → ${mapped})` : '')
          : `MKTR Leads buyer flagged lead as ${mktrLeadsStatus} (status preserved — quality/dispute signal)`;

        await m.ProspectActivity.create(
          {
            prospectId: prospect.id,
            type: 'updated',
            actorUserId: null,
            description,
            metadata: {
              source: 'mktr-leads',
              eventId,
              deliveryId: deliveryId ?? null,
              mktrLeadsStatus,
              previousLeadStatus,
              ...(mapped ? {} : { qualitySignal: true }),
            },
          },
          { transaction: t }
        );

        const responseBody = {
          success: true,
          externalId: prospect.id,
          mktrLeadsStatus,
          appliedLeadStatus: mapped ?? previousLeadStatus,
          qualitySignal: mapped == null,
        };

        // Claimed last, inside the transaction: a rollback (failed apply)
        // leaves the event re-processable.
        await m.IdempotencyKey.create(
          {
            key,
            scope: IDEMPOTENCY_SCOPE,
            responseBody,
            responseCode: 200,
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          },
          { transaction: t }
        );

        return responseBody;
      });

      return { statusCode: 200, body };
    } catch (err) {
      // Concurrent duplicate: another request claimed the key mid-flight and
      // (by claim-last ordering) has already applied the same event.
      if (err?.name === 'SequelizeUniqueConstraintError') {
        return { statusCode: 200, body: { success: true, replay: true } };
      }
      throw err;
    }
  }

  return { processExternalLeadOutcome };
}

export const { processExternalLeadOutcome } = makeExternalLeadOutcomeService();
