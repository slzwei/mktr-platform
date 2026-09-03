import express from 'express';
import { makeLimiter } from '../middleware/rateLimiters.js';
import { clientKey } from '../middleware/pgRateLimitStore.js';
import { emailNormKey } from '../services/repeatSignup.js';
import { RSVP_BODY_MAX_BYTES } from '../utils/rsvpAnswers.js';
import * as rsvpController from '../controllers/rsvpController.js';

/**
 * RSVP pages — PUBLIC surface (docs/plans/rsvp-pages.md §5.2-5.4), served to
 * rsvp.redeem.sg. Ships dark behind RSVP_ENABLED like the admin router.
 *
 * Both routes are unauthenticated by design and declared in meta.public. The
 * host boundary (only this namespace answers on rsvp.redeem.sg) is the
 * strict allowlist in internalRouteHostGuard — P3 of the plan.
 *
 * Rate limiting here is transport hygiene, not seat protection (§8.6): the
 * shared store bursts 2× at a window edge and fails open on a DB blip. The
 * per-email bucket blunts retry storms; capacity itself is enforced under
 * the event row lock in rsvpService.submitResponse.
 */
export const meta = {
  // Public routes (default-deny routing): the attendee page + its submit.
  public: ['GET /:slug', 'POST /:slug/respond'],
  path: '/api/rsvp-public',
  flag: 'RSVP_ENABLED',
};

const router = express.Router();

const tooMany = { success: false, message: 'Too many requests, please try again later' };

// Per-visitor: mirrors the waitlist/contact budget (5/min/IP).
const respondLimiter = makeLimiter({
  prefix: 'rl:rsvp-respond',
  windowMs: 60 * 1000,
  max: 5,
  message: tooMany,
  skip: () => process.env.NODE_ENV === 'test',
});

// Per-(event, email): a retry storm on one address cannot ride on rotating IPs.
const emailLimiter = makeLimiter({
  prefix: 'rl:rsvp-email',
  windowMs: 10 * 60 * 1000,
  max: 6,
  message: tooMany,
  keyGenerator: (req) => `${req.params.slug}:${emailNormKey(req.body?.answers?.email) || clientKey(req)}`,
  skip: () => process.env.NODE_ENV === 'test',
});

// The global parser allows 1mb; an RSVP is a few hundred bytes. Checked on the
// declared length before any work is done (the parser has already run).
function bodySizeGuard(req, res, next) {
  const declared = Number(req.get('content-length') || 0);
  if (declared > RSVP_BODY_MAX_BYTES) {
    return res.status(413).json({ success: false, message: 'Request too large' });
  }
  return next();
}

router.get('/:slug', rsvpController.getPublicEvent);
router.post('/:slug/respond', bodySizeGuard, respondLimiter, emailLimiter, rsvpController.respond);

export default router;
