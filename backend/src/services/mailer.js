import nodemailer from 'nodemailer';
import { logger } from '../utils/logger.js';
import { normalizeCustomerHostChoice } from '../utils/customerHost.js';

// D12: per-origin from-address. Lead-capture confirmations sent from the
// redeem.sg flow use noreply@redeem.sg; admin / agent emails keep the
// existing noreply@mktr.sg. The provider-side DKIM/SPF/DMARC verification
// for redeem.sg is operational work tracked in Phase 6.1 of the plan.
const MKTR_FROM = process.env.EMAIL_FROM_MKTR || process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@mktr.sg';
const REDEEM_FROM = process.env.EMAIL_FROM_REDEEM || 'noreply@redeem.sg';

export function resolveEmailFrom(context = 'mktr') {
  if (context === 'redeem' || context === 'public') return REDEEM_FROM;
  return MKTR_FROM;
}

export function brandFromContext(context = 'mktr') {
  return context === 'redeem' || context === 'public' ? 'Redeem' : 'MKTR';
}

let cachedTransporter = null;

export function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD } = process.env;

  if (!EMAIL_HOST || !EMAIL_PORT || !EMAIL_USER || !EMAIL_PASSWORD) {
    logger.warn('Mailer not fully configured — emails will be logged but not sent');
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


export async function sendEmail({ to, subject, html, text, context, from }) {
  // Resolve from-address by context (lead-capture flows pass context='redeem',
  // admin flows omit it). An explicit `from` arg overrides both.
  const resolvedFrom = from || resolveEmailFrom(context);

  const transporter = getTransporter();
  if (!transporter) {
    logger.info('[DEV Fallback] Email not sent (mailer not configured)', { to, subject, from: resolvedFrom });
    logger.debug('Email body preview', { body: html || text || '(no body)' });
    return { success: false, message: 'Mailer not configured; logged instead.' };
  }

  try {
    await transporter.sendMail({ from: resolvedFrom, to, subject, html, text });
    return { success: true };
  } catch (err) {
    // Surface SES/SMTP rejection details — Nodemailer attaches `code`,
    // `responseCode`, and `response` (the full SMTP message). Without
    // logging these explicitly, callers' `.catch(err => log err.message)`
    // only sees a generic "Mail command failed" string and the actual
    // SES reason (e.g., "Email address is not verified") is lost.
    logger.error('Email send failed', {
      to,
      from: resolvedFrom,
      subject,
      code: err.code,
      responseCode: err.responseCode,
      command: err.command,
      response: err.response,
      message: err.message
    });
    throw err;
  }
}

export async function sendLeadAssignmentEmail(agent, prospect, isBulk = false, count = 1) {
  // Validate agent object
  if (!agent) {
    logger.error('Failed to send lead assignment email: agent is null or undefined');
    throw new Error('Agent object is required to send assignment email');
  }

  if (!agent.email) {
    logger.error('Failed to send lead assignment email: agent has no email address', { agentId: agent.id || 'unknown' });
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
        <li><strong>Email:</strong> ${prospect.email || 'N/A'}</li>
        <li><strong>Phone:</strong> ${prospect.phone || 'N/A'}</li>
      </ul>
      <p><a href="${process.env.FRONTEND_BASE_URL || 'http://localhost:5173'}/prospect/${prospect.id}">View Lead Details</a></p>
    `;
  }

  logger.info('Sending lead assignment email', { to: agent.email, agentId: agent.id });

  // REDIRECT SYSTEM AGENT EMAILS
  const systemEmail = process.env.SYSTEM_AGENT_EMAIL || 'system@mktr.local';
  const redirectEmail = process.env.SYSTEM_AGENT_REDIRECT_EMAIL;
  let targetEmail = agent.email;

  if (agent.email === systemEmail || (agent.firstName === 'System' && agent.lastName === 'Agent')) {
    if (redirectEmail) {
      logger.info('Agent is System Agent — redirecting assignment email', { originalEmail: agent.email, redirectTo: redirectEmail });
      targetEmail = redirectEmail;
    } else {
      logger.warn('Agent is System Agent but SYSTEM_AGENT_REDIRECT_EMAIL not set — skipping email');
      return { success: false, message: 'System Agent email redirect not configured' };
    }
  }

  const result = await sendEmail({
    to: targetEmail,
    subject,
    html
  });

  if (result.success) {
    logger.info('Lead assignment email sent successfully', { to: agent.email });
  } else {
    logger.warn('Lead assignment email not sent (mailer not configured)', { to: agent.email });
  }

  return result;
}



// --- Modern Email Template Helper ---
function getModernTemplate(title, content, action, options = {}) {
  const headerTitle = options.headerTitle || 'MKTR Platform';
  const footerHtml = options.footerHtml || `<p>&copy; ${new Date().getFullYear()} MKTR Platform. All rights reserved.</p>`;
  // Optional animated/static header image (e.g., the Redeem confetti GIF).
  // Renders full-bleed in the dark header; clients that block images or
  // can't animate GIFs (Outlook) fall back to the alt text on the same
  // #111827 background, so it degrades to a clean wordmark look.
  const headerInner = options.headerImage
    ? `<img src="${options.headerImage}" alt="${options.headerImageAlt || headerTitle}" width="600" style="display:block; width:100%; max-width:600px; height:auto; border:0; margin:0 auto;" />`
    : `<h1>${headerTitle}</h1>`;
  const headerStyle = options.headerImage ? 'background:#111827; padding:0; text-align:center;' : '';
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
        <div class="header" style="${headerStyle}">
          ${headerInner}
        </div>
        <div class="content">
          <h2>${title}</h2>
          ${content}
          ${actionButton}
        </div>
        <div class="footer">
          ${footerHtml}
        </div>
      </div>
    </body>
    </html>
  `;
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendLeadConfirmationEmail(prospect) {
  if (!prospect?.email) {
    logger.warn('Skipping lead confirmation email: prospect has no email', { prospectId: prospect?.id });
    return { success: false, message: 'Missing prospect email' };
  }

  // Skip synthetic Retell emails (e.g. retell-{callId}@calls.mktr.sg) — those
  // are placeholder addresses for voice-sourced leads and not real recipients.
  if (/@calls\.mktr\.sg$/i.test(prospect.email)) {
    return { success: false, message: 'Skipped: synthetic Retell email' };
  }

  const campaignName = prospect.campaign?.name || prospect.campaignName;
  if (!campaignName) {
    logger.warn('Skipping lead confirmation email: missing campaign name', { prospectId: prospect.id });
    return { success: false, message: 'Missing campaign name' };
  }

  const firstName = prospect.firstName || 'there';
  const safeFirstName = escapeHtml(firstName);
  const safeCampaign = escapeHtml(campaignName);
  const subject = `We've received your interest in ${campaignName}`;

  // Brand the confirmation email by the campaign's customer host: redeem.sg
  // (default) shows the Redeem brand; an mktr.sg campaign must show MKTR to the
  // customer. Backend code is not bundled into the frontend dist, so the MKTR
  // literals here do not affect the redeem-build brand-isolation grep.
  const hostChoice = normalizeCustomerHostChoice(prospect.campaign?.design_config?.customerHost);
  const isMktrHost = hostChoice === 'mktr';
  const brandName = isMktrHost ? 'MKTR' : 'Redeem';
  const headerImage = isMktrHost
    ? 'https://mktr.sg/email/confetti-header.gif'
    : 'https://redeem.sg/email/confetti-header.gif';
  const footerEntityHtml = isMktrHost
    ? 'MKTR PTE. LTD. (UEN 202507548M)'
    : 'Redeem &middot; A service of MKTR PTE. LTD. (UEN 202507548M)';
  const footerEntityText = isMktrHost
    ? 'MKTR PTE. LTD. (UEN 202507548M)'
    : 'Redeem · A service of MKTR PTE. LTD. (UEN 202507548M)';

  const content = `
    <p>Hi ${safeFirstName},</p>
    <p>Thank you for your interest in <strong>${safeCampaign}</strong>.</p>
    <p>We've received your submission and a member of our team will be in touch with you shortly &mdash; usually within 24 hours.</p>
    <p>If you didn't submit this request, you can safely ignore this email.</p>
    <p>&mdash; The ${brandName} team</p>
  `;

  const html = getModernTemplate(
    "We've received your submission",
    content,
    null,
    {
      headerTitle: brandName,
      headerImage,
      headerImageAlt: 'Thank you!',
      footerHtml: `<p>&copy; ${new Date().getFullYear()} ${footerEntityHtml}</p>`,
    }
  );

  const text = `Hi ${firstName},

Thank you for your interest in ${campaignName}.

We've received your submission and a member of our team will be in touch with you shortly — usually within 24 hours.

If you didn't submit this request, you can safely ignore this email.

— The ${brandName} team

© ${new Date().getFullYear()} ${footerEntityText}`;

  logger.info('Sending lead confirmation email', { to: prospect.email, prospectId: prospect.id, campaign: campaignName, brand: brandName });

  return sendEmail({
    to: prospect.email,
    subject,
    html,
    text,
    context: hostChoice,
  });
}

export async function sendPackageAssignmentEmail(agent, packageDetails) {
  if (!agent || !agent.email) {
    logger.warn('Cannot send package assignment email: missing agent email');
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

  logger.info('Sending package assignment email', { to: agent.email });

  return sendEmail({
    to: agent.email,
    subject,
    html
  });
}
