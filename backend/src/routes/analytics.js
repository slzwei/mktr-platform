import express from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { SessionVisit, Campaign } from '../models/index.js';

const router = express.Router();

const allowedOrigins = new Set([
  'https://mktr.sg',
  'https://www.mktr.sg',
  'http://localhost:5173'
]);

function isAllowedOrigin(req) {
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  return [...allowedOrigins].some((o) => origin.startsWith(o) || referer.startsWith(o));
}

router.post('/events', asyncHandler(async (req, res) => {
  if (!isAllowedOrigin(req)) {
    throw new AppError('Origin not allowed', 403);
  }

  const { type, meta = {} } = req.body || {};
  if (!type) throw new AppError('Event type required', 400);

  // Read session cookie
  const sid = req.cookies?.sid || req.headers['x-session-id'];
  if (!sid) throw new AppError('Missing session', 400);

  // Upsert visit
  let visit = await SessionVisit.findOne({ where: { sessionId: sid } });
  if (!visit) {
    visit = await SessionVisit.create({
      sessionId: sid,
      landingPath: meta?.path || '/lead-capture',
      utmSource: meta?.utm_source || null,
      utmMedium: meta?.utm_medium || null,
      utmCampaign: meta?.utm_campaign || null,
      utmTerm: meta?.utm_term || null,
      utmContent: meta?.utm_content || null,
      eventsJson: []
    });
  }

  const events = Array.isArray(visit.eventsJson) ? visit.eventsJson : [];
  events.push({ type, ts: new Date().toISOString(), meta: { ...meta, clientTs: meta?.ts || null } });
  await visit.update({ eventsJson: events });

  res.json({ success: true });
}));

// Increment a neutral referral counter for a campaign
router.post('/referrals', asyncHandler(async (req, res) => {
  if (!isAllowedOrigin(req)) {
    throw new AppError('Origin not allowed', 403);
  }

  const sid = req.cookies?.sid || req.headers['x-session-id'];
  if (!sid) throw new AppError('Missing session', 400);

  const { campaignId } = req.body || {};
  if (!campaignId) throw new AppError('campaignId required', 400);

  const campaign = await Campaign.findByPk(campaignId);
  if (!campaign) throw new AppError('Campaign not found', 404);

  const metrics = campaign.metrics || {};
  metrics.referrals = (metrics.referrals || 0) + 1;
  await campaign.update({ metrics });

  // Track referral event in session visit as well
  let visit = await SessionVisit.findOne({ where: { sessionId: sid } });
  if (!visit) {
    visit = await SessionVisit.create({ sessionId: sid, landingPath: '/lead-capture', eventsJson: [] });
  }
  const events = Array.isArray(visit.eventsJson) ? visit.eventsJson : [];
  events.push({ type: 'referral_visit', ts: new Date().toISOString(), meta: { campaignId } });
  await visit.update({ eventsJson: events });

  res.json({ success: true });
}));

export default router;


