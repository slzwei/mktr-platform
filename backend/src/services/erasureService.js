import { randomUUID } from 'crypto';
import { Op, Transaction } from 'sequelize';
import {
  sequelize, Consumer, Prospect, RewardEntitlement, RedemptionEvent,
  ConsentEvent, ConsumerSuppression, WebhookSubscriber, WebhookDelivery,
} from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { emailNormKey } from './repeatSignup.js';
import { makeInventoryService } from './redeemOps/inventoryService.js';
import { makeRedeemOpsAuditService } from './redeemOps/auditService.js';
import { buildLeadDeletedPayload } from './prospectHelpers.js';
import { flushDeliveries, historicallyTargetedSubscribers } from './webhookService.js';
import { reconcileSuppressionPropagation } from './suppressionPropagationService.js';
import { evictVerifiedPhone } from './verifiedPhoneStore.js';
import { evictDncCheckCache } from './dncCheckService.js';

/**
 * PDPA person-level erasure (PR C, docs/plans/consumer-spine-and-consent-ledger.md §4).
 *
 * ERASURE = ALLOWLIST REBUILD, NOT A SCRUB LIST: a prospect row keeps only its
 * non-personal skeleton (ids, campaign, status/priority/score, quarantine,
 * conversionDate, utm source labels) and EVERYTHING else goes — including the
 * copies PII leaked into over its lifetime: activity update-snapshots,
 * commission descriptions, webhook delivery payloads, draw-entry masked-name
 * snapshots, referral-name copies on OTHER people's rows, provider idempotency
 * responses, OTP rows, waitlist rows, session/attribution browsing records.
 *
 * Concurrency contract (§4 lock ordering): the Consumer row is locked FOR
 * UPDATE **first**, and capture takes the same lock first too (the resolver's
 * consumers upsert runs BEFORE Prospect.create — prospectService §capture), so
 * capture-vs-erase serializes cleanly: capture-first → the new prospect is
 * visible to the erasure's enumeration; erasure-first → the capture upsert
 * waits, sees the phone freed at commit (phone nulled ⇒ out of
 * uq_consumers_phone), and mints a NEW consumer. Re-signup after erasure is a
 * new person with fresh consent, by construction — no tombstone (PDPC: an
 * unsalted hash of an enumerable space is pseudonymous, so phoneHash is
 * nulled too).
 *
 * Re-POSTing an erased consumer runs a REPAIR pass (Codex R1 #2): the same
 * scrub over every consumerId-linked row, so PII that leaked back in through a
 * race (a concurrent staff edit, a draw freeze mid-erase) is removable by
 * simply erasing again. Identity-derived arms (phone/email matching) are dead
 * on repair — the identity is already null — which is exactly why writers are
 * also guarded (updateProspect 410s on erased rows).
 *
 * The deliberate exception to the spine's "rebuildable projection" principle:
 * this mutates source rows. The reconciler never resurrects an erased
 * consumer — its groups require prospects.phone IS NOT NULL (all nulled here)
 * and its zeroing branch targets phone IS NOT NULL consumers only.
 *
 * Retained-skeleton stance (Codex R1 #10, decided): business/transaction
 * records (redemptions, commissions, draw audit chain, counters) are kept
 * under PDPA's business-records basis, admin-gated; person FKs stay so the
 * suppression keeps meaning something. What must never remain is CONTENT
 * about the person — and that is what the matrix removes.
 */

/** draw_entries.phoneHash is NOT NULL — erasure writes this obviously-fake sentinel. */
export const ERASED_PHONE_HASH = '0'.repeat(64);

const digitsOf = (v) => String(v || '').replace(/\D/g, '');

const defaultDeps = {
  sequelize, Consumer, Prospect, RewardEntitlement, RedemptionEvent,
  ConsentEvent, ConsumerSuppression, WebhookSubscriber, WebhookDelivery,
  logger, flushDeliveries, historicallyTargetedSubscribers, reconcileSuppressionPropagation,
  evictVerifiedPhone, evictDncCheckCache,
  inventory: makeInventoryService(),
  audit: makeRedeemOpsAuditService(),
};

