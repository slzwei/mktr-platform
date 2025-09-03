import express from 'express';
import crypto from 'crypto';
import { asyncHandler } from '../middleware/errorHandler.js';
import { Attribution } from '../models/index.js';

const router = express.Router();

// Middleware to bind attribution from atk cookie and ensure sid cookie
router.get('/lead-capture', asyncHandler(async (req, res, next) => {
  const atk = req.cookies?.atk;
  const isProd = process.env.NODE_ENV === 'production';
  // Ensure sid cookie exists
  let sid = req.cookies?.sid;
  if (!sid) {
    sid = crypto.randomBytes(16).toString('hex');
    res.cookie('sid', sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      domain: isProd ? '.mktr.sg' : undefined,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });
  }

  if (atk) {
    try {
      const [payload, sig] = atk.split('.');
      const expected = crypto.createHmac('sha256', process.env.ATTRIB_SECRET || 'attrib').update(payload).digest('base64url');
      if (sig !== expected) throw new Error('Bad signature');
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (data.exp && Date.now() / 1000 > data.exp) throw new Error('Expired');
      const attrib = await Attribution.findByPk(data.id);
      if (attrib && attrib.expiresAt > new Date()) {
        // Allow reuse if same sid; otherwise mark usedOnce
        const reuse = attrib.sessionId && attrib.sessionId === sid;
        await attrib.update({
          sessionId: sid,
          lastTouchAt: new Date(),
          usedOnce: reuse ? attrib.usedOnce : true
        });
      }
      // Do not clear atk; it will expire
    } catch (e) {
      // Ignore
    }
  }

  // After binding, redirect to the frontend SPA route, preserving any shareable params
  const frontendBase = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';
  const qs = req.url.includes('?') ? req.url.split('?')[1] : '';
  const suffix = qs ? `/LeadCapture?${qs}` : '/LeadCapture';
  return res.redirect(302, `${frontendBase}${suffix}`);
}));

export default router;


