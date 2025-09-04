export function getAgentInviteSubject(companyName = 'MKTR') {
  return `You are invited to join ${companyName} as an Agent`;
}

export function getAgentInviteEmail({
  firstName = 'there',
  inviteLink,
  companyName = 'MKTR',
  companyUrl,
  expiryDays = 7
}) {
  const safeLink = String(inviteLink || '').trim();
  const safeCompanyUrl = companyUrl || 'https://example.com';

  return `
<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${companyName} Agent Invitation</title>
    <style>
      /* Email-client-safe resets */
      body { margin:0; padding:0; background-color:#f6f9fc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', sans-serif; color:#0f172a; }
      a { color: inherit; text-decoration: none; }
      .container { width:100%; background:#f6f9fc; padding: 24px 0; }
      .card { max-width: 560px; margin: 0 auto; background:#ffffff; border-radius: 12px; overflow:hidden; box-shadow: 0 4px 16px rgba(2, 6, 23, 0.08); }
      .header { background: linear-gradient(135deg, #0ea5e9, #2563eb); padding: 24px; color:#ffffff; }
      .brand { font-size: 18px; font-weight: 700; letter-spacing: 0.2px; }
      .content { padding: 24px; }
      .greeting { font-size: 16px; margin: 0 0 12px 0; }
      .message { font-size: 14px; line-height: 22px; margin: 0 0 20px 0; color:#334155; }
      .cta-wrap { text-align:center; padding: 8px 0 20px; }
      .button { display: inline-block; background:#2563eb; color:#ffffff; padding: 12px 18px; border-radius: 8px; font-weight: 600; box-shadow: 0 4px 10px rgba(37, 99, 235, 0.3); }
      .note { font-size: 12px; color:#64748b; line-height: 18px; margin-top: 12px; }
      .divider { height:1px; background:#eef2f7; margin: 20px 0; }
      .linkbox { background:#f8fafc; border:1px solid #e2e8f0; padding: 12px; border-radius: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 12px; color:#334155; word-break: break-all; }
      .footer { padding: 16px 24px 24px; font-size:12px; color:#64748b; text-align:center; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="card">
        <div class="header">
          <div class="brand">${companyName}</div>
        </div>
        <div class="content">
          <p class="greeting">Hi ${firstName},</p>
          <p class="message">
            You have been invited to join <strong>${companyName}</strong> as an agent. Click the button below to accept your invitation and complete your registration.
          </p>
          <div class="cta-wrap">
            <a class="button" href="${safeLink}" target="_blank" rel="noopener noreferrer">Accept Invitation</a>
          </div>
          <div class="note">
            This link will expire in ${expiryDays} days. If the button does not work, copy and paste the URL below into your browser:
          </div>
          <div class="linkbox">${safeLink}</div>
          <div class="divider"></div>
          <p class="note">
            If you did not expect this email, you can safely ignore it.
          </p>
        </div>
        <div class="footer">
          <div>
            © ${new Date().getFullYear()} ${companyName}. All rights reserved.
          </div>
          <div>
            <a href="${safeCompanyUrl}" target="_blank" rel="noopener noreferrer">Visit ${companyName}</a>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>
`;
}

export function getAgentInviteText({ firstName = 'there', inviteLink, companyName = 'MKTR', expiryDays = 7 }) {
  return `Hi ${firstName},\n\nYou have been invited to join ${companyName} as an agent.\n\nAccept Invitation: ${inviteLink}\n\nThis link expires in ${expiryDays} days. If you did not expect this email, you can ignore it.`;
}


