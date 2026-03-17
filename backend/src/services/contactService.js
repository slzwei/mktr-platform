import { sendEmail } from './mailer.js';

const ROLE_LABELS = {
  advertiser: 'Advertiser',
  phv_driver: 'PHV Driver',
  fleet_owner: 'Fleet Owner',
  salesperson: 'Salesperson'
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Build the HTML email body for a contact form submission.
 */
export function buildContactEmailHtml({ name, email, phone, company, message, userType }) {
  return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, 'Helvetica Neue', Arial, sans-serif; background:#f7f7f8; padding:24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.06)">
          <tr>
            <td style="padding:24px 24px 0 24px;">
              <div style="font-size:20px; font-weight:700; color:#111827;">MKTR PTE. LTD.</div>
              <div style="font-size:12px; color:#6b7280; margin-top:4px;">Contact Form Submission</div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px 0 24px;">
              <div style="border-top:1px solid #e5e7eb"></div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px;">
              <div style="font-size:14px; color:#374151; line-height:1.6;">
                <p style="margin:0 0 12px 0;">You have received a new message from the website contact form.</p>
                <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%; font-size:14px;">
                  <tr>
                    <td style="padding:8px 0; color:#6b7280; width:160px;">Name</td>
                    <td style="padding:8px 0; color:#111827; font-weight:600;">${escapeHtml(name)}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0; color:#6b7280;">Email</td>
                    <td style="padding:8px 0; color:#111827; font-weight:600;">${escapeHtml(email)}</td>
                  </tr>
                  ${userType ? `<tr><td style="padding:8px 0; color:#6b7280;">Role</td><td style="padding:8px 0; color:#111827; font-weight:600;">${escapeHtml(ROLE_LABELS[userType] || userType)}</td></tr>` : ''}
                  ${company ? `<tr><td style="padding:8px 0; color:#6b7280;">Company</td><td style="padding:8px 0; color:#111827; font-weight:600;">${escapeHtml(company)}</td></tr>` : ''}
                  ${phone ? `<tr><td style="padding:8px 0; color:#6b7280;">Phone</td><td style="padding:8px 0; color:#111827; font-weight:600;">${escapeHtml(phone)}</td></tr>` : ''}
                </table>
                <div style="margin:16px 0; border-top:1px solid #e5e7eb"></div>
                <div style="font-size:12px; color:#6b7280; text-transform:uppercase; letter-spacing:0.04em;">Message</div>
                <div style="margin-top:8px; white-space:pre-wrap; color:#111827;">${escapeHtml(message)}</div>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px 24px;">
              <div style="border-top:1px solid #e5e7eb"></div>
              <div style="font-size:12px; color:#9ca3af; padding-top:12px;">This email was sent from the MKTR website.</div>
            </td>
          </tr>
        </table>
      </div>
    `;
}

/**
 * Build the plain-text fallback email body.
 */
export function buildContactEmailText({ name, email, phone, company, message, userType }) {
  return `New contact form submission\n\nName: ${name}\nEmail: ${email}\nRole: ${userType ? (ROLE_LABELS[userType] || userType) : '-'}\nCompany: ${company || '-'}\nPhone: ${phone || '-'}\n\nMessage:\n${message}`;
}

/**
 * Process a validated contact form submission. Returns { sent: boolean }.
 */
export async function processContactSubmission(data) {
  const subject = `New Contact Form Submission — MKTR PTE. LTD.`;
  const html = buildContactEmailHtml(data);
  const text = buildContactEmailText(data);

  const result = await sendEmail({
    to: 'shawnleeapps@gmail.com',
    subject,
    html,
    text
  });

  return { sent: result.success };
}
