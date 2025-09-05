import express from 'express';
import Joi from 'joi';
import { sendEmail } from '../services/mailer.js';

const router = express.Router();

const contactSchema = Joi.object({
  name: Joi.string().min(2).max(200).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().max(50).allow('', null),
  company: Joi.string().max(200).allow('', null),
  // Optional role from the contact form dropdown
  userType: Joi.string()
    .valid('advertiser', 'phv_driver', 'fleet_owner', 'salesperson')
    .allow('', null),
  message: Joi.string().min(10).max(5000).required()
});

router.post('/', async (req, res, next) => {
  try {
    const { error, value } = contactSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid contact submission',
        errors: error.details.map(d => ({ field: d.path.join('.'), message: d.message }))
      });
    }

    const { name, email, phone, company, message, userType } = value;

    const roleLabels = {
      advertiser: 'Advertiser',
      phv_driver: 'PHV Driver',
      fleet_owner: 'Fleet Owner',
      salesperson: 'Salesperson'
    };

    const subject = `New Contact Form Submission — MKTR PTE. LTD.`;

    const html = `
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
                  ${userType ? `<tr><td style="padding:8px 0; color:#6b7280;">Role</td><td style="padding:8px 0; color:#111827; font-weight:600;">${escapeHtml(roleLabels[userType] || userType)}</td></tr>` : ''}
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

    const result = await sendEmail({
      to: 'shawnleeapps@gmail.com',
      subject,
      html,
      text: `New contact form submission\n\nName: ${name}\nEmail: ${email}\nRole: ${userType ? (roleLabels[userType] || userType) : '-'}\nCompany: ${company || '-'}\nPhone: ${phone || '-'}\n\nMessage:\n${message}`
    });

    if (!result.success) {
      // Even if mailer isn't configured, return success to the client to avoid leaking config state
      return res.status(200).json({ success: true, message: 'Message submitted successfully' });
    }

    return res.status(200).json({ success: true, message: 'Message sent successfully' });
  } catch (err) {
    return next(err);
  }
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default router;


