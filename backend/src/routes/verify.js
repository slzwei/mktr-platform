import express from 'express';
import * as ctrl from '../controllers/verifyController.js';
import { makeLimiter } from '../middleware/rateLimiters.js';

export const meta = {
  path: '/api/verify',
  // Public routes (default-deny routing): public capture funnel OTP
  public: ['POST /send', 'POST /check'],
};

const router = express.Router();

/**
 * Transport-level burst control.
 *
 * Now durable (Postgres, migration 083) instead of in-process: the old
 * MemoryStore counted per Render instance and reset on every redeploy, so the
 * advertised "10 per 15 minutes" was really "10 per instance, until the next
 * deploy".
 *
 * This remains defence-in-depth ONLY — anyone with rotating IPs walks straight
 * through an IP-keyed limiter. The control that actually protects our SSIR
 * sender ID is the per-number daily cap in services/smsQuota.js, which is keyed
 * on the thing an attacker cannot rotate: the victim's phone number.
 */
const verifyLimiter = (prefix, max) => makeLimiter({
  prefix,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max,
  message: { error: 'Too many verification attempts. Please try again later.' },
});

// Separate buckets: fumbling a code shouldn't consume the budget that lets you
// request a fresh one. The previous single shared limiter charged both routes to
// one counter, so five wrong guesses ate half the resend allowance.
const sendLimiter = verifyLimiter('rl:verify-send', 10);
const checkLimiter = verifyLimiter('rl:verify-check', 20);

// POST /api/verify/send - Send verification code
router.post('/send', sendLimiter, ctrl.sendCode);

// POST /api/verify/check - Check verification code
router.post('/check', checkLimiter, ctrl.checkCode);

export default router;
