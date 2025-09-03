import express from 'express';
import { Op } from 'sequelize';
import { User } from '../models/index.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';
import { googleLogin } from '../controllers/authController.js';

const router = express.Router();

// Register new user
router.post('/register', validate(schemas.userRegister), asyncHandler(async (req, res) => {
  const { email, password, firstName, lastName, phone, role, full_name, fullName } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ where: { email } });
  if (existingUser) {
    throw new AppError('User with this email already exists', 400);
  }

  // Create new user
  const user = await User.create({
    email,
    password,
    // Prefer explicit first/last, but allow single full name string
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    fullName: fullName || full_name || undefined,
    phone,
    role: role || 'customer',
    emailVerificationToken: uuidv4()
  });

  // Generate token
  const token = generateToken(user.id);

  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    data: {
      user: user.toJSON(),
      token
    }
  });
}));

// Login user
router.post('/login', validate(schemas.userLogin), asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Find user by email
  const user = await User.findOne({ 
    where: { email },
    attributes: { include: ['password'] }
  });

  if (!user) {
    throw new AppError('Invalid email or password', 401);
  }

  // Check password (returns false for OAuth-only users without password)
  const isValidPassword = await user.comparePassword(password);
  if (!isValidPassword) {
    throw new AppError('Invalid email or password', 401);
  }

  // Check if user is active
  if (!user.isActive) {
    throw new AppError('Account is deactivated', 401);
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save();

  // Generate token
  const token = generateToken(user.id);

  res.json({
    success: true,
    message: 'Login successful',
    data: {
      user: user.toJSON(),
      token
    }
  });
}));

// Get current user profile
router.get('/profile', authenticateToken, asyncHandler(async (req, res) => {
  // Include related profiles based on role
  const includeOptions = [];
  
  if (req.user.role === 'fleet_owner') {
    includeOptions.push({ association: 'fleetOwnerProfile' });
  } else if (req.user.role === 'driver') {
    includeOptions.push({ association: 'driverProfile' });
  }

  const user = await User.findByPk(req.user.id, {
    include: includeOptions
  });

  res.json({
    success: true,
    data: { user }
  });
}));

// Update user profile
router.put('/profile', authenticateToken, validate(schemas.userUpdate), asyncHandler(async (req, res) => {
  const { firstName, lastName, phone, avatar } = req.body;

  await req.user.update({
    firstName: firstName || req.user.firstName,
    lastName: lastName || req.user.lastName,
    phone: phone || req.user.phone,
    avatar: avatar || req.user.avatar
  });

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: { user: req.user.toJSON() }
  });
}));

// Change password
router.put('/change-password', authenticateToken, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new AppError('Current password and new password are required', 400);
  }

  if (newPassword.length < 6) {
    throw new AppError('New password must be at least 6 characters long', 400);
  }

  // Get user with password
  const user = await User.findByPk(req.user.id, {
    attributes: { include: ['password'] }
  });

  // Verify current password
  const isValidPassword = await user.comparePassword(currentPassword);
  if (!isValidPassword) {
    throw new AppError('Current password is incorrect', 400);
  }

  // Update password
  await user.update({ password: newPassword });

  res.json({
    success: true,
    message: 'Password changed successfully'
  });
}));

// Refresh token
router.post('/refresh', authenticateToken, asyncHandler(async (req, res) => {
  // Generate new token
  const token = generateToken(req.user.id);

  res.json({
    success: true,
    message: 'Token refreshed successfully',
    data: { token }
  });
}));

// Google OAuth login - use proper controller
router.post('/google', googleLogin);

// Google OAuth config check endpoint
router.get('/google/config', (req, res) => {
  res.json({
    success: true,
    data: { googleClientId: !!process.env.GOOGLE_CLIENT_ID }
  });
});

// Google OAuth callback endpoint
router.post('/google/callback', asyncHandler(async (req, res) => {
  const { code, state } = req.body;

  if (!code) {
    throw new AppError('Missing authorization code', 400);
  }

  console.log('🔍 Received OAuth callback with code');

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '', // Optional for public clients
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: `${req.get('origin') || 'http://localhost:5173'}/auth/google/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('❌ Token exchange failed:', errorData);
      throw new AppError('Failed to exchange authorization code', 400);
    }

    const tokens = await tokenResponse.json();
    console.log('✅ Token exchange successful');

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
    console.log('✅ User info retrieved:', { email: googleUser.email, name: googleUser.name });

    // Find or create user in our database
    let user = await User.findOne({ where: { email: googleUser.email } });
    
    if (!user) {
      // Create new user
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
        emailVerified: true, // Google emails are pre-verified
      });

      console.log('✅ New user created:', user.email);
    } else {
      console.log('✅ Existing user found:', user.email);
    }

    // Generate JWT token
    const token = generateToken(user.id);

    res.json({
      success: true,
      message: 'Google authentication successful',
      data: {
        user: user.toJSON(),
        token
      }
    });

  } catch (error) {
    console.error('❌ OAuth callback error:', error);
    throw new AppError(`Google authentication failed: ${error.message}`, 400);
  }
}));

// Logout (client-side token removal, but we can track it)
router.post('/logout', authenticateToken, asyncHandler(async (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
}));

// Verify email
router.get('/verify-email/:token', asyncHandler(async (req, res) => {
  const { token } = req.params;

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

  res.json({
    success: true,
    message: 'Email verified successfully'
  });
}));

// Request password reset
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw new AppError('Email is required', 400);
  }

  const user = await User.findOne({ where: { email } });
  if (!user) {
    // Don't reveal if email exists
    return res.json({
      success: true,
      message: 'If the email exists, a reset link has been sent'
    });
  }

  // Generate reset token
  const resetToken = uuidv4();
  const resetExpires = new Date(Date.now() + 3600000); // 1 hour

  await user.update({
    resetPasswordToken: resetToken,
    resetPasswordExpires: resetExpires
  });

  // TODO: Send email with reset link
  // await sendPasswordResetEmail(user.email, resetToken);

  res.json({
    success: true,
    message: 'If the email exists, a reset link has been sent'
  });
}));

// Reset password
router.post('/reset-password/:token', asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  if (!password || password.length < 6) {
    throw new AppError('Password must be at least 6 characters long', 400);
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

  res.json({
    success: true,
    message: 'Password reset successfully'
  });
}));

export default router;
