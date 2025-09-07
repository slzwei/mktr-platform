import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { DEFAULT_TENANT_ID } from './tenant.js';

// JWKS (central auth) support
let remoteJwks = null;
let expectedIssuer = null;
let expectedAudience = null;
if (process.env.AUTH_JWKS_URL) {
  try {
    remoteJwks = createRemoteJWKSet(new URL(process.env.AUTH_JWKS_URL));
    expectedIssuer = process.env.AUTH_ISSUER || null;
    expectedAudience = process.env.AUTH_AUDIENCE || null;
  } catch (_) {
    remoteJwks = null;
  }
}

async function mapJwtToUser(payload) {
  let user = null;
  if (payload?.sub) user = await User.findByPk(payload.sub);
  if (!user && payload?.email) user = await User.findOne({ where: { email: payload.email } });
  if (!user && String(process.env.ENABLE_AUTH_MAPPING).toLowerCase() === 'true' && payload?.email) {
    user = await User.create({
      email: payload.email,
      firstName: payload.name ? String(payload.name).split(' ')[0] : null,
      lastName: null,
      fullName: payload.name || null,
      role: 'customer',
      isActive: true,
      emailVerified: true
    });
  }
  if (user) {
    user.tid = payload?.tid || DEFAULT_TENANT_ID;
    return user;
  }
  return null;
}

// Verify JWT token
export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ success: false, message: 'Access token required' });
    }

    if (remoteJwks) {
      try {
        const { payload } = await jwtVerify(token, remoteJwks, {
          issuer: expectedIssuer || undefined,
          audience: expectedAudience || undefined
        });
        const user = await mapJwtToUser(payload);
        if (!user || !user.isActive) {
          return res.status(401).json({ success: false, message: 'Invalid or inactive user' });
        }
        user.lastLogin = new Date();
        await user.save();
        req.user = user;
        return next();
      } catch (_) {
        // fall through to legacy
      }
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const legacyUser = await User.findByPk(decoded.userId);
    if (!legacyUser || !legacyUser.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid or inactive user' });
    }
    legacyUser.lastLogin = new Date();
    await legacyUser.save();
    req.user = legacyUser;
    return next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// Check user roles
export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

// Admin only middleware
export const requireAdmin = requireRole('admin');

// Agent or Admin middleware
export const requireAgentOrAdmin = requireRole('agent', 'admin');

// Fleet Owner or Admin middleware
export const requireFleetOwnerOrAdmin = requireRole('fleet_owner', 'admin');

// Optional authentication (doesn't fail if no token)
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      let user = null;
      if (remoteJwks) {
        try {
          const { payload } = await jwtVerify(token, remoteJwks, {
            issuer: expectedIssuer || undefined,
            audience: expectedAudience || undefined
          });
          user = await mapJwtToUser(payload);
        } catch (_) {}
      }
      if (!user) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          user = await User.findByPk(decoded.userId);
        } catch (_) {}
      }
      if (user && user.isActive) req.user = user;
    }
    
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

// Generate JWT token
export const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// Verify email token
export const verifyEmailToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};
