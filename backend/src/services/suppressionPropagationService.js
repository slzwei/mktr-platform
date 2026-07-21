import { randomUUID } from 'crypto';
import { Op } from 'sequelize';
import {
  sequelize, Consumer, Prospect, ConsumerSuppression, WebhookSubscriber,
  WebhookDelivery, SuppressionPropagation,
} from '../models/index.js';
import { logger } from '../utils/logger.js';
import { buildLeadSuppressedPayload } from './prospectHelpers.js';
import { flushDeliveries, historicallyTargetedSubscribers } from './webhookService.js';

/**
 * Suppression propagation (tracker "propagate",
 * docs/plans/suppression-propagation-plan.md + the wire contract in
 * docs/reference/webhook-propagation-contract.md).
 *
 * NOT a fanout — a RECONCILER over a durable projection. The v1 fanout design
 * was rejected by Codex round 1 for being lossy (dark-period suppressions,
 * future leads of an already-suppressed person, capture races, savepoint
 * rollbacks — all permanently silent). Instead:
 *
 *   current state (consumer_suppressions + consumers.erasedAt)
 *     ⨝ the person's prospects
 *     ⨝ delivery history (who was ever TARGETED with the lead's payload)
 *     ⨝ current subscriptions (events includes 'lead.suppressed')
 *   ⇒ suppression_propagations pairs (subscriberId, prospectId, scope)
 *
 * The pass is deterministic and assignment-shaped: safe to run anytime,
 * repeatedly, concurrently (DB unique + ON CONFLICT DO NOTHING; queue claims
 * are CAS updates). Every loss mode heals on the next pass — including the
 * dark→flip backfill: while no subscriber carries the event nothing is
 * created, and the first pass after a bootstrap flag flip projects the entire
 * backlog from state.
 *
 * Scope is monotonic: 'marketing' (unsubscribe/complaint/admin) may later be
 * joined by 'all' (erasure); nothing downgrades — there is no unsuppression
 * event in v1.
 *
 * Erasure-fallback rule: for erasure-scope pairs, subscribers whose events
 * include 'lead.deleted' get NO pair — their signal is the erasure outbox
 * (erasureService) with its dead-letter repair. Subscribers that only handle
 * 'lead.suppressed' get reason:'erasure', scope:'all' so stop-contact ships
 * before their deletion handler exists.
 */

const digitsOf = (v) => String(v || '').replace(/\D/g, '');

