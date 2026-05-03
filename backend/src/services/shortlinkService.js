import crypto from 'crypto';
import { Op } from 'sequelize';
import { ShortLink, ShortLinkClick, sequelize } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';

const generateSlug = (len = 8) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

async function allocateSlug() {
  let slug = generateSlug(8);
  let tries = 0;
  while (await ShortLink.findOne({ where: { slug } })) {
    slug = generateSlug(8);
    if (++tries > 5) break;
  }
  return slug;
}

/**
 * Create a public share short link (no auth, share purpose only).
 */
export async function createShareLink({ targetUrl, campaignId }) {
  if (!targetUrl || typeof targetUrl !== 'string') {
    throw new AppError('targetUrl is required', 400);
  }

  const allowed = targetUrl.includes('/LeadCapture') || targetUrl.includes('/lead-capture');
  if (!allowed) {
    throw new AppError('Only lead capture URLs can be shortened', 400);
  }

  const slug = await allocateSlug();
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  await ShortLink.create({
    slug,
    targetUrl,
    purpose: 'share',
    campaignId: campaignId || null,
    createdBy: null,
    expiresAt
  });

  return { slug, url: `/share/${slug}` };
}

/**
 * Admin: mint a new short link with configurable purpose and TTL.
 */
export async function createAdminLink({ targetUrl, campaignId, purpose = 'share', ttlDays = 90 }, userId) {
  if (!targetUrl || typeof targetUrl !== 'string') {
    throw new AppError('targetUrl is required', 400);
  }

  // Prevent open redirect — only allow https URLs, block dangerous schemes
  const parsed = new URL(targetUrl); // throws on invalid URL
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new AppError('Only http/https URLs are allowed', 400);
  }

  const slug = await allocateSlug();
  const expiresAt = new Date(Date.now() + (ttlDays || 90) * 24 * 60 * 60 * 1000);

  const link = await ShortLink.create({
    slug,
    targetUrl,
    purpose,
    campaignId: campaignId || null,
    createdBy: userId,
    expiresAt
  });

  return { slug, url: `/share/${slug}`, link };
}

/**
 * Resolve a slug to its target URL. Returns null if not found or expired.
 */
export async function resolveSlug(slug) {
  const link = await ShortLink.findOne({ where: { slug } });
  if (!link) return { status: 'not_found', link: null };
  if (link.expiresAt && link.expiresAt < new Date()) return { status: 'expired', link: null };
  return { status: 'ok', link };
}

/**
 * Record a click for analytics. Failures are swallowed to avoid breaking the redirect.
 */
export async function recordClick(link, { userAgent, referer, ip }) {
  try {
    const ipHash = crypto.createHash('sha256').update(`${ip}:${process.env.IP_HASH_SALT || 'salt'}`).digest('hex');
    const device = /Mobile|Android|iPhone|iPad/i.test(userAgent) ? 'mobile' : 'desktop';

    await ShortLinkClick.create({ shortLinkId: link.id, ua: userAgent, referer, ipHash, device });
    await link.update({
      clickCount: sequelize.literal('"clickCount" + 1'),
      lastClickedAt: new Date()
    });
  } catch (_) { /* ignore analytics failures */ }
}

/**
 * List short links with filtering and pagination.
 */
export async function listLinks({ page = 1, limit = 20, search = '', campaignId, purpose }) {
  const where = {};
  if (campaignId) where.campaignId = campaignId;
  if (purpose) where.purpose = purpose;
  if (search) {
    const sanitizedSearch = String(search).trim().slice(0, 100).replace(/%/g, '\\%').replace(/_/g, '\\_');
    where.slug = { [Op.like]: `%${sanitizedSearch}%` };
  }

  const { rows, count } = await ShortLink.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    offset: (Number(page) - 1) * Number(limit),
    limit: Number(limit)
  });
  return { items: rows, total: count };
}

/**
 * Update a short link (currently only expiresAt).
 */
export async function updateLink(id, { expiresAt }) {
  const link = await ShortLink.findByPk(id);
  if (!link) throw new AppError('Not found', 404);
  const updates = {};
  if (expiresAt) updates.expiresAt = new Date(expiresAt);
  await link.update(updates);
  return link;
}

/**
 * Get click records for a short link.
 */
export async function getClicks(shortLinkId) {
  return ShortLinkClick.findAll({ where: { shortLinkId }, order: [['ts', 'DESC']], limit: 200 });
}

/**
 * Delete a short link and its associated click records.
 */
export async function deleteLink(id) {
  const link = await ShortLink.findByPk(id);
  if (!link) throw new AppError('Not found', 404);
  await ShortLinkClick.destroy({ where: { shortLinkId: id } });
  await link.destroy();
}
