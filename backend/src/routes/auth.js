import express from 'express';
import { makeLimiter } from '../middleware/rateLimiters.js';
import { authenticateToken } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import * as auth from '../controllers/authController.js';
import { isSandbox, flagOn } from '../utils/deployEnv.js';

export const meta = {
  path: '/api/auth',
  // Public routes (default-deny routing): login/registration/password/invite flows — public by nature
  public: ['POST /register', 'POST /login', 'POST /google', 'GET /google/config', 'GET /google/state', 'POST /google/callback', 'GET /verify-email/:token', 'POST /forgot-password', 'POST /reset-password/:token', 'GET /invite-info/:token', 'POST /accept-invite'],
};

const router = express.Router();

// Rate limit auth endpoints to prevent brute force. Separate buckets on
// purpose (P1-6): a password-reset flood must not consume the budget that lets
// a legitimate user log in, and a token-scanning sweep must not lock out either.
const isTest = process.env.NODE_ENV === 'test';
const cap = (n) => (isTest ? 10000 : n);

/** Session doors — register, login, both Google exchanges. */
const authLimiter = makeLimiter({
  prefix: 'rl:auth',
  windowMs: 60 * 1000,
  max: cap(10),
  message: { success: false, message: 'Too many auth attempts, try again later' }
});

/** Credential-change doors — forgot / reset / change password. */
const passwordLimiter = makeLimiter({
  prefix: 'rl:auth-password',
  windowMs: 15 * 60 * 1000,
  max: cap(10),
  message: { success: false, message: 'Too many password requests, try again later' }
});

/** Token doors — email verification and invitations, i.e. anything scannable. */
const tokenLimiter = makeLimiter({
  prefix: 'rl:auth-token',
  windowMs: 15 * 60 * 1000,
  max: cap(30),
  message: { success: false, message: 'Too many attempts, try again later' }
});

// ─── Public auth ────────────────────────────────────────────────────────────
// Public self-registration is CLOSED in a sandbox (plan §5): the environment
// exists for a fixed cast of seeded, permission-boundary users, and an open
// door would let anyone who finds the URL mint an account inside it. Off by
// default; SANDBOX_SELF_REGISTRATION_ENABLED=true reopens it deliberately.
const blockSandboxRegistration = (req, res, next) => {
  if (isSandbox() && !flagOn('SANDBOX_SELF_REGISTRATION_ENABLED')) {
    return res.status(403).json({
      success: false,
      message: 'Self-registration is disabled in the sandbox. Use a seeded account.',
    });
  }
  return next();
};

router.post('/register', authLimiter, blockSandboxRegistration, validate(schemas.userRegister), auth.register);
router.post('/login', authLimiter, validate(schemas.userLogin), auth.login);

// ─── Google OAuth ───────────────────────────────────────────────────────────
router.post('/google', authLimiter, auth.googleLogin);
router.get('/google/config', auth.googleConfigCheck);
router.get('/google/state', auth.generateOAuthState);
router.post('/google/callback', authLimiter, auth.googleOAuthCallback);

// ─── Authenticated user ─────────────────────────────────────────────────────
router.get('/profile', authenticateToken, auth.getProfile);
router.put('/profile', authenticateToken, validate(schemas.userUpdate), auth.updateProfile);
router.put('/change-password', passwordLimiter, authenticateToken, auth.changePassword);
router.post('/refresh', authenticateToken, auth.refreshToken);
router.post('/logout', authenticateToken, auth.logout);

// ─── Email verification & password reset ────────────────────────────────────
router.get('/verify-email/:token', tokenLimiter, auth.verifyEmail);
router.post('/forgot-password', passwordLimiter, auth.forgotPassword);
router.post('/reset-password/:token', passwordLimiter, auth.resetPassword);

// ─── Invitations ────────────────────────────────────────────────────────────
router.get('/invite-info/:token', tokenLimiter, auth.getInviteInfo);
router.post('/accept-invite', tokenLimiter, auth.acceptInvite);

// ─── Onboarding ─────────────────────────────────────────────────────────────
// NOTE: the self-service role endpoint was REMOVED (P0-2). It let any
// registered customer promote themselves to 'agent'. Agents join via the
// invitation flow (accept-invite) only; driver/fleet roles are retired.

export default router;
