import express from 'express';
import crypto from 'crypto';
import { asyncHandler } from '../middleware/errorHandler.js';
import { Attribution } from '../models/index.js';
import { publicHostFromRequest, cookieDomainForPublicHost } from '../utils/publicHost.js';
import { frontendBaseForHost } from '../utils/frontendBase.js';

const isProd = process.env.NODE_ENV === 'production';
if (isProd && !process.env.ATTRIB_SECRET) {
  throw new Error('FATAL: ATTRIB_SECRET must be set in production');
}
const ATTRIB_SECRET = process.env.ATTRIB_SECRET || 'dev-attrib-secret';

const router = express.Router();

// Middleware to bind attribution from atk cookie and ensure sid cookie
router.get('/lead-capture', asyncHandler(async (req, res, next) => {
  const atk = req.cookies?.atk;
  const isProdReq = process.env.NODE_ENV === 'production';
  const publicHost = publicHostFromRequest(req);
  const cookieDomain = isProdReq ? cookieDomainForPublicHost(publicHost) : undefined;
  // Ensure sid cookie exists
  let sid = req.cookies?.sid;
  if (!sid) {
    sid = crypto.randomBytes(16).toString('hex');
    res.cookie('sid', sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProdReq,
      domain: cookieDomain,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });
  }

  if (atk) {
    try {
      const [payload, sig] = atk.split('.');
      const expected = crypto.createHmac('sha256', ATTRIB_SECRET).update(payload).digest('base64url');
      if (sig !== expected) throw new Error('Bad signature');
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (data.exp && Date.now() / 1000 > data.exp) throw new Error('Expired');
      const attrib = await Attribution.findByPk(data.id);
      if (attrib && attrib.expiresAt > new Date()) {
        const reuse = attrib.sessionId && attrib.sessionId === sid;
        // Enforce single-use: a token already consumed by another session must
        // not be replayed to bind a different session.
        if (!(attrib.usedOnce && !reuse)) {
          await attrib.update({
            sessionId: sid,
            lastTouchAt: new Date(),
            usedOnce: true
          });
        }
      }
      // Do not clear atk; it will expire
    } catch (e) {
      // Ignore
    }
  }

  // After binding, redirect to the SPA on the same public host the user is on
  // (mktr.sg vs redeem.sg) so the attribution cookies stay scoped correctly.
  // Falls back to MKTR_FRONTEND_URL / FRONTEND_BASE_URL when no host match.
  const frontendBase = frontendBaseForHost(publicHost);
  const qs = req.url.includes('?') ? req.url.split('?')[1] : '';
  const suffix = qs ? `/LeadCapture?${qs}` : '/LeadCapture';
  return res.redirect(302, `${frontendBase}${suffix}`);
}));

export default router;


