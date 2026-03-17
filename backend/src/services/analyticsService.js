import { SessionVisit, Campaign } from '../models/index.js';

/**
 * Upsert a session visit and append an analytics event.
 */
export async function trackEvent(sid, type, meta = {}) {
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
}

/**
 * Track a referral visit for a campaign in the session.
 * Campaign-level referral counts are now computed from session visit data,
 * so we no longer increment a JSON counter (which had a race condition).
 */
export async function trackReferral(sid, campaignId) {
  if (!campaignId) {
    const err = new Error('campaignId required');
    err.statusCode = 400;
    throw err;
  }

  const campaign = await Campaign.findByPk(campaignId);
  if (!campaign) {
    const err = new Error('Campaign not found');
    err.statusCode = 404;
    throw err;
  }

  // Track referral event in session visit (the source of truth for referral counts)
  let visit = await SessionVisit.findOne({ where: { sessionId: sid } });
  if (!visit) {
    visit = await SessionVisit.create({ sessionId: sid, landingPath: '/lead-capture', eventsJson: [] });
  }
  const events = Array.isArray(visit.eventsJson) ? visit.eventsJson : [];
  events.push({ type: 'referral_visit', ts: new Date().toISOString(), meta: { campaignId } });
  await visit.update({ eventsJson: events });
}
