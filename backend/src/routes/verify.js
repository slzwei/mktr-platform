import express from 'express';
import rateLimit from 'express-rate-limit';
import * as ctrl from '../controllers/verifyController.js';

export const meta = { path: '/api/verify' };

const router = express.Router();

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 attempts per window
  message: { error: 'Too many verification attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/verify/send - Send verification code
router.post('/send', verifyLimiter, ctrl.sendCode);

// POST /api/verify/check - Check verification code
router.post('/check', verifyLimiter, ctrl.checkCode);

export default router;
