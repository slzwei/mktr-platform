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
  // Validate agent object
  if (!agent) {
    console.error('❌ Failed to send lead assignment email: agent is null or undefined');
    throw new Error('Agent object is required to send assignment email');
  }

  if (!agent.email) {
    console.error(`❌ Failed to send lead assignment email: agent ${agent.id || 'unknown'} has no email address`);
    throw new Error(`Agent ${agent.id || 'unknown'} has no email address`);
  }

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
      <p><a href="${process.env.FRONTEND_BASE_URL || 'http://localhost:5173'}/MyProspects">View My Prospects</a></p>
    `;
  } else {
    const campaignName = prospect.campaign?.name || prospect.campaignName || 'N/A';
    const campaignId = prospect.campaign?.id || prospect.campaignId || null;

    // Format signup date and time
    const signupDate = new Date(prospect.createdAt);
    const dateOptions = { year: 'numeric', month: 'short', day: 'numeric' };
    const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: true };
    const formattedDate = signupDate.toLocaleDateString('en-US', dateOptions);
    const formattedTime = signupDate.toLocaleTimeString('en-US', timeOptions);

    html = `
      <h2>New Lead Assigned</h2>
      <p>Hello ${agent.firstName || 'Agent'},</p>
      <p>A new prospect has been assigned to you:</p>
      <ul>
        <li><strong>Name:</strong> ${prospect.firstName} ${prospect.lastName}</li>
        <li><strong>Campaign:</strong> ${campaignName}</li>
        <li><strong>Signed Up:</strong> ${formattedDate} at ${formattedTime}</li>
        <li><strong>Email:</strong> ${prospect.email}</li>
        <li><strong>Phone:</strong> ${prospect.phone || 'N/A'}</li>
      </ul>
      <p><a href="${process.env.FRONTEND_BASE_URL || 'http://localhost:5173'}/prospect/${prospect.id}">View Lead Details</a></p>
    `;
  }

  console.log(`📧 Sending lead assignment email to ${agent.email} (Agent ID: ${agent.id})`);

  // REDIRECT SYSTEM AGENT EMAILS
  // The user requested that if the system agent receives a lead, the email goes to shawnleejob@gmail.com
  const systemEmail = process.env.SYSTEM_AGENT_EMAIL || 'system@mktr.local';
  let targetEmail = agent.email;

  if (agent.email === systemEmail || (agent.firstName === 'System' && agent.lastName === 'Agent')) {
    console.log(`📧 Agent is System Agent (${agent.email}). Redirecting assignment email to shawnleejob@gmail.com`);
    targetEmail = 'shawnleejob@gmail.com';
  }

  const result = await sendEmail({
    to: targetEmail,
    subject,
    html
  });

  if (result.success) {
    console.log(`✅ Lead assignment email sent successfully to ${agent.email}`);
  } else {
    console.warn(`⚠️  Lead assignment email not sent (mailer not configured): ${agent.email}`);
  }

  return result;
}



// --- Modern Email Template Helper ---
function getModernTemplate(title, content, action) {
  const actionButton = action
    ? `<div style="margin-top: 32px;"><a href="${action.url}" class="action-btn">${action.text}</a></div>`
    : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { margin: 0; padding: 0; background-color: #F3F4F6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
        .container { max-width: 600px; margin: 40px auto; background: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
        .header { background: #111827; padding: 32px; text-align: center; }
        .header h1 { color: #FFFFFF; margin: 0; font-size: 24px; font-weight: 600; letter-spacing: -0.025em; }
        .content { padding: 40px 32px; color: #374151; line-height: 1.6; }
        .content h2 { margin-top: 0; color: #111827; font-size: 20px; font-weight: 600; }
        .content p { margin-bottom: 24px; }
        .details-box { background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 24px; margin-bottom: 24px; }
        .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #E5E7EB; }
        .detail-row:last-child { border-bottom: none; }
        .detail-label { color: #6B7280; font-weight: 500; }
        .detail-value { color: #111827; font-weight: 600; }
        .action-btn { display: inline-block; background: #2563EB; color: #FFFFFF; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; text-align: center; width: 100%; box-sizing: border-box; }
        .action-btn:hover { background: #1D4ED8; }
        .footer { background: #F9FAFB; padding: 24px; text-align: center; color: #6B7280; font-size: 14px; border-top: 1px solid #E5E7EB; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>MKTR Platform</h1>
        </div>
        <div class="content">
          <h2>${title}</h2>
          ${content}
          ${actionButton}
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} MKTR Platform. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export async function sendPackageAssignmentEmail(agent, packageDetails) {
  if (!agent || !agent.email) {
    console.warn('⚠️ Cannot send package assignment email: Missing agent email');
    return { success: false };
  }

  const subject = `[MKTR] New Package Assigned: ${packageDetails.name}`;

  const detailsHtml = `
    <div class="details-box">
      <div class="detail-row">
        <div class="detail-label">Package Name</div>
        <div class="detail-value">${packageDetails.name}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Campaign</div>
        <div class="detail-value">${packageDetails.campaignName || 'N/A'}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Leads Included</div>
        <div class="detail-value">${packageDetails.leadCount}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Assigned Date</div>
        <div class="detail-value">${new Date().toLocaleDateString()}</div>
      </div>
    </div>
  `;

  const content = `
    <p>Hello ${agent.firstName || 'Agent'},</p>
    <p>A new lead package has been assigned to your account. You can now access these leads from your dashboard.</p>
    ${detailsHtml}
    <p>This package is now active and leads will be distributed according to the allocation rules.</p>
  `;

  const html = getModernTemplate('New Lead Package Assigned', content, {
    text: 'View My Packages',
    url: `${process.env.FRONTEND_BASE_URL || 'http://localhost:5173'}/MyPackages`
  });

  console.log(`📧 Sending package assignment email to ${agent.email}`);

  return sendEmail({
    to: agent.email,
    subject,
    html
  });
}
