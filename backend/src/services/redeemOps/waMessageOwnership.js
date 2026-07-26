import { sequelize } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';

/**
 * Send-time ownership writer (docs/plans/per-campaign-lead-scoring.md §5).
 *
 * ONE function, called by every WhatsApp send path that has a lead. It exists
 * as its own module rather than inline in whatsappService so the screening
 * callback, the reward rails and any future sender share exactly one writer —
 * §5's rule is that ownership is stamped once, at send, by whoever sent it.
 *
 * THE SEND PATHS, enumerated (this is the whole list as of migration 096):
 *
 *   1-4. redeemOps/whatsappService.js `sendTemplate` — the single choke point
 *        for reward_pass / draw_entry_pass (kind 'pass' | 'draw_pass'),
 *        reward_voucher ('voucher'), draw_boost_receipt* ('boost_receipt')
 *        and draw_callback_optin ('screening_callback'). All four senders
 *        funnel through it (whatsappService.js:213), so one call site covers
 *        them; the kind travels down from the sender.
 *
 *   5.   verificationService.js `sendWhatsAppOtpMeta` (:72-121) — the
 *        pre-prospect OTP. DELIBERATELY WRITES NO ROW, for two independent
 *        reasons. (a) There is no lead to own it: the OTP is what gates
 *        capture, so at send time the prospect does not exist yet
 *        (sendVerificationCode takes { phone, countryCode, campaignId } and no
 *        prospect, :167). A row here would have to invent an owner, which is
 *        the derivation §5 exists to forbid. (b) It is a different WhatsApp
 *        sender entirely — META_WA_PHONE_NUMBER_ID / META_WA_ACCESS_TOKEN, a
 *        separate credential pair from the WHATSAPP_* set the reward rails use
 *        (backend/env.example:161-162) — and the status webhook binds to
 *        WHATSAPP_PHONE_NUMBER_ID, skipping any other sender's entries as
 *        unmatchedForeign (waWebhookService.js:137,145-148). So OTP wamids do
 *        not reach wa_message_statuses in the first place and there is nothing
 *        for an ownership row to scope. An unowned wamid never scores, which
 *        is the correct outcome and the one the join gives for free.
 *
 * RESEND. Every send gets a fresh wamid from Meta, so a resend is a NEW row,
 * not an update — `resendCredential` (entitlementService.js:792-806) re-reads
 * the prospect and sends again, and both messages end up separately owned and
 * separately scoreable. The ON CONFLICT DO NOTHING below is therefore not a
 * resend mechanism; it is redelivery insurance, since a wamid is unique and a
 * second insert of the same one can only be a repeat of the same send.
 *
 * FAILED SEND. No wamid, no row. A send that Meta rejects (4xx), that throws,
 * or that is gated off never reaches this writer — the caller only invokes it
 * on a 2xx carrying a message id. A 2xx WITHOUT one ("accepted, untrackable",
 * whatsappService.js:302-310) also writes nothing: there is no key to own. In
 * every one of those cases the message cannot appear in wa_message_statuses
 * under an id we could have owned, so unowned-and-unscored is exact, not lossy.
 *
 * NEVER THROWS. The senders are fire-and-forget and must stay that way
 * (whatsappService.js:26-28). A failure here loses the message's scoreability,
 * never the message — so it is logged loudly and swallowed.
 */

/** The kinds a caller may stamp. Anything else is a programming error. */
export const WA_SEND_KINDS = Object.freeze([
  'pass', 'draw_pass', 'voucher', 'boost_receipt', 'screening_callback',
]);

export function makeWaMessageOwnership(overrides = {}) {
  const d = { sequelize, logger, ...overrides };

  /**
   * Stamp one message's owner. Returns true iff a row was written.
   *
   * @param {object} args
   * @param {string} args.wamid      Meta message id — the join key.
   * @param {object} args.prospect   The lead the message was sent for.
   * @param {string} args.kind       One of WA_SEND_KINDS.
   * @param {Date}   [args.sentAt]
   */
  async function recordWaSend({ wamid, prospect, kind, sentAt = new Date() }) {
    if (!wamid || !prospect?.id) return false;
    if (!WA_SEND_KINDS.includes(kind)) {
      d.logger.warn('redeem_ops.whatsapp.ownership_bad_kind', { kind, wamid });
      return false;
    }
    try {
      // Raw INSERT into a model-backed table ⇒ createdAt/updatedAt are named
      // explicitly. Sequelize's sync() emits them NOT NULL with no database
      // default while the migration declares DEFAULT now(), so omitting them
      // passes in prod and dies in every test (CLAUDE.md, "test schema ≠ prod
      // schema").
      await d.sequelize.query(
        `INSERT INTO wa_message_sends
           (wamid, "prospectId", "campaignId", "consumerId", kind, "sentAt", "createdAt", "updatedAt")
         VALUES (:wamid, :prospectId, :campaignId, :consumerId, :kind, :sentAt, NOW(), NOW())
         ON CONFLICT (wamid) DO NOTHING`,
        {
          replacements: {
            wamid: String(wamid).slice(0, 128),
            prospectId: prospect.id,
            campaignId: prospect.campaignId || null,
            consumerId: prospect.consumerId || null,
            kind,
            sentAt,
          },
        }
      );
      return true;
    } catch (err) {
      // The message went out; only its scoreability is lost.
      d.logger.error('redeem_ops.whatsapp.ownership_write_failed', {
        wamid, prospectId: prospect.id, kind, error: err?.message,
      });
      return false;
    }
  }

  return { recordWaSend };
}

const _default = makeWaMessageOwnership();
export const recordWaSend = _default.recordWaSend;
export default _default;
