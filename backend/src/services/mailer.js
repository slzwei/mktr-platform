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

export async function sendLeadAssignmentEmail(agent, prospect, isBulk = false, count = 1) {
  if (!agent?.email) return;

  const subject = isBulk
    ? `[MKTR] You have been assigned ${count} new leads`
    : `[MKTR] New Lead Assigned: ${prospect.firstName} ${prospect.lastName}`;

  let html = '';

  if (isBulk) {
    html = `
      <h2>New Leads Assigned</h2>
      <p>Hello ${agent.firstName || 'Agent'},</p>
      <p>You have been assigned <strong>${count}</strong> new leads in the MKTR platform.</p>
      <p>Please log in to your dashboard to review and contact them.</p>
      <p><a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/admin/leads">View Leads</a></p>
    `;
  } else {
    html = `
      <h2>New Lead Assigned</h2>
      <p>Hello ${agent.firstName || 'Agent'},</p>
      <p>A new prospect has been assigned to you:</p>
      <ul>
        <li><strong>Name:</strong> ${prospect.firstName} ${prospect.lastName}</li>
        <li><strong>Company:</strong> ${prospect.company || 'N/A'}</li>
        <li><strong>Email:</strong> ${prospect.email}</li>
        <li><strong>Phone:</strong> ${prospect.phone || 'N/A'}</li>
      </ul>
      <p><a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/admin/leads/${prospect.id}">View Lead Details</a></p>
    `;
  }

  return sendEmail({
    to: agent.email,
    subject,
    html
  });
}

