import { asyncHandler } from '../middleware/errorHandler.js';
import * as rsvpService from '../services/rsvpService.js';

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

export const listResponses = asyncHandler(async (req, res) => {
  const data = await rsvpService.listResponses(req.params.id, {
    cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    limit: req.query.limit,
  });
  res.json({ success: true, data });
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
  return res
    .status(result.created ? 201 : 200)
    .json({ success: true, data: { status: result.created ? 'created' : 'updated' } });
});
