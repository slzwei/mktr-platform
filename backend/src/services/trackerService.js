import crypto from 'crypto';
import { QrTag, QrScan, Attribution, Campaign } from '../models/index.js';

const isProd = process.env.NODE_ENV === 'production';
if (isProd && !process.env.IP_HASH_SALT) {
  throw new Error('FATAL: IP_HASH_SALT must be set in production');
}
if (isProd && !process.env.ATTRIB_SECRET) {
  throw new Error('FATAL: ATTRIB_SECRET must be set in production');
}
const IP_HASH_SALT = process.env.IP_HASH_SALT || 'dev-salt';
const ATTRIB_SECRET = process.env.ATTRIB_SECRET || 'dev-attrib-secret';

/**
 * Resolve a QR tag by slug (active only). Returns null if not found.
 */
export async function resolveQrTag(slug) {
  return QrTag.findOne({ where: { slug, active: true } });
}

/**
 * Record a QR scan, de-dup within 2 minutes for same (slug, ipHash, ua).
 * Returns the created scan record.
 */
export async function recordScan(qrTag, { userAgent, referer, ip }) {
  const ua = userAgent;
  const ipHash = crypto.createHash('sha256').update(`${ip}:${IP_HASH_SALT}`).digest('hex');
  const device = /Mobile|Android|iPhone|iPad/.test(ua) ? 'mobile' : 'desktop';
  const botFlag = /(bot|spider|crawler)/i.test(ua);

  // De-dup within 2 minutes for same (slug, ipHash, ua)
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
  const recentScan = await QrScan.findOne({ where: { qrTagId: qrTag.id }, order: [['ts', 'DESC']] });
  let isDuplicate = false;
  if (recentScan && recentScan.ts > twoMinutesAgo && recentScan.ipHash === ipHash && recentScan.ua === ua) {
    isDuplicate = true;
  }

  return QrScan.create({
    qrTagId: qrTag.id,
    ipHash,
    ua,
    referer,
    device,
    geoCity: null,
    botFlag,
    isDuplicate
  });
}

/**
 * Create a short-lived attribution token (20 minutes) for the scan.
 * Returns { token, expiresAt } where token is a signed base64url payload.
 */
export async function createAttribution(qrTag, scan) {
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000);
  const attrib = await Attribution.create({
    qrTagId: qrTag.id,
    qrScanId: scan.id,
    sessionId: null,
    firstTouch: false,
    lastTouchAt: null,
    expiresAt,
    usedOnce: false
  });

  const payload = Buffer.from(JSON.stringify({ id: attrib.id, exp: Math.floor(expiresAt.getTime() / 1000) })).toString('base64url');
  const sig = crypto.createHmac('sha256', ATTRIB_SECRET).update(payload).digest('base64url');
  const token = `${payload}.${sig}`;

  return { token, expiresAt };
}

/**
 * Build redirect search params from the qrTag.
 */
export function buildRedirectParams(qrTag) {
  return new URLSearchParams({
    ...(qrTag.campaignId ? { campaign_id: String(qrTag.campaignId) } : {}),
    slug: qrTag.slug
  }).toString();
}

/**
 * Resolve session attribution from sid/atk cookies.
 * Returns { qrTagId, campaignId, slug, active, campaign } or null.
 */
export async function resolveSession(sid, atkCookie) {
  if (!sid) return null;

  let attrib = await Attribution.findOne({
    where: { sessionId: sid },
    order: [['lastTouchAt', 'DESC']]
  });

  // If no bound attribution yet, bind from short-lived token (atk)
  if (!attrib && atkCookie) {
    try {
      const [payload, sig] = atkCookie.split('.');
      const expected = crypto.createHmac('sha256', ATTRIB_SECRET).update(payload).digest('base64url');
      if (sig === expected) {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        const nowSec = Math.floor(Date.now() / 1000);
        if (!data.exp || nowSec <= data.exp) {
          const tokenAttrib = await Attribution.findByPk(data.id);
          if (tokenAttrib && tokenAttrib.expiresAt > new Date()) {
            const reuse = tokenAttrib.sessionId && tokenAttrib.sessionId === sid;
            await tokenAttrib.update({
              sessionId: sid,
              lastTouchAt: new Date(),
              usedOnce: reuse ? tokenAttrib.usedOnce : true
            });
            attrib = tokenAttrib;
          }
        }
      }
    } catch (e) {
      // ignore and proceed as unaffiliated session
    }
  }

  if (!attrib) return null;

  const qrTag = await QrTag.findByPk(attrib.qrTagId);
  if (!qrTag || !qrTag.active) return null;

  let campaign = null;
  if (qrTag.campaignId) {
    campaign = await Campaign.findByPk(qrTag.campaignId, {
      attributes: ['id', 'name', 'design_config', 'is_active']
    });
  }

  return {
    qrTagId: qrTag.id,
    campaignId: qrTag.campaignId,
    slug: qrTag.slug,
    active: qrTag.active,
    campaign
  };
}

/**
 * Generate a random session ID.
 */
export function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}
