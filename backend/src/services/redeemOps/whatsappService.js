import QRCode from 'qrcode';
import { RewardOffer, PartnerOrganisation } from '../../models/index.js';
import { logger } from '../../utils/logger.js';
import { renderQrCardPng } from './qrCardRenderer.js';
import { isSendBlocked } from '../consentService.js';

/**
 * Consumer WhatsApp delivery for reward credentials (trial-reward PR E,
 * docs/plans/trial-reward-funnel-hardening-prompt.md). Sends the reservation
 * pass at issue and the voucher at unlock as Meta Cloud API UTILITY templates.
 *
 * Ships DARK: REDEEM_OPS_WHATSAPP_ENABLED (default false) gates every send at
 * call time, so wiring these senders in is a no-op until the flag flips.
 *
 * Message shape (SG anti-scam posture — people distrust bare links, so the
 * credential leads with a QR IMAGE HEADER, mirroring the voucher email's
 * inline QR): header = per-customer QR uploaded to the Graph media API at
 * send time; body = utility text carrying the redeem.sg/r/ link as the
 * tap-fallback. The pass QR encodes the claim LINK (a human scanning it lands
 * on the branded pass page; the consultant scanner strips the prefix); the
 * voucher QR encodes the RAW token (merchant-scan parity with the email).
 * WHATSAPP_QR_HEADER=false drops the header component for body-only templates
 * — the template shape on Meta and this flag must agree or sends fail.
 *
 * Fire-and-forget one-shot like the email senders: resolve a normalized
 * { sent, skipped?, to?, error? }, NEVER throw — the entitlement service
 * writes the truthful per-channel receipt.
 *
 * Templates (submitted for Meta approval as UTILITY, lang 'en', IMAGE header):
 *   reward_pass:    "Hi {{1}}, your {{2}} is reserved. Show this pass to your
 *                    consultant when you meet and they'll activate it on the
 *                    spot: redeem.sg/r/{{3}} Keep this link handy."
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

/** QR image header on/off — must match the approved templates' shape. */
function qrHeaderEnabled() {
  return String(process.env.WHATSAPP_QR_HEADER ?? 'true').toLowerCase() !== 'false';
}

