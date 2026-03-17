import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../models/index.js';
import { generateToken } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

/**
 * Register a new user.
 * @returns {{ user: object, token: string }}
 */
export async function register({ email, password, firstName, lastName, fullName, phone, role }) {
  const existingUser = await User.findOne({ where: { email } });
  if (existingUser) {
    throw new AppError('User with this email already exists', 400);
  }

  const user = await User.create({
    email,
    password,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    fullName: fullName || undefined,
    phone,
    role: role || 'customer',
    emailVerificationToken: uuidv4()
  });

  const token = generateToken(user.id);

  return { user, token };
}

/**
 * Authenticate a user with email + password.
 * @returns {{ user: object, token: string }}
 */
export async function login(email, password) {
  const user = await User.findOne({
    where: { email },
    attributes: { include: ['password'] }
  });

  if (!user) {
    throw new AppError('Invalid email or password', 401);
  }

  const isValidPassword = await user.comparePassword(password);
  if (!isValidPassword) {
    throw new AppError('Invalid email or password', 401);
  }

  if (!user.isActive) {
    throw new AppError('Account is deactivated', 401);
  }

  if (user.role === 'agent' && user.invitationToken) {
    throw new AppError('Please accept your invitation via the email link before logging in.', 403);
  }

  user.lastLogin = new Date();
  await user.save();

  const token = generateToken(user.id);

  return { user, token };
}

/**
 * Change password for an authenticated user.
 */
export async function changePassword(userId, currentPassword, newPassword) {
  if (!currentPassword || !newPassword) {
    throw new AppError('Current password and new password are required', 400);
  }

  if (newPassword.length < 8) {
    throw new AppError('New password must be at least 8 characters long', 400);
  }

  const user = await User.findByPk(userId, {
    attributes: { include: ['password'] }
  });

  const isValidPassword = await user.comparePassword(currentPassword);
  if (!isValidPassword) {
    throw new AppError('Current password is incorrect', 400);
  }

  await user.update({ password: newPassword });

  return user;
}

/**
 * Issue a fresh JWT for an existing session.
 * @returns {{ token: string }}
 */
export function refreshToken(userId) {
  const token = generateToken(userId);
  return { token };
}

/**
 * Get user profile with role-specific associations.
 */
export async function getProfile(userId, userRole) {
  const includeOptions = [];

  if (userRole === 'fleet_owner') {
    includeOptions.push({ association: 'fleetOwnerProfile' });
  } else if (userRole === 'driver') {
    includeOptions.push({ association: 'driverProfile' });
  }
  includeOptions.push({ association: 'payout', required: false });

  const user = await User.findByPk(userId, {
    include: includeOptions
  });

  return user;
}

/**
 * Update user profile fields.
 */
export async function updateProfile(user, { firstName, lastName, phone, avatar, dateOfBirth, companyName, email }) {
  // If email is changing, ensure uniqueness
  if (email && email !== user.email) {
    if (user.googleSub && user.role !== 'admin') {
      throw new AppError('Email for Google-linked account cannot be changed. Contact support.', 400);
    }
    const existing = await User.findOne({ where: { email } });
    if (existing) {
      throw new AppError('Email is already in use', 400);
    }
  }

  await user.update({
    email: email || user.email,
    firstName: firstName || user.firstName,
    lastName: lastName || user.lastName,
    phone: phone || user.phone,
    avatar: avatar || user.avatar,
    dateOfBirth: dateOfBirth || user.dateOfBirth,
    companyName: companyName || user.companyName
  });

  return user;
}

/**
 * Handle Google ID-token login (legacy one-tap flow).
 * Finds or creates a local user from verified Google token payload fields.
 * @returns {{ user: object, token: string }}
 */
export async function googleIdTokenLogin({ email, googleSub, name, picture }) {
  let user = await User.findOne({ where: { email } });

  if (!user) {
    const fullName = name || '';
    const nameParts = fullName.split(' ');
    const firstName = nameParts[0] || 'Google';
    const lastName = nameParts.slice(1).join(' ') || 'User';

    user = await User.create({
      email,
      firstName,
      lastName,
      fullName,
      avatarUrl: picture || '',
      role: 'customer',
      isActive: true,
      googleSub,
      lastLogin: new Date(),
      emailVerified: true,
      password: null
    });
  } else {
    if (!user.googleSub) user.googleSub = googleSub;
    if (!user.fullName && name) user.fullName = name;
    if (!user.avatarUrl && picture) user.avatarUrl = picture;
    user.lastLogin = new Date();
    await user.save();
  }

  if (!user.isActive) {
    throw new AppError('User account is inactive', 403);
  }

  const token = generateToken(user.id);

  return { user, token };
}

/**
 * Google OAuth code-exchange callback.
 * Exchanges authorization code for tokens, fetches Google profile, and
 * finds-or-creates a local user.
 * @returns {{ user: object, token: string }}
 */
