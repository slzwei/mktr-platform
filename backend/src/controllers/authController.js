import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const googleLogin = async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing Google credential' 
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
        message: 'Invalid Google token payload' 
      });
    }

    // 2) Find or create local user
    let user = await User.findOne({ where: { email } });
    if (!user) {
      // Extract name parts
      const fullName = payload.name || '';
      const nameParts = fullName.split(' ');
      const firstName = nameParts[0] || 'Google';
      const lastName = nameParts.slice(1).join(' ') || 'User';

      user = await User.create({
        email,
        firstName,
        lastName,
        fullName,
        avatarUrl: payload.picture || '',
        role: 'customer',
        isActive: true,
        googleSub,
        lastLogin: new Date(),
        emailVerified: true, // Google accounts are pre-verified
        password: null // No password for Google OAuth users
      });
    } else {
      // Update existing user with Google info if missing
      if (!user.googleSub) user.googleSub = googleSub;
      if (!user.fullName && payload.name) user.fullName = payload.name;
      if (!user.avatarUrl && payload.picture) user.avatarUrl = payload.picture;
      user.lastLogin = new Date();
      await user.save();
    }

    if (!user.isActive) {
      return res.status(403).json({ 
        success: false, 
        message: 'User account is inactive' 
      });
    }

    // 3) Issue our app JWT for session
    const token = jwt.sign(
      { 
        userId: user.id, 
        role: user.role,
        email: user.email 
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.json({
      success: true,
      message: 'Google authentication successful',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          full_name: user.fullName,
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl: user.avatarUrl,
          isActive: user.isActive,
          lastLogin: user.lastLogin
        },
      },
    });
  } catch (err) {
    console.error('googleLogin error:', err);
    
    // More specific error handling
    if (err.message && err.message.includes('Token used too late')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Google token has expired. Please try again.' 
      });
    }
    
    if (err.message && err.message.includes('Wrong recipient')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid Google token audience.' 
      });
    }

    return res.status(401).json({ 
      success: false, 
      message: 'Google authentication failed. Please try again.' 
    });
  }
};

// Environment validation helper
export const validateGoogleOAuthConfig = () => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.warn('⚠️  WARNING: GOOGLE_CLIENT_ID is not configured in environment variables');
    return false;
  }
  
  if (!process.env.JWT_SECRET) {
    console.error('❌ ERROR: JWT_SECRET is required but not configured');
    return false;
  }
  
  console.log('✅ Google OAuth configuration validated');
  return true;
};
