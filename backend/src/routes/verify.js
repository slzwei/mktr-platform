import express from 'express';
import rateLimit from 'express-rate-limit';
import * as ctrl from '../controllers/verifyController.js';
import { PostgresRateLimitStore, clientKey } from '../middleware/pgRateLimitStore.js';

export const meta = { path: '/api/verify' };

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
const makeLimiter = (prefix, max) => rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max,
  keyGenerator: clientKey,
  store: new PostgresRateLimitStore({ prefix }),
  message: { error: 'Too many verification attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Separate buckets: fumbling a code shouldn't consume the budget that lets you
// request a fresh one. The previous single shared limiter charged both routes to
// one counter, so five wrong guesses ate half the resend allowance.
const sendLimiter = makeLimiter('rl:verify-send', 10);
const checkLimiter = makeLimiter('rl:verify-check', 20);

// POST /api/verify/send - Send verification code
router.post('/send', sendLimiter, ctrl.sendCode);

// POST /api/verify/check - Check verification code
router.post('/check', checkLimiter, ctrl.checkCode);

export default router;
