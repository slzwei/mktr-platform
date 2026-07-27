import crypto from 'crypto';
import { sequelize } from '../../database/connection.js';
import Consumer from '../../models/Consumer.js';
import { applyUnsubscribe } from '../consentService.js';
import { phoneHashOf } from '../consumerService.js';
import { normalizePhone } from '../prospectHelpers.js';
import { markLeadDirtyByWamidTx } from '../leadScoreDirty.js';
import { rescoreLeadSoon } from '../leadScoringService.js';
import { logger } from '../../utils/logger.js';

/**
 * Meta WhatsApp webhook processing (docs/plans/wa-delivery-truth.md §B).
 *
 * Two payload species, both handled here:
 *  - `statuses[]` — per-message delivery outcomes (sent/delivered/read/failed,
 *    including the silent 131049 marketing-frequency-cap drop that motivated
 *    this file). Each lands as a rank-guarded atomic upsert into the
 *    wa_message_statuses inbox; readers join it by wamid. The upsert must
 *    COMMIT before the route answers 200 — Meta's retry is our durability, so
 *    a persistence failure must surface as a 5xx, never be swallowed.
 *  - `messages[]` — inbound customer messages. The only ones acted on are the
 *    marketing-pack STOP forms ("Stop promotions" quick-reply or typed
 *    stop/unsubscribe/cancel), which map to the existing GLOBAL unsubscribe
 *    (channel 'all' + reason 'unsubscribe', source 'wa_stop') — deliberately
 *    NOT a new suppression channel: the model has no per-channel reason and
 *    the existing resubscribe path must be able to lift it.
 *    applyUnsubscribe is idempotent, so Meta redelivery is harmless.
 *
 * Payloads are bound to OUR assets: when WHATSAPP_WABA_ID /
 * WHATSAPP_PHONE_NUMBER_ID are set, entries for any other WABA or sender
 * number are skipped (a valid signature alone doesn't prove the callback is
 * about our sender). Statuses with unknown wamids are logged and kept — a
 * status can legitimately beat its receipt's commit; the read-time join
 * resolves whenever the receipt lands.
 */

// Rank order is Meta's own lifecycle; failed is terminal and outranks read so
// a post-hoc failure verdict always wins the row.
const STATUS_RANK_SQL = `CASE %s WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END`;
const KNOWN_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);
const STOP_FORMS = new Set(['stop', 'stop promotions', 'unsubscribe', 'cancel']);
// Bound per-request work: Meta batches are small in practice; anything larger
// than this is hostile or malformed and the tail is dropped (logged).
const MAX_ITEMS = 200;

/**
 * Default lead-score reaction to a status. Dirty the owning lead (durable),
 * then attempt an immediate rescore (best effort). Returns how many leads were
 * dirtied so the caller can count them. Swallows its own errors: losing a
 * rescore costs freshness, losing the status costs delivery truth, and only
 * one of those is this webhook's job.
 */
async function defaultOnMessageRead(wamid, status) {
  if (status !== 'read' || !wamid) return 0;
  try {
    const ids = await sequelize.transaction((t) => markLeadDirtyByWamidTx(t, wamid));
    for (const id of ids) rescoreLeadSoon(id);
    return ids.length;
  } catch (err) {
    logger.warn('redeem_ops.wa.read_invalidation_failed', { wamid, error: err?.message });
    return 0;
  }
}

