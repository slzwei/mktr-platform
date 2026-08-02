/**
 * Reward DELIVERY — the email + WhatsApp fan-out and its receipts (P3-2).
 *
 * Lifted out of entitlementService, which had grown to ~1,400 lines by holding
 * the state machine, the delivery fan-out, three reconciliation sweeps and the
 * list projection in one factory. This is the fan-out.
 *
 * The rule that holds it together: email and WhatsApp are INDEPENDENT legs.
 * Neither can block or fail the other, each writes its own channel-tagged
 * receipt, and the boolean return means "a fresh EMAIL attempt was scheduled"
 * — WhatsApp never affects it. Behaviour is unchanged.
 */
import { canEmailProspect } from './fulfilmentNotify.js';

/**
 * kind → the notify deps that send it. EXHAUSTIVE on purpose: the old
 * inline ternaries ended in `: d.notifyReservation`, so any kind the engine
 * did not recognise was silently delivered as a reservation pass. An unknown
 * kind now sends NOTHING and logs — a wrong email to a real customer is worse
 * than a missing one, and the reconciler/Resend exist to recover a gap.
 */
const KIND_SENDERS = {
  pass: { email: 'notifyReservation', wa: 'notifyReservationWa' },
  voucher: { email: 'notifyUnlock', wa: 'notifyUnlockWa' },
  boost_receipt: { email: 'notifyBoostReceipt', wa: 'notifyBoostReceiptWa' },
  handover_receipt: { email: 'notifyHandover', wa: 'notifyHandoverWa' },
};

// In-flight fire-and-forget deliveries (all service instances share this).
// flushDeliveries() lets tests — and anything else that needs a barrier —
// await every queued email + receipt write deterministically.
const pendingDeliveries = new Set();

/** Await every in-flight delivery. Re-exported from entitlementService. */
export async function flushDeliveries() {
  while (pendingDeliveries.size > 0) {
    await Promise.allSettled([...pendingDeliveries]);
  }
}

/**
 * @param {object} args
 * @param {object} args.d The entitlement service's dependency object.
 * @returns {{ queueDelivery: Function, writeDeliveryReceipt: Function }}
 */
export function makeEntitlementDelivery({ d }) {
  /**
   * Post-commit, fire-and-forget delivery + truthful per-channel receipts.
   * Email and WhatsApp (PR E) are INDEPENDENT legs — one failing/skipping can
   * never block or fail the other, and each writes its own receipt tagged with
   * its channel. The boolean return keeps PR A's contract: "a fresh EMAIL
   * attempt was scheduled" (the `emailQueued` the routes surface) — WhatsApp
   * never affects it. The WhatsApp sender self-guards flag/consent/phone via
   * `skipped` results (no receipt on a skip: nothing was attempted), so a
   * no-email Retell lead still gets its WhatsApp leg — the email guard below
   * deliberately gates only the email leg.
   *
   * `channels` selects which legs to fire; it defaults to BOTH so capture,
   * unlock and the sweep are unchanged. The ops Resend passes a specific set
   * (email / whatsapp / both) so staff can re-send on exactly the channel(s)
   * they chose — one token rotation, the same fresh credential on each leg.
   */
  function queueDelivery({
    entitlement, prospect, kind, presentationToken = null, voucherToken = null,
    drawCtx = null,
    channels = ['whatsapp', 'email'],
  }) {
    if (!KIND_SENDERS[kind]) {
      d.logger.error('redeem_ops.delivery.unknown_kind', { entitlementId: entitlement?.id, kind });
      return false;
    }
    const args = kind === 'voucher'
      ? { entitlement, voucherToken }
      : kind === 'boost_receipt'
        ? { entitlement, drawCtx }
        : kind === 'handover_receipt'
          ? { entitlement }
          : { entitlement, presentationToken, drawCtx };
    const fire = (fn, channel) => {
      const delivery = Promise.resolve()
        .then(async () => {
          // PR C erasure stop: these sends are queued with a point-in-time
          // prospect object, and an erasure can land between the queue and the
          // fire. Reload the row and re-check right before sending — an erased
          // person's voucher/pass must never leave the building. Post-erasure
          // the reloaded row also has null email/phone, so the sender's own
          // guards skip too (defence in depth). isSendBlocked fails OPEN for
          // transactional purpose: a consent-infra hiccup never strands a
          // legitimate voucher. Only persisted prospects are re-checked — an
          // id-less object has no row to reload (and no erasure to observe).
          let target = prospect;
          if (prospect?.id) {
            const fresh = await d.Prospect.findByPk(prospect.id);
            if (fresh) target = fresh;
            if (await d.isSendBlocked(target, { channel, purpose: 'transactional' })) {
              d.logger.info('redeem_ops.delivery.blocked', {
                entitlementId: entitlement.id, channel, reason: 'suppressed_or_erased',
              });
              return { skipped: 'suppressed' };
            }
          }
          return fn({ ...args, prospect: target });
        })
        .then((r) => {
          if (r?.skipped) return null;
          return writeDeliveryReceipt(entitlement.id, kind, r || { sent: false, error: 'no sender result' }, channel);
        })
        .catch((err) => writeDeliveryReceipt(entitlement.id, kind, { sent: false, error: err?.message }, channel));
      pendingDeliveries.add(delivery);
      delivery.finally(() => pendingDeliveries.delete(delivery));
    };

    if (channels.includes('whatsapp')) {
      const waFn = d[KIND_SENDERS[kind].wa];
      if (typeof waFn === 'function') fire(waFn, 'whatsapp');
    }

    if (!channels.includes('email')) return false;
    const fn = d[KIND_SENDERS[kind].email];
    if (typeof fn !== 'function' || !canEmailProspect(prospect)) return false;
    fire(fn, 'email');
    return true;
  }

  async function writeDeliveryReceipt(entitlementId, kind, r, channel = 'email') {
    try {
      await d.RedemptionEvent.create({
        entitlementId,
        type: r.sent ? 'notified' : 'notify_failed',
        actorType: 'system',
        metadata: {
          kind,
          channel,
          to: r.to || null, // already masked by the sender
          // Provider correlation ids (docs/plans/wa-delivery-truth.md):
          // messageId (wamid) keys the wa_message_statuses read-time join;
          // providerMessageId is the SMTP/SES id for the future SES-events
          // leg. Both are scrubbed by PDPA erasure.
          ...(r.messageId ? { messageId: r.messageId } : {}),
          ...(r.templateName ? { templateName: r.templateName } : {}),
          ...(r.providerMessageId ? { providerMessageId: r.providerMessageId, provider: r.provider || null } : {}),
          ...(r.error ? { error: String(r.error).slice(0, 200) } : {}),
        },
      });
    } catch (err) {
      d.logger.error('redeem_ops.delivery.receipt_failed', { entitlementId, channel, error: err?.message });
    }
  }

  return { queueDelivery, writeDeliveryReceipt };
}
