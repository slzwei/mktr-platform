import nodemailer from 'nodemailer';

let cachedTransporter = null;

export function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD } = process.env;

  if (!EMAIL_HOST || !EMAIL_PORT || !EMAIL_USER || !EMAIL_PASSWORD) {
    console.warn('⚠️  Mailer not fully configured. Emails will be logged but not sent.');
    cachedTransporter = null;
    return null;
  }

  const transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: Number(EMAIL_PORT) || 587,
    secure: String(EMAIL_PORT) === '465',
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASSWORD
    }
  });

  cachedTransporter = transporter;
  return transporter;
}

export async function sendEmail({ to, subject, html, text }) {
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  const transporter = getTransporter();
  if (!transporter) {
    console.log('📧 [DEV Fallback] Email not sent (mailer not configured):', { to, subject });
    console.log('— HTML Preview —');
    console.log(html || text || '(no body)');
    return { success: false, message: 'Mailer not configured; logged instead.' };
  }

  await transporter.sendMail({ from, to, subject, html, text });
  return { success: true };
}

