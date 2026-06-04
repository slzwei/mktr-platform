import { UniqueConstraintError } from 'sequelize';
import { WaitlistSignup } from '../models/index.js';
import { sendEmail } from './mailer.js';
import { logger } from '../utils/logger.js';

const NOTIFY_TO = process.env.WAITLIST_NOTIFY_EMAIL || 'shawnleeapps@gmail.com';

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Send the admin a heads-up that someone joined the waitlist.
 * Non-authoritative: failure here must NOT fail the signup. Returns boolean sent.
 */
async function notifyAdmin({ email, name, phone, source }) {
  const subject = 'New MKTR waitlist signup';
  const rows = [
    ['Email', email],
    ['Name', name || '-'],
    ['Phone', phone || '-'],
    ['Source', source || '-'],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;color:#6b7280;width:120px;">${k}</td><td style="padding:6px 0;color:#111827;font-weight:600;">${escapeHtml(v)}</td></tr>`
    )
    .join('');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f7f7f8;padding:24px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
        <tr><td style="padding:24px 24px 0 24px;">
          <div style="font-size:18px;font-weight:700;color:#111827;">MKTR PTE. LTD.</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Waitlist signup</div>
        </td></tr>
        <tr><td style="padding:16px 24px;">
          <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;font-size:14px;">${rows}</table>
        </td></tr>
      </table>
    </div>`;
  const text = `New MKTR waitlist signup\n\nEmail: ${email}\nName: ${name || '-'}\nPhone: ${phone || '-'}\nSource: ${source || '-'}`;

  const result = await sendEmail({ to: NOTIFY_TO, subject, html, text });
  return result.success;
}

/**
 * Persist a waitlist signup. Persistence is the source of truth for success —
 * if the row is written (or already exists), the signup succeeded, regardless of
 * whether the notification email sent. Idempotent on normalized email.
 *
 * Throws only on a real DB failure (caller maps that to a 5xx).
 * Returns { created } where created=false means the email was already on the list.
 */
export async function processWaitlistSignup({ email, name, phone, source, ipAddress, userAgent }) {
  const normalizedEmail = normalizeEmail(email);

  let created = false;
  let signup;
  try {
    const [row, wasCreated] = await WaitlistSignup.findOrCreate({
      where: { email: normalizedEmail },
      defaults: {
        email: normalizedEmail,
        name: name?.trim() || null,
        phone: phone?.trim() || null,
        source: source?.trim() || 'homepage',
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      },
    });
    signup = row;
    created = wasCreated;
  } catch (err) {
    // Race: a concurrent insert won the unique constraint. Treat as existing.
    if (err instanceof UniqueConstraintError) {
      signup = await WaitlistSignup.findOne({ where: { email: normalizedEmail } });
      created = false;
    } else {
      throw err; // real DB error → 5xx
    }
  }

  // Notify the admin only for genuinely new signups; never let it fail the request.
  if (created && signup) {
    try {
      const sent = await notifyAdmin({ email: normalizedEmail, name, phone, source });
      if (sent) {
        await signup.update({ notifiedAt: new Date() }).catch(() => {});
      } else {
        logger.warn('Waitlist signup saved but admin notification not sent (mailer not configured)', { email: normalizedEmail });
      }
    } catch (err) {
      logger.error('Waitlist admin notification failed (signup still saved)', { email: normalizedEmail, error: err.message });
    }
  }

  return { created };
}
