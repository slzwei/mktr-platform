import { asyncHandler } from '../middleware/errorHandler.js';
import * as rsvpService from '../services/rsvpService.js';
import { sendRsvpConfirmationEmail, sendRsvpOrganiserNotification } from '../services/rsvpMailer.js';

// ── admin (router-level authenticateToken + requireAdmin — routes/rsvpAdmin.js) ──

export const listEvents = asyncHandler(async (req, res) => {
  const events = await rsvpService.listEvents();
  res.json({ success: true, data: { events } });
});

export const createEvent = asyncHandler(async (req, res) => {
  const event = await rsvpService.createEvent(req.body, req.user);
  res.status(201).json({ success: true, data: { event } });
});

export const checkSlugAvailability = asyncHandler(async (req, res) => {
  const data = await rsvpService.checkSlugAvailability(String(req.query.slug || ''), {
    excludeEventId: typeof req.query.excludeEventId === 'string' ? req.query.excludeEventId : undefined,
  });
  res.json({ success: true, data });
});

export const getEvent = asyncHandler(async (req, res) => {
  const event = await rsvpService.getEvent(req.params.id);
  res.json({ success: true, data: { event } });
});

export const updateEvent = asyncHandler(async (req, res) => {
  const event = await rsvpService.updateEvent(req.params.id, req.body);
  res.json({ success: true, data: { event } });
});

export const publishEvent = asyncHandler(async (req, res) => {
  const event = await rsvpService.publishEvent(req.params.id);
  res.json({ success: true, data: { event } });
});

export const closeEvent = asyncHandler(async (req, res) => {
  const event = await rsvpService.closeEvent(req.params.id);
  res.json({ success: true, data: { event } });
});

export const deleteEvent = asyncHandler(async (req, res) => {
  await rsvpService.deleteEvent(req.params.id);
  res.json({ success: true });
});

export const purgeEvent = asyncHandler(async (req, res) => {
  const data = await rsvpService.purgeEvent(req.params.id, { actorId: req.user?.id || null, reason: req.body.reason });
  res.json({ success: true, data });
});

export const listResponses = asyncHandler(async (req, res) => {
  const data = await rsvpService.listResponses(req.params.id, {
    cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    limit: req.query.limit,
  });
  res.json({ success: true, data });
});

export const updateResponse = asyncHandler(async (req, res) => {
  const response = await rsvpService.updateResponse(req.params.id, req.params.rid, req.body);
  res.json({ success: true, data: { response } });
});

export const exportResponsesCsv = asyncHandler(async (req, res) => {
  const { filename, csv, truncated } = await rsvpService.exportResponsesCsv(req.params.id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  if (truncated) res.setHeader('X-Rsvp-Export-Truncated', '1');
  res.send(csv);
});

// ── public (routes/rsvpPublic.js; declared in meta.public) ──

export const getPublicEvent = asyncHandler(async (req, res) => {
  const event = await rsvpService.getPublicEvent(req.params.slug);
  if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
  return res.json({ success: true, data: event });
});

export const respond = asyncHandler(async (req, res) => {
  const result = await rsvpService.submitResponse(req.params.slug, req.body, { referrer: req.get('referer') });
  // Honeypot hits get the same shape as a success — nothing to learn from.
  if (result.ignored) return res.json({ success: true, data: { status: 'ok' } });
  // Post-commit, fire-and-forget: SMTP can never turn a saved RSVP into a
  // failed one, and a resubmit only re-mails when it actually changed a seat.
  if (result.notify && (result.created || result.reactivated)) {
    sendRsvpConfirmationEmail(result.notify).catch(() => {});
  }
  // The organiser hears about EVERY accepted submission, edits included — a
  // changed dietary answer matters to whoever is catering.
  if (result.notify) {
    sendRsvpOrganiserNotification(result.notify).catch(() => {});
  }
  return res
    .status(result.created ? 201 : 200)
    .json({ success: true, data: { status: result.created ? 'created' : 'updated' } });
});
