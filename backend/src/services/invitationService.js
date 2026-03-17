import { v4 as uuidv4 } from 'uuid';
import { User } from '../models/index.js';
import { sendEmail } from './mailer.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

/**
 * Send a role-based invitation to a new user.
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.fullName
 * @param {string} params.role - 'agent' | 'fleet_owner' | 'driver_partner'
 * @param {string} params.inviterEmail - to prevent self-invite
 * @param {Object} [params.extraFields] - e.g. { owed_leads_count: 5 }
 * @param {Function} params.getEmailContent - function({ firstName, inviteLink, companyName, companyUrl, expiryDays, roleLabel }) => { subject, html, text }
 * @returns {Promise<{ user: Object, inviteLink: string }>}
 */
export async function sendRoleInvitation({ email, fullName, role, inviterEmail, extraFields = {}, getEmailContent }) {
  if (!email || !fullName) {
    throw new AppError('email and full_name are required', 400);
  }

  // Prevent self-invite
  if (inviterEmail && String(inviterEmail).toLowerCase() === String(email).toLowerCase()) {
    throw new AppError('You cannot invite your own email address', 400);
  }

  // Check for existing user
  const existing = await User.findOne({ where: { email } });
  if (existing) {
    throw new AppError('A user with this email already exists. Permanently delete the existing user first to send a new invitation.', 400);
  }

  // Parse full name into first/last
  const nameParts = String(fullName).trim().split(/\s+/);
  const firstName = nameParts[0] || 'User';
  const lastName = nameParts.slice(1).join(' ') || '';

  // Generate invitation token + expiry (7 days)
  const invitationToken = uuidv4();
  const invitationExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Create user record
  const user = await User.create({
    email,
    firstName,
    lastName,
    role,
    isActive: true,
    emailVerified: false,
    invitationToken,
    invitationExpires,
    ...extraFields
  });

  // Build invite link
  const frontendBase = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';
  const inviteLink = `${frontendBase}/auth/accept-invite?token=${encodeURIComponent(invitationToken)}&email=${encodeURIComponent(email)}`;

  // Get email content from caller-provided template function and send
  const companyName = process.env.COMPANY_NAME || 'MKTR';
  const companyUrl = process.env.COMPANY_URL || process.env.FRONTEND_BASE_URL || 'http://localhost:5173';
  const roleLabel = role === 'agent' ? 'Agent' : role === 'fleet_owner' ? 'Fleet Owner' : 'Driver Partner';

  const { subject, html, text } = getEmailContent({
    firstName,
    inviteLink,
    companyName,
    companyUrl,
    expiryDays: 7,
    roleLabel
  });

  try {
    await sendEmail({ to: email, subject, html, text });
  } catch (emailError) {
    logger.error('Failed to send invite email', { error: emailError?.message || String(emailError) });
    // Don't fail the request; user is created and link is returned
  }

  return { user, inviteLink };
}
