import express from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { SessionVisit } from '../models/index.js';

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

export default router;


