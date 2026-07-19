import nodemailer from 'nodemailer';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';
import { maskEmail } from '../utils/redactTokens.js';
import { normalizeCustomerHostChoice, customerHostOrigin } from '../utils/customerHost.js';
import { getOrCreateProspectShareLink } from './shortlinkService.js';
import { ensureUnsubToken } from './consentService.js';

// Lead-capture confirmation email: the designer's production, table-based HTML email
// (design_handoff_lead_confirmation_email). Read once at boot from the co-located copy so it
// ships with the backend regardless of the deploy root. Do NOT reformat or sanitize it; the
// inline styles and MSO conditional comments are deliberate email-client requirements.
const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIRMATION_EMAIL_HTML = readFileSync(join(__dirname, 'email-templates/confirmation-email.html'), 'utf8');
const CONFIRMATION_EMAIL_TXT = readFileSync(join(__dirname, 'email-templates/confirmation-email.txt'), 'utf8');
// Lucky-draw variant (docs/plans/lucky-draw-10x.md §4.5): draw campaigns must
// not promise the generic "gift + call within 24 hours" — they confirm the
// entry and pitch the ×N session multiplier instead.
const CONFIRMATION_EMAIL_DRAW_HTML = readFileSync(join(__dirname, 'email-templates/confirmation-email-draw.html'), 'utf8');
const CONFIRMATION_EMAIL_DRAW_TXT = readFileSync(join(__dirname, 'email-templates/confirmation-email-draw.txt'), 'utf8');

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


