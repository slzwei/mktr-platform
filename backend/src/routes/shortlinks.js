import express from 'express';
import crypto from 'crypto';
import { Op } from 'sequelize';
import { ShortLink, ShortLinkClick } from '../models/index.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

const generateSlug = (len = 8) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

// Admin-only: mint a new short link
router.post('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { targetUrl, campaignId, purpose = 'share', ttlDays = 90 } = req.body || {};
  if (!targetUrl || typeof targetUrl !== 'string') {
    throw new AppError('targetUrl is required', 400);
  }

  let slug = generateSlug(8);
  let tries = 0;
  while (await ShortLink.findOne({ where: { slug } })) {
    slug = generateSlug(8);
    if (++tries > 5) break;
  }

  const expiresAt = new Date(Date.now() + (ttlDays || 90) * 24 * 60 * 60 * 1000);

  const link = await ShortLink.create({
    slug,
    targetUrl,
    purpose,
    campaignId: campaignId || null,
    createdBy: req.user.id,
    expiresAt
  });

  res.status(201).json({ success: true, data: { slug, url: `/share/${slug}`, link } });
}));

// Public redirect: /share/:slug → target
router.get('/:slug', asyncHandler(async (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');

  const { slug } = req.params;
  const link = await ShortLink.findOne({ where: { slug } });
  if (!link) {
    return res.redirect(302, '/lead-capture?error=not_found');
  }
  if (link.expiresAt && link.expiresAt < new Date()) {
    return res.redirect(302, '/lead-capture?error=expired');
  }

  // Minimal analytics (UA/device). Hash IP to avoid storing raw IP.
  try {
    const ua = req.headers['user-agent'] || '';
    const referer = req.headers.referer || '';
    const ip = req.ip || req.connection?.remoteAddress || '';
    const ipHash = crypto.createHash('sha256').update(`${ip}:${process.env.IP_HASH_SALT || 'salt'}`).digest('hex');
    const device = /Mobile|Android|iPhone|iPad/i.test(ua) ? 'mobile' : 'desktop';

    await ShortLinkClick.create({ shortLinkId: link.id, ua, referer, ipHash, device });
    await link.update({ clickCount: (link.clickCount || 0) + 1, lastClickedAt: new Date() });
  } catch (_) { /* ignore analytics failures */ }

  return res.redirect(302, link.targetUrl);
}));

export default router;

// Admin list/manage APIs (mounted under /api/shortlinks)
router.get('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search = '', campaignId, purpose } = req.query;
  const where = {};
  if (campaignId) where.campaignId = campaignId;
  if (purpose) where.purpose = purpose;
  if (search) where.slug = { [Op.like]: `%${String(search).trim()}%` };

  const { rows, count } = await ShortLink.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    offset: (Number(page) - 1) * Number(limit),
    limit: Number(limit)
  });
  res.json({ success: true, data: { items: rows, total: count } });
}));

router.patch('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { expiresAt } = req.body || {};
  const link = await ShortLink.findByPk(id);
  if (!link) throw new AppError('Not found', 404);
  const updates = {};
  if (expiresAt) updates.expiresAt = new Date(expiresAt);
  await link.update(updates);
  res.json({ success: true, data: { link } });
}));

router.get('/:id/clicks', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const clicks = await ShortLinkClick.findAll({ where: { shortLinkId: id }, order: [['ts', 'DESC']], limit: 200 });
  res.json({ success: true, data: { clicks } });
}));

// Delete a short link and its associated click records
router.delete('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const link = await ShortLink.findByPk(id);
  if (!link) throw new AppError('Not found', 404);
  await ShortLinkClick.destroy({ where: { shortLinkId: id } });
  await link.destroy();
  res.json({ success: true });
}));


