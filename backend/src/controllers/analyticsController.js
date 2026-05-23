import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import * as analyticsService from '../services/analyticsService.js';

const allowedOrigins = new Set([
  'https://mktr.sg',
  'https://www.mktr.sg',
  'https://redeem.sg',
  'https://www.redeem.sg',
  'http://localhost:5173'
]);

function assertAllowedOrigin(req) {
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const allowed = [...allowedOrigins].some((o) => origin.startsWith(o) || referer.startsWith(o));
  if (!allowed) {
    throw new AppError('Origin not allowed', 403);
  }
}

function getSessionId(req) {
  const sid = req.cookies?.sid || req.headers['x-session-id'];
  if (!sid) throw new AppError('Missing session', 400);
  return sid;
}

export const trackEvent = asyncHandler(async (req, res) => {
  assertAllowedOrigin(req);

  const { type, meta = {} } = req.body || {};
  if (!type) throw new AppError('Event type required', 400);

  const sid = getSessionId(req);
  await analyticsService.trackEvent(sid, type, meta);
  res.json({ success: true });
});

export const trackReferral = asyncHandler(async (req, res) => {
  assertAllowedOrigin(req);

  const sid = getSessionId(req);
  const { campaignId } = req.body || {};
  await analyticsService.trackReferral(sid, campaignId);
  res.json({ success: true });
});
