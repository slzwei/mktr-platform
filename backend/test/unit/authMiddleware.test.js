import { jest } from '@jest/globals';
import '../setup.js';
import jwt from 'jsonwebtoken';

// ── Mock dependencies ──

const mockUser = {
  id: 'user-1',
  email: 'test@test.com',
  role: 'admin',
  isActive: true,
  lastLogin: null,
  save: jest.fn().mockResolvedValue(true),
};

jest.unstable_mockModule('../../src/models/index.js', () => ({
  User: {
    findByPk: jest.fn().mockResolvedValue(mockUser),
    findOne: jest.fn().mockResolvedValue(mockUser),
    create: jest.fn().mockResolvedValue(mockUser),
  },
}));

jest.unstable_mockModule('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
}));

jest.unstable_mockModule('../../src/middleware/tenant.js', () => ({
  DEFAULT_TENANT_ID: 'default-tenant',
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.unstable_mockModule('../../src/utils/authCookie.js', () => ({
  COOKIE_NAME: 'mktr_session',
}));

const {
  authenticateToken,
  requireRole,
  requireAdmin,
  optionalAuth,
  generateToken,
  verifyEmailToken,
} = await import('../../src/middleware/auth.js');

const { User } = await import('../../src/models/index.js');

// Helper to build mock req/res/next
function buildReqRes(overrides = {}) {
  const req = {
    cookies: {},
    headers: {},
    user: null,
    ...overrides,
  };

  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  const next = jest.fn();

  return { req, res, next };
}

// ── Tests ──

describe('authMiddleware (unit)', () => {
  const JWT_SECRET = process.env.JWT_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    User.findByPk.mockResolvedValue(mockUser);
  });

  // ────────────────────────────────────────────────
  // authenticateToken
  // ────────────────────────────────────────────────

  describe('authenticateToken', () => {
    it('returns 401 when no token provided', async () => {
      const { req, res, next } = buildReqRes();

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Access token required' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('authenticates valid JWT from Authorization header', async () => {
      const token = jwt.sign({ userId: 'user-1' }, JWT_SECRET, { expiresIn: '1h' });
      const { req, res, next } = buildReqRes({
        headers: { authorization: `Bearer ${token}` },
      });

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe('user-1');
    });

    it('authenticates valid JWT from cookie', async () => {
      const token = jwt.sign({ userId: 'user-1' }, JWT_SECRET, { expiresIn: '1h' });
      const { req, res, next } = buildReqRes({
        cookies: { mktr_session: token },
      });

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
    });

    it('returns 401 for expired JWT', async () => {
      const token = jwt.sign({ userId: 'user-1' }, JWT_SECRET, { expiresIn: '-1s' });
      const { req, res, next } = buildReqRes({
        headers: { authorization: `Bearer ${token}` },
      });

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Token expired' })
      );
    });

    it('returns 401 for wrong secret', async () => {
      const token = jwt.sign({ userId: 'user-1' }, 'wrong-secret', { expiresIn: '1h' });
      const { req, res, next } = buildReqRes({
        headers: { authorization: `Bearer ${token}` },
      });

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid token' })
      );
    });

    it('returns 401 for malformed token', async () => {
      const { req, res, next } = buildReqRes({
        headers: { authorization: 'Bearer not.a.valid.jwt' },
      });

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 401 for inactive user', async () => {
      const token = jwt.sign({ userId: 'user-1' }, JWT_SECRET, { expiresIn: '1h' });
      User.findByPk.mockResolvedValue({ ...mockUser, isActive: false });

      const { req, res, next } = buildReqRes({
        headers: { authorization: `Bearer ${token}` },
      });

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid or inactive user' })
      );
    });

    it('returns 401 when user not found in DB', async () => {
      const token = jwt.sign({ userId: 'nonexistent' }, JWT_SECRET, { expiresIn: '1h' });
      User.findByPk.mockResolvedValue(null);

      const { req, res, next } = buildReqRes({
        headers: { authorization: `Bearer ${token}` },
      });

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  // ────────────────────────────────────────────────
  // requireRole
  // ────────────────────────────────────────────────

  describe('requireRole', () => {
    it('allows user with matching role', () => {
      const middleware = requireRole('admin', 'agent');
      const { req, res, next } = buildReqRes();
      req.user = { role: 'admin' };

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('blocks user with non-matching role', () => {
      const middleware = requireRole('admin');
      const { req, res, next } = buildReqRes();
      req.user = { role: 'agent' };

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Insufficient permissions' })
      );
    });

    it('returns 401 when no user on request', () => {
      const middleware = requireRole('admin');
      const { req, res, next } = buildReqRes();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('allows multiple roles', () => {
      const middleware = requireRole('agent', 'admin');
      const { req, res, next } = buildReqRes();
      req.user = { role: 'agent' };

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // requireAdmin
  // ────────────────────────────────────────────────

  describe('requireAdmin', () => {
    it('allows admin user', () => {
      const { req, res, next } = buildReqRes();
      req.user = { role: 'admin' };

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('blocks agent user', () => {
      const { req, res, next } = buildReqRes();
      req.user = { role: 'agent' };

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('blocks customer user', () => {
      const { req, res, next } = buildReqRes();
      req.user = { role: 'customer' };

      requireAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ────────────────────────────────────────────────
  // optionalAuth
  // ────────────────────────────────────────────────

  describe('optionalAuth', () => {
    it('sets req.user when valid token provided', async () => {
      const token = jwt.sign({ userId: 'user-1' }, JWT_SECRET, { expiresIn: '1h' });
      const { req, res, next } = buildReqRes({
        headers: { authorization: `Bearer ${token}` },
      });

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
    });

    it('continues with null user when no token', async () => {
      const { req, res, next } = buildReqRes();

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeNull();
    });

    it('continues with null user when token is invalid', async () => {
      const { req, res, next } = buildReqRes({
        headers: { authorization: 'Bearer invalid-token' },
      });

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      // User should not be set (remains null)
    });
  });

  // ────────────────────────────────────────────────
  // generateToken
  // ────────────────────────────────────────────────

  describe('generateToken', () => {
    it('returns a valid JWT', () => {
      const token = generateToken('user-1');

      expect(token).toBeDefined();
      const decoded = jwt.verify(token, JWT_SECRET);
      expect(decoded.userId).toBe('user-1');
    });

    it('includes userId in payload', () => {
      const token = generateToken('user-123');
      const decoded = jwt.decode(token);

      expect(decoded.userId).toBe('user-123');
    });
  });

  // ────────────────────────────────────────────────
  // generateToken edge cases
  // ────────────────────────────────────────────────

  describe('generateToken (edge cases)', () => {
    it('produces different tokens for different user IDs', () => {
      const token1 = generateToken('user-1');
      const token2 = generateToken('user-2');

      expect(token1).not.toBe(token2);
    });

    it('token has standard JWT format (3 dot-separated parts)', () => {
      const token = generateToken('user-1');
      const parts = token.split('.');

      expect(parts).toHaveLength(3);
    });

    it('token has expiration', () => {
      const token = generateToken('user-1');
      const decoded = jwt.decode(token);

      expect(decoded.exp).toBeDefined();
      expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });

  // ────────────────────────────────────────────────
  // authenticateToken edge cases
  // ────────────────────────────────────────────────

  describe('authenticateToken (edge cases)', () => {
    it('accepts token from cookie when header is absent', async () => {
      const token = jwt.sign({ userId: 'user-1' }, JWT_SECRET, { expiresIn: '1h' });

      const { req, res, next } = buildReqRes({
        cookies: { mktr_session: token },
      });

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
    });

    it('handles empty authorization header', async () => {
      const { req, res, next } = buildReqRes({
        headers: { authorization: '' },
      });

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('handles authorization header without Bearer prefix', async () => {
      const token = jwt.sign({ userId: 'user-1' }, JWT_SECRET, { expiresIn: '1h' });
      const { req, res, next } = buildReqRes({
        headers: { authorization: token }, // no "Bearer " prefix
      });

      await authenticateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  // ────────────────────────────────────────────────
  // requireRole edge cases
  // ────────────────────────────────────────────────

  describe('requireRole (edge cases)', () => {
    it('blocks driver_partner from admin-only routes', () => {
      const middleware = requireRole('admin');
      const { req, res, next } = buildReqRes();
      req.user = { role: 'driver_partner' };

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('blocks fleet_owner from agent routes', () => {
      const middleware = requireRole('agent');
      const { req, res, next } = buildReqRes();
      req.user = { role: 'fleet_owner' };

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('allows fleet_owner for fleet_owner+admin routes', () => {
      const middleware = requireRole('fleet_owner', 'admin');
      const { req, res, next } = buildReqRes();
      req.user = { role: 'fleet_owner' };

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // verifyEmailToken
  // ────────────────────────────────────────────────

  describe('verifyEmailToken', () => {
    it('returns decoded payload for valid token', () => {
      const token = jwt.sign({ userId: 'user-1', purpose: 'email' }, JWT_SECRET, { expiresIn: '1h' });

      const result = verifyEmailToken(token);

      expect(result).toBeDefined();
      expect(result.userId).toBe('user-1');
    });

    it('returns null for expired token', () => {
      const token = jwt.sign({ userId: 'user-1' }, JWT_SECRET, { expiresIn: '-1s' });

      const result = verifyEmailToken(token);

      expect(result).toBeNull();
    });

    it('returns null for invalid token', () => {
      const result = verifyEmailToken('not-a-valid-token');

      expect(result).toBeNull();
    });

    it('returns null for wrong secret', () => {
      const token = jwt.sign({ userId: 'user-1' }, 'wrong-secret');

      const result = verifyEmailToken(token);

      expect(result).toBeNull();
    });
  });
});