const defaultDeps = {
  sequelize, Consumer, Prospect, ConsumerSuppression, WebhookSubscriber,
  WebhookDelivery, SuppressionPropagation,
  logger, buildLeadSuppressedPayload, flushDeliveries, historicallyTargetedSubscribers,
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
    const counts = { consumers: 0, pairsInserted: 0, queued: 0, requeued: 0 };
    try {
      // 1. Suppressed-or-erased consumers with their transition facts.
      // channel='all' rows only: v1 writers never produce channel rows, and a
      // future per-channel suppression (WA STOP) must NOT be promoted to a
      // global scope — that lands with a schemaVersion bump (Codex #3).
      const [targets] = await d.sequelize.query(
        `SELECT c.id, c.phone, c."erasedAt",
                s.reason AS "sReason", s."createdAt" AS "sAt"
           FROM consumers c
           LEFT JOIN consumer_suppressions s
             ON s."consumerId" = c.id AND s.channel = 'all'
          WHERE (s.id IS NOT NULL OR c."erasedAt" IS NOT NULL)
            ${consumerId ? 'AND c.id = :consumerId' : ''}
          ORDER BY c.id, s."createdAt" ASC`,
        { replacements: consumerId ? { consumerId } : {} }
      );
      if (!targets.length) return counts;

      // Group rows per consumer → the scopes this person's pairs need.
      const byConsumer = new Map();
      for (const row of targets) {
        if (!byConsumer.has(row.id)) {
          byConsumer.set(row.id, { id: row.id, phone: row.phone, erasedAt: row.erasedAt, suppressions: [] });
        }
        if (row.sReason) byConsumer.get(row.id).suppressions.push({ reason: row.sReason, at: row.sAt });
      }

      // Array.isArray guard: subscriber CRUD accepts arbitrary JSON for
      // events — a malformed row must not poison the pass (Codex #7).
      const subscribed = (await d.WebhookSubscriber.findAll({ where: { enabled: true } }))
        .filter((s) => Array.isArray(s.events) && s.events.includes('lead.suppressed'));
      if (!subscribed.length) return counts; // dark — pairs appear on the first pass after a flip
      const subscribedById = new Map(subscribed.map((s) => [s.id, s]));

      for (const consumer of byConsumer.values()) {
        try {
        counts.consumers += 1;
        // Scope transitions (monotonic; earliest evidence wins as occurredAt).
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
        if (!transitions.length) continue;

        const pids = await prospectIdsOf(consumer);
        if (!pids.length) continue;
        const targeted = await d.historicallyTargetedSubscribers(pids);

        // Erasure-fallback rule, OUTCOME-based (Codex #2): a lead.deleted
        // handler is skipped only when its lead.deleted delivery row actually
        // EXISTS for that lead — an erasure that ran while webhooks were
        // disabled queued nothing, and the person's stop-contact must not be
        // silently dropped on capability alone. If the deleted row appears
        // later (re-erase repair), both signals having fired is harmless:
        // consumer merge is monotonic.
        let deletedRowSet = new Set();
        const anyErasure = transitions.some((tr) => tr.scope === 'all');
        if (anyErasure) {
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
          for (const tr of transitions) {
            if (
              tr.scope === 'all'
              && sub.events.includes('lead.deleted')
              && deletedRowSet.has(`${subscriberId}:${prospectId}`)
            ) continue;
            values.push({ subscriberId, prospectId, scope: tr.scope, reason: tr.reason, occurredAt: tr.occurredAt });
          }
        }
        if (!values.length) continue;

        // 2. Project missing pairs — the unique index is the idempotency.
        const params = [];
        const tuples = values.map((v, i) => {
          const b = i * 7;
          params.push(randomUUID(), consumer.id, v.prospectId, v.subscriberId, v.scope, v.reason, v.occurredAt);
          return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, now(), now())`;
        });
        // RETURNING id so the inserted count is dialect-quirk-proof
        // (sequelize's INSERT metadata is not a pg rowCount).
        const [insertedRows] = await d.sequelize.query(
          `INSERT INTO suppression_propagations
             (id, "consumerId", "prospectId", "subscriberId", scope, reason, "occurredAt", "createdAt", "updatedAt")
           VALUES ${tuples.join(', ')}
           ON CONFLICT ("subscriberId", "prospectId", scope) DO NOTHING
           RETURNING id`,
          { bind: params }
        );
        counts.pairsInserted += insertedRows?.length ?? 0;
        } catch (err) {
          // Per-consumer isolation: one bad person/record must not poison the
          // whole pass (Codex #7).
          d.logger.warn('[suppression-propagation] consumer projection failed — continuing pass', {
            consumerId: consumer.id, error: err?.message || String(err),
          });
        }
      }

      // 3. Queue phase — pairs without a delivery, plus terminally-failed OR
      // PURGED ones (dead-letter purge deletes failed rows; the LEFT JOIN's
      // null arm catches the dangling pair — Codex #5). Re-queued at most
      // once per pass, only while still subscribed.
      if (String(process.env.WEBHOOK_ENABLED || 'false').toLowerCase() !== 'true') {
        d.logger.info('[suppression-propagation] webhooks disabled — pairs projected, queueing deferred', counts);
        return counts;
      }
      const pending = await d.SuppressionPropagation.findAll({
        where: { queuedAt: null, ...(consumerId ? { consumerId } : {}) },
      });
      const [failedRows] = await d.sequelize.query(
        `SELECT sp.id FROM suppression_propagations sp
           LEFT JOIN webhook_deliveries wd ON wd."deliveryId" = sp."deliveryId"
          WHERE sp."queuedAt" IS NOT NULL
            AND (wd.status = 'failed' OR wd.id IS NULL)
            ${consumerId ? 'AND sp."consumerId" = :consumerId' : ''}`,
        { replacements: consumerId ? { consumerId } : {} }
      );
      const failedIds = new Set(failedRows.map((r) => r.id));
      const work = [
        ...pending.map((p) => ({ pair: p, requeue: false })),
        ...(failedIds.size
          ? (await d.SuppressionPropagation.findAll({ where: { id: { [Op.in]: [...failedIds] } } }))
            .map((p) => ({ pair: p, requeue: true }))
          : []),
      ];

      const outbox = [];
      for (const { pair, requeue } of work) {
        const sub = subscribedById.get(pair.subscriberId);
        if (!sub) continue; // unsubscribed since projection — kill-switch semantics
        const deliveryId = randomUUID();
        try {
        await d.sequelize.transaction(async (t) => {
          // CAS claim so concurrent passes cannot double-queue.
          const [, claimMeta] = await d.sequelize.query(
            `UPDATE suppression_propagations
                SET "deliveryId" = :deliveryId, "queuedAt" = now(), "updatedAt" = now()
              WHERE id = :id AND ${requeue ? '"deliveryId" = :prevDeliveryId' : '"queuedAt" IS NULL'}`,
            {
              replacements: {
                deliveryId, id: pair.id,
                ...(requeue ? { prevDeliveryId: pair.deliveryId } : {}),
              },
              transaction: t,
            }
          );
          if ((claimMeta?.rowCount ?? 0) !== 1) return; // lost the claim — another pass owns it
          // In-txn rechecks (Codex #4): the pass-level subscriber snapshot and
          // failed-set are stale by now — a kill-switch flip or an admin
          // manual retry may have raced this pass. Throwing rolls the claim
          // back so a later pass re-evaluates from fresh state.
          const subNow = await d.WebhookSubscriber.findByPk(pair.subscriberId, { transaction: t });
          if (!subNow?.enabled || !Array.isArray(subNow.events) || !subNow.events.includes('lead.suppressed')) {
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
            ...d.buildLeadSuppressedPayload(pair.prospectId, {
              scope: pair.scope, reason: pair.reason, occurredAt: pair.occurredAt,
            }),
            deliveryId,
          };
          const delivery = await d.WebhookDelivery.create({
            subscriberId: pair.subscriberId, deliveryId, eventType: 'lead.suppressed',
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
      if (counts.pairsInserted || counts.queued || counts.requeued) {
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
