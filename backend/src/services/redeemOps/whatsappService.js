import QRCode from 'qrcode';
import { RewardOffer, PartnerOrganisation } from '../../models/index.js';
import { logger } from '../../utils/logger.js';
import { renderQrCardPng } from './qrCardRenderer.js';
import { isSendBlocked } from '../consentService.js';
import { boostDeadlineLong } from './drawLink.js';
import { recordWaSend } from './waMessageOwnership.js';

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

export function waEnabled() {
  return String(process.env.REDEEM_OPS_WHATSAPP_ENABLED || '').toLowerCase() === 'true';
}

/** QR image header on/off — must match the approved templates' shape. */
function qrHeaderEnabled() {
  return String(process.env.WHATSAPP_QR_HEADER ?? 'true').toLowerCase() !== 'false';
}

/**
 * Boost-receipt bodies that name the draw at {{2}} and the chances count at
 * {{3}} — the older phrasing ("your entry to the {{2}} now holds {{3}} chances",
 * "Campaign: {{2}} / Entry total after this session: ×{{3}}"). Everything since
 * says it the way people say it — "you now have ×10 chances for the iPhone 17
 * Pro Lucky Draw" — so the count comes second and unlisted names get that
 * order, the direction of travel. Verified against the live bodies on
 * 2026-07-27; `draw_boost_receipt_v2` is deliberately NOT here.
 * See sendBoostReceiptWhatsApp for why the order is keyed by name at all.
 */
const BOOST_TEMPLATES_DRAW_NAME_SECOND = new Set([
  'draw_boost_receipt', 'draw_session_receipt',
]);

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
 * Capability + policy gate for automated consumer WhatsApp — ledger-based
 * (3sites); the frozen sourceMetadata.consent_contact read is gone. Phone
 * gives the capability; the consent ledger gives the policy:
 *  - purpose 'transactional' (reservation pass, voucher, resend — every sender
 *    that exists today): DECISION D2 RESOLVED 2026-07-21 — delivering the
 *    credential the person claimed is performance of the service, not
 *    marketing, so only an erasure-reason suppression blocks it. A marketing
 *    unsubscribe/untick does NOT.
 *  - purpose 'marketing' (future templates): full canMarketTo — verified
 *    campaign-scoped grant + no suppression. Callers must pass a prospect
 *    carrying campaignId (projections without it get a structural false).
 * Error posture inherited from isSendBlocked: transactional fails OPEN
 * (DB-less unit runs unaffected), marketing fails CLOSED.
 * Mirrors canEmailProspect's role for the email channel — each channel decides
 * its own deliverability and neither suppresses the other.
 */
