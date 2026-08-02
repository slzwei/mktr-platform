import express from 'express';
import { makeLimiter } from '../middleware/rateLimiters.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { readWaCallbackContext, applyWaCallbackRequest } from '../services/retellScreeningService.js';

/**
 * PUBLIC screening-callback opt-in — backs redeem.sg/callback?t=<token>
 * (docs/plans/retell-screening-calls.md §16.6), the landing page of the
 * draw_callback_optin WhatsApp button.
 *
 * Token-authenticated like /api/reward-claim: the URL token IS the credential
 * (128-bit, minted per lead when the invite is sent, expires with the
 * screening hold). Responses carry the holder's first name + draw context
 * only — never full lead PII. The POST is the customer's documented consent
 * to be called: it schedules the ring-back; every dial guard (window, DNC,
 * consent, budget, concurrency) still re-runs at dial time, so a tap can
 * never bypass policy — and the attempt budget caps total dials.
 *
 * Deliberately OUTSIDE the host-blocked internal prefixes, so it is reachable
 * from the redeem.sg static site (internalRouteHostGuard blocklist).
 */
export const meta = {
  path: '/api/screening-callback',
};

const callbackLimiter = makeLimiter({
  prefix: 'rl:screening-callback',
  windowMs: 15 * 60 * 1000,
  max: 60, // generous for a human, hostile to token scanning (reward-claim parity)
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, message: 'Too many requests — try again later.' },
});

const router = express.Router();

router.get('/:token', callbackLimiter, asyncHandler(async (req, res) => {
  const raw = String(req.params.token || '').trim();
  if (raw.length < 16 || raw.length > 64) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  const ctx = await readWaCallbackContext(raw);
  if (ctx.state === 'invalid') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  return res.json({ success: true, data: ctx });
}));

router.post('/:token', callbackLimiter, asyncHandler(async (req, res) => {
  const raw = String(req.params.token || '').trim();
  if (raw.length < 16 || raw.length > 64) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  const result = await applyWaCallbackRequest(raw, req.body?.window, { ip: req.ip || null });
  if (result.state === 'invalid') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  if (result.state === 'bad_window') {
    return res.status(422).json({ success: false, message: 'Pick a valid time window.' });
  }
  // ok:false with done/in_flight is not an error — the page renders the state.
  return res.json({ success: true, data: result });
}));

export default router;
