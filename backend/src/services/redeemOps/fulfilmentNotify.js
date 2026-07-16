import QRCode from 'qrcode';
import { RewardOffer, PartnerOrganisation, Campaign, Activation } from '../../models/index.js';
import { sendEmail } from '../mailer.js';
import { logger } from '../../utils/logger.js';
import { maskEmail } from '../../utils/redactTokens.js';
import { customerHostOrigin, normalizeCustomerHostChoice } from '../../utils/customerHost.js';

/**
 * Consumer voucher delivery on unlock (docs/redeem-ops/MKTR_INTEGRATION.md §2).
 * The email carries the reward in three redundant forms: the voucher QR as a
 * CID-INLINE attachment (renders with remote images blocked; token stays out of
 * image-proxy logs), the short code as text, and the live /r/… link (which now
 * renders the voucher). Fire-and-forget — callers never await delivery for
 * latency, but senders RESOLVE (never throw) with a normalized result
 * `{ sent, skipped?, to?, error? }` so the entitlement service can write
 * truthful delivery receipts.
 */

/**
 * The single definition of "this prospect can receive reward email":
 * an address exists and is not a Retell placeholder. Used by the email
 * sender + receipts + the ops console's emailDeliverable flag. Deliberately
 * email-only — the notify seam itself stays channel-agnostic (PR E WhatsApp
 * must not be suppressed by email logic).
 */
export function canEmailProspect(prospect) {
  return Boolean(prospect?.email) && !/@calls\.mktr\.sg$/i.test(prospect.email);
}

