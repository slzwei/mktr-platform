import express from 'express';
import { makeLimiter } from '../middleware/rateLimiters.js';
import { showUnsubscribe, confirmUnsubscribe } from '../controllers/unsubscribeController.js';

export const meta = {
  path: '/api/unsubscribe',
  // Public routes (default-deny routing): one-click unsubscribe must never require login
  public: ['GET /', 'POST /'],
};

const router = express.Router();

const unsubLimit = makeLimiter({
  prefix: 'rl:unsubscribe',
  windowMs: 60 * 1000,
  max: 30,
  skip: () => process.env.NODE_ENV === 'test',
});

// GET renders the confirm form only (no mutation — scanners prefetch).
router.get('/', unsubLimit, showUnsubscribe);
// POST mutates: human form + RFC 8058 one-click (form-urlencoded body).
router.post('/', unsubLimit, express.urlencoded({ extended: false }), confirmUnsubscribe);

export default router;