export function makeWaWebhookService(overrides = {}) {
  const d = {
    sequelize,
    Consumer,
    applyUnsubscribe,
    phoneHashOf,
    normalizePhone,
    onMessageRead: defaultOnMessageRead,
    logger,
    ...overrides,
  };

  /** HMAC-SHA256 of the RAW body against X-Hub-Signature-256. */
  function verifySignature(rawBody, header, secret) {
    if (!secret) return false;
    if (!rawBody || !header || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
    const theirs = Buffer.from(header.slice('sha256='.length), 'utf8');
    const ours = Buffer.from(
      crypto.createHmac('sha256', secret).update(rawBody).digest('hex'),
      'utf8'
    );
    return theirs.length === ours.length && crypto.timingSafeEqual(theirs, ours);
  }

  /**
   * Atomic, rank-guarded upsert. One SQL statement so concurrent callbacks
   * (multi-instance deploys, Meta redelivery, out-of-order sent-after-read)
   * can never lose or downgrade state. errorCode/errorTitle stick once set —
   * a later non-failed transition must not blank the recorded failure detail.
   */
  async function upsertStatus({ wamid, status, errorCode = null, errorTitle = null, recipientHash = null, occurredAt = null }) {
    if (!wamid || !KNOWN_STATUSES.has(status)) return false;
    await d.sequelize.query(
      `INSERT INTO wa_message_statuses
         (wamid, status, "errorCode", "errorTitle", "recipientHash", "occurredAt", "createdAt", "updatedAt")
       VALUES (:wamid, :status, :errorCode, :errorTitle, :recipientHash, :occurredAt, NOW(), NOW())
       ON CONFLICT (wamid) DO UPDATE SET
         status = EXCLUDED.status,
         "errorCode" = COALESCE(EXCLUDED."errorCode", wa_message_statuses."errorCode"),
         "errorTitle" = COALESCE(EXCLUDED."errorTitle", wa_message_statuses."errorTitle"),
         "recipientHash" = COALESCE(EXCLUDED."recipientHash", wa_message_statuses."recipientHash"),
         "occurredAt" = COALESCE(EXCLUDED."occurredAt", wa_message_statuses."occurredAt"),
         "updatedAt" = NOW()
       WHERE ${STATUS_RANK_SQL.replace('%s', 'EXCLUDED.status')}
           > ${STATUS_RANK_SQL.replace('%s', 'wa_message_statuses.status')}`,
      {
        replacements: {
          wamid: String(wamid).slice(0, 128),
          status,
          errorCode: errorCode != null ? String(errorCode).slice(0, 16) : null,
          errorTitle: errorTitle != null ? String(errorTitle).slice(0, 200) : null,
          recipientHash,
          occurredAt,
        },
      }
    );
    return true;
  }

  /** The STOP text of an inbound message, or null. Quick-reply buttons carry
   * their label in button.text (payload mirrors it); typed messages in
   * text.body. */
  function stopTextOf(message) {
    const candidates = [message?.button?.text, message?.button?.payload, message?.text?.body];
    for (const c of candidates) {
      if (typeof c === 'string' && STOP_FORMS.has(c.trim().toLowerCase())) return c.trim();
    }
    return null;
  }

  async function handleStop(message) {
    const waId = message?.from;
    if (!waId || !/^\d{7,15}$/.test(String(waId))) return { handled: false, reason: 'bad_sender' };
    const phone = d.normalizePhone(String(waId));
    const consumer = await d.Consumer.findOne({ where: { phone } });
    if (!consumer) {
      d.logger.info('redeem_ops.wa.stop_unknown_phone', { phoneHash: d.phoneHashOf(phone) });
      return { handled: false, reason: 'unknown_phone' };
    }
    const { alreadySuppressed } = await d.applyUnsubscribe(consumer, { source: 'wa_stop' });
    d.logger.info('redeem_ops.wa.stop_applied', { consumerId: consumer.id, alreadySuppressed });
    return { handled: true, alreadySuppressed };
  }

  /**
   * Process a verified webhook body. Throws on persistence failure — the
   * route maps that to 5xx so Meta retries; a thrown error after SOME items
   * persisted is safe because every write here is idempotent.
   */
  async function processPayload(body) {
    const counts = { statuses: 0, stops: 0, skippedEntries: 0, unmatchedForeign: 0, leadsDirtied: 0 };
    if (body?.object !== 'whatsapp_business_account' || !Array.isArray(body?.entry)) return counts;

    const wantWaba = process.env.WHATSAPP_WABA_ID || null;
    const wantPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || null;
    let budget = MAX_ITEMS;

    for (const entry of body.entry.slice(0, 50)) {
      if (wantWaba && String(entry?.id) !== String(wantWaba)) {
        counts.unmatchedForeign += 1;
        continue;
      }
      for (const change of (Array.isArray(entry?.changes) ? entry.changes : [])) {
        if (change?.field !== 'messages') continue;
        const value = change?.value || {};
        if (wantPhoneId && value?.metadata?.phone_number_id
            && String(value.metadata.phone_number_id) !== String(wantPhoneId)) {
          counts.unmatchedForeign += 1;
          continue;
        }

        for (const s of (Array.isArray(value.statuses) ? value.statuses : [])) {
          if (budget-- <= 0) { counts.skippedEntries += 1; continue; }
          const err = Array.isArray(s?.errors) ? s.errors[0] : null;
          const ok = await upsertStatus({
            wamid: s?.id,
            status: s?.status,
            errorCode: err?.code != null ? String(err.code) : null,
            errorTitle: err?.title || err?.message || null,
            recipientHash: s?.recipient_id ? d.phoneHashOf(d.normalizePhone(String(s.recipient_id))) : null,
            occurredAt: s?.timestamp ? new Date(Number(s.timestamp) * 1000) : null,
          });
          if (ok) {
            counts.statuses += 1;
            d.logger.info('redeem_ops.wa.delivery_status', {
              wamid: s?.id, status: s?.status,
              ...(err ? { errorCode: err.code, errorTitle: err.title || err.message } : {}),
            });
            // A read is a RESPONSE to the lead that owns this message
            // (per-campaign-lead-scoring.md §3.2/§10). Dirty that lead and
            // fire a post-commit rescore, so the score moves within seconds
            // rather than waiting for the nightly rotation. Only 'read':
            // sent/delivered feed the person's capability frontier, which the
            // scorer reads live and needs no invalidation. Never fatal — the
            // webhook's job is to persist the status, and Meta's retry is our
            // durability for THAT.
            counts.leadsDirtied += await d.onMessageRead(s?.id, s?.status);
          }
        }

        for (const m of (Array.isArray(value.messages) ? value.messages : [])) {
          if (budget-- <= 0) { counts.skippedEntries += 1; continue; }
          if (!stopTextOf(m)) continue;
          const r = await handleStop(m);
          if (r.handled) counts.stops += 1;
        }
      }
    }
    return counts;
  }

  return { verifySignature, upsertStatus, processPayload, stopTextOf };
}

const _default = makeWaWebhookService();
export const verifySignature = _default.verifySignature;
export const processPayload = _default.processPayload;
export default _default;
