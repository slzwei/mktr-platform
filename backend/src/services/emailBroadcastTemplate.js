/**
 * The one broadcast email template (tracker "emailpush",
 * docs/plans/email-broadcast-push.md §3.4).
 *
 * Deliberately minimal: 600px single-column table in the visual family of
 * mailer.js's getModernTemplate (unexported — mailer stays frozen). Every
 * interpolated field is HTML-escaped; the body is plain text split on blank
 * lines into paragraphs — there is NO raw-HTML path, so admin copy can never
 * inject markup into consumer mail.
 *
 * The footer carries the Spam Control Act sender identity (MKTR entity line)
 * and the PR-B unsubscribe link; the pipeline only ever reaches this template
 * for recipients who passed the send-time consent gate, so nothing rendered
 * here is unsolicited mail. Final wording sits with the platform-wide counsel
 * review (docs/plans/consumer-spine-and-consent-ledger.md §9).
 */

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/** Blank-line-separated plain text → trimmed non-empty paragraph list. */
export function splitParagraphs(bodyText) {
  return String(bodyText || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Render the broadcast → { html, text }. `testNotice` (test sends only)
 * prepends a visible banner and the unsubscribe link renders inert.
 */
export function renderBroadcastEmail({
  subject,
  bodyText,
  ctaLabel,
  ctaUrl,
  brandName,
  brandOrigin,
  unsubscribeUrl,
  recipientFirstName,
  testNotice = false,
} = {}) {
  const paragraphs = splitParagraphs(bodyText);
  const greetingName = String(recipientFirstName || '').trim();
  const greeting = greetingName ? `Hi ${greetingName},` : 'Hi there,';
  const safeUnsub = unsubscribeUrl ? escapeHtml(unsubscribeUrl) : '#';

  const paragraphHtml = paragraphs
    .map((p) => `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #333333;">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('\n            ');

  const testBanner = testNotice
    ? `<tr><td style="background-color: #fff7e6; border: 1px solid #f0c36d; border-radius: 6px; padding: 10px 14px; font-size: 13px; color: #8a6d3b;">TEST SEND — this is a preview of a broadcast; the unsubscribe link below is inactive.</td></tr>
        <tr><td style="height: 16px;"></td></tr>`
    : '';

  const ctaHtml = ctaUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 8px 0 24px 0;">
              <tr>
                <td style="border-radius: 6px; background-color: #111111;">
                  <a href="${escapeHtml(ctaUrl)}" target="_blank" style="display: inline-block; padding: 12px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 6px;">${escapeHtml(ctaLabel || 'Learn more')}</a>
                </td>
              </tr>
            </table>`
    : '';

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width: 600px; max-width: 94%; background-color: #ffffff; border-radius: 8px; overflow: hidden;">
            <tr>
              <td style="padding: 28px 32px 8px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${testBanner}
                  <tr>
                    <td style="font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #999999; padding-bottom: 18px;">${escapeHtml(brandName || 'MKTR')}</td>
                  </tr>
                </table>
                <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #333333;">${escapeHtml(greeting)}</p>
                ${paragraphHtml}
                ${ctaHtml}
              </td>
            </tr>
            <tr>
              <td style="padding: 18px 32px 26px 32px; border-top: 1px solid #ececec;">
                <p style="margin: 0 0 6px 0; font-size: 12px; line-height: 1.5; color: #999999;">You're receiving this because you signed up with ${escapeHtml(brandName || 'MKTR')}${brandOrigin ? ` (${escapeHtml(brandOrigin)})` : ''}.</p>
                <p style="margin: 0 0 6px 0; font-size: 12px; line-height: 1.5; color: #999999;"><a href="${safeUnsub}" style="color: #666666; text-decoration: underline;">Unsubscribe</a> from marketing emails at any time.</p>
                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #bbbbbb;">MKTR PTE. LTD. (UEN 202507548M), Singapore</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textLines = [
    ...(testNotice ? ['[TEST SEND — unsubscribe link inactive]', ''] : []),
    greeting,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    ...(ctaUrl ? [`${ctaLabel || 'Learn more'}: ${ctaUrl}`, ''] : []),
    '--',
    `You're receiving this because you signed up with ${brandName || 'MKTR'}${brandOrigin ? ` (${brandOrigin})` : ''}.`,
    `Unsubscribe: ${unsubscribeUrl || '(test send)'}`,
    'MKTR PTE. LTD. (UEN 202507548M), Singapore',
  ];

  return { html, text: textLines.join('\n') };
}
