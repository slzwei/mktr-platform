import crypto from 'crypto';
import { Op } from 'sequelize';
import { ShortLink, ShortLinkClick, Prospect, sequelize } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { customerHostOrigin, normalizeCustomerHostChoice } from '../utils/customerHost.js';

const generateSlug = (len = 8) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

async function allocateSlug() {
  for (let tries = 0; tries < 8; tries++) {
    const slug = generateSlug(8);
    if (!(await ShortLink.findOne({ where: { slug } }))) return slug;
  }
  // 36^8 ≈ 2.8e12 keyspace — reaching here needs an astronomically full table. Throw
  // rather than return an unchecked (possibly colliding) slug that would trip the unique
  // constraint on insert: callers treat shortlink minting as non-blocking and fall back
  // to the long URL.
  throw new AppError('Could not allocate a unique short link slug', 500);
}

/**
 * Open-redirect guard: a share slug 302-redirects to its targetUrl, so the
 * target host must be one of our own domains (apex or subdomain of mktr.sg /
 * redeem.sg), a Render preview, or localhost in dev. Without this, a public
 * caller could mint a redeem.sg/share/{slug} link that bounces to any site
 * (phishing).
 */
function isOwnedRedirectHost(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  if (h === 'mktr.sg' || h.endsWith('.mktr.sg')) return true;
  if (h === 'redeem.sg' || h.endsWith('.redeem.sg')) return true;
  // Render previews + localhost are trusted only OUTSIDE production. In prod the
  // public brands (mktr.sg / redeem.sg) are the only valid share targets, so an
  // attacker-controlled *.onrender.com cannot be used to mint a redirect.
  if (process.env.NODE_ENV !== 'production') {
    if (h === 'localhost' || h === '127.0.0.1') return true;
    if (h.endsWith('.onrender.com')) return true;
  }
  return false;
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

  // Open-redirect guard: the slug 302s to targetUrl, so restrict to our hosts.
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new AppError('Invalid targetUrl', 400);
  }
  if (!['https:', 'http:'].includes(parsed.protocol) || !isOwnedRedirectHost(parsed.hostname)) {
    throw new AppError('targetUrl host is not allowed', 400);
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
 * Get-or-create the ONE canonical referral share link for a prospect.
 *
 * Both the confirmation email (server, at prospect creation) and the in-app share dialog
 * resolve through here so they hand the prospect the SAME `/share/{slug}`. The link is
 * keyed by `prospectId` (partial-unique index, migration 042) — `findOne` first to avoid
 * wasting a slug on the hot already-exists path, then `create` with a unique-violation
 * catch so concurrent callers converge on the one row. No fixed TTL: the link lives as
 * long as the campaign is active (enforced at submit), so `expiresAt` is null.
 *
 * @param {object} a
 * @param {string} a.prospectId  The prospect this link belongs to (= the share `ref`).
 * @param {string} a.campaignId  The campaign the link points at.
 * @param {string} a.origin      Canonical customer origin (customerHostOrigin output).
 */
export async function getOrCreateProspectShareLink({ prospectId, campaignId, origin }) {
  if (!prospectId || !campaignId || !origin) {
    throw new AppError('prospectId, campaignId and origin are required', 400);
  }

  // origin is server-computed, but validate defensively: http(s) + an owned host, then
  // normalize to a bare origin (no path/query/trailing slash) so the slug only ever 302s
  // to one of our domains.
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new AppError('Invalid origin', 400);
  }
  if (!['https:', 'http:'].includes(parsed.protocol) || !isOwnedRedirectHost(parsed.hostname)) {
    throw new AppError('origin host is not allowed', 400);
  }
  const cleanOrigin = parsed.origin;

  const existing = await ShortLink.findOne({ where: { prospectId } });
  if (existing) return { slug: existing.slug, url: `/share/${existing.slug}` };

  const targetUrl = `${cleanOrigin}/LeadCapture?campaign_id=${campaignId}&ref=${prospectId}`;
  try {
    const link = await ShortLink.create({
      slug: await allocateSlug(),
      targetUrl,
      purpose: 'share',
      campaignId,
      prospectId,
      createdBy: null,
      expiresAt: null,
    });
    return { slug: link.slug, url: `/share/${link.slug}` };
  } catch (err) {
    // Race: a concurrent mint won the unique(prospectId) index. Re-find and return that
    // row so the email and the SPA still converge on one canonical link.
    const isUnique =
      err?.name === 'SequelizeUniqueConstraintError' ||
      err?.original?.code === '23505' ||
      err?.parent?.code === '23505';
    if (isUnique) {
      const again = await ShortLink.findOne({ where: { prospectId } });
      if (again) return { slug: again.slug, url: `/share/${again.slug}` };
    }
    throw err;
  }
}

/**
 * Public-endpoint entry point: resolve a prospect's canonical share link by id alone.
 * Loads the prospect to derive the campaign + canonical host server-side (never trusting
 * a client-supplied host/campaign), then delegates to getOrCreateProspectShareLink. Lets
 * the in-app share dialog reuse the exact link the email minted even on the fallback path.
 */
export async function getOrCreateProspectShareLinkById({ prospectId }) {
  if (!prospectId || typeof prospectId !== 'string') {
    throw new AppError('prospectId is required', 400);
  }
  const prospect = await Prospect.findByPk(prospectId, {
    include: [{ association: 'campaign', attributes: ['id', 'design_config'] }],
  });
  if (!prospect || !prospect.campaignId) {
    throw new AppError('Prospect not found', 404);
  }
  const hostChoice = normalizeCustomerHostChoice(prospect.campaign?.design_config?.customerHost);
  const origin = customerHostOrigin(hostChoice);
  return getOrCreateProspectShareLink({
    prospectId: prospect.id,
    campaignId: prospect.campaignId,
    origin,
  });
}

/**
 * Admin: mint a new short link with configurable purpose and TTL.
 */
export async function createAdminLink({ targetUrl, campaignId, purpose = 'share', ttlDays = 90 }, userId) {
  if (!targetUrl || typeof targetUrl !== 'string') {
    throw new AppError('targetUrl is required', 400);
  }

  // Prevent open redirect — only allow https URLs, block dangerous schemes.
  // Guard new URL() so a malformed targetUrl yields a 400, not an uncaught 500.
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new AppError('Invalid targetUrl', 400);
  }
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

  // Clamp pagination so malformed query params (?page=-1, ?limit=abc) don't reach
  // Sequelize as a negative/NaN LIMIT/OFFSET, which throws → 500.
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 20), 200);

  const { rows, count } = await ShortLink.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    offset: (pageNum - 1) * limitNum,
    limit: limitNum
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
