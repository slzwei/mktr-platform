import { RewardOffer } from '../../models/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Consumer WhatsApp delivery for reward credentials (trial-reward PR E,
 * docs/plans/trial-reward-funnel-hardening-prompt.md). Sends the reservation
 * pass at issue and the voucher at unlock as Meta Cloud API UTILITY templates.
 *
 * Ships DARK: REDEEM_OPS_WHATSAPP_ENABLED (default false) gates every send at
 * call time, so wiring these senders in is a no-op until the flag flips. The
 * templates hardcode the redeem.sg /r/ host and carry ONLY the token as the
 * link variable — the /r/ page renders the live QR (pass while locked, voucher
 * once unlocked), so no media header and nothing in the message goes stale
 * semantically after unlock. Fire-and-forget one-shot like the email senders:
 * resolve a normalized { sent, skipped?, to?, error? }, NEVER throw — the
 * entitlement service writes the truthful per-channel receipt.
 *
 * Templates (submitted for Meta approval as UTILITY, lang 'en'):
 *   reward_pass:    "Hi {{1}}, your {{2}} is reserved. Show this pass to your
 *                    consultant when you meet and they'll activate it on the
 *                    spot: redeem.sg/r/{{3}}"
 *   reward_voucher: "Hi {{1}}, your {{2}} is activated. Show the QR on this
 *                    page to redeem: redeem.sg/r/{{3}} It's valid until {{4}}."
 */

// Version aligned with verificationService.js / metaCapiService.js.
const META_GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';

/**
 * DECISION D2 (pending, Shawn): gate automated consumer WhatsApp on the
 * optional signup `consent_contact` tick, or document a transactional-delivery
 * basis (delivering the reward the lead just requested) that covers
 * non-consented rows. Until decided we default to the SAFE side — no consent
 * flag, no automated WhatsApp (staff still have the audited copy-link bridge).
 * Choosing "transactional" = flip this constant to false.
 */
const WA_REQUIRES_CONTACT_CONSENT = true;

export function waEnabled() {
  return String(process.env.REDEEM_OPS_WHATSAPP_ENABLED || '').toLowerCase() === 'true';
}

/**
 * Digits-only Graph API recipient. Prospect phones are stored `+65XXXXXXXX`
 * (prospectHelpers.normalizePhone); bare 8-digit SG mobiles get the country
 * code. Anything under 10 digits can't be an international number → null.
 */
export function waRecipient(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (/^[89]\d{7}$/.test(digits)) return `65${digits}`;
  return digits.length >= 10 ? digits : null;
}

/**
 * Capability + policy gate for automated consumer WhatsApp. Phone gives the
 * capability; the consent arm is the D2 safe default above. Mirrors
 * canEmailProspect's role for the email channel — each channel decides its own
 * deliverability and neither suppresses the other.
 */
export function canWhatsAppProspect(prospect) {
  if (!prospect || !waRecipient(prospect.phone)) return false;
  if (WA_REQUIRES_CONTACT_CONSENT && prospect.sourceMetadata?.consent_contact !== true) return false;
  return true;
}

/** `+6591234567` → `••••4567` — same masking idiom as the ops list payload. */
function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits ? `••••${digits.slice(-4)}` : null;
}

/**
 * Meta rejects body params containing newlines/tabs/4+ spaces; URL-ish person
 * names must never ride a template (same rule as the mktr-leads wa-intro).
 */
function cleanParam(value, fallback) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!s) return fallback;
  if (/https?:|www\.|wa\.me/i.test(s)) return fallback;
  return s;
}

export function makeWhatsappService(overrides = {}) {
  const d = { RewardOffer, logger, fetch: (...args) => fetch(...args), ...overrides };

  async function rewardNameOf(entitlement) {
    try {
      const offer = await d.RewardOffer.findByPk(entitlement.rewardOfferId, {
        attributes: ['id', 'title', 'publicTitle'],
      });
      return offer?.publicTitle || offer?.title || 'your reward';
    } catch {
      return 'your reward';
    }
  }

  /** One template send. Resolves normalized result, never throws. */
  async function sendTemplate({ prospect, templateName, params }) {
    if (!waEnabled()) return { sent: false, skipped: 'disabled' };
    if (!canWhatsAppProspect(prospect)) return { sent: false, skipped: 'no_whatsapp' };

    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) {
      d.logger.error('redeem_ops.whatsapp.not_configured', { template: templateName });
      return { sent: false, to: maskPhone(prospect.phone), error: 'whatsapp not configured' };
    }

    const to = waRecipient(prospect.phone);
    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' },
        components: [
          { type: 'body', parameters: params.map((text) => ({ type: 'text', text })) },
        ],
      },
    };

    try {
      const res = await d.fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const err = await res.json();
          detail = err?.error ? `${err.error.code || res.status}: ${err.error.message || ''}` : detail;
        } catch { /* non-JSON error body — keep the status */ }
        return { sent: false, to: maskPhone(prospect.phone), error: `Meta API: ${detail}` };
      }
      return { sent: true, to: maskPhone(prospect.phone) };
    } catch (err) {
      return { sent: false, to: maskPhone(prospect.phone), error: err?.message || 'send failed' };
    }
  }

  /** Reservation pass at capture (agent_unlock policy). */
  async function sendReservationWhatsApp({ entitlement, prospect, presentationToken }) {
    const rewardName = await rewardNameOf(entitlement);
    return sendTemplate({
      prospect,
      templateName: process.env.WHATSAPP_TEMPLATE_PASS || 'reward_pass',
      params: [
        cleanParam(prospect?.firstName, 'there'),
        cleanParam(rewardName, 'your reward'),
        presentationToken,
      ],
    });
  }

  /** Voucher at unlock. */
  async function sendVoucherWhatsApp({ entitlement, prospect, voucherToken }) {
    const rewardName = await rewardNameOf(entitlement);
    const expiry = entitlement.expiresAt
      ? new Date(entitlement.expiresAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'further notice';
    return sendTemplate({
      prospect,
      templateName: process.env.WHATSAPP_TEMPLATE_VOUCHER || 'reward_voucher',
      params: [
        cleanParam(prospect?.firstName, 'there'),
        cleanParam(rewardName, 'your reward'),
        voucherToken,
        expiry,
      ],
    });
  }

  return { sendReservationWhatsApp, sendVoucherWhatsApp };
}

const _default = makeWhatsappService();
export default _default;
