import express from 'express';
import rateLimit from 'express-rate-limit';
import * as ctrl from '../controllers/dncController.js';

export const meta = { path: '/api/dnc' };

const router = express.Router();

// Public, IP rate-limited. The form fires one check per OTP-verified number, so a tight
// per-IP cap is plenty and blunts any attempt to grind the endpoint (the OTP-verified gate
// in the service is the real abuse control; this is defence-in-depth). Disabled under test.
const dncCheckLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, message: 'Too many DNC checks from this IP, please try again later.' },
});

// POST /api/dnc/check — OTP-gated DNC lookup for the consent gate (returns { registered }).
router.post('/check', dncCheckLimiter, ctrl.checkDnc);

export default router;
