import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import * as analyticsService from '../services/analyticsService.js';
import * as prospectService from '../services/prospectService.js';
import * as touchpointService from '../services/touchpointService.js';
import { resolveSid, setSidCookie } from '../utils/sessionId.js';

const allowedOrigins = new Set([
  'https://mktr.sg',
  'https://www.mktr.sg',
  'https://redeem.sg',
  'https://www.redeem.sg',
  'http://localhost:5173'
]);

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function assertAllowedOrigin(req) {
  // EXACT-origin match (ads-centralisation §4.3). The old prefix test
  // (`origin.startsWith(o)`) accepted lookalike hosts — a page on
  // https://mktr.sg.evil.example passed a startsWith check against
  // https://mktr.sg — for /events and /referrals alike. The Referer fallback
  // compares its PARSED origin, never the raw string.
  const origin = originOf(req.headers.origin || '');
  const refererOrigin = originOf(req.headers.referer || '');
  const allowed =
    (origin !== null && allowedOrigins.has(origin)) ||
    (refererOrigin !== null && allowedOrigins.has(refererOrigin));
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

/**
 * POST /touch — durable touchpoint beacon (ads-centralisation §4.3). Public
 * + rate-limited; Joi-validated with stripUnknown at the route. Never 4xxes
 * on session problems — the beacon is intentionally lossy, so gate misses
 * degrade to a 200 with a `skipped` marker.
 *
 * Session contract (§4.2): validated cookie wins → validated X-Session-Id
 * header adopts (the client can't read the httpOnly cookie) → no valid sid
 * skips. Every hit re-issues the 90d cookie (rolling window).
 */
export const trackTouch = asyncHandler(async (req, res) => {
  assertAllowedOrigin(req);
  if (!touchpointService.touchpointsEnabled()) {
    return res.json({ success: true, skipped: true });
  }
  const sid = resolveSid(req);
  if (!sid) {
    return res.json({ success: true, skipped: 'no_session' });
  }
  setSidCookie(req, res, sid);
  const b = req.body || {};
  const result = await touchpointService.recordTouch({
    sid,
    surface: b.surface,
    landingPath: b.path || null,
    referrer: b.referrer || null,
    campaignId: b.campaignId || null,
    utm: {
      utmSource: b.utm_source,
      utmMedium: b.utm_medium,
      utmCampaign: b.utm_campaign,
      utmTerm: b.utm_term,
      utmContent: b.utm_content,
    },
    clickIds: { fbclid: b.fbclid, ttclid: b.ttclid, gclid: b.gclid, gbraid: b.gbraid, wbraid: b.wbraid },
  });
  return res.json(result.recorded ? { success: true } : { success: true, skipped: result.skipped });
});

export const trackReferral = asyncHandler(async (req, res) => {
  assertAllowedOrigin(req);

  const { campaignId, ref } = req.body || {};
  // Referrer name for the "Referred by …" badge — resolved REGARDLESS of session
  // (same-campaign-guarded in the service; no cross-campaign name harvest). A fresh
  // referee clicking a /share/ link has no `sid` cookie yet, so gating this on a session
  // would silently hide the badge for the exact people it's meant for.
  const referrerName = await prospectService.resolveReferrerName({ ref, campaignId });
  // Click attribution is best-effort: it needs a session, but never block the badge on it.
  try {
    const sid = getSessionId(req);
    await analyticsService.trackReferral(sid, campaignId);
  } catch {
    /* no session (direct /share/ click) — skip click tracking, still return the name */
  }
  res.json({ success: true, data: { referrerName } });
});
