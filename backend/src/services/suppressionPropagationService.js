import { randomUUID } from 'crypto';
import { Op } from 'sequelize';
import {
  sequelize, Consumer, Prospect, ConsumerSuppression, WebhookSubscriber,
  WebhookDelivery, SuppressionPropagation,
} from '../models/index.js';
import { logger } from '../utils/logger.js';
import { buildLeadSuppressedPayload, buildLeadUnsuppressedPayload } from './prospectHelpers.js';
import { flushDeliveries, historicallyTargetedSubscribers } from './webhookService.js';

/**
 * Suppression propagation (tracker "propagate" + resubscribe lift, plan v3 —
 * docs/plans/suppression-propagation-plan.md; wire contract in
 * docs/reference/webhook-propagation-contract.md).
 *
 * NOT a fanout — a RECONCILER over a durable projection:
 *
 *   current state (consumer_suppressions + consumers.erasedAt
 *                  + latest source='resubscribe' ledger evidence)
 *     ⨝ the person's prospects ⨝ delivery history ⨝ current subscriptions
 *   ⇒ suppression_propagations pairs, each a tiny state machine:
 *       state          — desired downstream state ('suppressed' | 'lifted')
 *       deliveredState — what the last queued delivery conveyed
 *     needs-queue ⇔ the two differ (or the delivery terminally failed/purged).
 *
 * v3 (Shawn's Reading-2 decision): a fresh OTP-verified agree-all grant lifts
 * an unsubscribe — consentService removes the suppression row and writes a
 * source:'resubscribe' ledger event; this reconciler then flips the person's
 * 'marketing' pairs to lifted and emits lead.unsuppressed. Flips are
 * EVIDENCE-DRIVEN: no resubscribe event ⇒ no flip (a manual row delete stays
 * manual). The 'all' scope (erasure) is a latch and never lifts. Cycles
 * (unsub → resub → unsub) flip state back and forth; downstream merges are
 * watermarked (strictly-newer occurredAt wins), so unordered/repaired
 * deliveries stay idempotent in both directions.
 *
 * Deterministic and assignment-shaped: safe to run anytime, repeatedly,
 * concurrently (DB unique + ON CONFLICT DO NOTHING; queue claims are CAS on
 * deliveryId). Every loss mode heals on the next pass, including the
 * dark→flip backfill after a bootstrap flag flip.
 *
 * Erasure-fallback rule (outcome-based): for 'all' pairs, a subscriber whose
 * lead.deleted delivery row EXISTS for that lead is skipped — deletion
 * already implies stop-contact; capability alone never skips.
 */

const digitsOf = (v) => String(v || '').replace(/\D/g, '');

const EVENT_FOR_STATE = {
  suppressed: 'lead.suppressed',
  lifted: 'lead.unsuppressed',
};

const defaultDeps = {
  sequelize, Consumer, Prospect, ConsumerSuppression, WebhookSubscriber,
  WebhookDelivery, SuppressionPropagation,
  logger, buildLeadSuppressedPayload, buildLeadUnsuppressedPayload,
  flushDeliveries, historicallyTargetedSubscribers,
};

