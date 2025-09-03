import express from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { QrTag, QrScan, Attribution, Campaign } from '../models/index.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120
});

router.get('/track/:slug', limiter, asyncHandler(async (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');

  const { slug } = req.params;
  const qrTag = await QrTag.findOne({ where: { slug, active: true } });
  if (!qrTag) {
    return res.redirect(302, '/lead-capture?error=not_found');
  }

  const ua = req.headers['user-agent'] || '';
  const referer = req.headers.referer || '';
  const ip = req.ip || req.connection.remoteAddress || '';
  const ipHash = crypto.createHash('sha256').update(`${ip}:${process.env.IP_HASH_SALT || 'salt'}`).digest('hex');
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

  // Create short-lived attribution token (20 minutes)
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
  const sig = crypto.createHmac('sha256', process.env.ATTRIB_SECRET || 'attrib').update(payload).digest('base64url');
  const token = `${payload}.${sig}`;

  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('atk', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    domain: isProd ? '.mktr.sg' : undefined,
    maxAge: 20 * 60 * 1000,
    path: '/'
  });

  // Ensure sid cookie exists here to avoid an extra binder hop
  let sid = req.cookies?.sid;
  if (!sid) {
    sid = crypto.randomBytes(16).toString('hex');
    res.cookie('sid', sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      domain: isProd ? '.mktr.sg' : undefined,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });
  }

  // Redirect directly to the frontend SPA preserving shareable params
  const search = new URLSearchParams({
    ...(qrTag.campaignId ? { campaign_id: String(qrTag.campaignId) } : {}),
    slug: qrTag.slug,
  }).toString();
  // Go through binder to ensure attribution ↔ session binding before landing on SPA
  return res.redirect(302, `/lead-capture?${search}`);
}));

// Resolve current session attribution -> campaign/qrTag for SPA to load design
router.get('/session', asyncHandler(async (req, res) => {
  const sid = req.cookies?.sid;
  if (!sid) {
    return res.json({ success: true, data: null });
  }

  let attrib = await Attribution.findOne({
    where: { sessionId: sid },
    order: [['lastTouchAt', 'DESC']]
  });

  // If no bound attribution yet, bind from short-lived token (atk)
  if (!attrib && req.cookies?.atk) {
    try {
      const atk = req.cookies.atk;
      const [payload, sig] = atk.split('.');
      const expected = crypto.createHmac('sha256', process.env.ATTRIB_SECRET || 'attrib').update(payload).digest('base64url');
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

  if (!attrib) {
    return res.json({ success: true, data: null });
  }

  const qrTag = await QrTag.findByPk(attrib.qrTagId);
  if (!qrTag || !qrTag.active) {
    return res.json({ success: true, data: null });
  }

  let campaign = null;
  if (qrTag.campaignId) {
    campaign = await Campaign.findByPk(qrTag.campaignId, {
      attributes: ['id', 'name', 'design_config', 'is_active']
    });
  }

  return res.json({
    success: true,
    data: {
      qrTagId: qrTag.id,
      campaignId: qrTag.campaignId,
      slug: qrTag.slug,
      active: qrTag.active,
      campaign
    }
  });
}));

export default router;


