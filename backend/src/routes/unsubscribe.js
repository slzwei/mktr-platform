import express from 'express';
import rateLimit from 'express-rate-limit';
import { showUnsubscribe, confirmUnsubscribe } from '../controllers/unsubscribeController.js';

export const meta = { path: '/api/unsubscribe' };

const router = express.Router();

const unsubLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

// GET renders the confirm form only (no mutation — scanners prefetch).
router.get('/', unsubLimit, showUnsubscribe);
// POST mutates: human form + RFC 8058 one-click (form-urlencoded body).
router.post('/', unsubLimit, express.urlencoded({ extended: false }), confirmUnsubscribe);

export default router;
