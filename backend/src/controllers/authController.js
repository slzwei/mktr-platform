import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import * as authService from '../services/authService.js';
import * as onboardingService from '../services/onboardingService.js';
import { setAuthCookie, clearAuthCookie } from '../utils/authCookie.js';

const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_STATE_MAX_AGE = 10 * 60 * 1000; // 10 minutes

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ─── Google ID-token login (existing, kept as-is) ───────────────────────────

export const googleLogin = async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({
        success: false,
        message: 'Missing Google credential',
      });
    }

    // 1) Verify Google ID token using Google public keys
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    const email = payload?.email;
    const googleSub = payload?.sub;
    if (!email || !googleSub) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token payload',
      });
    }

    // 2) Delegate find-or-create + JWT to authService
    const result = await authService.googleIdTokenLogin({
      email,
      googleSub,
      name: payload.name,
      picture: payload.picture,
    });

    setAuthCookie(res, result.token);
    return res.json({
      success: true,
      message: 'Google authentication successful',
      data: {
        user: {
          id: result.user.id,
          email: result.user.email,
          role: result.user.role,
          // Redeem Ops sub-role — frontend capability checks read this
          // (src/lib/redeemOpsPermissions.js); the other auth flows return
          // toJSON() which includes it, so this hand-built shape must too.
          redeemOpsRole: result.user.redeemOpsRole,
          full_name: result.user.fullName,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          avatarUrl: result.user.avatarUrl,
          isActive: result.user.isActive,
          lastLogin: result.user.lastLogin,
        },
      },
    });
  } catch (err) {
    logger.error('googleLogin error', { error: err?.message || String(err) });

    // More specific error handling
    if (err.message && err.message.includes('Token used too late')) {
      return res.status(401).json({
        success: false,
        message: 'Google token has expired. Please try again.',
      });
    }

    if (err.message && err.message.includes('Wrong recipient')) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token audience.',
      });
    }

    // Pass through AppError status codes (e.g., 403 for inactive user)
    if (err.statusCode && err.statusCode !== 500) {
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Google authentication failed. Please try again.',
    });
  }
};

// Environment validation helper
export const validateGoogleOAuthConfig = () => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    logger.warn('GOOGLE_CLIENT_ID is not configured in environment variables');
    return false;
  }

  if (!process.env.JWT_SECRET) {
    logger.error('JWT_SECRET is required but not configured');
    return false;
  }

  logger.info('Google OAuth configuration validated');
  return true;
};

// ─── Auth controller methods (delegate to authService) ──────────────────────

export const register = asyncHandler(async (req, res) => {
  const { email, password, firstName, lastName, phone, full_name, fullName } = req.body;

  // Never trust client-supplied role on self-registration
  const role = 'customer';

  const result = await authService.register({
    email,
    password,
    firstName,
    lastName,
    fullName: fullName || full_name || undefined,
    phone,
    role,
  });

  setAuthCookie(res, result.token);
  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    data: {
      user: result.user.toJSON(),
    },
  });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const result = await authService.login(email, password);

  setAuthCookie(res, result.token);
  res.json({
    success: true,
    message: 'Login successful',
    data: {
      user: result.user.toJSON(),
    },
  });
});

export const getProfile = asyncHandler(async (req, res) => {
  const user = await authService.getProfile(req.user.id, req.user.role);

  res.json({
    success: true,
    data: { user },
  });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const { firstName, lastName, phone, avatar, dateOfBirth, companyName, email } = req.body;

  const user = await authService.updateProfile(req.user, {
    firstName,
    lastName,
    phone,
    avatar,
    dateOfBirth,
    companyName,
    email,
  });

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: { user: user.toJSON() },
  });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  await authService.changePassword(req.user.id, currentPassword, newPassword);

  res.json({
    success: true,
    message: 'Password changed successfully',
  });
});

export const refreshToken = asyncHandler(async (req, res) => {
  const result = authService.refreshToken(req.user.id);

  setAuthCookie(res, result.token);
  res.json({
    success: true,
    message: 'Token refreshed successfully',
  });
});

