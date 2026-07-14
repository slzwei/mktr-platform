import crypto from 'crypto';
import { QrTag, QrScan, Attribution, Campaign } from '../models/index.js';
import { buildPublicDesignConfig } from '../utils/publicDesignConfig.js';

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

  const scan = await QrScan.create({
    qrTagId: qrTag.id,
    ipHash,
    ua,
    referer,
    device,
    geoCity: null,
    botFlag,
    isDuplicate
  });

  // Bump the denormalized counters on the QR tag so the admin UI's
  // "Scans" / "Unique" columns reflect activity. The analytics row above
  // is the source of truth for reporting; these counters exist to avoid
  // an N+1 count(*) in the QR list. Unique only counts non-duplicate,
  // non-bot hits.
  const counters = { scanCount: 1 };
  if (!isDuplicate && !botFlag) counters.uniqueScanCount = 1;
  await QrTag.increment(counters, { where: { id: qrTag.id } });
  await QrTag.update({ lastScanned: new Date() }, { where: { id: qrTag.id } });

  return scan;
}

/**
 * Create a short-lived attribution token (20 minutes) for the scan.
 * Returns { token, expiresAt } where token is a signed base64url payload.
 */
export async function createAttribution(qrTag, scan, sessionId = null) {
  const expiresAt = new Date(Date.now() + 20 * 60 * 1000);
  // Bind to the session at scan time with a fresh lastTouchAt so the most
  // recently scanned campaign wins (last-touch). Both resolveSession() and
  // prospectService.createProspect() order bound attributions by
  // lastTouchAt DESC; leaving sessionId/lastTouchAt null here caused a later
  // scan of a different campaign to be ignored, mis-attributing the lead to
  // the first campaign the session ever scanned.
  const attrib = await Attribution.create({
    qrTagId: qrTag.id,
    qrScanId: scan.id,
    sessionId,
    firstTouch: false,
    lastTouchAt: sessionId ? new Date() : null,
    expiresAt,
    // A scan-time bind consumes the token for its session: mark usedOnce so a
    // leaked atk cannot later be replayed by a DIFFERENT session (the same
    // session is still allowed to re-bind via the reuse check downstream).
    usedOnce: !!sessionId
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

  // Most-recently-touched attribution wins (last-touch); createdAt then id DESC
  // are deterministic tiebreakers so a same-millisecond lastTouchAt tie always
  // resolves to the same row.
  let attrib = await Attribution.findOne({
    where: { sessionId: sid },
    order: [['lastTouchAt', 'DESC'], ['createdAt', 'DESC'], ['id', 'DESC']]
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
            // Enforce single-use: a token already consumed by another session
            // must not be replayed to bind a different session.
            if (!(tokenAttrib.usedOnce && !reuse)) {
              await tokenAttrib.update({
                sessionId: sid,
                lastTouchAt: new Date(),
                usedOnce: true
              });
              attrib = tokenAttrib;
            }
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
    // min_age / max_age feed the LeadCapture form's inline DOB age gate.
    // Must match the attribute list in campaignPreviewService.getPublicCampaign
    // — the QR-scan path (this fn) and the direct campaign_id link path both
    // hydrate the same form.
    const row = await Campaign.findByPk(qrTag.campaignId, {
      attributes: ['id', 'name', 'design_config', 'is_active', 'metaPixelId', 'tiktokPixelId', 'min_age', 'max_age']
    });
    if (row) {
      // Public endpoint: same design_config whitelist as previews/public —
      // the QR path must not become a side door for internal config keys
      // (luckyDraw activation/terms ids etc.). toJSON-tolerant: DI test mocks
      // return plain objects.
      campaign = typeof row.toJSON === 'function' ? row.toJSON() : { ...row };
      campaign.design_config = buildPublicDesignConfig(campaign.design_config);
    }
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