/** Host baked into the templates' body link — the WA channel standardizes on redeem.sg. */
function claimOrigin() {
  return process.env.WHATSAPP_CLAIM_ORIGIN || 'https://redeem.sg';
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

/** Wordmark on the QR card follows the claim origin (mktr.sg override vs redeem.sg default). */
function cardWordmark() {
  try {
    const host = new URL(claimOrigin()).hostname.toLowerCase();
    if (host === 'mktr.sg' || host.endsWith('.mktr.sg')) return 'MKTR.';
  } catch { /* unparseable origin → default brand */ }
  return 'Redeem.';
}

export function makeWhatsappService(overrides = {}) {
  const d = {
    RewardOffer, logger, QRCode, renderQrCard: renderQrCardPng,
    fetch: (...args) => fetch(...args), ...overrides,
  };

  async function offerContextOf(entitlement) {
    try {
      const offer = await d.RewardOffer.findByPk(entitlement.rewardOfferId, {
        attributes: ['id', 'title', 'publicTitle'],
        include: [{ model: PartnerOrganisation, as: 'partner', attributes: ['tradingName', 'brandName', 'legalName'] }],
      });
      return {
        rewardName: offer?.publicTitle || offer?.title || 'your reward',
        partnerName: offer?.partner?.tradingName || offer?.partner?.brandName || offer?.partner?.legalName || null,
      };
    } catch {
      return { rewardName: 'your reward', partnerName: null };
    }
  }

  /**
   * Upload one PNG to the Graph media API → media id for the header
   * component. Throws on failure — sendTemplate catches and receipts it
   * (an image-header template cannot be sent without its header, so there
   * is deliberately no body-only fallback).
   */
  async function uploadQrPng(phoneId, token, buffer) {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'image/png');
    form.append('file', new Blob([buffer], { type: 'image/png' }), 'reward-qr.png');
    const res = await d.fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        detail = err?.error ? `${err.error.code || res.status}: ${err.error.message || ''}` : detail;
      } catch { /* non-JSON error body — keep the status */ }
      throw new Error(`media upload failed — ${detail}`);
    }
    const json = await res.json();
    if (!json?.id) throw new Error('media upload returned no id');
    return json.id;
  }

  /** One template send. Resolves normalized result, never throws. */
  async function sendTemplate({ prospect, templateName, params, qrContent, card }) {
    if (!waEnabled()) return { sent: false, skipped: 'disabled' };
    if (!canWhatsAppProspect(prospect)) return { sent: false, skipped: 'no_whatsapp' };
    // PR B suppression gate: these sends are TRANSACTIONAL (delivering the
    // reward the person claimed) — only an erasure-reason suppression blocks
    // them; a marketing unsubscribe does not. Future marketing templates must
    // gate on consentService.canMarketTo with purpose:'marketing' instead.
    // isSendBlocked fails OPEN for transactional on lookup errors, so DB-less
    // unit runs are unaffected.
    if (await isSendBlocked(prospect, { channel: 'whatsapp', purpose: 'transactional' })) {
      return { sent: false, skipped: 'suppressed' };
    }

    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) {
      d.logger.error('redeem_ops.whatsapp.not_configured', { template: templateName });
      return { sent: false, to: maskPhone(prospect.phone), error: 'whatsapp not configured' };
    }

    try {
      const components = [
        { type: 'body', parameters: params.map((text) => ({ type: 'text', text })) },
      ];
      if (qrHeaderEnabled() && qrContent) {
        // Editorial voucher card (branded frame around the QR); any renderer
        // failure degrades to the plain QR — the credential always ships.
        let png = null;
        try {
          png = await d.renderQrCard({
            ...card, qrContent,
            customerFirstName: prospect?.firstName,
            wordmark: cardWordmark(),
          });
        } catch (err) {
          d.logger.warn('redeem_ops.whatsapp.qr_card_fallback', { template: templateName, error: err?.message });
        }
        if (!png) png = await d.QRCode.toBuffer(qrContent, { width: 512, margin: 2 });
        const mediaId = await uploadQrPng(phoneId, token, png);
        components.unshift({
          type: 'header',
          parameters: [{ type: 'image', image: { id: mediaId } }],
        });
      }

      const body = {
        messaging_product: 'whatsapp',
        to: waRecipient(prospect.phone),
        type: 'template',
        template: {
          name: templateName,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' },
          components,
        },
      };

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

  /** Reservation pass at capture (agent_unlock policy). QR = the claim link. */
  async function sendReservationWhatsApp({ entitlement, prospect, presentationToken }) {
    const { rewardName, partnerName } = await offerContextOf(entitlement);
    return sendTemplate({
      prospect,
      templateName: process.env.WHATSAPP_TEMPLATE_PASS || 'reward_pass',
      qrContent: `${claimOrigin()}/r/${presentationToken}`,
      card: { state: 'pass', rewardName, partnerName, expiresAt: entitlement.expiresAt },
      params: [
        cleanParam(prospect?.firstName, 'there'),
        cleanParam(rewardName, 'your reward'),
        presentationToken,
      ],
    });
  }

  /** Voucher at unlock. QR = the raw voucher token (merchant-scan parity with the email). */
  async function sendVoucherWhatsApp({ entitlement, prospect, voucherToken }) {
    const { rewardName, partnerName } = await offerContextOf(entitlement);
    const expiry = entitlement.expiresAt
      ? new Date(entitlement.expiresAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'further notice';
    return sendTemplate({
      prospect,
      templateName: process.env.WHATSAPP_TEMPLATE_VOUCHER || 'reward_voucher',
      qrContent: voucherToken,
      card: {
        state: 'voucher', rewardName, partnerName, expiresAt: entitlement.expiresAt,
        shortCode: entitlement.tokenHint || voucherToken.slice(-4).toUpperCase(),
      },
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
