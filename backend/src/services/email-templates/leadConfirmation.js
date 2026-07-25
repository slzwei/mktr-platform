import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { emailPalette } from '../../utils/drawTheme.js';
import { shortDate } from '../../utils/sgtTime.js';

/**
 * Lead-capture confirmation email: the designer's production, table-based HTML.
 * Read once at boot from the co-located copies so they ship with the backend
 * regardless of the deploy root. Do NOT reformat or sanitize them; the inline
 * styles and MSO conditional comments are deliberate email-client requirements.
 *
 * Two pairs:
 *  - confirmation-email.*      trial rewards — cream "Editorial" frame
 *  - confirmation-email-draw.* lucky draws — dark "Onyx" frame, the inbox twin
 *    of the Vault WhatsApp pass, recoloured per campaign from the SAME
 *    `luckyDraw.passTheme` enum (utils/drawTheme.js). The palette arrives as
 *    `c_*` merge fields rather than four near-identical template files.
 *
 * This module is deliberately IO-free apart from those boot reads — no models,
 * no DB — so the render is unit-testable and previewable
 * (scripts/preview-draw-email.js) without standing anything up.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIRMATION_EMAIL_HTML = readFileSync(join(__dirname, 'confirmation-email.html'), 'utf8');
const CONFIRMATION_EMAIL_TXT = readFileSync(join(__dirname, 'confirmation-email.txt'), 'utf8');
const CONFIRMATION_EMAIL_DRAW_HTML = readFileSync(join(__dirname, 'confirmation-email-draw.html'), 'utf8');
const CONFIRMATION_EMAIL_DRAW_TXT = readFileSync(join(__dirname, 'confirmation-email-draw.txt'), 'utf8');

const MONO_STACK = "'JetBrains Mono','SFMono-Regular',Consolas,Menlo,monospace";
const SERIF_STACK = "'Spectral',Georgia,'Times New Roman',serif";

export function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The draw-only merge fields for the Onyx email: the palette, the letterhead
 * wordmark, the optional entry-pass block, and the single "standing" stat.
 *
 * The standing stat follows the honest-date rule from the pass artwork (#252,
 * one date per surface). `drawOn` is the draw day and is stated as such;
 * without one we fall back to when ENTRIES CLOSE, a different and equally true
 * fact — the boost deadline is never dressed up as a draw date. With neither,
 * the whole standing row disappears. ENTRANT and STATUS were cut 2026-07-25:
 * the greeting already names the entrant and the H1 already states the status.
 *
 * `drawPass` is what makes this ONE email instead of two: when the send
 * carries a pass ({ link, deadlineLong, hasImage }), the pass block renders
 * inline — the card as a cid:draw-pass image plus the live /r/ link — and the
 * standalone reservation email is not sent at all. A confirmation without an
 * entitlement (no activation, issuance skipped) simply omits the block.
 */
function drawFields({ luckyDraw, campaignName, palette, isMktrHost, drawPass }) {
  const drawOn = shortDate(luckyDraw.drawOn);
  const closesAt = shortDate(luckyDraw.closesAt);
  const stat3 = drawOn
    ? { key: 'DRAW DATE', val: drawOn }
    : closesAt
      ? { key: 'ENTRIES CLOSE', val: closesAt }
      : null;

  const passLink = drawPass?.link ? escapeHtml(drawPass.link) : '';
  const deadline = drawPass?.deadlineLong ? escapeHtml(drawPass.deadlineLong) : '';
  const passCaption = deadline
    ? `Your consultant scans this at your session &mdash; reviews recorded by ${deadline} count.`
    : 'Your consultant scans this at your session.';
  // The card can be absent (renderer failure never blocks a send) — the block
  // then leads with the link, so the pass still reaches the inbox.
  const passRow = passLink
    ? '<tr>\n            <td class="px" style="padding:26px 40px 0 40px;">\n              '
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${palette.c_boxBg}" style="background-color:${palette.c_boxBg}; border:1px solid ${palette.c_boxBorder}; border-radius:16px;"><tr>`
      + '<td class="card-px" align="center" style="padding:24px 28px 24px 28px;">'
      + `<div style="font-family:${MONO_STACK};font-size:10px;letter-spacing:0.2em;color:${palette.c_eyebrow};padding-bottom:14px;">YOUR ENTRY PASS</div>`
      + (drawPass.hasImage
        ? '<img src="cid:draw-pass" width="300" alt="Your lucky draw entry pass" style="display:block;margin:0 auto;width:300px;max-width:100%;height:auto;border-radius:14px;">'
        : '')
      + `<div style="padding-top:${drawPass.hasImage ? 16 : 2}px;"><a href="${passLink}" style="font-family:${MONO_STACK};font-size:11px;letter-spacing:0.12em;color:${palette.c_linkText};text-decoration:underline;">VIEW YOUR ENTRY PASS</a></div>`
      + `<div style="padding-top:12px;font-family:${SERIF_STACK};font-size:14px;line-height:21px;color:${palette.c_quiet};">${passCaption}</div>`
      + '</td></tr></table>\n            </td>\n          </tr>'
    : '';
  const passText = drawPass?.link
    ? `\n\nYour entry pass (your consultant scans it at your session):\n${drawPass.link}`
      + (drawPass.deadlineLong ? `\nReviews recorded by ${drawPass.deadlineLong} count.` : '')
    : '';

  return {
    ...palette,
    prize: luckyDraw.prize || campaignName,
    multiplier: luckyDraw.multiplier || 10,
    // Small, left-aligned letterhead — the Onyx header is a rule of thirds, not
    // the centred hero block the trial-reward email uses.
    drawHeroLogo: isMktrHost
      ? '<img src="https://mktr.sg/email/new-mktr-wordmark-light.png" width="106" height="37" alt="MKTR" style="display:block;border:0;outline:none;">'
      : `<span style="font-family:${SERIF_STACK};font-size:27px;line-height:32px;color:${palette.c_word};letter-spacing:0.01em;">Redeem</span>`,
    passRow,
    passText,
    standingRow: stat3
      ? '<tr>\n            <td class="px" style="padding:28px 40px 0 40px;">\n              '
        + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${palette.c_hair};"><tr>`
        + '<td valign="top" style="padding:20px 0 0 0;">'
        + `<div style="font-family:${MONO_STACK};font-size:10px;letter-spacing:0.16em;color:${palette.c_statKey};padding-bottom:7px;">${stat3.key}</div>`
        + `<div style="font-family:${SERIF_STACK};font-size:17px;line-height:22px;color:${palette.c_statVal};">${stat3.val}</div>`
        + '</td></tr></table>\n            </td>\n          </tr>'
      : '',
    standingText: stat3 ? `\n\n${stat3.key.charAt(0)}${stat3.key.slice(1).toLowerCase()}: ${stat3.val}` : '',
  };
}