export function makeErasureService(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };

  /** The sourceMetadata allowlist rebuild: utm source labels + the erased marker. */
  function erasedSourceMetadata(sm) {
    const utmIn = sm && typeof sm === 'object' && sm.utm && typeof sm.utm === 'object' ? sm.utm : null;
    const utm = utmIn
      ? {
          ...(typeof utmIn.utm_source === 'string' && utmIn.utm_source ? { utm_source: utmIn.utm_source } : {}),
          ...(typeof utmIn.utm_medium === 'string' && utmIn.utm_medium ? { utm_medium: utmIn.utm_medium } : {}),
          ...(typeof utmIn.utm_campaign === 'string' && utmIn.utm_campaign ? { utm_campaign: utmIn.utm_campaign } : {}),
        }
      : null;
    return { ...(utm && Object.keys(utm).length ? { utm } : {}), erased: true };
  }

  const rowCount = (meta) => meta?.rowCount ?? 0;

  /**
   * Erase one consumer: one transaction over the full table matrix, then a
   * post-commit flush of the lead.deleted outbox rows + in-memory cache
   * evictions. Idempotent AND self-repairing — a second call (or a
   * crash-after-commit retry) re-runs the scrub over consumer-linked rows
   * without re-doing counters/suppression/ledger.
   *
   * Returns a per-table report so the admin (and the audit trail) can see
   * exactly what was touched — including what could NOT be done (fanout
   * skipped, inventory reversal failures, provider call ids needing external
   * deletion).
   */
  async function eraseConsumer(consumerId, { actorUser = null, reason = null, requestId = null } = {}) {
    const report = {
      consumerId,
      alreadyErased: false,
      repair: false,
      prospects: 0,
      referralCopiesScrubbed: 0,
      activities: 0,
      commissions: 0,
      entitlementsCancelled: 0,
      entitlementsScrubbed: 0,
      inventoryReversalFailures: 0,
      redemptions: 0,
      redemptionEvents: 0,
      inventoryEventReasons: 0,
      auditReasons: 0,
      drawEntries: 0,
      drawAttemptsClosed: 0,
      boostReviewReasons: 0,
      shortLinks: 0,
      sessionVisits: 0,
      attributions: 0,
      webhookDeliveriesScrubbed: 0,
      webhookDeliveriesCancelled: 0,
      leadDeletedQueued: 0,
      webhooksDisabled: false,
      idempotencyKeys: 0,
      verifications: 0,
      waitlistSignups: 0,
      consentSourceUrlsScrubbed: 0,
      retellCallIds: [], // provider-side deletion SOP: delete these calls in Retell
    };
    let outboxPairs = [];
    let erasedPhone = null;

    await d.sequelize.transaction(async (t) => {
      // 1. THE lock — every capture of this phone serializes behind this row.
      const consumer = await d.Consumer.findByPk(consumerId, {
        transaction: t,
        lock: Transaction.LOCK.UPDATE,
      });
      if (!consumer) throw new AppError('Consumer not found', 404);
      report.alreadyErased = Boolean(consumer.erasedAt);
      report.repair = report.alreadyErased;

      const now = new Date();
      const phone = consumer.phone || null;
      erasedPhone = phone;
      const phoneDigits = phone ? digitsOf(phone) : null;

      // 2. Mark erasing BEFORE enumeration (§4) — inside this txn the flag and
      // the scrub commit together; the early write is ordering hygiene.
      if (!consumer.erasedAt) {
        await consumer.update({ erasedAt: now }, { transaction: t });
      }

      // 3. Enumerate + lock the person's prospects:
      //    - by consumer link,
      //    - by DIGITS-normalized phone (raw-format Meta rows, spacing
      //      variants — exact-match would miss them; Codex R1 #1),
      //    - call_bot rows whose sourceMetadata.fromNumber is this person
      //      (inbound calls store MKTR's DDI as `phone`, the CALLER in
      //      fromNumber — the transcript/summary/recording live on that row).
      //    Inbound rows for OTHER callers (DDI phone, different fromNumber)
      //    stay untouched.
      const orArms = [{ consumerId }];
      if (phoneDigits) {
        // phoneDigits is digitsOf() output — \d+ only, safe to inline.
        orArms.push(
          d.sequelize.literal(`regexp_replace(COALESCE("Prospect"."phone", ''), '\\D', '', 'g') = '${phoneDigits}'`),
          d.sequelize.literal(`("Prospect"."leadSource" = 'call_bot' AND regexp_replace(COALESCE("Prospect"."sourceMetadata"->>'fromNumber', ''), '\\D', '', 'g') = '${phoneDigits}')`)
        );
      }
      const prospects = await d.Prospect.findAll({
        where: { [Op.or]: orArms },
        transaction: t,
        lock: Transaction.LOCK.UPDATE,
      });
      const pids = prospects.map((p) => p.id);
      const prospectEmails = prospects.map((p) => emailNormKey(p.email)).filter(Boolean);
      const sessionIds = [...new Set(prospects.map((p) => p.sessionId).filter(Boolean))];
      const attributionIds = [...new Set(prospects.map((p) => p.attributionId).filter(Boolean))];
      report.retellCallIds = [...new Set(prospects
        .map((p) => p.retellCallId || p.sourceMetadata?.retellCallId)
        .filter(Boolean))];

      if (pids.length) {
        // 4. Who was ever TARGETED with this lead's payload (before payloads
        // are scrubbed) — shared helper (tracker "propagate").
        const recipientRows = (await d.historicallyTargetedSubscribers(pids, t))
          .map((r) => ({ id: r.subscriberId, pid: r.prospectId }));

        // 5a. A pending delivery still carrying PII must never fire later.
        // (The in-memory instance a flush already queued is fenced too:
        // attemptDelivery reloads the row and refuses non-pending — PR C.)
        const [, cancelMeta] = await d.sequelize.query(
          `UPDATE webhook_deliveries
              SET status = 'failed', "errorMessage" = 'cancelled: person erased', "updatedAt" = now()
            WHERE status = 'pending'
              AND "eventType" NOT IN ('lead.deleted', 'lead.suppressed')
              AND (payload::jsonb #>> '{data,lead,externalId}') IN (:pids)`,
          { replacements: { pids }, transaction: t }
        );
        report.webhookDeliveriesCancelled = rowCount(cancelMeta);

        // 5b. Scrub every historical payload copy down to its envelope. Runs
        // BEFORE the lead.deleted outbox rows are written; earlier repair-run
        // outbox rows are excluded by event type. lead.suppressed is exempt
        // like lead.deleted: its payload is PII-free by contract, and
        // cancelling/scrubbing it would only make the suppression reconciler
        // re-queue an identical delivery (tracker "propagate").
        const [, scrubMeta] = await d.sequelize.query(
          `UPDATE webhook_deliveries
              SET payload = json_build_object(
                    'event', "eventType",
                    'deliveryId', payload::jsonb ->> 'deliveryId',
                    'erased', true,
                    'data', json_build_object('lead', json_build_object(
                      'externalId', payload::jsonb #>> '{data,lead,externalId}'))),
                  "responseBody" = NULL,
                  "updatedAt" = now()
            WHERE "eventType" NOT IN ('lead.deleted', 'lead.suppressed')
              AND (payload::jsonb #>> '{data,lead,externalId}') IN (:pids)
              AND (payload::jsonb -> 'erased') IS NULL`,
          { replacements: { pids }, transaction: t }
        );
        report.webhookDeliveriesScrubbed = rowCount(scrubMeta);

        // 5c. Referral copies on OTHER people's rows (Codex R1 #8): capture
        // denormalizes the referrer's NAME into each referred prospect's
        // sourceMetadata.referral — and their webhook payloads copied it.
        const [refRows] = await d.sequelize.query(
          `SELECT id, "sourceMetadata" FROM prospects
            WHERE ("sourceMetadata"::jsonb #>> '{referral,referrerProspectId}') IN (:pids)
              AND ("sourceMetadata"::jsonb #> '{referral}') ? 'referrerName'
              FOR UPDATE`,
          { replacements: { pids }, transaction: t }
        );
        for (const r of refRows) {
          const sm = r.sourceMetadata || {};
          const referral = { ...(sm.referral || {}) };
          delete referral.referrerName;
          await d.sequelize.query(
            'UPDATE prospects SET "sourceMetadata" = :sm, "updatedAt" = now() WHERE id = :id',
            { replacements: { sm: JSON.stringify({ ...sm, referral }), id: r.id }, transaction: t }
          );
        }
        report.referralCopiesScrubbed = refRows.length;
        await d.sequelize.query(
          `UPDATE webhook_deliveries
              SET payload = jsonb_set(payload::jsonb, '{data,lead,sourceMetadata,referral,referrerName}', '"[erased]"'::jsonb)::json
            WHERE (payload::jsonb #>> '{data,lead,sourceMetadata,referral,referrerProspectId}') IN (:pids)
              AND (payload::jsonb #> '{data,lead,sourceMetadata,referral}') ? 'referrerName'`,
          { replacements: { pids }, transaction: t }
        );

        // 6. lead.deleted outbox, in-txn (the deleteProspect transactional-
        // outbox pattern) for every enabled subscriber that both received this
        // lead and handles lead.deleted — deduped against earlier runs, so a
        // repair pass only queues what a crash lost. Lyfe's subscriber does
        // NOT handle it (known §4 gap — cross-repo follow-up; manual SOP until
        // then). Webhooks disabled ⇒ surfaced on the report, and a later
        // repair POST re-attempts (best-effort posture, never blocks erasure).
        if (String(process.env.WEBHOOK_ENABLED || 'false').toLowerCase() !== 'true') {
          report.webhooksDisabled = true;
          if (recipientRows.length) {
            d.logger.warn('[erasure] lead.deleted not queued (webhooks disabled) — erase again to re-attempt', {
              consumerId, prospects: pids.length,
            });
          }
        } else if (recipientRows.length) {
          const subIds = [...new Set(recipientRows.map((r) => r.id))];
          const subscribers = await d.WebhookSubscriber.findAll({
            where: { id: { [Op.in]: subIds }, enabled: true },
            transaction: t,
          });
          const handlers = subscribers.filter((s) => (s.events || []).includes('lead.deleted'));
          const receivedBySub = new Map();
          for (const r of recipientRows) {
            if (!receivedBySub.has(r.id)) receivedBySub.set(r.id, new Set());
            receivedBySub.get(r.id).add(r.pid);
          }
          for (const sub of handlers) {
            for (const pid of receivedBySub.get(sub.id) || []) {
              const [dupRows] = await d.sequelize.query(
                `SELECT 1 FROM webhook_deliveries
                  WHERE "subscriberId" = :sid AND "eventType" = 'lead.deleted'
                    AND (payload::jsonb #>> '{data,lead,externalId}') = :pid
                  LIMIT 1`,
                { replacements: { sid: sub.id, pid }, transaction: t }
              );
              if (dupRows.length) continue;
              const deliveryId = randomUUID();
              const payload = { ...buildLeadDeletedPayload({ id: pid }), deliveryId };
              const delivery = await d.WebhookDelivery.create({
                subscriberId: sub.id, deliveryId, eventType: 'lead.deleted', payload, status: 'pending',
              }, { transaction: t });
              outboxPairs.push({ delivery, subscriber: sub });
            }
          }
          report.leadDeletedQueued = outboxPairs.length;
        }

        // 7. Prospect allowlist rebuild. KEPT: id, campaignId, consumerId,
        // leadSource, leadStatus, priority, score, conversionDate, agent/qr
        // refs, quarantine fields, timestamps (business-records basis).
        // Everything else is PII or a PII pointer and goes.
        const [, pMeta] = await d.sequelize.query(
          `UPDATE prospects SET
              "firstName" = 'Erased', "lastName" = NULL, email = NULL, phone = NULL,
              company = NULL, "jobTitle" = NULL, industry = NULL,
              interests = '[]', budget = NULL, location = NULL, demographics = NULL,
              preferences = NULL, notes = NULL, tags = '[]',
              "lastContactDate" = NULL, "nextFollowUpDate" = NULL,
              "sessionId" = NULL, "attributionId" = NULL, "retellCallId" = NULL,
              "dncStatus" = NULL, "dncNoVoiceCall" = NULL, "dncNoTextMessage" = NULL,
              "dncNoFax" = NULL, "dncCheckedAt" = NULL, "dncValidUntil" = NULL,
              "dncMetadata" = NULL,
              "consentMetadata" = '{"erased":true}'::jsonb,
              "consumerId" = :consumerId,
              "updatedAt" = now()
            WHERE id IN (:pids)`,
          { replacements: { pids, consumerId }, transaction: t }
        );
        report.prospects = rowCount(pMeta);

        // sourceMetadata is a json column with heterogeneous shapes — the
        // allowlist is rebuilt in JS per row (a person has a handful of rows).
        for (const p of prospects) {
          await d.sequelize.query(
            'UPDATE prospects SET "sourceMetadata" = :sm WHERE id = :id',
            { replacements: { sm: JSON.stringify(erasedSourceMetadata(p.sourceMetadata)), id: p.id }, transaction: t }
          );
        }

        // The person's browsing records (Codex R1 #9): sessions + attribution
        // rows are deleted outright once no other prospect references them;
        // qr_scans keep only device-level aggregates (no person link left).
        if (sessionIds.length) {
          const [, svMeta] = await d.sequelize.query(
            `DELETE FROM session_visits sv
              WHERE sv."sessionId" IN (:sessionIds)
                AND NOT EXISTS (SELECT 1 FROM prospects p2 WHERE p2."sessionId" = sv."sessionId")`,
            { replacements: { sessionIds }, transaction: t }
          );
          report.sessionVisits = rowCount(svMeta);
        }
        if (attributionIds.length) {
          const [, atMeta] = await d.sequelize.query(
            `DELETE FROM attributions a
              WHERE a.id IN (:attributionIds)
                AND NOT EXISTS (SELECT 1 FROM prospects p2 WHERE p2."attributionId" = a.id)`,
            { replacements: { attributionIds }, transaction: t }
          );
          report.attributions = rowCount(atMeta);
        }

        // Provider idempotency responses persist the prospect link (+ payload
        // echoes) — delete them; replay protection matters less than the
        // person (rows TTL out anyway).
        const [, ikMeta] = await d.sequelize.query(
          `DELETE FROM idempotency_keys
            WHERE ("responseBody"::jsonb ->> 'prospectId') IN (:pids)`,
          { replacements: { pids }, transaction: t }
        );
        report.idempotencyKeys = rowCount(ikMeta);

        // 8. Activity metadata (update snapshots embed full before/after PII).
        // Descriptions reference campaign/staff names only — kept for ops history.
        const [, aMeta] = await d.sequelize.query(
          `UPDATE prospect_activities SET metadata = '{"erased":true}', "updatedAt" = now()
            WHERE "prospectId" IN (:pids)`,
          { replacements: { pids }, transaction: t }
        );
        report.activities = rowCount(aMeta);

        // 9. Commission free text embeds the lead's name ("Lead conversion:
        // First Last"); metadata is operator-supplied JSON — both scrubbed.
        // Financials/status/paymentInfo (the AGENT's payout data) stay.
        const [, cMeta] = await d.sequelize.query(
          `UPDATE commissions SET description = NULL, metadata = '{"erased":true}', "updatedAt" = now()
            WHERE "prospectId" IN (:pids)`,
          { replacements: { pids }, transaction: t }
        );
        report.commissions = rowCount(cMeta);

        // 13. Share links: expire + unlink + strip the ref= param out of the
        // public target (clicks are the VISITORS' data and keep aggregates).
        const [linkRows] = await d.sequelize.query(
          'SELECT id, "targetUrl" FROM short_links WHERE "prospectId" IN (:pids) FOR UPDATE',
          { replacements: { pids }, transaction: t }
        );
        for (const link of linkRows) {
          let target = link.targetUrl;
          try {
            const u = new URL(link.targetUrl);
            u.searchParams.delete('ref');
            target = u.toString();
          } catch { /* keep original on parse failure */ }
          await d.sequelize.query(
            `UPDATE short_links SET "prospectId" = NULL, "targetUrl" = :target,
                    "expiresAt" = now(), "updatedAt" = now()
              WHERE id = :id`,
            { replacements: { target, id: link.id }, transaction: t }
          );
        }
        report.shortLinks = linkRows.length;
      }

      // 10. Entitlements — by prospect, by consumer, and by phoneKey (legacy
      // rows that predate the spine). Live ones cancel WITH the full
      // cancelEntitlement bookkeeping; every row drops phoneKey/tokenHint.
      const entitlements = await d.RewardEntitlement.findAll({
        where: {
          [Op.or]: [
            ...(pids.length ? [{ prospectId: { [Op.in]: pids } }] : []),
            { consumerId },
            ...(phoneDigits ? [{ phoneKey: phoneDigits }] : []),
          ],
        },
        transaction: t,
        lock: Transaction.LOCK.UPDATE,
      });
      const eids = entitlements.map((e) => e.id);
      for (const ent of entitlements) {
        const live = ['eligible', 'issued'].includes(ent.status);
        if (ent.phoneKey !== null || ent.tokenHint !== null || live) {
          await d.RewardEntitlement.update(
            { ...(live ? { status: 'cancelled' } : {}), phoneKey: null, tokenHint: null },
            { where: { id: ent.id }, transaction: t }
          );
        }
        if (live) {
          report.entitlementsCancelled += 1;
          // Counter bookkeeping runs behind a SAVEPOINT: a skewed ledger must
          // never abort a PDPA erasure — but a swallowed failure is SURFACED
          // (report + event metadata), never silent (Codex R1 #4).
          let reversalOk = true;
          try {
            await d.sequelize.transaction({ transaction: t }, async (sp) => {
              await d.inventory.reverseIssued({
                offerId: ent.rewardOfferId, activationId: ent.activationId,
                entitlementId: ent.id, type: 'cancelled', actorType: 'staff',
                reason: 'erasure', transaction: sp,
              });
              await d.sequelize.query(
                `UPDATE activations SET "issuedCount" = "issuedCount" - 1, "updatedAt" = NOW()
                  WHERE id = :id AND "issuedCount" > 0`,
                { replacements: { id: ent.activationId }, transaction: sp }
              );
            });
          } catch (err) {
            reversalOk = false;
            report.inventoryReversalFailures += 1;
            d.logger.error('[erasure] inventory reversal FAILED — counters need manual reconcile', {
              entitlementId: ent.id, error: err?.message || String(err),
            });
          }
          await d.RedemptionEvent.create({
            entitlementId: ent.id, type: 'manual_override', actorType: 'staff',
            actorUserId: actorUser?.id || null,
            metadata: { action: 'erased', ...(reversalOk ? {} : { inventoryReversalFailed: true }) },
          }, { transaction: t });
        } else {
          report.entitlementsScrubbed += 1;
        }
      }

      // 11. Redemption free-text + receipt metadata (masked destinations,
      // reversal reasons, error strings) + inventory/audit operator text
      // (Codex R1 #13). The strip runs AFTER the 'erased' override events
      // above, but those carry only {action} — unaffected.
      if (eids.length) {
        const [, rMeta] = await d.sequelize.query(
          `UPDATE redemptions SET notes = NULL, "updatedAt" = now()
            WHERE "entitlementId" IN (:eids) AND notes IS NOT NULL`,
          { replacements: { eids }, transaction: t }
        );
        report.redemptions = rowCount(rMeta);
        const [, reMeta] = await d.sequelize.query(
          `UPDATE redemption_events
              SET metadata = (metadata - 'to' - 'reason' - 'error')
            WHERE "entitlementId" IN (:eids) AND metadata IS NOT NULL
              AND (metadata ? 'to' OR metadata ? 'reason' OR metadata ? 'error')`,
          { replacements: { eids }, transaction: t }
        );
        report.redemptionEvents = rowCount(reMeta);
        const [, ivMeta] = await d.sequelize.query(
          `UPDATE reward_inventory_events SET reason = NULL
            WHERE "entitlementId" IN (:eids) AND reason IS NOT NULL AND reason <> 'erasure'`,
          { replacements: { eids }, transaction: t }
        );
        report.inventoryEventReasons = rowCount(ivMeta);
        const auditEntityIds = [...eids, ...pids];
        const [, arMeta] = await d.sequelize.query(
          `UPDATE redeem_ops_audit_events SET reason = NULL
            WHERE "entityType" IN ('reward_entitlement', 'redemption', 'prospect')
              AND "entityId" IN (:auditEntityIds) AND reason IS NOT NULL`,
          { replacements: { auditEntityIds }, transaction: t }
        );
        report.auditReasons = rowCount(arMeta);
      }

      // 12. Draw entries (prospect join + phoneHash fallback — draw_entries
      // has no consumerId until tracker "drawlink"): unpickable + snapshot
      // scrubbed. phoneHash is NOT NULL ⇒ the all-zeros sentinel. Boost-review
      // operator text follows the entries.
      const [entryRows] = await d.sequelize.query(
        `SELECT id FROM draw_entries
          WHERE ${pids.length ? '"prospectId" IN (:pids) OR' : ''} "phoneHash" = :ph
          FOR UPDATE`,
        {
          replacements: { ...(pids.length ? { pids } : {}), ph: consumer.phoneHash || '__none__' },
          transaction: t,
        }
      );
      const entryIds = entryRows.map((r) => r.id);
      if (entryIds.length) {
        const [, deMeta] = await d.sequelize.query(
          `UPDATE draw_entries
              SET "prospectId" = NULL, "phoneLast4" = NULL, "displayName" = NULL,
                  "verifiedAtFreeze" = NULL, "phoneHash" = :sentinel
            WHERE id IN (:entryIds)`,
          { replacements: { entryIds, sentinel: ERASED_PHONE_HASH }, transaction: t }
        );
        report.drawEntries = rowCount(deMeta);

        // The erased-pending-winner decision (§4): a pending attempt on this
        // person closes as 'ineligible' — for a sealed/drawn draw the redraw
        // chain stays legal ('ineligible' is an allowed redraw reason). A
        // PUBLISHED draw needs the manual winners-wall SOP on top (no
        // unpublish flow exists). Claimed attempts stay claimed: the prize
        // was handed over and attempt rows hold no PII.
        const [, daMeta] = await d.sequelize.query(
          `UPDATE draw_attempts SET outcome = 'ineligible', "updatedAt" = now()
            WHERE "pickedEntryId" IN (:entryIds) AND outcome = 'pending'`,
          { replacements: { entryIds }, transaction: t }
        );
        report.drawAttemptsClosed = rowCount(daMeta);
      }
      {
        const dbrArms = [];
        const dbrRepl = {};
        if (pids.length) { dbrArms.push('"prospectId" IN (:pids)'); dbrRepl.pids = pids; }
        if (eids.length) { dbrArms.push('"entitlementId" IN (:eids)'); dbrRepl.eids = eids; }
        if (dbrArms.length) {
          const [, dbrMeta] = await d.sequelize.query(
            `UPDATE draw_boost_reviews SET reason = NULL, "updatedAt" = now()
              WHERE (${dbrArms.join(' OR ')}) AND reason IS NOT NULL`,
            { replacements: dbrRepl, transaction: t }
          );
          report.boostReviewReasons = rowCount(dbrMeta);
        }
      }

      // 14. OTP verification rows are keyed by the E.164 phone and hold codes.
      if (phone) {
        const [, vMeta] = await d.sequelize.query(
          'DELETE FROM verifications WHERE phone IN (:variants)',
          { replacements: { variants: [phone, phoneDigits] }, transaction: t }
        );
        report.verifications = rowCount(vMeta);
      }

      // 15. Waitlist rows are pure PII (email/name/phone/ip/ua) — deleted, not
      // husked. Matched on the person's known emails + phone digits.
      const emails = [...new Set([emailNormKey(consumer.email), ...prospectEmails].filter(Boolean))];
      if (emails.length || phoneDigits) {
        const [, wMeta] = await d.sequelize.query(
          `DELETE FROM waitlist_signups
            WHERE ${emails.length ? 'lower(trim(email)) IN (:emails)' : 'false'}
               OR ${phoneDigits ? "regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = :digits" : 'false'}`,
          { replacements: { ...(emails.length ? { emails } : {}), ...(phoneDigits ? { digits: phoneDigits } : {}) }, transaction: t }
        );
        report.waitlistSignups = rowCount(wMeta);
      }

      // 16. The person's consent-evidence rows keep their semantic core
      // (kind/granted/version/verified/when) but drop the page-URL locator
      // (Codex R1 #11) — the explicit append-only exception, like erasure
      // itself.
      const [, csMeta] = await d.sequelize.query(
        `UPDATE consent_events SET "sourceUrl" = NULL
          WHERE "consumerId" = :consumerId AND "sourceUrl" IS NOT NULL`,
        { replacements: { consumerId }, transaction: t }
      );
      report.consentSourceUrlsScrubbed = rowCount(csMeta);

      // 17. The consumer itself: identity + attributes + unsub token all null.
      // phone leaving uq_consumers_phone at commit is what frees the number
      // for a genuinely-new signup.
      if (!report.repair) {
        await consumer.update({
          phone: null, phoneHash: null, firstName: null, lastName: null,
          email: null, unsubTokenHash: null,
        }, { transaction: t });
      }

      // 18. Suppression: reason 'erasure' blocks EVERYTHING including
      // transactional (consentService semantics). An existing weaker row
      // (e.g. a prior unsubscribe) is UPGRADED — findOrCreate alone would
      // leave 'unsubscribe' in place and transactional sends flowing.
      const [suppression, created] = await d.ConsumerSuppression.findOrCreate({
        where: { consumerId, channel: 'all' },
        defaults: {
          id: randomUUID(), reason: 'erasure',
          source: 'erasure_endpoint', actorUserId: actorUser?.id || null,
        },
        transaction: t,
      });
      if (!created && suppression.reason !== 'erasure') {
        await suppression.update(
          { reason: 'erasure', source: 'erasure_endpoint', actorUserId: actorUser?.id || null },
          { transaction: t }
        );
      }

      // 19. Ledger evidence: one explicit GLOBAL denial, source 'erasure'.
      // The free-text reason stays in the ACCESS-CONTROLLED audit row only —
      // never in the ledger (Codex R1 #11).
      const priorErasureEvent = await d.ConsentEvent.findOne({
        where: { consumerId, source: 'erasure' }, transaction: t,
      });
      if (!priorErasureEvent) {
        await d.ConsentEvent.create({
          id: randomUUID(), consumerId, prospectId: null, campaignId: null,
          kind: 'contact', granted: false, channels: null,
          version: 'erasure-v1', source: 'erasure', sourceUrl: null,
          verified: false, actorUserId: actorUser?.id || null,
          metadata: null, occurredAt: now,
        }, { transaction: t });
      }

      // 20. Audit trail (admin action on a person). Repair runs get their own
      // action label so the trail shows the retry.
      await d.audit.recordAuditEvent({
        actorUser, action: report.repair ? 'consumer.erased_repair' : 'consumer.erased',
        entityType: 'consumer', entityId: consumerId, reason, requestId,
        after: {
          prospects: report.prospects,
          entitlementsCancelled: report.entitlementsCancelled,
          leadDeletedQueued: report.leadDeletedQueued,
          inventoryReversalFailures: report.inventoryReversalFailures,
        },
        transaction: t,
      });
    });

    // Post-commit: fire the persisted lead.deleted outbox rows + evict the
    // in-memory phone caches (OTP-verified marker, DNC result cache), then
    // trigger the suppression reconciler — subscribers that handle
    // lead.suppressed but not lead.deleted learn "stop contact" this way
    // (fallback rule, tracker "propagate"). Fire-and-forget: the periodic
    // pass heals a lost trigger.
    d.flushDeliveries(outboxPairs);
    Promise.resolve(d.reconcileSuppressionPropagation({ consumerId })).catch((err) => {
      d.logger.warn('[erasure] suppression propagation trigger failed (periodic pass heals)', {
        consumerId, error: err?.message || String(err),
      });
    });
    if (erasedPhone) {
      try {
        d.evictVerifiedPhone(erasedPhone);
        d.evictDncCheckCache(erasedPhone);
      } catch (err) {
        d.logger.warn('[erasure] cache eviction failed', { error: err?.message || String(err) });
      }
    }
    d.logger.info('[erasure] consumer erased', { consumerId, ...report, retellCallIds: report.retellCallIds.length });
    return report;
  }

  return { eraseConsumer };
}

const _default = makeErasureService();
export const eraseConsumer = _default.eraseConsumer;