export async function canWhatsAppProspect(prospect, { purpose = 'transactional' } = {}) {
  if (!prospect || !waRecipient(prospect.phone)) return false;
  return !(await isSendBlocked(prospect, { channel: 'whatsapp', purpose }));
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeWhatsappService(overrides = {}) {
  const d = {
    RewardOffer, logger, QRCode, renderQrCard: renderQrCardPng,
    fetch: (...args) => fetch(...args), sleep, isSendBlocked, recordWaSend, ...overrides,
  };

  /**
   * Graph API fetch with bounded retry on TRANSIENT failures only — a network
   * throw ("fetch failed": no response received, so the request very likely
   * never reached Meta) or a 5xx. 4xx (template/permission/bad-request) is
   * deterministic and returned as-is for the caller to receipt. This closes
   * the gap that silently lost a voucher WhatsApp on a single connection blip
   * while email went through (prod, 2026-07-20): the send was fire-and-forget
   * with no retry.
   */
  async function graphFetch(url, opts, { label, attempts = 3 } = {}) {
    let lastErr;
    for (let i = 1; i <= attempts; i += 1) {
      try {
        const res = await d.fetch(url, opts);
        if (res.status >= 500 && i < attempts) {
          d.logger.warn('redeem_ops.whatsapp.retry_5xx', { label, status: res.status, attempt: i });
          await d.sleep(300 * i);
          continue;
        }
        return res; // ok or 4xx — caller decides
      } catch (err) {
        lastErr = err;
        if (i < attempts) {
          d.logger.warn('redeem_ops.whatsapp.retry_network', { label, error: err?.message, attempt: i });
          await d.sleep(300 * i);
          continue;
        }
      }
    }
    throw lastErr;
  }

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
    const res = await graphFetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }, { label: 'media_upload' });
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

  /**
   * One template send. Resolves normalized result, never throws.
   *
   * `kind` is this send's OWNERSHIP label (§5 of
   * docs/plans/per-campaign-lead-scoring.md). Every sender below passes one,
   * and a 2xx carrying a wamid stamps `wa_message_sends` before resolving —
   * this is the single choke point all four templates funnel through, which is
   * why one call site here covers every rail. See waMessageOwnership.js for
   * the full send-path inventory and the resend / failed-send contract.
   */
  async function sendTemplate({ prospect, templateName, params, qrContent, card, purpose = 'transactional', urlButtonParam = null, kind = null }) {
    if (!waEnabled()) return { sent: false, skipped: 'disabled' };
    // Capability inline (not via canWhatsAppProspect) so each send costs ONE
    // ledger read and the receipt codes stay distinct: 'no_whatsapp' = phone
    // capability, 'suppressed' = ledger block.
    if (!prospect || !waRecipient(prospect.phone)) return { sent: false, skipped: 'no_whatsapp' };
    // PR B suppression gate. Default purpose is TRANSACTIONAL (delivering the
    // reward the person claimed) — only an erasure-reason suppression blocks
    // it; a marketing unsubscribe does not (D2 resolved — see
    // canWhatsAppProspect). purpose:'marketing' (the screening-callback
    // invite) runs the FULL canMarketTo gate instead — verified
    // campaign-scoped grant + no suppression — and fails CLOSED on lookup
    // errors, while transactional keeps failing OPEN (DB-less unit runs
    // unaffected).
    if (await d.isSendBlocked(prospect, { channel: 'whatsapp', purpose })) {
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
      // Dynamic-suffix URL button (house shape: url 'https://redeem.sg/{{1}}',
      // the param is path + query). Only the CTA (index 0) carries a variable;
      // the STOP quick-reply needs no component.
      if (urlButtonParam) {
        components.push({
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: urlButtonParam }],
        });
      }
      if (qrHeaderEnabled() && (qrContent || card?.state === 'boost')) {
        // Editorial voucher card (branded frame around the QR); any renderer
        // failure degrades to the plain QR — the credential always ships.
        // The boost receipt is the QR-less card state: with no qrContent
        // there is no bare-QR fallback, so a renderer failure is a receipted
        // send failure (an image-header template cannot send headerless).
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
        if (!png && !qrContent) throw new Error('boost card render failed — image-header template needs its header');
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

      const res = await graphFetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, { label: 'message_send' });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const err = await res.json();
          detail = err?.error ? `${err.error.code || res.status}: ${err.error.message || ''}` : detail;
        } catch { /* non-JSON error body — keep the status */ }
        return { sent: false, to: maskPhone(prospect.phone), templateName, error: `Meta API: ${detail}` };
      }
      // The wamid keys the delivery-truth join (wa_message_statuses) — a 2xx
      // without one is still a successful send ("accepted, untrackable"), so
      // the parse must never throw a delivered message into the failed path.
      let messageId = null;
      try {
        const json = await res.json();
        messageId = json?.messages?.[0]?.id || null;
      } catch { /* accepted, untrackable */ }
      if (!messageId) d.logger.warn('redeem_ops.whatsapp.no_wamid', { template: templateName });
      // Ownership BEFORE resolving, so a caller that acts on the result (the
      // screening callback patches its receipt straight after,
      // retellScreeningService.js:521-529) can never observe a sent message
      // whose owner is still unwritten.
      //
      // Its own try/catch, deliberately NOT the enclosing one: the message is
      // already out of the building by this line, and letting a bookkeeping
      // failure fall into the catch below would resolve `sent: false` for a
      // message the recipient has. That mislabels the receipt and invites a
      // duplicate resend — a far worse outcome than an unscoreable read. The
      // real writer swallows its own errors already; this is the fence that
      // holds if a future one doesn't.
      if (messageId && kind) {
        try {
          await d.recordWaSend({ wamid: messageId, prospect, kind });
        } catch (err) {
          d.logger.error('redeem_ops.whatsapp.ownership_threw', {
            template: templateName, wamid: messageId, error: err?.message,
          });
        }
      }
      return {
        sent: true, to: maskPhone(prospect.phone), templateName,
        ...(messageId ? { messageId } : {}),
      };
    } catch (err) {
      return { sent: false, to: maskPhone(prospect.phone), templateName, error: err?.message || 'send failed' };
    }
  }

  /** Reservation pass at capture (agent_unlock policy). QR = the claim link.
   * Draw rails (PR-4, F13): the APPROVED `draw_entry_pass` UTILITY template
   * (id 2818476365205485) — receipt-tone body carrying Shawn's D5 line
   * verbatim; 4 params = name, draw name, full pass link, boost deadline. */
  async function sendReservationWhatsApp({ entitlement, prospect, presentationToken, drawCtx = null }) {
    const { rewardName, partnerName } = await offerContextOf(entitlement);
    const passLink = `${claimOrigin()}/r/${presentationToken}`;
    if (drawCtx) {
      return sendTemplate({
        prospect,
        templateName: process.env.WHATSAPP_TEMPLATE_DRAW_PASS || 'draw_entry_pass',
        kind: 'draw_pass',
        qrContent: passLink,
        card: {
          state: 'pass', rewardName, partnerName, expiresAt: entitlement.expiresAt,
          // Presence of `draw` routes the render to the Vault frame; the prize,
          // draw day and colourway are what make it this campaign's pass rather
          // than a generic one.
          draw: {
            multiplier: drawCtx.multiplier,
            prize: drawCtx.prize,
            drawOn: drawCtx.drawOn,
            passTheme: drawCtx.passTheme,
            boostDeadlineLong: boostDeadlineLong(drawCtx.boostClosesAt),
          },
        },
        params: [
          cleanParam(prospect?.firstName, 'there'),
          cleanParam(drawCtx.drawName, 'the lucky draw'),
          passLink,
          cleanParam(boostDeadlineLong(drawCtx.boostClosesAt), 'the close date'),
        ],
      });
    }
    return sendTemplate({
      prospect,
      templateName: process.env.WHATSAPP_TEMPLATE_PASS || 'reward_pass',
      kind: 'pass',
      qrContent: passLink,
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
      kind: 'voucher',
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

  /** "×N confirmed" receipt at a recorded draw session — the WA twin of
   * sendBoostReceiptEmail, same register as the email body. The
   * `draw_boost_receipt_v2` template carries the Vault 'boost' card as its
   * IMAGE header — the QR-less celebration state (giant ×N; the pass is
   * consumed, nothing left to scan); 3 params = name, multiplier, draw name.
   *
   * THE ORDER IS THE TEMPLATE'S, NOT OURS, so it is keyed by the RESOLVED NAME
   * rather than fixed per deploy. v2 reads "You now have *{{2}} chances* for
   * the {{3}}" — the reverse of the retired MARKETING original ("your entry to
   * the {{2}} now holds {{3}} chances"). Params are positional with no
   * per-template remap, and Meta's approval and the Render env flip are two
   * manual steps that cannot be made simultaneous: binding the order to the
   * name is what keeps every intermediate state correct, instead of whichever
   * half lands first sending "*iPhone 17 Pro Lucky Draw chances* for the 10" —
   * which is exactly what two recipients got on 2026-07-26, when the rewording
   * that won v2 the UTILITY category moved the placeholders and nothing here
   * followed. Re-read the live body (`--all` on the submit script, or Graph
   * `fields=components`) before adding a name; assuming a twin inherited its
   * predecessor's wording is the mistake that caused this. */
  async function sendBoostReceiptWhatsApp({ prospect, drawCtx }) {
    const templateName = process.env.WHATSAPP_TEMPLATE_DRAW_BOOST || 'draw_boost_receipt_v2';
    const drawName = cleanParam(drawCtx?.drawName, 'the lucky draw');
    const multiplier = String(drawCtx?.multiplier || 10);
    return sendTemplate({
      prospect,
      templateName,
      kind: 'boost_receipt',
      card: {
        state: 'boost',
        rewardName: drawName,
        partnerName: 'Lucky draw',
        draw: {
          multiplier: drawCtx?.multiplier,
          prize: drawCtx?.prize,
          drawOn: drawCtx?.drawOn,
          passTheme: drawCtx?.passTheme,
        },
      },
      params: [
        cleanParam(prospect?.firstName, 'there'),
        ...(BOOST_TEMPLATES_DRAW_NAME_SECOND.has(templateName)
          ? [drawName, multiplier]
          : [multiplier, drawName]),
      ],
    });
  }

  /** The screening-callback opt-in (`draw_callback_optin`, APPROVED
   * 2026-07-25) — the WhatsApp leg of the AI screening gate for a lead a dial
   * could not finish. MARKETING purpose (full canMarketTo, fails closed): the
   * message itself is the ask; the URL button's tap is the person's consent to
   * be called. Copy contract: ×N is the TOTAL and the boost lands when the
   * consultant RECORDS the session — the campaign-page register, deliberately
   * NOT the phone script's "N more chances".
   * 4 params = name, draw name, multiplier, prize label ("at {{4}}"). */
  async function sendDrawCallbackOptinWhatsApp({ prospect, drawName, multiplier, prize, token }) {
    const rawPrize = cleanParam(prize, '');
    const prizeLabel = !rawPrize
      ? 'the grand prize'
      : (/^(the|a|an)\s/i.test(rawPrize) ? rawPrize : `the ${rawPrize}`);
    return sendTemplate({
      prospect,
      templateName: process.env.WHATSAPP_TEMPLATE_DRAW_CALLBACK || 'draw_callback_optin',
      kind: 'screening_callback',
      purpose: 'marketing',
      urlButtonParam: `callback?t=${encodeURIComponent(token)}&utm_source=wa_screening`,
      params: [
        cleanParam(prospect?.firstName, 'there'),
        cleanParam(drawName, 'the lucky draw'),
        String(Number.isFinite(Number(multiplier)) && Number(multiplier) >= 2 ? Math.floor(Number(multiplier)) : 10),
        prizeLabel,
      ],
    });
  }

  return { sendReservationWhatsApp, sendVoucherWhatsApp, sendBoostReceiptWhatsApp, sendDrawCallbackOptinWhatsApp };
}

const _default = makeWhatsappService();
export default _default;
export const sendDrawCallbackOptinWhatsApp = _default.sendDrawCallbackOptinWhatsApp;