/**
 * Merge-field substitution for the confirmation pair — the whole render, with
 * no IO in it, so the sender and the preview produce byte-identical email.
 * Unknown placeholders are left intact so a render check can flag them.
 *
 * firstName, campaignName, shareUrl and prize are user- or operator-derived and
 * are HTML-escaped; the letterhead, palette and unsubscribe link are deliberate
 * markup built here and pass through raw. The plain-text part is never escaped.
 */
export function renderLeadConfirmation({
  firstName, campaignName, luckyDraw, isMktrHost,
  shareUrl = '', unsubscribeUrl = '', unsubscribeTextLine = '',
  drawPass = null,
}) {
  const isDraw = luckyDraw?.enabled === true;
  const brandName = isMktrHost ? 'MKTR' : 'Redeem';
  // Resolved BEFORE the merge fields because several of them (the wordmark, the
  // unsubscribe link, the third stat cell) are markup carrying an
  // already-resolved colour: substitution runs ONCE, so a placeholder nested
  // inside a substituted value would survive into the inbox.
  const palette = isDraw ? emailPalette(luckyDraw.passTheme) : {};

  const fields = {
    firstName,
    campaignName,
    shareUrl: shareUrl || '',
    unsubscribeLine: unsubscribeUrl
      ? `<a href="${escapeHtml(unsubscribeUrl)}" class="unsub-a" style="color:${isDraw ? palette.c_unsub : 'inherit'};text-decoration:underline;">Unsubscribe from marketing messages</a>`
      : '',
    unsubscribeTextLine,
    brandName,
    brandWordmark: isMktrHost ? 'MKTR' : 'Redeem.',
    footerEntity: isMktrHost
      ? 'MKTR PTE. LTD. (UEN 202507548M)'
      : 'Redeem, a service of MKTR PTE. LTD. (UEN 202507548M)',
    year: new Date().getFullYear(),
    // heroLogo is the trial-reward email's centred letterhead; the draw email
    // uses the smaller left-aligned drawHeroLogo instead.
    heroLogo: isMktrHost
      ? '<img src="https://mktr.sg/email/new-mktr-wordmark-light.png" width="150" height="53" alt="MKTR" style="display:block;margin:0 auto;border:0;outline:none;">'
      : '<span style="font-family:\'Fraunces\',Georgia,\'Times New Roman\',serif;font-size:38px;line-height:42px;font-weight:600;letter-spacing:0.005em;color:#FFFCF7;">RedeemSG</span>',
    ...(isDraw ? drawFields({ luckyDraw, campaignName, palette, isMktrHost, drawPass }) : {}),
  };

  const escapeFields = new Set(['firstName', 'campaignName', 'shareUrl', 'prize']);
  const htmlTemplate = isDraw ? CONFIRMATION_EMAIL_DRAW_HTML : CONFIRMATION_EMAIL_HTML;
  const textTemplate = isDraw ? CONFIRMATION_EMAIL_DRAW_TXT : CONFIRMATION_EMAIL_TXT;
  return {
    html: htmlTemplate.replace(/\{\{(\w+)\}\}/g, (_, k) =>
      k in fields ? (escapeFields.has(k) ? escapeHtml(fields[k]) : String(fields[k])) : `{{${k}}}`
    ),
    text: textTemplate.replace(/\{\{(\w+)\}\}/g, (_, k) =>
      k in fields ? String(fields[k]) : `{{${k}}}`
    ),
  };
}

export default { renderLeadConfirmation, escapeHtml };