export async function googleOAuthCallback(code, origin) {
  // Determine redirect_uri that matches the initial Google auth request
  const explicitRedirectUri = process.env.GOOGLE_REDIRECT_URI;
  const isLocalhost = origin && (origin.includes('localhost') || origin.includes('127.0.0.1'));

  const derivedFrontendBaseUrl = isLocalhost
    ? origin
    : (process.env.FRONTEND_BASE_URL || origin || 'http://localhost:5173');

  const finalRedirectUri = explicitRedirectUri
    || `${derivedFrontendBaseUrl}/auth/google/callback`;

  logger.debug('OAuth token exchange redirect_uri', { redirectUri: finalRedirectUri });

  // Exchange authorization code for tokens
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: finalRedirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    const errorData = await tokenResponse.text();
    logger.error('Token exchange failed', { error: errorData });
    throw new AppError('Failed to exchange authorization code', 400);
  }

  const tokens = await tokenResponse.json();
  logger.debug('Token exchange successful');

  // Get user info from Google
  const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
    },
  });

  if (!userResponse.ok) {
    throw new AppError('Failed to get user information', 400);
  }

  const googleUser = await userResponse.json();
  logger.debug('Google user info retrieved successfully');

  // Find or create user — check googleSub (hard link) OR email (soft link)
  let user = await User.findOne({
    where: {
      [Op.or]: [
        { googleSub: googleUser.id },
        { email: googleUser.email }
      ]
    }
  });

  if (!user) {
    const nameParts = (googleUser.name || '').split(' ');
    const firstName = nameParts[0] || 'Google';
    const lastName = nameParts.slice(1).join(' ') || 'User';

    user = await User.create({
      email: googleUser.email,
      firstName,
      lastName,
      fullName: googleUser.name || `${firstName} ${lastName}`,
      avatarUrl: googleUser.picture || '',
      role: 'customer',
      isActive: true,
      emailVerified: true,
      googleSub: googleUser.id
    });

    logger.info('New user created via Google OAuth');
  } else {
    logger.debug('Existing user found via Google OAuth');

    if (user.role === 'agent' && user.invitationToken) {
      throw new AppError('Please accept your invitation via the email link before logging in.', 403);
    }

    if (!user.googleSub) {
      logger.info('Linking existing user to Google ID (hardening)');
      await user.update({ googleSub: googleUser.id });
    } else if (user.googleSub !== googleUser.id) {
      if (user.googleSub && user.googleSub !== googleUser.id) {
        logger.warn('Google ID mismatch for user. Stored sub differs from incoming sub.', { userId: user.id });
      }
    }
  }

  const token = generateToken(user.id);

  return { user, token };
}

/**
 * Verify a user's email via verification token.
 */
export async function verifyEmail(token) {
  const user = await User.findOne({
    where: { emailVerificationToken: token }
  });

  if (!user) {
    throw new AppError('Invalid verification token', 400);
  }

  await user.update({
    emailVerified: true,
    emailVerificationToken: null
  });

  return user;
}

/**
 * Initiate password reset flow. Returns resetToken if user exists, null otherwise.
 * Caller should NOT reveal to client whether user was found.
 * @returns {{ resetToken: string|null }}
 */
export async function forgotPassword(email) {
  if (!email) {
    throw new AppError('Email is required', 400);
  }

  const user = await User.findOne({ where: { email } });
  if (!user) {
    return { resetToken: null };
  }

  const resetToken = uuidv4();
  const resetExpires = new Date(Date.now() + 3600000); // 1 hour

  await user.update({
    resetPasswordToken: resetToken,
    resetPasswordExpires: resetExpires
  });

  return { resetToken };
}

/**
 * Reset password using a valid reset token.
 */
export async function resetPassword(token, password) {
  if (!password || password.length < 8) {
    throw new AppError('Password must be at least 8 characters long', 400);
  }

  const user = await User.findOne({
    where: {
      resetPasswordToken: token,
      resetPasswordExpires: { [Op.gt]: new Date() }
    }
  });

  if (!user) {
    throw new AppError('Invalid or expired reset token', 400);
  }

  await user.update({
    password,
    resetPasswordToken: null,
    resetPasswordExpires: null
  });

  return user;
}

/**
 * Get invite info by token.
 */
export async function getInviteInfo(token) {
  const user = await User.findOne({
    where: { invitationToken: token },
    attributes: ['email', 'firstName', 'lastName', 'fullName', 'phone', 'invitationExpires']
  });

  if (!user) {
    throw new AppError('Invalid invitation token', 400);
  }

  if (user.invitationExpires && new Date(user.invitationExpires).getTime() < Date.now()) {
    throw new AppError('Invitation has expired', 400);
  }

  return {
    email: user.email,
    fullName: user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
    phone: user.phone
  };
}

/**
 * Accept an invitation — set password, mark verified, clear token.
 * @returns {{ user: object, token: string }}
 */
export async function acceptInvite({ token, email, password, fullName, phone, dateOfBirth }) {
  if (!token || !email || !password) {
    throw new AppError('token, email and password are required', 400);
  }

  const user = await User.findOne({ where: { email, invitationToken: token } });
  if (!user) {
    throw new AppError('Invalid invitation token', 400);
  }

  if (user.invitationExpires && new Date(user.invitationExpires).getTime() < Date.now()) {
    throw new AppError('Invitation has expired', 400);
  }

  let firstName = user.firstName;
  let lastName = user.lastName;
  if (fullName) {
    const parts = String(fullName).trim().split(/\s+/);
    firstName = parts[0] || firstName;
    lastName = parts.slice(1).join(' ') || lastName;
  }

  await user.update({
    password,
    firstName,
    lastName,
    phone: phone || user.phone,
    dateOfBirth: dateOfBirth || user.dateOfBirth,
    emailVerified: true,
    invitationToken: null,
    invitationExpires: null
  });

  const tokenJwt = generateToken(user.id);

  return { user, token: tokenJwt };
}
