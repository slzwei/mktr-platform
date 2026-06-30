import { asyncHandler } from '../middleware/errorHandler.js';
import * as shortlinkService from '../services/shortlinkService.js';

export const createShareLink = asyncHandler(async (req, res) => {
  const body = req.body || {};
  // Prospect-aware path: when the SPA passes a prospectId (post-submit share), resolve the
  // ONE canonical per-prospect link (same row the confirmation email uses) instead of
  // minting a fresh slug from the client-supplied targetUrl. Server derives the campaign +
  // host from the prospect, so the client can't bind a link to a mismatched host/campaign.
  const data = body.prospectId
    ? await shortlinkService.getOrCreateProspectShareLinkById({ prospectId: body.prospectId })
    : await shortlinkService.createShareLink(body);
  res.status(201).json({ success: true, data });
});

export const createAdminLink = asyncHandler(async (req, res) => {
  const data = await shortlinkService.createAdminLink(req.body || {}, req.user.id);
  res.status(201).json({ success: true, data });
});

export const redirectSlug = asyncHandler(async (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');

  const { slug } = req.params;
  const { status, link } = await shortlinkService.resolveSlug(slug);

  if (status === 'not_found') return res.redirect(302, '/lead-capture?error=not_found');
  if (status === 'expired') return res.redirect(302, '/lead-capture?error=expired');

  await shortlinkService.recordClick(link, {
    userAgent: req.headers['user-agent'] || '',
    referer: req.headers.referer || '',
    ip: req.ip || req.connection?.remoteAddress || ''
  });

  return res.redirect(302, link.targetUrl);
});

export const listLinks = asyncHandler(async (req, res) => {
  const data = await shortlinkService.listLinks(req.query);
  res.json({ success: true, data });
});

export const updateLink = asyncHandler(async (req, res) => {
  const link = await shortlinkService.updateLink(req.params.id, req.body || {});
  res.json({ success: true, data: { link } });
});

export const getClicks = asyncHandler(async (req, res) => {
  const clicks = await shortlinkService.getClicks(req.params.id);
  res.json({ success: true, data: { clicks } });
});

export const deleteLink = asyncHandler(async (req, res) => {
  await shortlinkService.deleteLink(req.params.id);
  res.json({ success: true });
});
