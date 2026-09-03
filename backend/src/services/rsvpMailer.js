import { sendEmail } from './mailer.js';
import { escapeHtml } from './email-templates/leadConfirmation.js';
import { logger } from '../utils/logger.js';

/**
 * RSVP confirmation email (docs/plans/rsvp-pages.md §8.3): an OPERATIONAL
 * message — the attendee's own RSVP, the event details, the link back. It
 * carries no offers itself; whatever the event's consent line permits later
 * goes through a channel that honours opt-outs, not this transactional mail.
 *
 * Fired post-commit and fire-and-forget by the controller: a transport
 * failure is logged, never surfaced as a failed RSVP (§SHOULD-FIX 2 of the
 * plan review). Sends from the redeem context (noreply@redeem.sg).
 */

const rsvpPublicOrigin = () => (process.env.RSVP_PUBLIC_ORIGIN || 'https://rsvp.redeem.sg').replace(/\/$/, '');

function detailRows(layout) {
  const block = (layout?.blocks || []).find((b) => b?.type === 'details');
  return (block?.rows || []).filter((r) => r?.label || r?.value);
}

export function renderRsvpConfirmation({ event, response, updated = false }) {
  const url = event.slug ? `${rsvpPublicOrigin()}/${encodeURIComponent(event.slug)}` : rsvpPublicOrigin();
  const firstName = String(response.name || '').trim().split(/\s+/)[0] || 'there';
  const rows = detailRows(event.layout);
  const organiser = event.organiserName || 'the organiser';
  const headline = updated ? 'Your RSVP is updated' : "You're in";
  const subject = `${headline}: ${event.title}`;

  const text = [
    `Hi ${firstName},`,
    '',
    updated ? `We have updated your RSVP for ${event.title}.` : `Your RSVP for ${event.title} is confirmed.`,
    ...rows.map((r) => `${r.label}: ${r.value}`),
    '',
    `Hosted by ${organiser}.`,
    `Event page: ${url}`,
    '',
    'Need to change something? Open the page again and RSVP with this same email address.',
    '',
    'This is a confirmation of the RSVP you made on the page above.',
    'MKTR PTE. LTD. (UEN 202507548M) runs Redeem. Personal Data Policy: https://redeem.sg/personal-data-policy',
  ].join('\n');

  const rowsHtml = rows.map((r) => `<tr><td style="padding:4px 12px 4px 0;color:#7a6a58;font-size:13px;white-space:nowrap">${escapeHtml(r.label)}</td><td style="padding:4px 0;color:#2b1d12;font-size:15px">${escapeHtml(r.value)}</td></tr>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f4efe6;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#2b1d12">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffaf0;border-radius:16px;padding:28px">
<tr><td>
<p style="margin:0 0 6px;font-size:13px;color:#9a7e5c;letter-spacing:.06em;text-transform:uppercase">RSVP confirmation</p>
<h1 style="margin:0 0 14px;font-size:24px;line-height:1.2">${escapeHtml(headline)}</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.5">Hi ${escapeHtml(firstName)}, ${updated ? 'we have updated your RSVP for' : 'your RSVP for'} <strong>${escapeHtml(event.title)}</strong> ${updated ? '' : 'is confirmed'}.</p>
${rowsHtml ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px">${rowsHtml}</table>` : ''}
<p style="margin:0 0 18px;font-size:14px;color:#5a301a">Hosted by ${escapeHtml(organiser)}.</p>
<p style="margin:0 0 22px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:11px 18px;background:#d17029;color:#fff;text-decoration:none;border-radius:999px;font-weight:700">Open the event page</a></p>
<p style="margin:0 0 10px;font-size:13px;color:#7a6a58;line-height:1.5">Need to change something? Open the page again and RSVP with this same email address.</p>
<p style="margin:0;font-size:12px;color:#9a7e5c;line-height:1.5">This is a confirmation of the RSVP you made on the page above. MKTR PTE. LTD. (UEN 202507548M) runs Redeem. <a href="https://redeem.sg/personal-data-policy" style="color:#9a7e5c">Personal Data Policy</a>.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text };
}

/** Fire-and-forget. Honours the event's confirmation.emailEnabled switch. */
export async function sendRsvpConfirmationEmail({ event, response, updated = false }) {
  if (!event || !response?.email) return { sent: false, reason: 'no_recipient' };
  if (event.layout?.confirmation?.emailEnabled === false) return { sent: false, reason: 'disabled' };
  try {
    const { subject, html, text } = renderRsvpConfirmation({ event, response, updated });
    const result = await sendEmail({ to: response.email, subject, html, text, context: 'redeem' });
    return { sent: Boolean(result?.success) };
  } catch (err) {
    logger.warn({ err: err?.message, rsvpEventId: event.id }, 'rsvp.confirmation_email_failed');
    return { sent: false, reason: 'error' };
  }
}