export function makeSuppressionPropagationService(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };

  /** The person's leads: consumer link + (identity intact only) phone arms. */
  async function prospectIdsOf(consumer) {
    const orArms = [`"consumerId" = :cid`];
    const repl = { cid: consumer.id };
    const phoneDigits = consumer.erasedAt ? null : digitsOf(consumer.phone);
    if (phoneDigits) {
      // digitsOf output is \d+ only — safe to bind as a plain param.
      // Plain-phone arm EXCLUDES call_bot: their `phone` is MKTR's DDI, not
      // the caller (spine precedent, consumerService) — a consumer whose
      // number equals the DDI must not suppress strangers' call leads. The
      // caller leg is matched via fromNumber instead (Codex diff-round #6).
      orArms.push(`("leadSource" <> 'call_bot' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = :digits)`);
      orArms.push(`("leadSource" = 'call_bot' AND regexp_replace(COALESCE("sourceMetadata"->>'fromNumber', ''), '\\D', '', 'g') = :digits)`);
      repl.digits = phoneDigits;
    }
    const [rows] = await d.sequelize.query(
      `SELECT id FROM prospects WHERE ${orArms.join(' OR ')}`,
      { replacements: repl }
    );
    return rows.map((r) => r.id);
  }

  /**
   * One reconcile pass. `consumerId` narrows to one person (writer triggers,
   * capture hook); omitted = full pass (boot, interval, flag-flip backfill).
   * Returns counts. Never throws — callers are post-commit fire-and-forget.
   */
  async function reconcileSuppressionPropagation({ consumerId = null } = {}) {
    const counts = { consumers: 0, pairsInserted: 0, lifted: 0, resuppressed: 0, queued: 0, requeued: 0 };
    try {
      // 1. Target consumers: suppressed-or-erased (project/refresh suppressed
      // pairs) UNION consumers that still HAVE pairs (candidates for the lift
      // flip). channel='all' suppression rows only: a future per-channel
      // suppression (WA STOP) must not be promoted to a global scope.
      // resubAt = the latest resubscribe evidence — the lift's authoritative
      // occurredAt; without it no flip ever happens.
      const [targets] = await d.sequelize.query(
        `SELECT c.id, c.phone, c."erasedAt",
                s.reason AS "sReason", s."createdAt" AS "sAt",
                r."occurredAt" AS "resubAt"
           FROM consumers c
           LEFT JOIN consumer_suppressions s
             ON s."consumerId" = c.id AND s.channel = 'all'
           LEFT JOIN LATERAL (
             SELECT "occurredAt" FROM consent_events
              WHERE "consumerId" = c.id AND source = 'resubscribe'
                AND kind = 'contact' AND granted = true AND verified = true
                AND "campaignId" IS NULL
              ORDER BY "occurredAt" DESC LIMIT 1
           ) r ON true
          WHERE (s.id IS NOT NULL OR c."erasedAt" IS NOT NULL
                 OR EXISTS (SELECT 1 FROM suppression_propagations sp WHERE sp."consumerId" = c.id))
            ${consumerId ? 'AND c.id = :consumerId' : ''}
          ORDER BY c.id, s."createdAt" ASC`,
        { replacements: consumerId ? { consumerId } : {} }
      );
      if (!targets.length) return counts;

      // Group rows per consumer → this person's desired lane states.
      const byConsumer = new Map();
      for (const row of targets) {
        if (!byConsumer.has(row.id)) {
          byConsumer.set(row.id, {
            id: row.id, phone: row.phone, erasedAt: row.erasedAt,
            resubAt: row.resubAt, suppressions: [],
          });
        }
        if (row.sReason) byConsumer.get(row.id).suppressions.push({ reason: row.sReason, at: row.sAt });
      }

      // Array.isArray guard: subscriber CRUD accepts arbitrary JSON for
      // events — a malformed row must not poison the pass (Codex #7).
      // Either propagation event qualifies a subscriber for the pass — a
      // subscriber that dropped lead.suppressed but kept lead.unsuppressed
      // must still receive its lifts (Codex resub-round #8). The INSERT arm
      // below additionally requires lead.suppressed; queueing filters
      // per-event.
      const subscribed = (await d.WebhookSubscriber.findAll({ where: { enabled: true } }))
        .filter((s) => Array.isArray(s.events)
          && (s.events.includes('lead.suppressed') || s.events.includes('lead.unsuppressed')));
      if (!subscribed.length) return counts; // dark — pairs appear on the first pass after a flip
      const subscribedById = new Map(subscribed.map((s) => [s.id, s]));

      for (const consumer of byConsumer.values()) {
        try {
          counts.consumers += 1;
          const erasure = consumer.erasedAt
            ? { at: consumer.erasedAt, reason: 'erasure' }
            : (consumer.suppressions.find((s) => s.reason === 'erasure')
              ? { at: consumer.suppressions.find((s) => s.reason === 'erasure').at, reason: 'erasure' }
              : null);
          const marketing = consumer.suppressions.find((s) => s.reason !== 'erasure') || null;
          const transitions = [
            ...(marketing ? [{ scope: 'marketing', reason: marketing.reason, occurredAt: marketing.at }] : []),
            ...(erasure ? [{ scope: 'all', reason: 'erasure', occurredAt: erasure.at }] : []),
          ];

          // 2a. Project missing suppressed pairs (unchanged v2 semantics).
          if (transitions.length) {
            const pids = await prospectIdsOf(consumer);
            if (pids.length) {
              const targeted = await d.historicallyTargetedSubscribers(pids);

              // Erasure-fallback rule, OUTCOME-based (Codex #2): skip a
              // lead.deleted-capable subscriber only when its deletion row
              // actually exists for that lead.
              let deletedRowSet = new Set();
              if (transitions.some((tr) => tr.scope === 'all')) {
                const [deletedRows] = await d.sequelize.query(
                  `SELECT DISTINCT "subscriberId",
                          (payload::jsonb #>> '{data,lead,externalId}') AS pid
                     FROM webhook_deliveries
                    WHERE "eventType" = 'lead.deleted'
                      AND (payload::jsonb #>> '{data,lead,externalId}') IN (:pids)`,
                  { replacements: { pids } }
                );
                deletedRowSet = new Set(deletedRows.map((r) => `${r.subscriberId}:${r.pid}`));
              }

              const values = [];
              for (const { subscriberId, prospectId } of targeted) {
                const sub = subscribedById.get(subscriberId);
                if (!sub) continue;
                // New suppressed pairs only for subscribers that can receive
                // suppressions; unsuppressed-only subscribers still get their
                // existing pairs flipped/queued below.
                if (!sub.events.includes('lead.suppressed')) continue;
                for (const tr of transitions) {
                  if (
                    tr.scope === 'all'
                    && sub.events.includes('lead.deleted')
                    && deletedRowSet.has(`${subscriberId}:${prospectId}`)
                  ) continue;
                  values.push({ subscriberId, prospectId, scope: tr.scope, reason: tr.reason, occurredAt: tr.occurredAt });
                }
              }
              if (values.length) {
                const params = [];
                const tuples = values.map((v, i) => {
                  const b = i * 7;
                  params.push(randomUUID(), consumer.id, v.prospectId, v.subscriberId, v.scope, v.reason, v.occurredAt);
                  return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, now(), now())`;
                });
                // RETURNING id: the inserted count is dialect-quirk-proof
                // (sequelize's INSERT metadata is not a pg rowCount). New rows
                // default state='suppressed'; a conflicting LIFTED pair is
                // left alone here and re-suppressed by the flip below.
                const [insertedRows] = await d.sequelize.query(
                  `INSERT INTO suppression_propagations
                     (id, "consumerId", "prospectId", "subscriberId", scope, reason, "occurredAt", "createdAt", "updatedAt")
                   VALUES ${tuples.join(', ')}
                   ON CONFLICT ("subscriberId", "prospectId", scope) DO NOTHING
                   RETURNING id`,
                  { bind: params }
                );
                counts.pairsInserted += insertedRows?.length ?? 0;
              }
            }
          }

          // 2b. Lane flips on EXISTING marketing pairs — set-based, both
          // directions; the 'all' lane is a latch. AUTHORITATIVE: the pass's
          // snapshot only decides WHETHER to attempt a flip; the truth is
          // re-evaluated inside each UPDATE (EXISTS/NOT-EXISTS on the live
          // suppression rows + the ledger watermark), so a stale pass can
          // never overwrite a newer writer (Codex resub-round #3/#4).
          if (marketing) {
            // Re-suppression + watermark maintenance: reason/occurredAt come
            // from the LIVE suppression row INSIDE the statement — a stale
            // pass snapshot must never write an older watermark (Codex R2
            // #1). Targets both lifted pairs AND suppressed pairs whose
            // watermark lags a newer suppression (coalesced transitions);
            // deliveredState=NULL forces redelivery of the fresh watermark.
            // Ties resolve toward suppressed by design.
            const [flipped] = await d.sequelize.query(
              `UPDATE suppression_propagations sp
                  SET state = 'suppressed',
                      reason = (SELECT s.reason FROM consumer_suppressions s
                                 WHERE s."consumerId" = sp."consumerId"
                                   AND s.channel = 'all' AND s.reason <> 'erasure'
                                 ORDER BY s."createdAt" ASC LIMIT 1),
                      "occurredAt" = (SELECT s."createdAt" FROM consumer_suppressions s
                                 WHERE s."consumerId" = sp."consumerId"
                                   AND s.channel = 'all' AND s.reason <> 'erasure'
                                 ORDER BY s."createdAt" ASC LIMIT 1),
                      "deliveredState" = NULL,
                      "updatedAt" = now()
                WHERE sp."consumerId" = :cid AND sp.scope = 'marketing'
                  AND EXISTS (SELECT 1 FROM consumer_suppressions s
                               WHERE s."consumerId" = sp."consumerId"
                                 AND s.channel = 'all' AND s.reason <> 'erasure')
                  AND (sp.state = 'lifted'
                       OR (SELECT s."createdAt" FROM consumer_suppressions s
                            WHERE s."consumerId" = sp."consumerId"
                              AND s.channel = 'all' AND s.reason <> 'erasure'
                            ORDER BY s."createdAt" ASC LIMIT 1) > sp."occurredAt")
                RETURNING id`,
              { replacements: { cid: consumer.id } }
            );
            counts.resuppressed += flipped?.length ?? 0;
          } else if (!erasure && consumer.resubAt) {
            // Lift: statement-time authority — no suppression row may exist,
            // and the QUALIFIED resubscribe evidence must be STRICTLY newer
            // than the pair's current suppressed transition (kills stale-
            // evidence replay after a later unsubscribe's manual removal).
            // The watermark is read from the ledger inside the statement.
            const [flipped] = await d.sequelize.query(
              `UPDATE suppression_propagations sp
                  SET state = 'lifted', reason = 'resubscribe',
                      "occurredAt" = (SELECT MAX(ce."occurredAt") FROM consent_events ce
                                       WHERE ce."consumerId" = sp."consumerId"
                                         AND ce.source = 'resubscribe' AND ce.kind = 'contact'
                                         AND ce.granted = true AND ce.verified = true
                                         AND ce."campaignId" IS NULL),
                      "updatedAt" = now()
                WHERE sp."consumerId" = :cid AND sp.scope = 'marketing' AND sp.state = 'suppressed'
                  AND NOT EXISTS (SELECT 1 FROM consumer_suppressions s
                                   WHERE s."consumerId" = sp."consumerId" AND s.channel = 'all')
                  AND (SELECT MAX(ce."occurredAt") FROM consent_events ce
                        WHERE ce."consumerId" = sp."consumerId"
                          AND ce.source = 'resubscribe' AND ce.kind = 'contact'
                          AND ce.granted = true AND ce.verified = true
                          AND ce."campaignId" IS NULL) > sp."occurredAt"
                  -- The resubscribe must ALSO beat the latest ledger
                  -- WITHDRAWAL — append-only evidence that survives a manual
                  -- suppression-row delete, so coalesced S1→R1→S2 histories
                  -- can never replay old R1 after S2's row vanishes
                  -- (Codex R2 #2).
                  AND (SELECT MAX(ce."occurredAt") FROM consent_events ce
                        WHERE ce."consumerId" = sp."consumerId"
                          AND ce.source = 'resubscribe' AND ce.kind = 'contact'
                          AND ce.granted = true AND ce.verified = true
                          AND ce."campaignId" IS NULL)
                      > COALESCE((SELECT MAX(ce2."occurredAt") FROM consent_events ce2
                                   WHERE ce2."consumerId" = sp."consumerId"
                                     AND ce2.source = 'unsubscribe' AND ce2.kind = 'contact'
                                     AND ce2.granted = false), '-infinity'::timestamptz)
                RETURNING id`,
              { replacements: { cid: consumer.id } }
            );
            counts.lifted += flipped?.length ?? 0;
          }
        } catch (err) {
          // Per-consumer isolation: one bad person/record must not poison the
          // whole pass (Codex #7).
          d.logger.warn('[suppression-propagation] consumer projection failed — continuing pass', {
            consumerId: consumer.id, error: err?.message || String(err),
          });
        }
      }

      // 3. Queue phase — pairs whose deliveredState differs from state
      // (first-time queues AND flips), plus same-state pairs whose delivery
      // terminally failed or was purged (LEFT JOIN null arm, Codex #5).
      if (String(process.env.WEBHOOK_ENABLED || 'false').toLowerCase() !== 'true') {
        d.logger.info('[suppression-propagation] webhooks disabled — pairs projected, queueing deferred', counts);
        return counts;
      }
      const pending = await d.SuppressionPropagation.findAll({
        where: {
          [Op.and]: [
            d.sequelize.literal('"deliveredState" IS DISTINCT FROM state'),
            ...(consumerId ? [{ consumerId }] : []),
          ],
        },
      });
      const [failedRows] = await d.sequelize.query(
        `SELECT sp.id FROM suppression_propagations sp
           LEFT JOIN webhook_deliveries wd ON wd."deliveryId" = sp."deliveryId"
          WHERE sp."queuedAt" IS NOT NULL
            AND sp."deliveredState" IS NOT DISTINCT FROM sp.state
            AND (wd.status = 'failed' OR wd.id IS NULL)
            ${consumerId ? 'AND sp."consumerId" = :consumerId' : ''}`,
        { replacements: consumerId ? { consumerId } : {} }
      );
      const pendingIds = new Set(pending.map((p) => p.id));
      const failedIds = [...new Set(failedRows.map((r) => r.id))].filter((id) => !pendingIds.has(id));
      const work = [
        ...pending.map((p) => ({ pair: p, requeue: false })),
        ...(failedIds.length
          ? (await d.SuppressionPropagation.findAll({ where: { id: { [Op.in]: failedIds } } }))
            .map((p) => ({ pair: p, requeue: true }))
          : []),
      ];

      const outbox = [];
      for (const { pair, requeue } of work) {
        const sub = subscribedById.get(pair.subscriberId);
        if (!sub) continue; // unsubscribed since projection — kill-switch semantics
        // Cheap pre-filter on the (possibly stale) state; the in-txn recheck
        // below is authoritative. A subscriber that handles lead.suppressed
        // but not lead.unsuppressed keeps its lifted pairs unqueued — skipped
        // silently each pass until its allowlist catches up.
        if (!sub.events.includes(EVENT_FOR_STATE[pair.state])) continue;
        const deliveryId = randomUUID();
        try {
          await d.sequelize.transaction(async (t) => {
            // CAS claim on deliveryId (null-safe) — concurrent passes cannot
            // double-queue, and deliveredState snaps to the row's CURRENT
            // state atomically. RETURNING gives the claimed truth; the stale
            // pair object is never used past this point.
            const [claimedRows] = await d.sequelize.query(
              `UPDATE suppression_propagations
                  SET "deliveryId" = :deliveryId, "queuedAt" = now(),
                      "deliveredState" = state, "updatedAt" = now()
                WHERE id = :id AND "deliveryId" IS NOT DISTINCT FROM :prevDeliveryId
                RETURNING state, reason, "occurredAt", scope, "prospectId", "subscriberId"`,
              {
                replacements: { deliveryId, id: pair.id, prevDeliveryId: pair.deliveryId },
                transaction: t,
              }
            );
            if (claimedRows.length !== 1) return; // lost the claim — another pass owns it
            const claimed = claimedRows[0];
            const eventType = EVENT_FOR_STATE[claimed.state];

            // In-txn rechecks (Codex #4): subscription state and — for pure
            // same-state redeliveries — the previous delivery's status may
            // have changed since the pass snapshot. Throwing rolls the claim
            // back so a later pass re-evaluates from fresh state.
            const subNow = await d.WebhookSubscriber.findByPk(pair.subscriberId, { transaction: t });
            if (!subNow?.enabled || !Array.isArray(subNow.events) || !subNow.events.includes(eventType)) {
              throw new Error('recheck: subscription gone');
            }
            if (requeue && pair.deliveryId) {
              const [prevRows] = await d.sequelize.query(
                'SELECT status FROM webhook_deliveries WHERE "deliveryId" = :prev FOR UPDATE',
                { replacements: { prev: pair.deliveryId }, transaction: t }
              );
              if (prevRows.length && prevRows[0].status !== 'failed') {
                throw new Error('recheck: previous delivery revived by manual retry');
              }
            }
            const payload = {
              ...(claimed.state === 'lifted'
                ? d.buildLeadUnsuppressedPayload(claimed.prospectId, {
                  reason: claimed.reason, occurredAt: claimed.occurredAt,
                })
                : d.buildLeadSuppressedPayload(claimed.prospectId, {
                  scope: claimed.scope, reason: claimed.reason, occurredAt: claimed.occurredAt,
                })),
              deliveryId,
            };
            const delivery = await d.WebhookDelivery.create({
              subscriberId: pair.subscriberId, deliveryId, eventType,
              payload, status: 'pending',
            }, { transaction: t });
            outbox.push({ delivery, subscriber: sub });
            if (requeue) counts.requeued += 1; else counts.queued += 1;
          });
        } catch (err) {
          // A rolled-back claim (recheck fired) or a transient txn error skips
          // only THIS pair; the pass continues and a later pass re-evaluates.
          d.logger.info('[suppression-propagation] pair skipped', {
            pairId: pair.id, error: err?.message || String(err),
          });
        }
      }
      if (outbox.length) d.flushDeliveries(outbox);
      if (counts.pairsInserted || counts.lifted || counts.resuppressed || counts.queued || counts.requeued) {
        d.logger.info('[suppression-propagation] reconciled', counts);
      }
      return counts;
    } catch (err) {
      // Never throws — the projection heals on the next pass.
      d.logger.warn('[suppression-propagation] reconcile pass failed (will heal on next pass)', {
        error: err?.message || String(err), consumerId,
      });
      return counts;
    }
  }

  return { reconcileSuppressionPropagation };
}

const _default = makeSuppressionPropagationService();
export const reconcileSuppressionPropagation = _default.reconcileSuppressionPropagation;
