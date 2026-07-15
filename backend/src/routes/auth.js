import express from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateToken } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import * as auth from '../controllers/authController.js';

export const meta = { path: '/api/auth' };

const router = express.Router();

// Rate limit auth endpoints to prevent brute force
const isTest = process.env.NODE_ENV === 'test';
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTest ? 10000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many auth attempts, try again later' }
});

// ─── Public auth ────────────────────────────────────────────────────────────
router.post('/register', authLimiter, validate(schemas.userRegister), auth.register);
router.post('/login', authLimiter, validate(schemas.userLogin), auth.login);

// ─── Google OAuth ───────────────────────────────────────────────────────────
router.post('/google', auth.googleLogin);
router.get('/google/config', auth.googleConfigCheck);
router.get('/google/state', auth.generateOAuthState);
router.post('/google/callback', auth.googleOAuthCallback);

// ─── Authenticated user ─────────────────────────────────────────────────────
router.get('/profile', authenticateToken, auth.getProfile);
router.put('/profile', authenticateToken, validate(schemas.userUpdate), auth.updateProfile);
router.put('/change-password', authenticateToken, auth.changePassword);
router.post('/refresh', authenticateToken, auth.refreshToken);
router.post('/logout', authenticateToken, auth.logout);

// ─── Email verification & password reset ────────────────────────────────────
router.get('/verify-email/:token', auth.verifyEmail);
router.post('/forgot-password', auth.forgotPassword);
router.post('/reset-password/:token', auth.resetPassword);

// ─── Invitations ────────────────────────────────────────────────────────────
router.get('/invite-info/:token', auth.getInviteInfo);
router.post('/accept-invite', auth.acceptInvite);

// ─── Onboarding ─────────────────────────────────────────────────────────────
router.post('/onboarding/role', authenticateToken, auth.updateRole);
router.post('/onboarding/payout', authenticateToken, auth.savePayout);
// Car onboarding rode the retired fleet programme; same master switch as the
// fleet routers (read at import, like the route-loader mount flags).
if (String(process.env.FLEET_ROUTES_ENABLED || 'false').toLowerCase() === 'true') {
  router.post('/onboarding/car', authenticateToken, auth.createCar);
  router.post('/onboarding/cars/bulk', authenticateToken, auth.bulkCreateCars);
}

export default router;