export const generateOAuthState = asyncHandler(async (req, res) => {
  const state = crypto.randomBytes(32).toString('hex');

  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_STATE_MAX_AGE,
  });

  res.json({ success: true, data: { state } });
});

export const googleOAuthCallback = asyncHandler(async (req, res) => {
  const { code, state } = req.body;

  if (!code) {
    throw new AppError('Missing authorization code', 400);
  }

  // Validate OAuth state nonce to prevent CSRF (RFC 6749 Section 10.12)
  const storedState = req.cookies?.[OAUTH_STATE_COOKIE];
  if (!state || !storedState || state !== storedState) {
    logger.warn('OAuth state mismatch', { hasState: !!state, hasStoredState: !!storedState });
    throw new AppError('Invalid OAuth state. Please try again.', 403);
  }

  // Clear the state cookie after validation
  res.clearCookie(OAUTH_STATE_COOKIE, { path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });

  logger.debug('Received OAuth callback with code');

  try {
    const origin = req.get('origin');
    const result = await authService.googleOAuthCallback(code, origin);

    setAuthCookie(res, result.token);
    res.json({
      success: true,
      message: 'Google authentication successful',
      data: {
        user: result.user.toJSON(),
      },
    });
  } catch (error) {
    logger.error('Google OAuth callback error', { error: error?.message || String(error) });
    throw new AppError('Google authentication failed. Please try again.', 400);
  }
});

export const googleConfigCheck = (req, res) => {
  res.json({
    success: true,
    data: { googleClientId: !!process.env.GOOGLE_CLIENT_ID },
  });
};

export const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.params;

  await authService.verifyEmail(token);

  res.json({
    success: true,
    message: 'Email verified successfully',
  });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  await authService.forgotPassword(email);

  // Never return the reset token — it should only be sent via email
  // Use a generic message to prevent email enumeration
  res.json({
    success: true,
    message: 'If an account with that email exists, a password reset link has been sent.',
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  await authService.resetPassword(token, password);

  res.json({
    success: true,
    message: 'Password reset successfully',
  });
});

export const getInviteInfo = asyncHandler(async (req, res) => {
  const { token } = req.params;

  const info = await authService.getInviteInfo(token);

  res.json({
    success: true,
    data: info,
  });
});

export const acceptInvite = asyncHandler(async (req, res) => {
  const { token, email, password, full_name, phone, dateOfBirth } = req.body;

  const result = await authService.acceptInvite({
    token,
    email,
    password,
    fullName: full_name,
    phone,
    dateOfBirth,
  });

  setAuthCookie(res, result.token);
  res.json({
    success: true,
    message: 'Invitation accepted',
    data: { user: result.user.toJSON() },
  });
});

export const logout = asyncHandler(async (req, res) => {
  clearAuthCookie(res);
  res.json({
    success: true,
    message: 'Logged out successfully',
  });
});

// ─── Onboarding controller methods (delegate to onboardingService) ──────────

export const updateRole = asyncHandler(async (req, res) => {
  const { role } = req.body;

  const user = await onboardingService.updateRole(req.user, role);

  res.json({ success: true, message: 'Role updated', data: { user: user.toJSON() } });
});

export const savePayout = asyncHandler(async (req, res) => {
  const { method, paynowId, bankName, bankAccount } = req.body;

  const payout = await onboardingService.savePayout(req.user.id, {
    method,
    paynowId,
    bankName,
    bankAccount,
  });

  res.json({ success: true, data: { payout } });
});

export const createCar = asyncHandler(async (req, res) => {
  const { plate_number, make, model } = req.body;

  const car = await onboardingService.createCar(
    req.user.id,
    req.user.role,
    req.user.email,
    req.user.fullName,
    req.user.phone,
    { plateNumber: plate_number, make, model }
  );

  res.status(201).json({ success: true, data: { car } });
});

export const bulkCreateCars = asyncHandler(async (req, res) => {
  const { cars } = req.body;

  const created = await onboardingService.bulkCreateCars(
    req.user.id,
    req.user.email,
    req.user.fullName,
    req.user.phone,
    req.user.role,
    cars
  );

  res.status(201).json({ success: true, data: { cars: created } });
});