export function makeFulfilmentNotify(overrides = {}) {
  const d = { RewardOffer, PartnerOrganisation, Campaign, Activation, sendEmail, logger, QRCode, ...overrides };

  async function claimOrigin(activation) {
    // Brand the link by the linked campaign's customer host (redeem default)
    let hostChoice = 'redeem';
    if (activation?.campaignId) {
      const campaign = await d.Campaign.findByPk(activation.campaignId, { attributes: ['design_config'] });
      hostChoice = normalizeCustomerHostChoice(campaign?.design_config?.customerHost);
    }
    return { origin: customerHostOrigin(hostChoice), hostChoice };
  }

  /**
   * Campaign-branded absolute /r/ link — the ONE builder for every surface
   * that hands out a claim URL (emails here, the ops copy-link channel in
   * entitlementService). Never duplicate the origin logic.
   */
  async function buildClaimUrl(activation, rawToken) {
    const { origin, hostChoice } = await claimOrigin(activation);
    return { link: `${origin}/r/${rawToken}`, origin, hostChoice };
  }

  async function loadOfferContext(entitlement) {
    const offer = await d.RewardOffer.findByPk(entitlement.rewardOfferId, {
      include: [{ model: d.PartnerOrganisation, as: 'partner', attributes: ['tradingName', 'legalName', 'brandName'] }],
    });
    const activation = await d.Activation.findByPk(entitlement.activationId);
    const rewardName = offer?.publicTitle || offer?.title || 'your reward';
    const partnerName = offer?.partner?.tradingName || offer?.partner?.brandName || offer?.partner?.legalName || 'our partner';
    return { offer, activation, rewardName, partnerName };
  }

  /** Wraps sendEmail into the normalized result — resolves, never throws. */
  async function deliver(mail, to) {
    try {
      const r = await d.sendEmail(mail);
      if (r?.success === true) return { sent: true, to: maskEmail(to) };
      return { sent: false, to: maskEmail(to), error: r?.message || 'mailer not configured' };
    } catch (err) {
      return { sent: false, to: maskEmail(to), error: err?.message || 'send failed' };
    }
  }

  /** Reservation-pass email at capture (agent_unlock policy). */
  async function sendReservationEmail({ entitlement, prospect, presentationToken }) {
    if (!canEmailProspect(prospect)) return { sent: false, skipped: 'no_email' };
    const { activation, rewardName, partnerName } = await loadOfferContext(entitlement);
    const { link, hostChoice } = await buildClaimUrl(activation, presentationToken);

    const qrPng = await d.QRCode.toBuffer(link, { width: 320, margin: 1 });
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 8px">Your ${escapeHtml(rewardName)} is reserved 🎁</h2>
        <p>Hi ${escapeHtml(prospect.firstName || 'there')},</p>
        <p><strong>${escapeHtml(rewardName)}</strong> from <strong>${escapeHtml(partnerName)}</strong> is reserved for you.
        It unlocks after your complimentary financial review — show this pass to your consultant at the meeting.</p>
        <p style="text-align:center;margin:20px 0"><img src="cid:reservation-qr" width="220" height="220" alt="Reservation pass QR"/></p>
        <p style="text-align:center"><a href="${link}" style="color:#2563eb">View your reservation</a></p>
        <p style="color:#6b7280;font-size:12px">This pass is not a voucher yet — it can only be scanned by your consultant.
        Expires ${entitlement.expiresAt ? new Date(entitlement.expiresAt).toLocaleDateString('en-SG') : 'soon'}.</p>
      </div>`;
    return deliver({
      to: prospect.email,
      subject: `Reserved for you: ${rewardName}`,
      html,
      text: `Your ${rewardName} from ${partnerName} is reserved. Show this link's QR to your consultant at your review to unlock it: ${link}`,
      context: hostChoice === 'mktr' ? 'mktr' : 'redeem',
      attachments: [{ filename: 'reservation.png', content: qrPng, cid: 'reservation-qr' }],
    }, prospect.email);
  }

  /** Voucher email at unlock. */
  async function sendVoucherEmail({ entitlement, prospect, voucherToken }) {
    if (!canEmailProspect(prospect)) return { sent: false, skipped: 'no_email' };
    const { activation, rewardName, partnerName } = await loadOfferContext(entitlement);
    const { link, origin, hostChoice } = await buildClaimUrl(activation, voucherToken);
    const shortCode = entitlement.tokenHint || voucherToken.slice(-4).toUpperCase();

    const qrPng = await d.QRCode.toBuffer(voucherToken, { width: 320, margin: 1 });
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 8px">Your ${escapeHtml(rewardName)} is unlocked 🎉</h2>
        <p>Hi ${escapeHtml(prospect.firstName || 'there')},</p>
        <p>Show this voucher at <strong>${escapeHtml(partnerName)}</strong> to redeem
        your <strong>${escapeHtml(rewardName)}</strong>.</p>
        <p style="text-align:center;margin:20px 0"><img src="cid:voucher-qr" width="220" height="220" alt="Voucher QR"/></p>
        <p style="text-align:center;font-size:18px">or quote code <strong>${escapeHtml(shortCode)}</strong></p>
        <p style="text-align:center"><a href="${link}" style="color:#2563eb">View your voucher</a></p>
        <p style="color:#6b7280;font-size:12px">One-time use.
        ${entitlement.expiresAt ? `Valid until ${new Date(entitlement.expiresAt).toLocaleDateString('en-SG')}.` : ''}</p>
      </div>`;
    return deliver({
      to: prospect.email,
      subject: `Your voucher: ${rewardName}`,
      html,
      text: `Your ${rewardName} from ${partnerName} is unlocked! Voucher code: ${shortCode}. View it: ${origin}/r/${voucherToken}`,
      context: hostChoice === 'mktr' ? 'mktr' : 'redeem',
      attachments: [{ filename: 'voucher.png', content: qrPng, cid: 'voucher-qr' }],
    }, prospect.email);
  }

  /**
   * WhatsApp-paste bundle for the ops copy-link channel: the branded link, a
   * ready-to-send message, and a wa.me deep link (null without a phone). The
   * raw phone in waUrl is deliberate — the endpoint is capability-gated +
   * audited, and the staffer is about to see the number in WhatsApp anyway.
   */
  async function buildShareBundle({ entitlement, prospect, kind, rawToken }) {
    const { activation, rewardName, partnerName } = await loadOfferContext(entitlement);
    const { link } = await buildClaimUrl(activation, rawToken);
    const first = prospect?.firstName || 'there';
    const expiry = entitlement.expiresAt
      ? new Date(entitlement.expiresAt).toLocaleDateString('en-SG')
      : null;
    const waMessage = kind === 'voucher'
      ? `Hi ${first}! 🎉 Your ${rewardName} from ${partnerName} is unlocked. Show this voucher to redeem it: ${link}${expiry ? ` (valid until ${expiry})` : ''}`
      : `Hi ${first}! 🎁 Your ${rewardName} from ${partnerName} is reserved. Show this pass to your consultant at your review to unlock it: ${link}${expiry ? ` (expires ${expiry})` : ''}`;
    const digits = String(prospect?.phone || '').replace(/\D/g, '');
    const waUrl = digits.length >= 8 ? `https://wa.me/${digits}?text=${encodeURIComponent(waMessage)}` : null;
    return { link, waMessage, waUrl, waUnavailableReason: waUrl ? null : 'no_phone' };
  }

  return { sendReservationEmail, sendVoucherEmail, buildClaimUrl, buildShareBundle };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const _default = makeFulfilmentNotify();
export default _default;
