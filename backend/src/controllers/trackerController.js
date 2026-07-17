import { asyncHandler } from '../middleware/errorHandler.js';
import * as trackerService from '../services/trackerService.js';
import { publicHostFromRequest, cookieDomainForPublicHost } from '../utils/publicHost.js';
import { frontendBaseForHost } from '../utils/frontendBase.js';
import { Campaign } from '../models/index.js';
import { passesStaticGate } from '../services/marketplaceService.js';
import { readLegacyViewSafe } from '../utils/designConfigV2Clamp.js';

/**
 * qr_entry branch (docs/plans/redeem-marketplace-v2.md Phase 5): a marketplace
 * campaign can opt its QR scans into the offer-detail page instead of the
 * direct flow. Own flag (flipped only AFTER the SPA routes deploy), redeem
 * host only (frontendBaseForHost deliberately returns mktr.sg for mktr
 * requests, and /offers doesn't exist on the mktr build), and the campaign
 * must pass the marketplace publication gate. Anything else keeps today's
 * /LeadCapture redirect byte-for-byte.
 */
async function marketplaceDetailPath(qrTag, publicHost) {
  if (process.env.MARKETPLACE_QR_REDIRECT_ENABLED !== 'true') return null;
  if (!publicHost || !String(publicHost).endsWith('redeem.sg')) return null;
  if (!qrTag.campaignId) return null;
  try {
    const campaign = await Campaign.findByPk(qrTag.campaignId, {
      attributes: ['id', 'slug', 'type', 'status', 'is_active', 'design_config'],
    });
    if (!campaign || !passesStaticGate(campaign)) return null;
    // Version-aware (v2: distribution.marketplace.qrLanding); fail-safe = form landing.
    if (readLegacyViewSafe(campaign.design_config, {}).qr_entry !== 'detail') return null;
    return `/offers/${campaign.slug}`;
  } catch {
    return null; // attribution must never break over a marketplace lookup
  }
}

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

  // Determine the session id BEFORE creating the attribution so this scan
  // binds to the session immediately (last-touch). Reusing an existing sid
  // is correct — it's one session — but the latest scan must (re)bind it,
  // otherwise a subsequent scan of a different campaign is ignored and the
  // lead is mis-attributed to the first campaign ever scanned.
  let sid = req.cookies?.sid;
  const isNewSid = !sid;
  if (isNewSid) sid = trackerService.generateSessionId();

  const { token, expiresAt } = await trackerService.createAttribution(qrTag, scan, sid);

  res.cookie('atk', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    domain: cookieDomain,
    maxAge: 20 * 60 * 1000,
    path: '/'
  });

  if (isNewSid) {
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
  const detailPath = await marketplaceDetailPath(qrTag, publicHost);
  if (detailPath) {
    return res.redirect(302, `${frontendBase}${detailPath}?${search}`);
  }
  return res.redirect(302, `${frontendBase}/LeadCapture?${search}`);
});

export const getSession = asyncHandler(async (req, res) => {
  const data = await trackerService.resolveSession(req.cookies?.sid, req.cookies?.atk);
  return res.json({ success: true, data });
});
