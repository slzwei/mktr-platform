import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { DEFAULT_TENANT_ID } from './tenant.js';
import { logger } from '../utils/logger.js';
import { COOKIE_NAME } from '../utils/authCookie.js';

// Hard check: JWT_SECRET must be set or all token operations fail-safe
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not configured');
  }
  return secret;
}

// Lazy JWKS (central auth) support — initialized on first access
let _remoteJwks = undefined; // undefined = not yet initialized
let _expectedIssuer = null;
let _expectedAudience = null;

function getRemoteJwks() {
  if (_remoteJwks !== undefined) return _remoteJwks;
  if (process.env.AUTH_JWKS_URL) {
    // Require issuer and audience when JWKS is enabled
    if (!process.env.AUTH_ISSUER || !process.env.AUTH_AUDIENCE) {
      logger.error('AUTH_ISSUER and AUTH_AUDIENCE must be set when AUTH_JWKS_URL is configured');
      _remoteJwks = null;
      return null;
    }
    try {
      _remoteJwks = createRemoteJWKSet(new URL(process.env.AUTH_JWKS_URL));
      _expectedIssuer = process.env.AUTH_ISSUER;
      _expectedAudience = process.env.AUTH_AUDIENCE;
    } catch (_) {
      _remoteJwks = null;
    }
  } else {
    _remoteJwks = null;
  }
  return _remoteJwks;
}

function getExpectedIssuer() {
  getRemoteJwks(); // ensure initialized
  return _expectedIssuer;
}

function getExpectedAudience() {
  getRemoteJwks(); // ensure initialized
  return _expectedAudience;
}

// Test injection hook for user lookup
let _userLookup = null;

export function setUserLookup(fn) {
  _userLookup = fn;
}

async function mapJwtToUser(payload) {
  if (_userLookup) return _userLookup(payload);
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
      emailVerified: true,
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
    // Read token: cookie first, then Authorization header
    const cookieToken = req.cookies?.[COOKIE_NAME];
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.split(' ')[1];
    const token = cookieToken || bearerToken;

    if (!token) {
      return res.status(401).json({ success: false, message: 'Access token required' });
    }

    if (getRemoteJwks()) {
      try {
        const { payload } = await jwtVerify(token, getRemoteJwks(), {
          issuer: getExpectedIssuer() || undefined,
          audience: getExpectedAudience() || undefined,
        });
        const user = await mapJwtToUser(payload);
        if (!user || !user.isActive) {
          return res.status(401).json({ success: false, message: 'Invalid or inactive user' });
        }
        // Debounce lastLogin writes — only update if stale by 5+ minutes
        const fiveMinutes = 5 * 60 * 1000;
        if (!user.lastLogin || Date.now() - new Date(user.lastLogin).getTime() > fiveMinutes) {
          user.lastLogin = new Date();
          user.save().catch(() => {}); // fire-and-forget, don't block the request
        }
        req.user = user;
        return next();
      } catch (_) {
        // fall through to legacy
      }
    }

    const decoded = jwt.verify(token, getJwtSecret());
    const legacyUser = await User.findByPk(decoded.userId);
    if (!legacyUser || !legacyUser.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid or inactive user' });
    }
    // Debounce lastLogin writes — only update if stale by 5+ minutes
    const fiveMinutes = 5 * 60 * 1000;
    if (!legacyUser.lastLogin || Date.now() - new Date(legacyUser.lastLogin).getTime() > fiveMinutes) {
      legacyUser.lastLogin = new Date();
      legacyUser.save().catch(() => {}); // fire-and-forget, don't block the request
    }
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
        message: 'Authentication required',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
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
    // Read token: cookie first, then Authorization header
    const cookieToken = req.cookies?.[COOKIE_NAME];
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.split(' ')[1];
    const token = cookieToken || bearerToken;

    if (token) {
      let user = null;
      if (getRemoteJwks()) {
        try {
          const { payload } = await jwtVerify(token, getRemoteJwks(), {
            issuer: getExpectedIssuer() || undefined,
            audience: getExpectedAudience() || undefined,
          });
          user = await mapJwtToUser(payload);
        } catch (_) {
          /* expected: token verification may fail */
        }
      }
      if (!user) {
        try {
          const decoded = jwt.verify(token, getJwtSecret());
          user = await User.findByPk(decoded.userId);
        } catch (_) {
          /* expected: token verification may fail */
        }
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
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
};

// Verify email token
export const verifyEmailToken = (token) => {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (error) {
    return null;
  }
};
