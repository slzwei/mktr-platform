import { asyncHandler } from '../middleware/errorHandler.js';
import * as trackerService from '../services/trackerService.js';

export const trackSlug = asyncHandler(async (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');

  const { slug } = req.params;
  const qrTag = await trackerService.resolveQrTag(slug);
  if (!qrTag) {
    return res.redirect(302, '/lead-capture?error=not_found');
  }

  const scan = await trackerService.recordScan(qrTag, {
    userAgent: req.headers['user-agent'] || '',
    referer: req.headers.referer || '',
    ip: req.ip || req.connection.remoteAddress || ''
  });

  const { token, expiresAt } = await trackerService.createAttribution(qrTag, scan);

  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('atk', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    domain: isProd ? '.mktr.sg' : undefined,
    maxAge: 20 * 60 * 1000,
    path: '/'
  });

  // Ensure sid cookie exists here to avoid an extra binder hop
  let sid = req.cookies?.sid;
  if (!sid) {
    sid = trackerService.generateSessionId();
    res.cookie('sid', sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      domain: isProd ? '.mktr.sg' : undefined,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });
  }

  const search = trackerService.buildRedirectParams(qrTag);
  return res.redirect(302, `/lead-capture?${search}`);
});

export const getSession = asyncHandler(async (req, res) => {
  const data = await trackerService.resolveSession(req.cookies?.sid, req.cookies?.atk);
  return res.json({ success: true, data });
});