export async function sendEmail({ to, subject, html, text, context, from, attachments, headers }) {
  // Resolve from-address by context (lead-capture flows pass context='redeem',
  // admin flows omit it). An explicit `from` arg overrides both.
  const resolvedFrom = from || resolveEmailFrom(context);

  const transporter = getTransporter();
  if (!transporter) {
    // Recipient masked and no body preview — reward emails carry live bearer
    // tokens in their links/QRs, and log lines outlive the emails.
    logger.info('[DEV Fallback] Email not sent (mailer not configured)', { to: maskEmail(to), subject, from: resolvedFrom });
    logger.debug('Email body preview suppressed', { bodyBytes: (html || text || '').length });
    return { success: false, message: 'Mailer not configured; logged instead.' };
  }

  try {
    // `attachments` (optional, nodemailer passthrough) carries CID-inline images —
    // the Redeem Ops voucher QR ships as an attachment, not a remote URL, so it
    // renders with remote images blocked and the token stays out of image-proxy
    // logs (docs/redeem-ops/MKTR_INTEGRATION.md §2).
    // `headers` (optional, nodemailer passthrough) carries List-Unsubscribe /
    // List-Unsubscribe-Post on consumer emails (PR B).
    await transporter.sendMail({ from: resolvedFrom, to, subject, html, text, ...(attachments ? { attachments } : {}), ...(headers ? { headers } : {}) });
    return { success: true };
  } catch (err) {
    // Surface SES/SMTP rejection details — Nodemailer attaches `code`,
    // `responseCode`, and `response` (the full SMTP message). Without
    // logging these explicitly, callers' `.catch(err => log err.message)`
    // only sees a generic "Mail command failed" string and the actual
    // SES reason (e.g., "Email address is not verified") is lost.
    logger.error('Email send failed', {
      to: maskEmail(to),
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

export async function sendLeadConfirmationEmail(prospect, { shareUrl: shareUrlOverride } = {}) {
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
  // Draw campaigns confirm a draw ENTRY (no gift/24h-call promise) — template
  // pair + subject swap on design_config.luckyDraw (docs/plans/lucky-draw-10x.md §4.5).
  const luckyDraw = prospect.campaign?.design_config?.luckyDraw;
  const isDraw = luckyDraw?.enabled === true;
  const subject = isDraw
    ? `You're in the draw — ${campaignName}`
    : `We've received your interest in ${campaignName}`;

  // Brand the confirmation email by the campaign's customer host: redeem.sg (default) shows
  // the Redeem brand; an mktr.sg campaign shows MKTR. Backend code is not bundled into the
  // frontend dist, so the MKTR literals here do not affect the redeem-build brand grep.
  const hostChoice = normalizeCustomerHostChoice(prospect.campaign?.design_config?.customerHost);
  const isMktrHost = hostChoice === 'mktr';
  const brandName = isMktrHost ? 'MKTR' : 'Redeem';
  const brandWordmark = isMktrHost ? 'MKTR' : 'Redeem.';
  const footerEntity = isMktrHost
    ? 'MKTR PTE. LTD. (UEN 202507548M)'
    : 'Redeem, a service of MKTR PTE. LTD. (UEN 202507548M)';
  // heroLogo is the only brand-conditional merge field that is HTML (Redeem = Fraunces text
  // wordmark, MKTR = the hosted wordmark image), so it is NOT escaped in the substitution.
  const heroLogo = isMktrHost
    ? '<img src="https://mktr.sg/email/new-mktr-wordmark-light.png" width="150" height="53" alt="MKTR" style="display:block;margin:0 auto;border:0;outline:none;">'
    : '<span style="font-family:\'Fraunces\',Georgia,\'Times New Roman\',serif;font-size:38px;line-height:42px;font-weight:600;letter-spacing:0.005em;color:#FFFCF7;">RedeemSG</span>';

  // Referral link: prefer the canonical shareUrl minted at prospect creation (identical to
  // the in-app share dialog). Only self-derive as a fallback when the caller didn't pass it
  // (keeps the email self-contained); fall back to the long ?ref= URL if minting fails so
  // the email always ships a working link. Non-blocking either way.
  let shareUrl = shareUrlOverride || null;
  if (!shareUrl && prospect.campaign?.id) {
    const origin = customerHostOrigin(hostChoice);
    try {
      const { url } = await getOrCreateProspectShareLink({
        prospectId: prospect.id,
        campaignId: prospect.campaign.id,
        origin,
      });
      shareUrl = `${origin}${url}`;
    } catch (err) {
      logger.warn('Confirmation email: share link unavailable, using long URL', { prospectId: prospect.id, err: err?.message });
      shareUrl = `${origin}/LeadCapture?campaign_id=${prospect.campaign.id}&ref=${prospect.id}`;
    }
  }
  // Render the designer's production template (design_handoff_lead_confirmation_email) by
  // substituting merge fields. firstName, campaignName and shareUrl are user or operator
  // derived, so they are HTML-escaped exactly as before; heroLogo is intentional markup and
  // the brand literals and year are controlled, so they pass through raw. The plain-text part
  // is never escaped. Unknown placeholders are left intact so a render check can flag them.
  // Unsubscribe plumbing (PR B, plan §3.4): consumer-linked leads get a
  // working List-Unsubscribe header pair + footer link. The deterministic
  // token means every email rebuilds the same URL, and the URL carries ONLY
  // the token — never the cross-campaign consumer id. Unlinked rows send
  // without it (nothing to unsubscribe person-level yet). Mint failure never
  // blocks the email.
  let unsubscribeUrl = '';
  if (prospect.consumerId) {
    try {
      const token = await ensureUnsubToken(prospect.consumerId);
      const apiOrigin = process.env.API_PUBLIC_ORIGIN || 'https://api.mktr.sg';
      unsubscribeUrl = `${apiOrigin}/api/unsubscribe?t=${token}`;
    } catch (err) {
      logger.warn('Unsubscribe link mint failed (email sends without it)', { err: err?.message });
    }
  }
  const unsubscribeLine = unsubscribeUrl
    ? `<a href="${escapeHtml(unsubscribeUrl)}" style="color:inherit;text-decoration:underline;">Unsubscribe from marketing messages</a>`
    : '';
  const unsubscribeTextLine = unsubscribeUrl
    ? `Unsubscribe from marketing messages: ${unsubscribeUrl}`
    : '';
  const unsubHeaders = unsubscribeUrl
    ? {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      }
    : undefined;

  const fields = {
    firstName,
    campaignName,
    shareUrl: shareUrl || '',
    unsubscribeLine,
    unsubscribeTextLine,
    brandName,
    brandWordmark,
    footerEntity,
    year: new Date().getFullYear(),
    heroLogo,
    ...(isDraw
      ? { prize: luckyDraw.prize || campaignName, multiplier: luckyDraw.multiplier || 10 }
      : {}),
  };
  const escapeFields = new Set(['firstName', 'campaignName', 'shareUrl', 'prize']);
  const htmlTemplate = isDraw ? CONFIRMATION_EMAIL_DRAW_HTML : CONFIRMATION_EMAIL_HTML;
  const textTemplate = isDraw ? CONFIRMATION_EMAIL_DRAW_TXT : CONFIRMATION_EMAIL_TXT;
  const html = htmlTemplate.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    k in fields ? (escapeFields.has(k) ? escapeHtml(fields[k]) : String(fields[k])) : `{{${k}}}`
  );
  const text = textTemplate.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    k in fields ? String(fields[k]) : `{{${k}}}`
  );

  logger.info('Sending lead confirmation email', { to: prospect.email, prospectId: prospect.id, campaign: campaignName, brand: brandName });

  return sendEmail({
    to: prospect.email,
    subject,
    html,
    text,
    context: hostChoice,
    ...(unsubHeaders ? { headers: unsubHeaders } : {}),
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
