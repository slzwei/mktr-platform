import { asyncHandler } from '../middleware/errorHandler.js';
import * as trackerService from '../services/trackerService.js';
import { publicHostFromRequest, cookieDomainForPublicHost } from '../utils/publicHost.js';
import { frontendBaseForHost } from '../utils/frontendBase.js';

export const trackSlug = asyncHandler(async (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');

  const isProd = process.env.NODE_ENV === 'production';
  const publicHost = publicHostFromRequest(req);
  const cookieDomain = isProd ? cookieDomainForPublicHost(publicHost) : undefined;
  // Land on the SPA's /LeadCapture route (the binder route lives at lowercase
  // /lead-capture which the static site does NOT serve). We redirect to the
  // public host the user actually loaded so cookies + attribution stay scoped
  // to a single host.
  const frontendBase = frontendBaseForHost(publicHost);

  const { slug } = req.params;
  const qrTag = await trackerService.resolveQrTag(slug);
  if (!qrTag) {
    return res.redirect(302, `${frontendBase}/LeadCapture?error=not_found`);
  }

  const scan = await trackerService.recordScan(qrTag, {
    userAgent: req.headers['user-agent'] || '',
    referer: req.headers.referer || '',
    ip: req.ip || req.connection.remoteAddress || ''
  });

  const { token, expiresAt } = await trackerService.createAttribution(qrTag, scan);

  res.cookie('atk', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    domain: cookieDomain,
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
      domain: cookieDomain,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });
  }

  const search = trackerService.buildRedirectParams(qrTag);
  return res.redirect(302, `${frontendBase}/LeadCapture?${search}`);
});

export const getSession = asyncHandler(async (req, res) => {
  const data = await trackerService.resolveSession(req.cookies?.sid, req.cookies?.atk);
  return res.json({ success: true, data });
});
